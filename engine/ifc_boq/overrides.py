"""Line-level decisions applied by the engine."""
from __future__ import annotations

from .expr import fmt
from .log import CalcLog


def from_decisions(decisions: list[dict]) -> dict[str, dict]:
    overrides = {}
    for decision in decisions:
        prefix, _, key = decision["questionId"].partition(":")
        if prefix != "override":
            continue
        edit = decision["answer"]
        if not key or not isinstance(edit, dict):
            raise ValueError("A line override needs a line key and an edit object")
        if "unit" in edit and ("quantity" not in edit or not edit["unit"].strip()):
            raise ValueError("Changing the line unit requires a quantity and a non-empty unit")
        if ("quantity" in edit or edit.get("excluded")) and not (edit.get("reason") or "").strip():
            raise ValueError("Changing a quantity or excluding a line requires a reason")
        overrides[key] = edit
    return overrides


def apply_quantity(line: dict, edit: dict) -> None:
    if "quantity" in edit:
        line["overridden"] = {"fields": ["quantity"], "engineQuantity": line["quantity"], "quantity": edit["quantity"]}
        line["quantity"] = edit["quantity"]


def _finish(line: dict, edit: dict, log: CalcLog) -> None:
    details = line.get("overridden", {})
    fields = details.setdefault("fields", [])
    for field in ("unit", "description"):
        if field in edit:
            fields.append(field)
            details["engine" + field.capitalize()] = line[field]
            line[field] = edit[field]
    if details.get("engineCodes"):
        fields.append("codes")
    if edit.get("excluded"):
        fields.append("excluded")
        line["excluded"] = True
    if not fields:
        return
    if edit.get("reason"):
        details["reason"] = edit["reason"]
    line["overridden"] = details
    if "quantity" in fields:
        old = fmt(details["engineQuantity"]) if details["engineQuantity"] is not None else "to confirm"
        new = fmt(details["quantity"]) if details["quantity"] is not None else "to confirm"
        if "unit" in fields:                     # a unit edit: say from what to what (TF-108)
            old, new = f"{old} {details['engineUnit']}", f"{new} {line['unit']}"
        summary = f"quantity edited: {old} → {new}"
    else:
        summary = f"edited {', '.join(fields)}"
    line["notes"] = [*line["notes"], summary]
    reason = f" ({edit['reason']})" if edit.get("reason") else ""
    log.info("decision", f"{line['description']}: {summary}{reason}", ruleId=line["ruleId"], lineKey=line["key"],
             code="log.decision.line_override", params={"description": line["description"], **details})


def apply_final(lines: list[dict], overrides: dict[str, dict], log: CalcLog) -> list[dict]:
    remaining = set(overrides)
    for line in lines:
        if line["key"] in remaining:
            _finish(line, overrides[line["key"]], log)
            remaining.remove(line["key"])
    return [
        {"id": "orphan:" + key, "kind": "orphan_override", "blocking": False,
         "code": "question.orphan_override", "params": {"lineKey": key},
         "message": f"The edit for '{key}' has no matching line in this run.",
         "answer": {"kind": "choice", "options": [{"value": "dismiss", "label": "Dismiss"}]}}
        for key in sorted(remaining)
    ]
