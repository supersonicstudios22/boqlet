"""Compare immutable BoQ runs and their model versions by stable IDs."""
from __future__ import annotations

from collections import Counter, defaultdict

CHANGE_TYPES = ("added", "removed", "changed")
LINE_FIELDS = ("quantity", "unit", "description", "codes")


def _snapshot(line):
    """The line as the BoQ shows it; an edited quantity also keeps the engine's value under it (BR-09)."""
    snapshot = {field: line[field] for field in LINE_FIELDS}
    edit = line.get("overridden") or {}
    if "quantity" in edit.get("fields", []):
        snapshot["engineQuantity"] = edit.get("engineQuantity")
    return snapshot


def _edit(line):
    """What the user edited, without the engine values it replaced (those move with the model)."""
    return {k: v for k, v in (line.get("overridden") or {}).items() if not k.startswith("engine")} if line else None


def _elements(model):
    parsed = model.get("parsed") or {}
    storeys = {node["id"]: node.get("name") for node in parsed.get("spatial", []) if node["kind"] == "storey"}
    catalogues = parsed.get("catalogues", {})
    materials = {m["id"]: m["name"] for m in catalogues.get("materials", [])}
    types = {entry["id"]: entry.get("name") for entry in catalogues.get("types", [])}
    layers = {entry["id"]: entry for entry in catalogues.get("layerSets", [])}

    def names(value):
        if isinstance(value, list):
            return [names(item) for item in value]
        if isinstance(value, dict):
            return {
                key: materials.get(item, item) if key == "materialId" else names(layers.get(item, item))
                if key == "layerSetId" else names(item)
                for key, item in value.items() if key != "id"
            }
        return value

    return {
        e["id"]: {
            "class": e["ifcClassBase"], "type": types.get(e.get("typeId")) or e.get("objectType"),
            "name": e.get("name"), "storey": storeys.get(e.get("storeyId")),
            "material": names(e.get("materialRef")), "reported": e.get("quantities", {}).get("reported"),
        }
        for e in parsed.get("elements", [])
    }


def _shares(lines, models):
    traces = {m.get("traceId", m["modelId"]): m["modelId"] for m in models}
    memberships = defaultdict(set)
    for model in models:
        for item in (model.get("parsed") or {}).get("elements", []):
            memberships[item["id"]].add(model["modelId"])
    output = defaultdict(dict)
    for line in lines.values():
        for entry in line.get("trace", {}).get("elements", []):
            guid = entry["guid"]
            if not guid:
                continue
            model = traces.get(entry.get("model"))
            if model is None and len(memberships.get(guid, ())) == 1:
                model = next(iter(memberships[guid]))
            if model is None and len(models) == 1:
                model = models[0]["modelId"]
            shares = output[model, guid]
            shares[line["key"]] = round(shares.get(line["key"], 0) + (entry.get("quantity") or 0), 6)
    return output


def _model_changes(before, after, old_shares, new_shares, derived=frozenset()):
    old_models = {m["modelId"]: m for m in before}
    new_models = {m["modelId"]: m for m in after}
    changes, by_model = [], []
    causes = defaultdict(set)
    churn = False
    for model_id in dict.fromkeys([*new_models, *old_models]):
        first, second = old_models.get(model_id), new_models.get(model_id)
        if first and second and first["versionId"] == second["versionId"]:
            continue
        name = (second or first)["name"]
        old = _elements(first) if first else {}
        new = _elements(second) if second else {}
        counts = dict.fromkeys(CHANGE_TYPES, 0)
        for guid in dict.fromkeys([*new, *old]):
            left, right = old.get(guid), new.get(guid)
            a = old_shares.get((model_id, guid), {})
            b = new_shares.get((model_id, guid), {})
            keys = sorted(a.keys() | b.keys())
            # Derived lines spread an edited source quantity over its elements; what the model gives an
            # element is its share of the item lines.
            measured_a = {key: share for key, share in a.items() if key not in derived}
            measured_b = {key: share for key, share in b.items() if key not in derived}
            fields = []
            if left is None:
                change = "added"
            elif right is None:
                change = "removed"
            else:
                change = "changed"
                fields = [field for field in ("class", "type", "name", "storey", "material")
                          if left[field] != right[field]]
                if measured_a != measured_b or left["reported"] != right["reported"]:
                    fields.append("quantities")
                if not fields:
                    continue
            counts[change] += 1
            changes.append({"guid": guid, "model": name, "change": change, "fields": fields, "lineKeys": keys})
            for key in keys:
                causes[key].add("elements_" + change)
        if sum(counts.values()):
            by_model.append({"model": name, **counts})
        churn |= bool(old and new and counts["removed"] * 2 > len(old) and counts["added"] * 2 > len(new))
    return changes, by_model, causes, churn


