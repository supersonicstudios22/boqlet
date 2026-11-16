"""
pipeline.py - getBoq: ParsedModel(s) + rules + classifications + dictionaries (+ decisions) -> BoqResult.

    result = get_boq(parsed, rules, classifications=[(code_list, map)], dictionaries=[...],
                     resolution=settings, decisions=[...])
    result = get_boq([{"id": "arch", "parsed": p1, "meshes": m1, "discipline": "architecture"},
                      {"id": "str", "parsed": p2, "meshes": m2, "discipline": "structure", "scope": {...}}],
                     rules, ..., federation=FederationSettings)

One ParsedModel is a federation of one; a list is combined by federation.py before the rules.
`meshes` (optional, {guid: trimesh}) is the model's mesh sidecar (geometry.py); federation uses it
to compare solids and to link rooms and embedded elements across models.

`rules` may be a flattened RuleSet or a RuleSetPatch together with `rule_library`
(all rule sets by id) so the chain can be flattened here.

Order of work (each step writes to the calculation log):
  1. parse summary              (the ParsedModel is produced by parse.py and cached)
  2. names + measure            dictionaries -> terms; adopt quantities per element, per model
     federation                 several models -> one set of elements (federation.py)
  3. rules                      items -> lines, then derived lines, then manual lines
  4. coverage                   unmatched / excluded / covered-by-parent elements
  5. classification             codes per line per system
  6. questions                  blocking ones make status "needs_input"
"""
from __future__ import annotations

import time
from collections import defaultdict

from .classify import classify
from .expr import Expr, fmt
from .federation import combine
from .log import CalcLog
from .measure import build as measure, building_measures
from .names import Resolver, decision_entries
from .overrides import apply_final, apply_quantity, from_decisions
from .rules import RuleEngine, enabled_view, flatten, integrity, referenced_fields, unmatched_id

INTERNAL = ("_fields", "_mixed", "_parts", "_source_key", "_manual_kind")


def element_boxes(parsed: dict) -> dict[str, tuple]:
    """GlobalId -> (min xyz, max xyz) in world coordinates: the element's own mesh, or for an
    aggregate without a body of its own the union of its parts' boxes."""
    els = {e["id"]: e for e in parsed["elements"]}
    out: dict[str, tuple] = {}

    def box(g: str, depth: int = 0):
        if g in out or depth > 20:
            return out.get(g)
        geo = els[g]["quantities"]["geometry"]
        if geo.get("bboxMin") and geo.get("bboxMax"):
            out[g] = (geo["bboxMin"], geo["bboxMax"])
        else:
            parts = [b for c in els[g].get("childIds", []) if c in els for b in [box(c, depth + 1)] if b]
            if parts:
                out[g] = ([min(b[0][i] for b in parts) for i in range(3)], [max(b[1][i] for b in parts) for i in range(3)])
        return out.get(g)
    for g in els:
        box(g)
    return out


def _worth_asking(r: dict, settings: dict, x: Expr) -> bool:
    rules = settings.get("askFor")
    if not rules:
        return True
    return any(a["field"] == r["field"] and (not a.get("when") or x.evaluate(a["when"], r.get("ctx", {}))) for a in rules)


def names_in_model(parsed: dict, dictionaries: list[dict], resolution: dict | None = None) -> list[dict]:
    """Every distinct name the model uses (materials, layer materials, type names), how the given
    dictionaries resolve it, and on which elements. Used by the dictionary editor; runs no rules.

    One row per (field, raw text, resolved term): the same text can mean different things on
    different element classes when an entry has a `when` condition."""
    resolution = resolution or {}
    rv = Resolver(dictionaries, resolution)
    _, resolutions = measure(parsed, rv, CalcLog())
    rows: dict[tuple, dict] = {}
    guids: dict[tuple, set] = defaultdict(set)
    for r in resolutions:
        key = (r["field"], r["raw"], r["term"])
        row = rows.setdefault(key, {
            "field": r["field"], "raw": r["raw"], "term": r["term"], "method": r["method"],
            "layer": r.get("layer"), "dictionary": r.get("dictionary"), "entryId": r.get("entryId"),
            "classes": [], "count": 0, "worthAsking": False,
            "extracted": {k: v["value"] for k, v in rv.extract(r["field"], r["raw"], r.get("ctx", {})).items()},
        })
        cls = r.get("ctx", {}).get("ifc_class")
        if cls and cls not in row["classes"]:
            row["classes"].append(cls)
        guids[key].add(r["guid"])
        if r["term"] is None and _worth_asking(r, resolution, rv.expr):
            row["worthAsking"] = True
    for key, row in rows.items():
        row["count"] = len(guids[key])
        row["classes"].sort()
    return sorted(rows.values(), key=lambda r: (r["field"], r["term"] is not None, r["raw"].lower()))


