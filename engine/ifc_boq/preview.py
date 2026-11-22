"""A preset preview compares displayed line quantities by their stable keys."""
from __future__ import annotations


def sample(line: dict) -> dict:
    result = {field: line[field] for field in ("key", "ruleId", "description", "quantity", "unit")}
    if line.get("keys"):
        result["keys"] = line["keys"]
    if storey := line.get("location", {}).get("storey"):
        result["storey"] = storey
    # The code per classification with its item text as the engine filled it (only the engine fills blanks):
    # the Library's "Reads as" sample (F10-AC5).
    if codes := line.get("codes"):
        result["codes"] = {system: {"code": entry["code"], **({"text": entry["text"]} if entry.get("text") else {})}
                           for system, entry in codes.items()}
    return result


def compare_lines(before: dict, after: dict) -> list[dict]:
    previous = {line["key"]: sample(line) for line in before["lines"]}
    changes = []
    for line in after["lines"]:
        key = line["key"]
        new = sample(line)
        old = previous.pop(key, None)
        if old is None:
            changes.append({"key": key, "change": "added", "after": new})
        elif any(old[field] != new[field] for field in ("description", "quantity", "unit")):
            changes.append({"key": key, "change": "changed", "before": old, "after": new})
    changes.extend({"key": key, "change": "removed", "before": old} for key, old in previous.items())
    return changes