def _rules(result):
    return {rule["id"]: rule for kind in ("items", "derived", "manual")
            for rule in result.get("ruleSet", {}).get(kind, [])}


def _decision_changes(before, after):
    a = {d["questionId"]: d for d in before}
    b = {d["questionId"]: d for d in after}
    guids, other = set(), False
    for key in a.keys() | b.keys():
        first, second = a.get(key), b.get(key)
        if first is not None and second is not None and first["answer"] == second["answer"]:
            continue
        elements = {guid for decision in (first, second) if decision
                    for guid in (decision.get("question") or {}).get("guids", [])}
        guids.update(elements)
        other |= not elements
    return guids, other


def _override_keys(before, after):
    a = {line["key"]: line for line in before["lines"]}
    b = {line["key"]: line for line in after["lines"]}
    keys = {key for key in a.keys() | b.keys() if _edit(a.get(key)) != _edit(b.get(key))}
    guids = {entry["guid"] for key in keys for line in (a.get(key), b.get(key)) if line
             for entry in line.get("trace", {}).get("elements", []) if entry["guid"]}
    return keys, guids


def compare(before, after, from_models=(), to_models=(), *, inputs_changed=(), from_decisions=(), to_decisions=()):
    a = {line["key"]: line for line in before["lines"] if not line.get("excluded")}
    b = {line["key"]: line for line in after["lines"] if not line.get("excluded")}
    a_shares, b_shares = _shares(a, from_models), _shares(b, to_models)
    derived = {line["key"] for line in (*a.values(), *b.values()) if line["ruleKind"] == "derived"}
    elements, by_model, model_causes, churn = _model_changes(from_models, to_models, a_shares, b_shares, derived)
    a_rules, b_rules = _rules(before), _rules(after)
    decisions, other_decisions = _decision_changes(from_decisions, to_decisions)
    overridden, overridden_guids = _override_keys(before, after)
    changed_rules = {rule for rule in a_rules.keys() | b_rules.keys() if a_rules.get(rule) != b_rules.get(rule)}
    line_changes = []
    for key in dict.fromkeys([*b, *a]):
        left, right = a.get(key), b.get(key)
        old = _snapshot(left) if left is not None else None
        new = _snapshot(right) if right is not None else None
        if old == new:
            continue
        causes = set(model_causes.get(key, ()))
        change = "added" if left is None else "removed" if right is None else "changed"
        rule = (right or left)["ruleId"]
        traces = [line.get("trace", {}) for line in (left, right) if line]
        guids = {entry["guid"] for trace in traces for entry in trace.get("elements", []) if entry["guid"]}
        if rule in changed_rules or (len(traces) == 2 and traces[0].get("params") != traces[1].get("params")):
            causes.add("rules_changed")
        if len(traces) == 1 and "inputs.ruleSet" in inputs_changed and not causes:
            causes.add("rules_changed")
        if key in overridden or any(trace.get("sourceLine") in overridden for trace in traces):
            causes.add("override_changed")
        if (right or left)["ruleKind"] == "derived" and guids & overridden_guids and not causes:
            causes.add("override_changed")
        if guids & decisions or (other_decisions and not causes):
            causes.add("decision_changed")
        if "inputs.classifications" in inputs_changed and not causes:
            causes.add("rules_changed")
        x, y = old["quantity"] if old else 0, new["quantity"] if new else 0
        delta = round(y - x, 6) if x is not None and y is not None else None
        delta_pct = round((y - x) / abs(x) * 100, 6) if old and new and x and y is not None else None
        line_changes.append({"lineKey": key, "change": change,
                             **({"before": old} if old else {}), **({"after": new} if new else {}),
                             "delta": delta, "deltaPct": delta_pct, "causes": sorted(causes)})
    previous_questions = {q["id"] for q in before.get("questions", [])}
    next_questions = {q["id"] for q in after.get("questions", [])}
    questions = {"new": sorted(next_questions - previous_questions),
                 "resolved": sorted(previous_questions - next_questions)}
    line_counts = Counter(change["change"] for change in line_changes)
    element_counts = Counter(change["change"] for change in elements)
    return {
        "lines": line_changes, "elements": elements, "questions": questions,
        "summary": {
            **{f"lines{change.title()}": line_counts[change] for change in CHANGE_TYPES},
            **{f"elements{change.title()}": element_counts[change] for change in CHANGE_TYPES},
            "linesUnchanged": len(a.keys() | b.keys()) - len(line_changes),
            "questionsNew": len(questions["new"]), "questionsResolved": len(questions["resolved"]),
            "guidChurnWarning": churn, "inputsChanged": list(inputs_changed), "byModel": by_model,
        },
    }
