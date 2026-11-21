"""Structured quantities recorded alongside the original calculation."""
from __future__ import annotations

import json

ORDER = {"start": 0, "derive": 0, "deduct": 1, "add": 2, "factor": 3, "round": 4, "edit": 5}


def slot(spec):
    return spec.get("param") if isinstance(spec, dict) else None


def step(kind, code, value, params=None, param=None):
    out = {"kind": kind, "code": f"trace.{code}", "params": params or {}, "value": value}
    if param:
        out["param"] = param
    return out


def collect(line, part_steps, guid=None):
    """Group like contributions so a large take-off still has a compact explanation."""
    grouped = line.setdefault("_steps", {})
    for item in part_steps:
        params = item["params"]
        counts = {k: v for k, v in params.items() if k in {"count", "kept", "missing"}}
        signature = (item["kind"], item["code"], item.get("param"),
                     json.dumps({k: v for k, v in params.items() if k not in counts}, sort_keys=True))
        if signature not in grouped:
            entry = dict(item, params=dict(params), elements={})
            grouped[signature] = entry
        else:
            entry = grouped[signature]
            if item["value"] is not None:
                entry["value"] = (entry["value"] or 0) + item["value"]
            for key, value in counts.items():
                entry["params"][key] = entry["params"].get(key, 0) + value
        if guid:
            entry["elements"][guid] = None


def quantity_delta(before, after, kind, code, params=None, param=None):
    if before is None or after is None or before == after:
        return []
    return [step(kind, code, after - before, params, param)]


def finish(line):
    measured = line.pop("_steps", {})
    trace = line["trace"]
    edit = line.get("overridden", {})
    edited = "quantity" in edit.get("fields", [])
    unit = line["unit"]
    original_unit = edit.get("engineUnit", unit)
    original = edit.get("engineQuantity") if edited else line["quantity"]
    quantity = line["quantity"]
    merged = []
    for item in sorted(measured.values(), key=lambda item: ORDER[item["kind"]]):
        if item["elements"]:
            item["elements"] = list(item["elements"])
        else:
            item.pop("elements")
        item["unit"] = original_unit
        merged.append(item)
    if original is not None:
        subtotal = sum(item["value"] or 0 for item in merged)
        if abs(original - subtotal) > 1e-7:
            merged.append(dict(step("round", "round", original - subtotal), unit=original_unit))
    if edited:
        params = {"engineQuantity": original, "quantity": quantity}
        if original_unit != unit:
            params["engineUnit"] = original_unit
        if edit.get("reason"):
            params["reason"] = edit["reason"]
        delta = None if quantity is None else quantity - (original or 0)
        merged.append(dict(step("edit", "edit.flagged" if quantity is None else "edit.quantity", delta, params), unit=unit))
    trace["steps"] = [*merged, dict(step("result", "result", quantity), unit=unit)]


def describe(item):
    kind, value = item["kind"], item["value"]
    params = item["params"]
    unit = item.get("unit", "")
    amount = "quantity to be confirmed" if value is None else f"{value:g} {unit}".strip()
    if kind == "derive":
        return f"Derived from {params.get('sourceDescription', params.get('sourceLine', 'source'))}: {amount}"
    if kind == "deduct":
        threshold = f" above {params['threshold']:g} by {params['compareBy']}" if "threshold" in params else ""
        return f"Deduct {params['count']} {params['what']}{threshold}: {amount}"
    if kind == "edit":
        return f"Edited quantity: {params.get('quantity')} {unit}".strip()
    labels = {"start": "Starting quantity", "add": "Add", "factor": "Factor adjustment", "round": "Rounding", "result": "Result"}
    return f"{labels[kind]}: {amount}"
