"""Engine result invariants (review B-01, FM-111).

Checked at the end of every `get_boq`, before the result leaves the engine:

- **hard** (the result can't be stored as it is): question ids and line keys are unique. A duplicate question id
  once surfaced only as a database primary-key violation (ENG-003).
- **soft** (the numbers or counts disagree with themselves): `stats` agree with the lines; an item line's
  quantity is the sum of its elements' shares (within its rounding); an element measured by two item rules of
  one family without claims carries a `double_count` warning (A-20).

In strict mode (the engine tests, `IFC_BOQ_STRICT_INVARIANTS=1`) any violation raises `InvariantError`. Otherwise
hard violations raise too (the worker answers `result_invalid`, not retryable) and soft ones become one warning
entry each in the calculation log (`log.invariants.violation`), so a legitimate model is never refused for them.
"""
from __future__ import annotations

import os
from collections import Counter, defaultdict
from itertools import combinations

from .units import DIMENSION as UNIT_FAMILY

STRICT_ENV = "IFC_BOQ_STRICT_INVARIANTS"
_REL = 1e-6


class InvariantError(ValueError):
    """The result breaks an invariant. `hard` ones can't be stored; `violations` lists every one found."""

    def __init__(self, violations: list[dict], hard: bool):
        self.violations = violations
        self.hard = hard
        super().__init__("; ".join(v["message"] for v in violations[:5]) + (f" (+{len(violations) - 5} more)" if len(violations) > 5 else ""))


def strict() -> bool:
    return os.environ.get(STRICT_ENV, "") not in ("", "0", "false")


def _dupes(values) -> list:
    return sorted(v for v, n in Counter(values).items() if n > 1)


def hard_violations(result: dict) -> list[dict]:
    out = []
    for qid in _dupes(q["id"] for q in result.get("questions", [])):
        out.append({"code": "duplicate_question_id", "id": qid, "message": f"question id {qid!r} appears more than once"})
    for key in _dupes(line["key"] for line in result.get("lines", [])):
        out.append({"code": "duplicate_line_key", "id": key, "message": f"line key {key!r} appears more than once"})
    return out


def _step(rounding) -> float:
    if not isinstance(rounding, dict):
        return 0.0
    step = rounding.get("step")
    if isinstance(step, dict):          # a slot reference: {"value": ...}
        step = step.get("value")
    try:
        return abs(float(step or 0))
    except (TypeError, ValueError):
        return 0.0


def soft_violations(result: dict) -> list[dict]:
    out = []
    lines = result.get("lines", [])
    stats = result.get("stats", {})
    flagged = sum(1 for line in lines if line.get("quantity") is None or line.get("toConfirm"))
    if stats.get("lines") != len(lines):
        out.append({"code": "stats_lines", "message": f"stats.lines {stats.get('lines')} but {len(lines)} lines"})
    if stats.get("flaggedLines") != flagged:
        out.append({"code": "stats_flagged", "message": f"stats.flaggedLines {stats.get('flaggedLines')} but {flagged} flagged lines"})

    rules = result.get("ruleSet") or {}
    items = {i.get("id"): i for i in rules.get("items", [])}
    default_rounding = (rules.get("defaults") or {}).get("rounding")
    for line in lines:
        if line.get("ruleKind") != "item" or line.get("overridden") or line.get("excluded"):
            continue
        q = line.get("quantity")
        shares = [e.get("quantity") for e in line.get("trace", {}).get("elements", [])]
        if q is None or not shares or any(s is None for s in shares):
            continue
        item = items.get(line.get("ruleId"), {})
        if item.get("minimum") or any("minimum" in n for n in line.get("notes", [])):
            continue
        rounding = item.get("rounding") or default_rounding or {}
        step = _step(rounding)
        per_element = isinstance(rounding, dict) and rounding.get("at") == "element"
        total = sum(shares)
        tolerance = step * (len(shares) if per_element else 1) + _REL * max(abs(total), abs(q), 1.0)
        if abs(q - total) > tolerance:
            out.append({"code": "line_sum", "id": line["key"],
                        "message": f"line {line['key']!r}: quantity {q} but its elements add up to {total:.6f}"})

    claims = {i: set(item.get("claims") or ()) for i, item in items.items()}
    rules_of = defaultdict(set)
    for line in lines:
        if line.get("ruleKind") != "item" or line.get("excluded"):
            continue
        family = UNIT_FAMILY.get(line.get("unit"), line.get("unit"))
        for e in line.get("trace", {}).get("elements", []):
            rules_of[(e["guid"], family)].add(line["ruleId"])
    warned = defaultdict(set)
    for w in result.get("warnings", []):
        if w.get("code") == "double_count":
            for guid in w.get("guids", []):
                warned[guid].add(w.get("params", {}).get("family"))
    for (guid, family), rids in sorted(rules_of.items()):
        loose = any(not (claims.get(a) and claims.get(b)) for a, b in combinations(sorted(rids), 2))
        if loose and family not in warned.get(guid, ()):
            out.append({"code": "double_count_unwarned", "id": guid,
                        "message": f"element {guid} is measured as {family} by {', '.join(sorted(rids))} without claims and without a double_count warning"})
    return out


def check(result: dict, *, strict_mode: bool | None = None) -> list[dict]:
    """Checks `result` in place: raises on hard violations (always) and soft ones (strict); otherwise appends one
    warning entry per soft violation to `result["log"]`. Returns the soft violations."""
    hard = hard_violations(result)
    if hard:
        raise InvariantError(hard, hard=True)
    soft = soft_violations(result)
    if soft and (strict() if strict_mode is None else strict_mode):
        raise InvariantError(soft, hard=False)
    log = result.setdefault("log", [])
    for v in soft:
        log.append({"seq": len(log) + 1, "stage": "summary", "level": "warning", "message": "Invariant: " + v["message"],
                    "code": "log.invariants.violation", "params": {"check": v["code"], "id": v.get("id")}})
    return soft