def get_boq(parsed: dict, rules: dict, classifications: list[tuple[dict, dict]], dictionaries: list[dict],
            resolution: dict | None = None, decisions: list[dict] | None = None,
            rule_library: dict[str, dict] | None = None, federation: dict | None = None,
            progress=None) -> dict:
    t0 = time.time()
    log = CalcLog()
    resolution = resolution or {}
    decisions = decisions or []
    overrides = from_decisions(decisions)
    answers = {d["questionId"]: d.get("answer") for d in decisions}

    models = ([{"id": None, "parsed": parsed}] if isinstance(parsed, dict) and "header" in parsed
              else [dict(m) for m in parsed])
    for m in models:
        h = m["parsed"]["header"]
        m["id"] = m.get("id") or h["source"]["sha256"][:12]
        m["fileName"] = h["source"]["fileName"]
        m["discipline"] = m.get("discipline") or h.get("disciplineGuess") or "unknown"

    # 1. parse summary ------------------------------------------------------------------
    for m in models:
        h, st = m["parsed"]["header"], m["parsed"]["stats"]
        log.info("parse", f"{h['source']['fileName']}: {h['ifcSchema']}, {h.get('authoringApp', {}).get('fullName', 'unknown tool')}, "
                          f"{st['elementCount']} elements, {st['openingCount']} openings, {st['spaceCount']} spaces "
                          f"(discipline guess: {h.get('disciplineGuess')}" + (f", run as {m['discipline']})" if len(models) > 1 else ")"),
            code="log.parse.model", params=dict(
                fileName=h['source']['fileName'], schema=h['ifcSchema'],
                authoringApp=(h.get('authoringApp') or {}).get('fullName'), elements=st['elementCount'],
                openings=st['openingCount'], spaces=st['spaceCount'], disciplineGuess=h.get('disciplineGuess'),
                discipline=m['discipline'],
            ))
        if m["parsed"]["verification"]["summary"]:
            log.info("parse", "verification: " + ", ".join(f"{k} x{v}" for k, v in m["parsed"]["verification"]["summary"].items()),
                code="log.parse.verification", params=dict(checks=m['parsed']['verification']['summary']))

    # 2. names + measure (per model), federation ------------------------------------------
    if progress:
        progress("names", 20, "Resolving model names")
    flat = rules if "extends" not in rules else flatten(rules, rule_library or {})
    if "chain" not in flat:
        flat = flatten(flat, {})
    dec_entries = decision_entries(decisions)
    rv = Resolver(dictionaries, resolution, dec_entries)
    log.info("names", "dictionaries: " + ", ".join(f"{d['id']} ({d['layer']})" for d in dictionaries)
             + (f"; {len(dec_entries)} name answer(s) from decisions" if dec_entries else ""),
        code="log.names.dictionaries", params=dict(
            dictionaries=[{'id': d['id'], 'layer': d['layer']} for d in dictionaries],
            decisions=len(dec_entries),
        ))
    resolutions = []
    measure_questions: dict[str, dict] = {}                # contradictions, merged across models
    if progress:
        progress("measure", 35, "Measuring elements")
    for m in models:
        qs: list[dict] = []
        m["elements"], res = measure(m["parsed"], rv, log, model_id=m["id"], discipline=m["discipline"],
                                     answers=answers, questions=qs)
        m["boxes"] = element_boxes(m["parsed"])
        resolutions += res
        for q in qs:
            if q["id"] in measure_questions:
                existing = measure_questions[q["id"]]
                existing["guids"] += q["guids"]
                existing["occurrences"] += q["occurrences"]
                existing["params"]["count"] = existing["occurrences"]
                existing["params"]["minDifference"] = min(existing["params"]["minDifference"], q["params"]["minDifference"])
                existing["params"]["maxDifference"] = max(existing["params"]["maxDifference"], q["params"]["maxDifference"])
            else:
                measure_questions[q["id"]] = q
    if progress:
        progress("federate", 55, "Combining models")
    elements, model_reports, fed_questions, fed_warnings = combine(models, federation or {}, rv.expr, log, answers)
    distinct = {}
    for r in resolutions:
        distinct.setdefault((r["field"], r["raw"]), {**r, "count": 0})["count"] += 1
    for (field, raw), r in sorted(distinct.items(), key=lambda kv: (kv[0][0], kv[0][1] or "")):
        if r["term"]:
            log.detail("names", f"{field} '{raw}' -> {r['term']} ({r['method']} match, {r['layer']} layer, "
                                f"dictionary {r.get('dictionary')}, entry {r.get('entryId')}) x{r['count']}",
                code="log.names.resolved", params=dict(
                    field=field, raw=raw, term=r['term'], method=r['method'], layer=r['layer'],
                    dictionary=r.get('dictionary'), entryId=r.get('entryId'), count=r['count'],
                ))
        else:
            log.detail("names", f"{field} '{raw}' -> UNRESOLVED x{r['count']}",
                code="log.names.unresolved", params=dict(field=field, raw=raw, count=r['count']))
    n_ok = sum(1 for r in distinct.values() if r["term"])
    log.info("names", f"{n_ok} of {len(distinct)} distinct names resolved",
        code="log.names.summary", params=dict(resolved=n_ok, total=len(distinct)))

    # 3. rules ----------------------------------------------------------------------------
    if progress:
        progress("rules", 70, "Applying measurement rules")
    log.info("match", f"rule set '{flat['name']}' ({' -> '.join(flat['chain'])}), "
                      f"{len(flat['items'])} item rules, {len(flat.get('derived', []))} derived, {len(flat.get('manual', []))} manual",
        code="log.match.rule_set", params=dict(
            name=flat['name'], chain=flat['chain'], items=len(flat['items']),
            derived=len(flat.get('derived', [])), manual=len(flat.get('manual', [])),
        ))
    warnings: list[dict] = [{"code": "rule_set", "message": p, "params": {"problem": p}} for p in integrity(flat)]
    for w in warnings:
        log.warn("match", w["message"],
            code="log.match.rule_set_problem", params=dict(problem=w['message']))
    warnings += fed_warnings                                # federation logged its own
    building = building_measures(elements, [m["parsed"] for m in models], log)
    eng = RuleEngine(flat, elements, rv.expr, log, answers, building)
    eng.run_items()
    eng.finalize_lines()
    item_lines = list(eng.lines.values())
    for line in item_lines:
        if (edit := overrides.get(line["key"])) is not None:
            apply_quantity(line, edit)
    derived_lines = eng.run_derived()
    manual_lines = eng.run_manual()
    for line in derived_lines + manual_lines:
        if (edit := overrides.get(line["key"])) is not None:
            apply_quantity(line, edit)
    lines = item_lines + derived_lines + manual_lines
    warnings += eng.warnings
    questions: list[dict] = list(eng.questions) + fed_questions + list(measure_questions.values())

    # 4. coverage -------------------------------------------------------------------------
    parent_of = {e["guid"]: e.get("parent_guid") for e in elements}

    def ancestor_measured(g: str) -> bool:                # parts of parts (HiCAD nests bolts in fixings in railings)
        seen, p = set(), parent_of.get(g)
        while p and p not in seen:
            if p in eng.matched:
                return True
            seen.add(p)
            p = parent_of.get(p)
        return False
    covered = {e["guid"] for e in elements if ancestor_measured(e["guid"])} | eng.through_parts
    # an aggregate (IfcElementAssembly) whose parts are all measured or excluded is covered by them
    done = eng.matched | eng.excluded
    for _ in range(20):                                   # nested assemblies, bottom up
        more = {e["guid"] for e in elements if e.get("child_guids") and e["guid"] not in done | covered
                and all(c in done or c in covered for c in e["child_guids"])}
        if not more:
            break
        covered |= more
    groups = defaultdict(list)
    for e in elements:
        g = e["guid"]
        if g in eng.matched or g in eng.excluded or g in covered:
            continue
        groups[unmatched_id(e)].append(e)
    for qid, els in sorted(groups.items()):
        e0 = els[0]
        questions.append({"id": qid, "kind": "unmatched", "blocking": False, "guids": [e["guid"] for e in els],
                          "occurrences": len(els),
                          "code": "question.unmatched", "params": {"count": len(els), "ifcClass": e0["ifc_class"],
                                                                  "name": e0.get("type_name") or e0.get("name")},
                          "message": f"{len(els)} x {e0['ifc_class']} '{e0.get('type_name') or e0.get('name')}' not measured by any rule. "
                                     f"Assign a rule or exclude.",
                          "answer": {"kind": "rule"}})
    unmatched_n = sum(len(v) for v in groups.values())
    log.info("match", f"coverage: {len(eng.matched)} measured, {len(covered - eng.matched)} covered by their parent or parts, "
                      f"{len(eng.excluded)} excluded, {unmatched_n} unmatched",
        code="log.match.coverage", params=dict(
            measured=len(eng.matched), covered=len(covered - eng.matched), excluded=len(eng.excluded),
            unmatched=unmatched_n,
        ))

    # names that matter -> questions
    refs = referenced_fields(enabled_view(flat), [m for _, m in classifications])
    field_needed = {"material": "material" in refs, "layer_material": "material" in refs or "layers" in refs,
                    "type_name": "element_type" in refs, "space_name": "space_type" in refs}
    for (field, raw), r in sorted(distinct.items(), key=lambda kv: (kv[0][0], kv[0][1] or "")):
        if r["term"] or not raw or not _worth_asking(r, resolution, rv.expr):
            continue
        blocking = resolution.get("unresolved", "ask") == "ask" and field_needed.get(field, False)
        questions.append({"id": f"name:{field}:{raw}", "kind": "unknown_name", "blocking": blocking,
                          "field": field, "raw": raw, "occurrences": r["count"],
                          "code": "question.unknown_name", "params": {"field": field, "raw": raw, "count": r["count"],
                                                                     "blocking": blocking},
                          "message": f"What is '{raw}' ({field.replace('_', ' ')})? Used {r['count']} time(s)."
                                     + ("" if blocking else " Not used by the current rules."),
                          "answer": {"kind": "term", "category": "element_type" if field == "type_name" else
                                     ("space" if field == "space_name" else "material")}})

    # 5. classification -----------------------------------------------------------------
    if progress:
        progress("classify", 85, "Classifying lines")
    for code_list, cmap in classifications:
        classify(lines, code_list, cmap, rv.expr, log, answers, questions, warnings, overrides=overrides)
    questions.extend(apply_final(lines, overrides, log))

    # 6. questions & decisions ----------------------------------------------------------
    applied = [q for q in questions if q["id"] in answers]
    for d in decisions:
        if d["questionId"].startswith("override:"):
            continue
        log.info("decision", f"answer applied: {d['questionId']} = {d.get('answer')!r}",
            code="log.decision.answer_applied", params=dict(questionId=d['questionId'], answer=d.get('answer')))
    questions = [q for q in questions if q["id"] not in answers]
    for q in questions:
        log.add("summary", f"question ({'blocking' if q['blocking'] else 'info'}): {q['message']}",
                "warning" if q["blocking"] else "info",
            code="log.summary.question", params=dict(
                blocking=q['blocking'], questionCode=q['code'], message=q['message'],
            ))

    # assemble ---------------------------------------------------------------------------
    primary = classifications[0][0]["id"] if classifications else None
    order = {i["id"]: n for n, i in enumerate(flat["items"] + flat.get("derived", []) + flat.get("manual", []))}

    def sort_key(l):
        path = [p["code"] for p in l.get("codes", {}).get(primary, {}).get("path", [])] if primary else []
        return (0 if path else 1, path, order.get(l["ruleId"], 999), l["description"])

    out_lines = []
    for l in sorted(lines, key=sort_key):
        bl = {k: v for k, v in l.items() if k not in INTERNAL}
        bl.setdefault("codes", {})
        if bl.get("quantity") is not None:
            bl["quantity"] = round(bl["quantity"], 6)
        out_lines.append(bl)
    blocking = [q for q in questions if q["blocking"]]
    status = "needs_input" if blocking else "complete"
    flagged = sum(1 for l in out_lines if l["quantity"] is None)
    log.info("summary", f"{len(out_lines)} lines ({flagged} flagged), {len(questions)} open question(s) "
                        f"({len(blocking)} blocking) -> {status}",
        code="log.summary.result", params=dict(
            lines=len(out_lines), flagged=flagged, questions=len(questions), blocking=len(blocking),
            status=status,
        ))
    ruleset_snapshot = {k: v for k, v in flat.items() if k != "chain"}
    ruleset_snapshot["meta"] = {**ruleset_snapshot.get("meta", {}), "chain": " -> ".join(flat["chain"])}
    return {
        "status": status,
        "log": log.entries,
        "ruleSet": ruleset_snapshot,
        "lines": out_lines,
        "questions": questions,
        "warnings": warnings,
        "checks": [c if len(models) == 1 else {**c, "id": f"{m['fileName']}:{c['id']}"}
                   for m in models for c in m["parsed"]["verification"]["checks"]],
        "models": model_reports,
        "building": building,
        "stats": {
            "elements": len(elements), "measuredElements": len(eng.matched), "excludedElements": len(eng.excluded),
            "unmatchedElements": unmatched_n, "lines": len(out_lines), "flaggedLines": flagged,
            "decisionsApplied": len(applied) + sum("overridden" in line for line in out_lines),
            "durationMs": int((time.time() - t0) * 1000),
        },
    }
