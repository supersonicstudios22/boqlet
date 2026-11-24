"""
rules.py - input (2): execute a rule set (OurRuleType, packages/types/src/rules.ts)
against MeasuredElement[] and produce BoQ lines.

  flatten()      RuleSetPatch chain -> one RuleSet (snapshot stored with the result)
  integrity()    problems in a rule set regardless of the model
  RuleEngine     selection, quantities (QuantitySpec), deductions, breakdowns, line keys,
                 bands, rounding, claims, onMissing, derived rules, manual items

Every number is explained in the calculation log ("quantity" / "derived" stages) and in
each line's trace, so a user can see exactly how it was produced.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from itertools import combinations

from .expr import Expr, fmt, step_round
from .log import CalcLog
from .measure import scale_label
from .templates import render as render_template
from .trace_steps import collect, quantity_delta, slot, step

UNIT_SCALE_FIELDS = {"net_volume": "volume", "net_area": "area", "length": "length"}   # MeasuredElement.unit_scale

UNIT_DEFAULT = {"count": "nr", "length": "m", "area": "m2", "volume": "m3", "mass": "kg", "perimeter": "m"}
UNIT_FACTOR = {  # from SI base (m, m2, m3, kg, nr)
    "m": 1, "mm": 1000, "km": 0.001, "ft": 3.280839895, "m2": 1, "ft2": 10.7639104, "yd2": 1.19599005,
    "m3": 1, "ft3": 35.3146667, "yd3": 1.30795062, "kg": 1, "t": 0.001, "lb": 2.20462262,
}
# What a line unit measures, for the double-count check (review A-20); a unit not listed is its own family.
UNIT_FAMILY = {"nr": "count", "m": "length", "mm": "length", "km": "length", "ft": "length",
               "m2": "area", "ft2": "area", "yd2": "area", "m3": "volume", "ft3": "volume", "yd3": "volume",
               "kg": "mass", "t": "mass", "lb": "mass"}
MIXABLE = ("material", "element_type", "storey", "storey_elevation", "predefined_type", "is_external", "ifc_class", "family")


# ============================================================================ rule sets
def flatten(target: dict, library: dict[str, dict]) -> dict:
    """params merge by name; sections merge by id; items / derived / manual override by id; `remove` drops ids."""
    if "extends" not in target:
        out = json.loads(json.dumps(target))
        out.setdefault("derived", [])
        out.setdefault("manual", [])
        out["chain"] = [target["id"]]
        return out
    if target["extends"] not in library:
        raise ValueError(f"Rule set '{target['id']}' extends unknown rule set '{target['extends']}'")
    base = flatten(library[target["extends"]], library)
    for name, p in (target.get("params") or {}).items():
        base["params"][name] = {**base["params"].get(name, {}), **p}
    if "scope" in target:
        base["scope"] = target["scope"]
    if "setupSteps" in target:
        base["setupSteps"] = target["setupSteps"]
    if target.get("sections"):
        sections = {s["id"]: s for s in base.get("sections", [])}
        for s in target["sections"]:
            sections[s["id"]] = {**sections.get(s["id"], {}), **s}
        base["sections"] = list(sections.values())
    removed = set(target.get("remove", []))
    for key in ("items", "derived", "manual"):
        cur = {x["id"]: x for x in base.get(key, [])}
        for x in target.get(key, []):
            cur[x["id"]] = x
        base[key] = [x for x in cur.values() if x["id"] not in removed]
    for k in ("id", "name", "version"):
        base[k] = target[k]
    base["meta"] = {**base.get("meta", {}), **target.get("meta", {})}
    if target.get("defaults"):
        base["defaults"] = {**base.get("defaults", {}), **target["defaults"]}
    base["chain"] = base["chain"] + [target["id"]]
    base.pop("extends", None)
    base.pop("remove", None)
    return base


def integrity(rules: dict) -> list[str]:
    ids = {x["id"] for x in rules["items"]}
    out = [f"derived rule '{d['id']}' reads from '{src}', which does not exist (removed or renamed?)"
           for d in rules.get("derived", []) for src in d["from"] if src not in ids]
    params = set(rules["params"])
    formula_slots = [{"id": f"slot {k}", "value": p["value"]} for k, p in rules["params"].items() if p.get("type") == "formula"]
    for x in rules["items"] + rules.get("derived", []) + rules.get("manual", []) + formula_slots:
        blob = json.dumps(x)
        for ref in re.findall(r'"param":\s*"([^"]+)"', blob) + re.findall(r"\bp\.([A-Za-z_][A-Za-z0-9_]*)", blob):
            if ref not in params:
                out.append(f"'{x['id']}' uses parameter '{ref}', which is not defined")
    return sorted(set(out))


def enabled_view(flat: dict) -> dict:
    """The rule set as it runs: enabled items, derived and manual rules only, parameter slots
    replaced by their values (formula slots included). What 'used by the current rules' means."""
    params = {k: p.get("value") for k, p in flat.get("params", {}).items()}

    def fill(v):
        if isinstance(v, dict):
            if set(v) == {"param"}:
                return fill(params.get(v["param"]))
            return {k: fill(x) for k, x in v.items()}
        if isinstance(v, list):
            return [fill(x) for x in v]
        return v
    on = lambda r: fill(r.get("enabled", True)) is not False
    return {k: [fill(r) for r in flat.get(k, []) if on(r)] for k in ("items", "derived", "manual")}


def referenced_fields(rules: dict, maps: list[dict]) -> set[str]:
    """Which element fields rules and maps actually use (drives which questions block)."""
    blob = json.dumps({"rules": rules, "maps": maps})
    fields = set()
    for f in ("material", "element_type", "space_type", "layers", "family_name", "type_name"):
        if re.search(rf'\b{f}\b', blob):
            fields.add(f)
    return fields


# ============================================================================ engine
def select(sel: dict, el: dict, expr: Expr, val=lambda v: v, ctx=None) -> bool:
    """Does a Selector (rules.ts) match a measured element? Shared by rules and federation.
    `val` resolves parameter slots; `ctx` is the expression context for `expr` selectors."""
    if "all" in sel:
        return all(select(s, el, expr, val, ctx) for s in sel["all"])
    if "any" in sel:
        return any(select(s, el, expr, val, ctx) for s in sel["any"])
    if "not" in sel:
        return not select(sel["not"], el, expr, val, ctx)
    if "ifcClass" in sel:
        cls = sel["ifcClass"] if isinstance(sel["ifcClass"], list) else [sel["ifcClass"]]
        return el["ifc_class"] in cls or el["ifc_class_raw"] in cls
    if "family" in sel:
        fams = sel["family"] if isinstance(sel["family"], list) else [sel["family"]]
        return el["family"] in fams
    if "expr" in sel:
        return bool(expr.evaluate(sel["expr"], ctx if ctx is not None else el))
    f, op, v = sel["field"], sel["op"], val(sel.get("value"))
    x = el.get("props", {}).get(f[6:]) if f.startswith("props.") else el.get(f)
    if op == "eq":
        return x == v
    if op == "neq":
        return x != v
    if op == "in":
        return x in (v or [])
    if op == "not_in":
        return x not in (v or [])
    if op == "contains":
        return x is not None and str(v).lower() in str(x).lower()
    if op == "starts_with":
        return x is not None and str(x).lower().startswith(str(v).lower())
    if op == "matches":
        return x is not None and re.search(str(v), str(x), re.I) is not None
    if op == "under":
        return expr.under(x, v)
    if op == "exists":
        return x is not None
    if op == "missing":
        return x is None
    if op == "between":
        return x is not None and v is not None and v[0] <= x <= v[1]
    if op in ("gt", "gte", "lt", "lte"):
        if x is None or v is None:
            return False
        return {"gt": x > v, "gte": x >= v, "lt": x < v, "lte": x <= v}[op]
    raise ValueError(f"Unknown selector op '{op}'")


class RuleEngine:
    def __init__(self, rules: dict, elements: list[dict], expr: Expr, log: CalcLog,
                 decisions: dict[str, object] | None = None, building: dict | None = None):
        self.rules = rules
        self.params = {k: v.get("value") for k, v in rules["params"].items()}
        self.el = elements
        self.by_guid = {e["guid"]: e for e in elements}
        self.x = expr
        self.log = log
        self.decisions = decisions or {}
        self.building = {k: v for k, v in (building or {}).items() if k not in ("provenance", "notes")}
        self.defaults = rules.get("defaults", {})
        self.questions: list[dict] = []
        self.warnings: list[dict] = []
        self._asked: dict[str, dict] = {}          # missing_data questions by id (one per rule and element)
        self.lines: dict[tuple, dict] = {}
        self.lines_by_rule: dict[str, list[dict]] = defaultdict(list)
        self.matched: set[str] = set()
        self.excluded: set[str] = set()
        self.out_of_scope: set[str] = set()           # left out by the rule set's scope
        self.skipped_parts: set[str] = set()
        self.through_parts: set[str] = set()          # parents no rule can measure: their parts are measured
        self.claims: dict[tuple, list[str]] = defaultdict(list)

    # ---------------------------------------------------------------- helpers
    def ancestor_in(self, e: dict, guids: set) -> bool:
        """Any aggregate ancestor in guids (a slab in an assembly in a measured roof is a part too)."""
        seen, p = set(), e.get("parent_guid")
        while p and p not in seen:
            if p in guids:
                return True
            seen.add(p)
            p = self.by_guid.get(p, {}).get("parent_guid")
        return False

    def val(self, v):
        if isinstance(v, dict) and "param" in v:
            return self.params.get(v["param"])
        return v

    def formula_text(self, v) -> str:
        """An expression for traces; a formula slot shows where it came from."""
        return f"{self.val(v)}   (from slot {v['param']})" if isinstance(v, dict) and "param" in v else str(v)

    def enabled(self, x) -> bool:
        return self.val(x.get("enabled", True)) is not False

    def ctx(self, part: dict) -> dict:
        return {**part, "p": self.params, "building": self.building}

    def select(self, sel: dict, el: dict) -> bool:
        return select(sel, el, self.x, self.val, self.ctx(el))

    # ---------------------------------------------------------------- quantities
    def deductions(self, gross: float, rules: list[dict], part: dict, per: str, trace=None, faces=1) -> tuple[float, list[str]]:
        """Apply DeductionRule[] to a gross value. per = 'area' | 'volume' | 'length'."""
        notes, total = [], 0.0
        thickness = part.get("thickness") or 0
        for d in rules or []:
            what, mode = d["what"], self.val(d["mode"])
            if mode == "none":
                continue
            if what == "recesses":
                ops = [o for o in part.get("openings", []) if o["kind"] == "recess"]

                def amount(o):
                    if per == "length":
                        return o["width"] or 0
                    return (o["area"] or 0) * ((o.get("depth") or thickness) if per == "volume" else 1)
            elif what == "embedded":
                # columns / beams through this element (measure.py `embedded`): the area they take
                # out of the face, or that area x this part's thickness (a layer gets its share)
                ops = list(part.get("embedded") or [])
                if per == "length":
                    if ops:
                        notes.append("embedded elements are not deducted from lengths")
                    continue

                def amount(o):
                    a = o.get("area")
                    if per == "volume":
                        return a * thickness if a is not None and thickness else o["volume"]
                    return a or 0
            else:
                kinds = {"openings": None, "doors": "door", "windows": "window", "voids": "void"}[what]
                ops = [o for o in part.get("openings", []) if o["kind"] != "recess" and (kinds is None or o["kind"] == kinds)]

                def amount(o):
                    if per == "length":
                        return o["width"] or 0
                    return (o["area"] or 0) * (thickness if per == "volume" else 1)
            if d.get("where"):
                ops = [o for o in ops if self.x.evaluate(d["where"], {**self.ctx(part), **o})]
            if not ops:
                continue
            if (share := part.get("_open_share", 1.0)) != 1.0:      # one room's part of a face (A-11)
                whole = amount
                amount = lambda o, whole=whole, share=share: whole(o) * share
            t = self.val(d.get("threshold")) or 0
            by = self.val(d.get("compareBy")) or ("volume" if what == "embedded" else "area")
            size = lambda o: o.get(by) or 0
            if mode == "all":
                chosen = ops
                ded = sum(amount(o) for o in ops)
            elif mode == "over_threshold":
                chosen = [o for o in ops if size(o) > t]
                ded = sum(amount(o) for o in chosen)
            elif mode == "excess_only":
                chosen = [o for o in ops if size(o) > t]
                ded = sum(amount(o) * (size(o) - t) / size(o) for o in chosen if size(o))
            elif mode == "per_element_sum":
                chosen = ops if sum(size(o) for o in ops) > t else []
                ded = sum(amount(o) for o in chosen)
            else:
                raise ValueError(f"Unknown deduction mode {mode}")
            total += ded
            kept = len(ops) - len(chosen)
            msg = f"- {fmt(round(ded, 4))} ({len(chosen)} {what} deducted, mode {mode}"
            if mode != "all":
                msg += f", threshold {fmt(t)} by {by}"
            msg += f"{'; ' + str(kept) + ' kept' if kept else ''})"
            notes.append(msg)
            if trace is not None:
                data = dict(what=what, count=len(chosen) * faces, kept=kept * faces, mode=mode)
                if mode != "all":
                    data.update(threshold=t, compareBy=by)
                if mode_slot := slot(d.get("mode")):
                    data["modeParam"] = mode_slot
                code = {"all": "all", "excess_only": "excess"}.get(mode, "over_threshold")
                trace.append(step("deduct", f"deduct.{code}", -ded * faces, data, slot(d.get("threshold"))))
            if self.val(d.get("addReveals")) and per == "area" and chosen and what != "embedded":
                # one face's reveals (A-12): a wall has two faces and the frame is taken as central, so
                # each face gets half the opening's depth; `both` calls this once per face, a face
                # part shared between rooms takes its share
                share = part.get("_open_share", 1.0)
                rev = sum((2 * (o["height"] or 0) + (o["width"] or 0)) * (o.get("depth") or thickness) / 2 for o in chosen) * share
                total -= rev
                notes.append(f"+ {fmt(round(rev, 4))} reveals")
                if trace is not None:
                    trace.append(step("add", "add.reveals", rev * faces))
        return gross - total, notes

    def surface_values(self, part: dict, surface: str) -> tuple[float | None, float | None, str]:
        g, n = part.get("gross_area"), part.get("net_area")
        # walls: real sides (measure.py side_faces) sum their faces. Slab top / bottom stay the
        # adopted main area (a slab's mesh top includes the area under walls; reported areas do not).
        faces = part.get("faces") or []
        side = {}
        for f in faces:
            if f.get("side") in ("a", "b"):
                sg, sn = side.get(f["side"], (0.0, 0.0))
                side[f["side"]] = (sg + (f.get("gross_area") or 0), sn + (f.get("net_area") or 0))
        real = "_part" not in part and len(side) == 2 and side["a"] != side["b"]
        if real and surface in ("side_a", "side_b", "larger", "smaller", "mean", "both"):
            a, b = side["a"], side["b"]
            pick = {"side_a": a, "side_b": b,
                    "larger": max(a, b, key=lambda t: t[0]), "smaller": min(a, b, key=lambda t: t[0]),
                    "mean": ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), "both": (a[0] + b[0], a[1] + b[1])}[surface]
            return pick[0], pick[1], f"{surface} (faces)"
        if surface in ("main", "top", "bottom", "larger", "smaller", "mean", "side_a", "side_b"):
            return g, n, surface
        if surface == "both":
            return (2 * g if g is not None else None), (2 * n if n is not None else None), "both faces"
        if surface == "footprint":
            v = part.get("footprint_area")
            return v, v, "footprint"
        if surface == "developed":
            v = part.get("developed_area") or n
            return v, v, "developed"
        if surface == "edges":
            p, t = part.get("perimeter"), part.get("thickness")
            v = p * t if p and t else None
            return v, v, "edges (perimeter x thickness)"
        return g, n, surface

    def quantity(self, spec: dict, part: dict, trace=None) -> tuple[float | None, str, str]:
        """(value in SI or None, unit, explanation)."""
        k = spec["kind"]
        unit = spec.get("unit") or UNIT_DEFAULT.get(k, "nr")

        def gross(value, **params):
            if trace is not None:
                trace.append(step("start", f"start.{k}", value, {"count": 1, **params}))
        if k == "count":
            return 1.0, unit, "count = 1"
        if k == "perimeter":
            v = part.get("perimeter")
            return v, unit, f"perimeter = {fmt(v)}"
        if k == "length":
            basis = self.val(spec.get("basis")) or "axis"
            field = {"girth": "profile_girth", "perimeter": "perimeter"}.get(basis, "length")
            v = part.get(field)
            if v is None:
                return None, unit, f"length ({basis}) missing"
            gross(v, basis=basis)
            if spec.get("deductions"):
                v, notes = self.deductions(v, spec["deductions"], part, "length", trace)
                return v, unit, f"length ({basis}) {fmt(part.get(field))} " + " ".join(notes)
            return v, unit, f"length ({basis}) = {fmt(round(v, 4))}"
        if k == "area":
            surface = self.val(spec.get("surface")) or "main"
            start = self.val(spec.get("start")) or "gross"
            g, n, label = self.surface_values(part, surface)
            if spec.get("deductions"):
                if g is None:
                    return None, unit, f"area ({label}) missing"
                gross(g, surface=surface, start="gross")
                if surface == "both":                      # deduct openings from each face
                    one, notes = self.deductions(g / 2, spec["deductions"], part, "area", trace, faces=2)
                    v = 2 * one
                    notes = [n + " per face" for n in notes]
                else:
                    v, notes = self.deductions(g, spec["deductions"], part, "area", trace)
                return v, unit, (f"area ({label}, gross {fmt(round(g, 4))}) {' '.join(notes)} = {fmt(round(v, 4))}" if notes
                                 else f"area ({label}) = {fmt(round(v, 4))} (no openings to deduct)")
            v = g if start == "gross" else n
            if v is not None:
                gross(v, surface=surface, start=start)
            return v, unit, f"area ({label}, {start}) = {fmt(round(v, 4)) if v is not None else 'missing'}"
        if k == "volume":
            start = self.val(spec.get("start")) or "net"
            if spec.get("deductions"):
                g = part.get("gross_volume")
                if g is None:
                    return None, unit, "volume missing"
                gross(g, start="gross")
                v, notes = self.deductions(g, spec["deductions"], part, "volume", trace)
                return v, unit, (f"volume (gross {fmt(round(g, 4))}) {' '.join(notes)} = {fmt(round(v, 4))}" if notes
                                 else f"volume = {fmt(round(v, 4))} (no openings to deduct)")
            v = part.get("gross_volume" if start == "gross" else "net_volume")
            if v is not None:
                gross(v, start=start)
            return v, unit, f"volume ({start}) = {fmt(round(v, 4)) if v is not None else 'missing'}"
        if k == "mass":
            basis = self.val(spec.get("basis")) or "volume_density"
            unit = spec.get("unit") or "kg"
            if basis == "nominal_per_length":
                L, m = part.get("length"), part.get("nominal_mass_per_length")
                if L and m:
                    return L * m, unit, f"mass = length x nominal kg/m = {fmt(round(L, 4))} x {fmt(m)} = {fmt(round(L * m, 3))} kg"
                basis = "volume_density"                       # fall back, explained
                fb = "no nominal kg/m for profile; "
            else:
                fb = ""
            if basis == "volume_density":
                V = part.get("net_volume")
                rho = self.val(spec.get("density")) or part.get("density")
                if V and rho:
                    return V * rho, unit, f"{fb}mass = volume x density = {fmt(round(V, 5))} x {fmt(rho)} = {fmt(round(V * rho, 3))} kg"
                return None, unit, f"{fb}mass: volume or density missing"
            v = part.get("mass")
            return v, unit, f"mass (reported) = {fmt(v)}"
        if k == "choose":
            pick = self.val(spec["pick"])
            if pick not in spec["options"]:
                return None, "nr", f"choose: option '{pick}' not defined"
            v, u, expl = self.quantity(spec["options"][pick], part, trace)
            return v, u, f"[{pick}] {expl}"
        if k == "when":
            cond_val, cond_txt = self.x.explain(spec["if"], self.ctx(part))
            branch = "then" if cond_val else "else"
            v, u, expl = self.quantity(spec[branch], part, trace)
            return v, u, f"when {cond_txt} -> {branch}: {expl}"
        if k == "formula":
            v, txt = self.x.explain(self.val(spec["expr"]) or "", self.ctx(part))
            return (float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None), spec["unit"], txt
        raise ValueError(f"Unknown quantity kind {k}")

    @staticmethod
    def convert(v: float | None, unit: str) -> float | None:
        if v is None:
            return None
        return v * UNIT_FACTOR.get(unit, 1)

    def round_(self, v, rounding):
        if v is None or not rounding:
            return v
        step = self.val(rounding["step"]) or 0
        if not step:
            return v
        return step_round(v, step, self.val(rounding.get("mode")) or "nearest")     # one helper with FLOOR / CEIL (A-23)

    # ---------------------------------------------------------------- breakdown
    def parts_of(self, item: dict, el: dict) -> list[dict]:
        bd = self.val(item.get("breakdown")) or self.defaults.get("breakdown") or "element"
        if bd == "layer" and el.get("layers"):
            out = []
            single = len(el["layers"]) == 1          # one layer is the element: its own volumes (A-14)
            for l in el["layers"]:
                t = l["thickness"]
                out.append({**el, "material": l["material"], "material_raw": l["material_raw"], "thickness": t,
                            "layer_index": l["index"],
                            "net_volume": el.get("net_volume") if single else
                            (el["net_area"] * t if el.get("net_area") is not None else None),
                            "gross_volume": el.get("gross_volume") if single else
                            (el["gross_area"] * t if el.get("gross_area") is not None else None),
                            "_part": f"layer {l['index'] + 1} {l['material_raw']}"})
            return out
        if bd == "face" and el.get("faces"):
            # a side split between rooms shares its openings in proportion (measure.side_faces): each face
            # part deducts its share of the element's openings (A-11)
            side_gross = defaultdict(float)
            for f in el["faces"]:
                side_gross[f["side"]] += f.get("gross_area") or 0
            return [{**el, "gross_area": f["gross_area"], "net_area": f["net_area"], "side": f["side"],
                     "space": f.get("space"), "space_name": f.get("space_name"), "space_type": f.get("space_type"),
                     "is_external": f.get("is_external", el.get("is_external")),
                     "layer_material": f.get("layer_material"), "layer_material_raw": f.get("layer_material_raw"),
                     "_open_share": (f.get("gross_area") or 0) / side_gross[f["side"]] if side_gross[f["side"]] else 1.0,
                     "_part": f"face {f['side']}" + (f" {f['space_name']}" if f.get("space_name") else "")} for f in el["faces"]]
        if bd == "material" and el.get("layers"):
            # each material its own volumes, as layers (review A-24: every group used to keep the element's
            # gross volume, so the groups summed to N x the element); one group is the element itself
            groups = defaultdict(float)
            for l in el["layers"]:
                groups[l["material"]] += l["thickness"]
            single = len(groups) == 1
            return [{**el, "material": m, "thickness": t,
                     "net_volume": el.get("net_volume") if single else
                     (el["net_area"] * t if el.get("net_area") is not None else None),
                     "gross_volume": el.get("gross_volume") if single else
                     (el["gross_area"] * t if el.get("gross_area") is not None else None),
                     "_part": f"material {m}"} for m, t in groups.items()]
        if bd == "child" and el.get("child_guids"):
            return [{**self.by_guid[c], "_part": f"child {self.by_guid[c].get('name')}"} for c in el["child_guids"] if c in self.by_guid]
        return [el]

    PART_VOLUME_TOLERANCE = 0.02          # share of the element's volume (and at least 1 litre)

    def check_part_volumes(self, item: dict, el: dict, parts: list[dict]) -> None:
        """Review A-24: a volume measured by layers or materials should add up to the element's volume. Parts are
        layer area x layer thickness (the documented rule), which is more than the solid on a notched or
        stepped wall (DEC-87); beyond the tolerance the log warns, naming both sums, so the difference is never
        silent. Only items that measure a volume are checked."""
        bd = self.val(item.get("breakdown")) or self.defaults.get("breakdown") or "element"
        spec = item.get("quantity") or {}
        if spec.get("kind") == "choose":
            spec = (spec.get("options") or {}).get(self.val(spec.get("pick"))) or {}
        if bd not in ("layer", "material") or len(parts) < 2 or spec.get("kind") != "volume":
            return
        key = "gross_volume" if self.val(spec.get("start")) == "gross" else "net_volume"
        whole, vals = el.get(key), [p.get(key) for p in parts]
        if not whole or any(v is None for v in vals):
            return
        total = sum(vals)
        if abs(total - whole) > max(self.PART_VOLUME_TOLERANCE * abs(whole), 1e-3):
            self.log.warn("quantity", f"{el.get('name') or el['guid']}: its {len(parts)} {bd} parts add up to {fmt(round(total, 4))} m3, "
                                      f"the element is {fmt(round(whole, 4))} m3 (layer area x thickness; a notched or "
                                      f"stepped element)", ruleId=item["id"], guid=el["guid"],
                code="log.quantity.parts_volume", params=dict(name=el.get("name") or el["guid"], breakdown=bd,
                                                              parts=len(parts), total=total, element=whole))

    def part_filter_passes(self, item: dict, el: dict) -> bool:
        """`partFilter` is applied after breakdown: an element is taken when one of its parts passes
        (with no breakdown, the element itself). A face's layer material exists only on the face (A-11)."""
        if not item.get("partFilter"):
            return True
        parts = self.parts_of(item, el)
        return any(self.x.evaluate(item["partFilter"], self.ctx(p)) for p in parts)

    # ---------------------------------------------------------------- template
    def render(self, tpl, part: dict, extra: dict | None = None) -> str:
        return render_template(self.val(tpl) or "", self.x, {**self.ctx(part), **(extra or {})})

    # ---------------------------------------------------------------- items
    def run_items(self):
        items = [i for i in self.rules["items"]]
        enabled = [i for i in items if self.enabled(i)]
        forced = {}                                    # guid -> rule id, from answers to "unmatched" questions
        for e in self.el:
            ans = self.decisions.get(unmatched_id(e))
            if ans == "exclude":
                self.excluded.add(e["guid"])
            elif ans:
                forced[e["guid"]] = ans
        # scope: elements the rule set leaves out are only for items with scope "out"
        for sel in (self.rules.get("scope") or {}).get("exclude", []):
            self.out_of_scope |= {e["guid"] for e in self.el if self.select(sel, e)}
        if self.out_of_scope:
            self.log.info("match", f"{len(self.out_of_scope)} element(s) left out of this BoQ by the rule set's scope",
                          data={"guids": sorted(self.out_of_scope)},
                code="log.match.out_of_scope", params=dict(count=len(self.out_of_scope)))
        # pass 1: plain matches
        matches = {}
        for i in items:
            out = (i.get("scope") or "in") == "out"
            matches[i["id"]] = [e for e in self.el if (e["guid"] in self.out_of_scope) == out and self.select(i["match"], e)]
        # A parent is measured when an enabled rule takes it (partFilter included) and gets a value.
        # A parent no rule can measure (a roof with no body of its own and no planar parts) is
        # measured through its parts instead of becoming a flagged line that hides them.
        parents = {e["parent_guid"] for e in self.el if e.get("parent_guid")}
        taken_parents, parent_measured = set(), set()
        for i in enabled:
            for e in matches[i["id"]]:
                if e["guid"] not in parents or e["guid"] in self.excluded:
                    continue
                if not self.part_filter_passes(i, e):
                    continue
                taken_parents.add(e["guid"])
                on_missing = i.get("onMissing") or self.defaults.get("onMissing")
                if (isinstance(on_missing, dict) and "default" in on_missing
                        or isinstance(self.decisions.get(f"missing:{i['id']}:{e['guid']}"), (int, float))
                        or any(self.quantity(i["quantity"], p)[0] is not None for p in self.parts_of(i, e))):
                    parent_measured.add(e["guid"])
        with_ruled_parts = {e["parent_guid"] for i in enabled for e in matches[i["id"]] if e.get("parent_guid")}
        self.through_parts = {g for g in taken_parents - parent_measured if g in with_ruled_parts and g not in forced}
        for g in sorted(self.through_parts):
            p = self.by_guid[g]
            self.log.info("match", f"{p.get('name') or g} ({p['ifc_class']}): no rule gets a quantity for the whole; "
                                   f"measured through its {len(p.get('child_guids', []))} part(s)", guid=g,
                code="log.match.measured_by_parts", params=dict(
                    name=p.get('name') or g, ifcClass=p['ifc_class'], parts=len(p.get('child_guids', [])),
                ))
        # pass 2: per enabled rule, skip aggregate parts whose parent is measured
        takes = {}
        for i in enabled:
            take = []
            for e in matches[i["id"]]:
                if e["guid"] in self.excluded:
                    continue
                if e["guid"] in self.through_parts:
                    continue
                if self.ancestor_in(e, parent_measured) and (i.get("parts") or "skip") == "skip":
                    self.skipped_parts.add(e["guid"])
                    continue
                if not self.part_filter_passes(i, e):
                    continue
                take.append(e)
            take += [self.by_guid[g] for g, rid in forced.items() if rid == i["id"] and g in self.by_guid
                     and self.by_guid[g] not in take]
            takes[i["id"]] = take
            for e in take:
                for c in i.get("claims", []):
                    self.claims[(e["guid"], c)].append(i["id"])
        dropped = self.double_claims()
        for i in enabled:
            take = [e for e in takes[i["id"]] if (i["id"], e["guid"]) not in dropped]
            self.log.info("match", f"rule '{i['id']}' ({i.get('label', '')}) takes {len(take)} element(s)"
                          + (f"; {len([e for e in matches[i['id']] if e['guid'] in self.skipped_parts])} aggregate part(s) skipped (parent measured)"
                             if any(e['guid'] in self.skipped_parts for e in matches[i['id']]) else ""),
                          ruleId=i["id"], data={"guids": [e["guid"] for e in take]},
                code="log.match.rule_selected", params=dict(ruleId=i['id'], label=i.get('label', ''), count=len(take)))
            for e in take:
                self.matched.add(e["guid"])
                parts = self.parts_of(i, e)
                self.check_part_volumes(i, e, parts)
                for part in parts:
                    if i.get("partFilter") and part is not e and not self.x.evaluate(i["partFilter"], self.ctx(part)):
                        continue
                    self.add_part(i, e, part)
        decided_out = set(self.excluded)
        for i in items:
            if not self.enabled(i) and i.get("whenDisabled") != "ask":     # "ask": left to coverage (A-16)
                for e in matches[i["id"]]:
                    if e["guid"] not in self.matched:
                        self.excluded.add(e["guid"])
                if matches[i["id"]]:
                    self.log.info("match", f"rule '{i['id']}' is disabled: {len(matches[i['id']])} element(s) excluded",
                                  ruleId=i["id"],
                        code="log.match.rule_disabled", params=dict(ruleId=i['id'], count=len(matches[i['id']])))
        self.excluded |= self.out_of_scope
        self.excluded -= self.matched
        if decided_out:
            self.log.info("decision", f"{len(decided_out)} element(s) excluded by user answers",
                code="log.decision.excluded", params=dict(count=len(decided_out)))

    def double_claims(self) -> set[tuple[str, str]]:
        """Elements two or more rules claim for the same purpose ("body", "finish"...): one
        `double_claim` question per claim and set of rules. The answer names the rule that keeps
        them, or "both". Returns the (rule id, guid) pairs an answer takes away."""
        groups = defaultdict(list)
        for (guid, claim), rids in self.claims.items():
            if len(set(rids)) > 1:
                groups[(claim, tuple(sorted(set(rids))))].append(guid)
        labels = {i["id"]: i.get("label") or i["id"] for i in self.rules["items"]}
        dropped = set()
        for (claim, rids), guids in sorted(groups.items()):
            qid = f"double_claim:{claim}:{'|'.join(rids)}"
            ans = self.decisions.get(qid)
            if ans in rids:
                dropped |= {(r, g) for r in rids if r != ans for g in guids}
                self.log.info("decision", f"{len(guids)} element(s) claimed for '{claim}' by {', '.join(rids)}: "
                                          f"measured by '{ans}' only (answer)",
                    code="log.decision.claim_selected", params=dict(
                        count=len(guids), claim=claim, rules=list(rids), selected=ans,
                    ))
                continue
            if ans == "both":
                self.log.info("decision", f"{len(guids)} element(s) claimed for '{claim}' by {', '.join(rids)}: all kept (answer)",
                    code="log.decision.claim_all", params=dict(count=len(guids), claim=claim, rules=list(rids)))
                continue
            e0 = self.by_guid[guids[0]]
            msg = (f"{len(guids)} element(s) (e.g. {e0['ifc_class']} '{e0.get('type_name') or e0.get('name') or ''}') are "
                   f"claimed for '{claim}' by {len(rids)} rules ({', '.join(labels[r] for r in rids)}): they are counted "
                   f"{len(rids)} times. Which rule should measure them?")
            self.questions.append({
                "id": qid, "kind": "double_claim", "blocking": False, "guids": guids, "occurrences": len(guids),
                "code": "question.double_claim",
                "params": {"count": len(guids), "ifcClass": e0["ifc_class"], "name": e0.get("type_name") or e0.get("name"),
                           "claim": claim, "rules": [labels[r] for r in rids]},
                "message": msg, "suggestion": "both",
                "answer": {"kind": "choice", "options": [{"value": r, "label": f"Only '{labels[r]}'"} for r in rids]
                           + [{"value": "both", "label": "All of them (they measure different things)"}]}})
            self.warnings.append({"code": "double_claim", "guids": guids,
                                  "params": {"count": len(guids), "claim": claim, "rules": list(rids)},
                                  "message": f"{len(guids)} element(s): rules {', '.join(rids)} all claim '{claim}' (possible double count)"})
        return dropped

    def double_counts(self, lines: list[dict]) -> None:
        """BR-13 (review A-20): an element in the item lines of two or more rules that measure it in the same
        family (count, length, area, volume, mass), where a pair of those rules does not both declare `claims`,
        may be counted twice: one non-blocking `double_count` warning per family and set of rules, listing the
        elements. Rules that both declare claims say what each measures (wall body and paint, slab area and
        concrete volume); a claim they share is a `double_claim` question instead. Derived and manual lines
        are not item lines (formwork, finishes from other lines). Lines a person excluded are left out."""
        claims = {i["id"]: set(i.get("claims") or ()) for i in self.rules["items"]}
        labels = {i["id"]: i.get("label") or i["id"] for i in self.rules["items"]}
        rules_of = defaultdict(set)                  # (guid, family) -> rule ids
        for line in lines:
            if line["ruleKind"] != "item" or line.get("_excluded"):
                continue
            family = UNIT_FAMILY.get(line["unit"], line["unit"])
            for e in line["trace"]["elements"]:
                rules_of[(e["guid"], family)].add(line["ruleId"])
        groups = defaultdict(list)
        for (guid, family), rids in rules_of.items():
            ids = sorted(rids)
            loose = sorted({r for a, b in combinations(ids, 2) if not (claims.get(a) and claims.get(b)) for r in (a, b)})
            if loose:
                groups[(family, tuple(loose))].append(guid)
        for (family, rids), guids in sorted(groups.items()):
            guids = sorted(guids)
            e0 = self.by_guid.get(guids[0], {})
            name = e0.get("type_name") or e0.get("name") or ""
            msg = (f"{len(guids)} element(s) (e.g. {e0.get('ifc_class')} '{name}') are measured as {family} by "
                   f"{len(rids)} rules ({', '.join(labels.get(r, r) for r in rids)}) that do not declare what they "
                   f"claim: possibly counted twice. Give each rule a claim, or narrow their matches.")
            params = {"count": len(guids), "family": family, "rules": [labels.get(r, r) for r in rids], "ruleIds": list(rids),
                      "ifcClass": e0.get("ifc_class"), "name": name}
            self.warnings.append({"code": "double_count", "ruleId": rids[0], "guids": guids, "params": params, "message": msg})
            self.log.warn("match", msg, ruleId=rids[0], code="log.match.double_count", params=params)

    def add_part(self, item: dict, el: dict, part: dict):
        rid = item["id"]
        part_steps = []
        v, unit, expl = self.quantity(item["quantity"], part, part_steps)
        note = None
        source = "measured"
        decided = list(el.get("decisions") or ())          # the answers measure applied to this element (A-06)
        if v is None:
            on = item.get("onMissing") or self.defaults.get("onMissing") or "flag"
            qid = f"missing:{rid}:{el['guid']}"
            if qid in self.decisions and isinstance(self.decisions[qid], (int, float)):
                v = float(self.decisions[qid])
                note, source = f"value supplied by user ({fmt(v)})", "user"
                decided.append(qid)
                expl += f"; user answer {fmt(v)}"
            elif isinstance(on, dict):
                v = float(self.val(on["default"]))
                note = f"default {fmt(v)} used ({expl})"
            elif on == "skip":
                self.log.warn("quantity", f"{el.get('name')}: {expl}; skipped (onMissing skip)", ruleId=rid, guid=el["guid"],
                    code="log.quantity.skipped", params=dict(name=el.get('name'), reason=expl))
                return
            elif on == "ask":
                # one question per rule and element (review A-25): a breakdown's parts share it, `occurrences`
                # counts them, and the answer is used for each part without a value
                asked = self._asked.get(qid)
                if asked is not None:
                    asked["occurrences"] += 1
                else:
                    self._asked[qid] = {
                        "id": qid, "kind": "missing_data", "blocking": True, "guids": [el["guid"]], "occurrences": 1,
                        "code": "question.missing_data",
                        "params": {"rule": item.get("label", rid), "name": el.get("name"), "reason": expl, "unit": unit},
                        "message": f"Rule '{item.get('label', rid)}' needs a quantity for {el.get('name')}: {expl}. Enter it in {unit}.",
                        "answer": {"kind": "number", "unit": unit}}
                    self.questions.append(self._asked[qid])
                note = "waiting for user input"
            else:
                note = f"missing: {expl}"
        if not part_steps:
            kind = item["quantity"]["kind"]
            code = kind if kind in UNIT_DEFAULT else "value"
            part_steps.append(step("start", f"start.{code if v is not None else 'missing'}", v, {"count": 1}))
        factor = self.val(item.get("factor"))
        if v is not None and factor not in (None, 1):
            expl += f"; x factor {fmt(factor)}"
            part_steps.extend(quantity_delta(v, v * factor, "factor", "factor", {"factor": factor}, slot(item.get("factor"))))
            v *= factor
        mn = item.get("minimum")
        if v is not None and mn and self.val(mn.get("per")) == "element":
            m = self.val(mn["value"])
            if v < m:
                expl += f"; raised to minimum {fmt(m)}"
                part_steps.extend(quantity_delta(v, m, "add", "add.minimum", {"minimum": self.convert(m, unit)}, slot(mn["value"])))
                v = m
        for item_step in part_steps:
            item_step["value"] = self.convert(item_step["value"], unit)
        v = self.convert(v, unit)
        rnd = item.get("rounding") or self.defaults.get("rounding")
        if rnd and self.val(rnd.get("at")) == "element":
            rounded = self.round_(v, rnd)
            part_steps.extend(quantity_delta(v, rounded, "round", "round", param=slot(rnd["step"])))
            v = rounded
        # line key
        keys = {}
        for k in item.get("lineKey", []):
            keys[k] = part.get(k) if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k) else self.x.evaluate(k, self.ctx(part))
        band_label = None
        for b in item.get("bands", []):
            x = part.get(b["field"])
            edges = [self.val(e) for e in b["edges"]]
            idx = sum(1 for e in edges if x is not None and x > e)
            labels = b.get("labels") or [f"band {i}" for i in range(len(edges) + 1)]
            band_label = labels[idx] if idx < len(labels) else f"band {idx}"
            keys[f"band:{b['field']}"] = band_label
        lk = (rid,) + tuple(_key(v_) for v_ in keys.values()) + (unit,)
        key = " | ".join(str(x) for x in lk)
        line = self.lines.get(lk)
        if line is None:
            desc = self.render(item["description"], part)
            if band_label:
                desc += f" ({band_label})"
            line = {"key": key, "ruleId": rid, "ruleKind": "item", "description": desc, "unit": unit,
                    "quantity": 0.0, "source": "measured", "family": el["family"], "keys": keys,
                    "trace": {"formula": describe_spec(item["quantity"], self), "params": self.params_used(item),
                              "elements": []},
                    "tags": item.get("tags", []), "notes": [], "_parts": [], "_missing": 0, "_rule": item,
                    "_unit_scale": {}, "_questions": set()}
            self.lines[lk] = line
            self.lines_by_rule[rid].append(line)
        line["trace"]["elements"].append({"guid": el["guid"], "model": el.get("model_id"),
                                          "name": (el.get("name") or "") + (f" [{part['_part']}]" if part.get("_part") else ""),
                                          "quantity": None if v is None else round(v, 6), "note": note or expl,
                                          **({"decisions": [self.trace_decision(q) for q in decided]} if decided else {})})
        collect(line, part_steps, el["guid"])
        line["_parts"].append(part)
        for field, factor in (el.get("unit_scale") or {}).items():      # measure took a stated value as a unit error
            line["_unit_scale"][(field, factor)] = line["_unit_scale"].get((field, factor), 0) + 1
        line["_questions"].update(el.get("contradictions") or ())           # open contradictions (A-05)
        if v is None:
            line["_missing"] += 1
        else:
            line["quantity"] += v
        if source == "user":
            line["notes"].append(f"{el.get('name')}: user-supplied value")
        self.log.detail("quantity", f"{el.get('name') or el['guid']}{' [' + part['_part'] + ']' if part.get('_part') else ''}: "
                        f"{expl} -> {fmt(round(v, 4)) if v is not None else 'MISSING'} {unit}",
                        ruleId=rid, lineKey=key, guid=el["guid"],
            code="log.quantity.element", params=dict(
                name=el.get('name') or el['guid'], part=part.get('_part'), calculation=expl, quantity=v,
                unit=unit,
            ))

    def trace_decision(self, qid: str) -> dict:
        """A decision as a line's trace names it: the answer, and who gave it when (A-06)."""
        meta = (getattr(self.decisions, "meta", None) or {}).get(qid) or {}
        return {"questionId": qid, "answer": dict.get(self.decisions, qid) if isinstance(self.decisions, dict) else None,
                **{k: v for k, v in (("by", meta.get("by")), ("at", meta.get("at"))) if v}}

    def params_used(self, item) -> dict:
        blob = json.dumps(item)
        names = set(re.findall(r'"param":\s*"([^"]+)"', blob)) | set(re.findall(r"\bp\.([A-Za-z_][A-Za-z0-9_]*)", blob))
        for n in list(names):                       # slots a formula slot itself reads
            if isinstance(self.params.get(n), str) and self.rules["params"].get(n, {}).get("type") == "formula":
                names |= set(re.findall(r"\bp\.([A-Za-z_][A-Za-z0-9_]*)", self.params[n]))
        return {n: self.params.get(n) for n in sorted(names)}

    # ---------------------------------------------------------------- finalize
    def finalize_lines(self):
        for line in self.lines.values():
            item = line.pop("_rule")
            parts = line.pop("_parts")
            missing = line.pop("_missing")
            for (field, factor), count in sorted(line.pop("_unit_scale", {}).items()):
                line["notes"].append(f"{count} element(s): the {UNIT_SCALE_FIELDS.get(field, field)} stated in the file looks "
                                     f"like a unit error (x{scale_label(factor)}); the geometry is used")
            n = len(line["trace"]["elements"])
            if missing == n:
                line["quantity"] = None
                line["source"] = "flagged"
                line["notes"].append("quantity could not be determined for any element")
            elif missing:
                line["notes"].append(f"{missing} of {n} element(s) had no value and are not included")
            questions = sorted(line.pop("_questions", ()))
            if line["quantity"] is not None and (missing or questions):       # a quantity that needs a look (A-05)
                line["toConfirm"] = {"measured": n - missing, "elements": n, **({"questions": questions} if questions else {})}
            mn = item.get("minimum")
            if line["quantity"] is not None and mn and self.val(mn.get("per")) == "line":
                m = self.convert(self.val(mn["value"]), line["unit"])
                if line["quantity"] < m:
                    line["notes"].append(f"raised to line minimum {fmt(m)}")
                    collect(line, quantity_delta(line["quantity"], m, "add", "add.minimum", {"minimum": m}, slot(mn["value"])))
                    line["quantity"] = m
            rnd = item.get("rounding") or self.defaults.get("rounding")
            if rnd and self.val(rnd.get("at", "line")) == "line":
                rounded = self.round_(line["quantity"], rnd)
                collect(line, quantity_delta(line["quantity"], rounded, "round", "round", param=slot(rnd["step"])))
                line["quantity"] = rounded
            # summary fields for classification / grouping
            vals = {f: Counter(_key(p.get(f)) for p in parts) for f in MIXABLE}
            line["_fields"] = {f: _unkey(c.most_common(1)[0][0]) for f, c in vals.items()}
            line["_mixed"] = sorted(f for f, c in vals.items() if len(c) > 1)
            storeys = sorted({p.get("storey") for p in parts if p.get("storey")})
            line["location"] = {"storey": storeys[0]} if len(storeys) == 1 else ({"storeys": storeys} if storeys else {})
            line["_parts"] = parts
            self.log.info("quantity", f"line '{line['description']}' = {fmt(line['quantity']) if line['quantity'] is not None else 'FLAGGED'} "
                          f"{line['unit']} from {n} element(s)", ruleId=line["ruleId"], lineKey=line["key"],
                code="log.quantity.line", params=dict(
                    description=line['description'], quantity=line['quantity'], unit=line['unit'], elements=n,
                ))

    # ---------------------------------------------------------------- derived
    def run_derived(self) -> list[dict]:
        out: dict[tuple, dict] = {}
        for d in self.rules.get("derived", []):
            if not self.enabled(d):
                self.log.info("derived", f"derived rule '{d['id']}' disabled", ruleId=d["id"],
                    code="log.derived.disabled", params=dict(ruleId=d['id']))
                continue
            unit = d["unit"]
            n_lines = 0
            for src_id in d["from"]:
                for src in self.lines_by_rule.get(src_id, []):
                    if d["scope"] == "line":
                        sctx = {**src["_fields"], **src["keys"], "qty": src["quantity"], "unit": src["unit"], "keys": src["keys"]}
                        sources = [(sctx, None, src)]
                    else:
                        sources = [(p, p.get("guid"), src) for p in src["_parts"]]
                    for sctx, guid, srcline in sources:
                        ctx = {**sctx, "src": sctx, "p": self.params, "building": self.building}
                        if d.get("where") and not self.x.evaluate(d["where"], ctx):
                            continue
                        v, txt = self.x.explain(self.val(d["quantity"]) or "", ctx)
                        v = float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
                        if (override := srcline.get("overridden")) and "quantity" in override:
                            txt += f"; source quantity edited to {fmt(srcline['quantity'])}"
                            if d["scope"] == "element" and v is not None:
                                original = override["engineQuantity"]
                                if srcline["quantity"] is None:
                                    v = None
                                elif original:
                                    v *= srcline["quantity"] / original
                                else:
                                    txt += "; no measured total to distribute the edit across elements"
                        if srcline.get("_excluded"):              # an excluded source counts 0 (P54, Q48)
                            txt += "; source line excluded"
                            v = 0.0
                        factor = self.val(d.get("factor"))
                        if v is not None and factor not in (None, 1):
                            txt += f" x factor {fmt(factor)}"
                            v *= factor
                        if v is None:
                            on = d.get("onMissing") or "flag"
                            if isinstance(on, dict):
                                v = float(self.val(on["default"]))
                                txt += f"; default {fmt(v)}"
                            elif on == "skip":
                                continue
                        # lineKey present (even []) = group by those keys; absent = one line per source line
                        grouped = "lineKey" in d
                        keys = {k: sctx.get(k) for k in d["lineKey"]} if grouped else dict(srcline["keys"])
                        lk = (d["id"],) + (tuple(_key(x) for x in keys.values()) if grouped else (srcline["key"],)) + (unit,)
                        line = out.get(lk)
                        if line is None:
                            line = {"key": " | ".join(str(x) for x in lk), "ruleId": d["id"], "ruleKind": "derived",
                                    "description": self.render(d["description"], sctx, {"src": sctx}),
                                    "unit": unit, "quantity": 0.0, "source": "derived", "family": srcline.get("family"),
                                    "keys": keys, "trace": {"formula": self.formula_text(d["quantity"]), "params": self.params_used(d),
                                                            "elements": [], "sourceLine": srcline["key"]},
                                    "tags": d.get("tags", []), "notes": [], "_fields": dict(srcline["_fields"]),
                                    "_mixed": list(srcline["_mixed"]), "location": srcline.get("location", {}),
                                    "_source_key": srcline["key"], "_missing": 0, "_count": 0, "_confirm": [],
                                    "_text_context": {**sctx, "src": sctx}}
                            out[lk] = line
                            n_lines += 1
                        line["_count"] += 1
                        if (c := srcline.get("toConfirm")) and not (srcline.get("overridden") or {}).get("fields", []).count("quantity"):
                            line["_confirm"].append(c)
                        trace = {"guid": guid or "", "name": (sctx.get("name") or "") if guid else f"line {srcline['description']}",
                                 "quantity": None if v is None else round(v, 6), "note": txt}
                        if model_id := sctx.get("model_id"):
                            trace["model"] = model_id
                        line["trace"]["elements"].append(trace)
                        code = "derive.excluded" if srcline.get("_excluded") else "derive.missing" if v is None else "derive"
                        collect(line, [step("derive", code, v, {
                            "formula": self.val(d["quantity"]), "sourceLine": srcline["key"],
                            "sourceDescription": srcline["description"], "sourceLines": [srcline["key"]],
                            "lines": 1, "count": 1,
                        }, slot(d["quantity"]))], guid)
                        if v is None:
                            line["_missing"] += 1
                        else:
                            line["quantity"] += v
                        self.log.detail("derived", f"{d['id']} from {'element ' + str(sctx.get('name')) if guid else 'line ' + srcline['description']}: {txt}",
                                        ruleId=d["id"], lineKey=line["key"], guid=guid,
                            code="log.derived.source", params=dict(
                                ruleId=d['id'], source=sctx.get('name') if guid else srcline['description'],
                                calculation=txt,
                            ))
            if n_lines == 0:
                self.log.info("derived", f"derived rule '{d['id']}' produced no lines (no matching sources)", ruleId=d["id"],
                    code="log.derived.no_sources", params=dict(ruleId=d['id']))
        lines = []
        for line in out.values():
            if line["_missing"] == line["_count"]:
                line["quantity"], line["source"] = None, "flagged"
            elif line["_missing"]:
                line["notes"].append(f"{line['_missing']} source(s) had no value")
            confirm = line.pop("_confirm")
            if line["quantity"] is not None and (line["_missing"] or confirm):   # follows its sources (A-05)
                questions = sorted({q for c in confirm for q in c.get("questions", ())})
                line["toConfirm"] = {"measured": line["_count"] - line["_missing"], "elements": line["_count"],
                                     **({"questions": questions} if questions else {})}
            rnd = next((x.get("rounding") for x in self.rules.get("derived", []) if x["id"] == line["ruleId"]), None) \
                or self.defaults.get("rounding")
            rounded = self.round_(line["quantity"], rnd)
            collect(line, quantity_delta(line["quantity"], rounded, "round", "round", param=slot(rnd["step"]) if rnd else None))
            line["quantity"] = rounded
            for k in ("_missing", "_count"):
                line.pop(k)
            self.log.info("derived", f"line '{line['description']}' = {fmt(line['quantity']) if line['quantity'] is not None else 'FLAGGED'} {line['unit']}",
                          ruleId=line["ruleId"], lineKey=line["key"],
                code="log.derived.line", params=dict(
                    description=line['description'], quantity=line['quantity'], unit=line['unit'],
                ))
            lines.append(line)
        return lines

    # ---------------------------------------------------------------- manual
    def run_manual(self, keys: dict[str, str]) -> list[dict]:
        lines = []
        for m in self.rules.get("manual", []):
            if not self.enabled(m):
                continue
            q = self.val(m.get("quantity"))
            amount = self.val(m.get("amount"))
            formula = "manual item"
            if m.get("formula"):
                v, txt = self.x.explain(self.val(m["formula"]) or "", self.ctx({}))
                q = float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
                formula = self.formula_text(m["formula"]) + f"   ->   {txt}"
            line = {"key": keys.get(m["id"], m["id"]), "ruleId": m["id"], "ruleKind": "manual", "description": self.render(m["description"], {}),
                    "unit": m["unit"], "quantity": float(q) if q is not None else None,
                    "source": "manual" if q is not None else "flagged", "keys": {},
                    "trace": {"formula": formula, "params": self.params_used(m) if m.get("formula") else {}, "elements": []},
                    "tags": m.get("tags", []), "notes": [f"amount {fmt(amount)}"] if amount is not None else
                    ([] if q is not None else ["no model behind this line: quantity to be entered"]),
                    "_fields": {"manual_kind": m["kind"]}, "_mixed": [], "_manual_kind": m["kind"],
                    "_manual_codes": m.get("codes", {}), "location": {}}
            collect(line, [step("start", "manual" if q is not None else "manual.missing", line["quantity"],
                                {"formula": formula} if m.get("formula") else {})])
            lines.append(line)
            self.log.info("manual", f"manual item '{line['description']}' ({m['kind']}): "
                          f"{fmt(line['quantity']) + ' ' + line['unit'] if q is not None else 'quantity to be entered'}",
                          ruleId=m["id"], lineKey=line["key"],
                code="log.manual.line", params=dict(
                    description=line['description'], kind=m['kind'], quantity=line['quantity'],
                    unit=line['unit'],
                ))
        return lines


