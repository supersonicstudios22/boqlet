"""Review B-01: the result invariants catch broken results (fed by hand) and pass on a real one."""
import copy

import pytest

from ifc_boq import invariants
from ifc_boq.invariants import InvariantError


def line(key, quantity, shares, rule="walls", unit="m2", **extra):
    return {"key": key, "ruleId": rule, "ruleKind": "item", "unit": unit, "quantity": quantity, "notes": [],
            "trace": {"elements": [{"guid": g, "quantity": q} for g, q in shares]}, **extra}


def result(lines, questions=(), warnings=(), items=None):
    return {"lines": list(lines), "questions": list(questions), "warnings": list(warnings), "log": [],
            "ruleSet": {"items": items or [{"id": "walls"}, {"id": "paint", "claims": ["finish"]}],
                        "defaults": {"rounding": {"step": 0.01, "mode": "nearest", "at": "line"}}},
            "stats": {"lines": len(lines), "flaggedLines": sum(1 for l in lines if l["quantity"] is None or l.get("toConfirm"))}}


GOOD = [line("walls|A", 10.0, [("g1", 4.0), ("g2", 6.004)]), line("walls|B", None, [("g3", None)])]


def test_a_consistent_result_passes():
    assert invariants.check(result(GOOD), strict_mode=True) == []


def test_duplicate_question_ids_and_line_keys_always_raise():
    with pytest.raises(InvariantError) as caught:
        invariants.check(result(GOOD, questions=[{"id": "q"}, {"id": "q"}]), strict_mode=False)
    assert caught.value.hard and caught.value.violations[0]["code"] == "duplicate_question_id"
    with pytest.raises(InvariantError) as caught:
        invariants.check(result(GOOD + [line("walls|A", 1.0, [("g9", 1.0)])]), strict_mode=False)
    assert caught.value.violations[0]["code"] == "duplicate_line_key"


@pytest.mark.parametrize("broken, code", [
    (lambda r: r["stats"].update(lines=7), "stats_lines"),
    (lambda r: r["stats"].update(flaggedLines=0), "stats_flagged"),
    (lambda r: r["lines"][0].update(quantity=10.5), "line_sum"),
])
def test_soft_violations_raise_in_strict_mode_and_are_logged_otherwise(broken, code):
    r = result(copy.deepcopy(GOOD))
    broken(r)
    with pytest.raises(InvariantError) as caught:
        invariants.check(copy.deepcopy(r), strict_mode=True)
    assert not caught.value.hard and [v["code"] for v in caught.value.violations] == [code]
    found = invariants.check(r, strict_mode=False)
    assert [v["code"] for v in found] == [code]
    assert r["log"][-1]["code"] == "log.invariants.violation" and r["log"][-1]["level"] == "warning"


def test_line_sum_allows_the_rounding_step_and_skips_edited_and_minimum_lines():
    assert invariants.check(result([line("walls|A", 10.01, [("g1", 10.004)])]), strict_mode=True) == []
    edited = line("walls|A", 99.0, [("g1", 1.0)], overridden={"fields": ["quantity"]})
    raised = line("walls|B", 5.0, [("g2", 1.0)], notes=["raised to line minimum 5"])
    assert invariants.check(result([edited, raised]), strict_mode=True) == []


def test_an_element_in_two_unclaimed_rules_of_one_family_needs_its_double_count_warning():
    lines = [line("walls|A", 4.0, [("g1", 4.0)]), line("other|A", 4.0, [("g1", 4.0)], rule="other")]
    items = [{"id": "walls"}, {"id": "other"}]
    with pytest.raises(InvariantError) as caught:
        invariants.check(result(lines, items=items), strict_mode=True)
    assert caught.value.violations[0]["code"] == "double_count_unwarned"
    warned = [{"code": "double_count", "guids": ["g1"], "params": {"family": "area"}}]
    assert invariants.check(result(lines, warnings=warned, items=items), strict_mode=True) == []
    claimed = [{"id": "walls", "claims": ["body"]}, {"id": "other", "claims": ["finish"]}]
    assert invariants.check(result(lines, items=claimed), strict_mode=True) == []


def test_the_duplex_result_passes_in_strict_mode(duplex_parsed):
    from tests.test_duplex import run
    r = run(duplex_parsed)                    # get_boq already checked it (strict in the tests); once more by hand
    assert invariants.check(r, strict_mode=True) == []