def unmatched_id(e: dict) -> str:
    """Question id grouping unmatched elements of the same class and type."""
    return f"unmatched:{e['ifc_class']}:{e.get('type_name') or e.get('name') or ''}"


def _key(v):
    if isinstance(v, float):
        return round(v, 6)
    return v


def _unkey(v):
    return v


def describe_spec(spec: dict, eng: RuleEngine | None = None) -> str:
    """Human-readable formula for a QuantitySpec (used in traces and the Excel sheet)."""
    v = (lambda x: eng.val(x)) if eng else (lambda x: x)
    k = spec["kind"]
    if k == "count":
        return "count"
    if k == "length":
        return f"length ({v(spec.get('basis')) or 'axis'})"
    if k in ("area", "volume"):
        base = f"{k}"
        if k == "area":
            base += f" ({v(spec.get('surface')) or 'main'}"
        else:
            base += " ("
        base += f"{', ' if k == 'area' else ''}{v(spec.get('start')) or ('gross' if k == 'area' else 'net')})"
        for d in spec.get("deductions") or []:
            mode = v(d["mode"])
            if mode == "none":
                continue
            base += f" - {d['what']}[{mode}"
            if mode != "all":
                base += f" > {fmt(v(d.get('threshold')) or 0)}"
            base += "]"
        return base
    if k == "mass":
        return f"mass ({v(spec.get('basis'))})"
    if k == "perimeter":
        return "perimeter"
    if k == "choose":
        pick = v(spec["pick"])
        return f"{pick}: " + describe_spec(spec["options"].get(pick, {"kind": "count"}), eng)
    if k == "when":
        return f"IF {spec['if']} THEN {describe_spec(spec['then'], eng)} ELSE {describe_spec(spec['else'], eng)}"
    if k == "formula":
        return eng.formula_text(spec["expr"]) if eng else str(spec["expr"])
    return k
