"""Review B-02 (ENG-027): property-based tests for the expression evaluator and the breakdowns, with Hypothesis.
Each property is a rule the documents state; the examples are drawn, not chosen by the author. The whole file
runs in a few seconds (well under the item's 60 s)."""
from __future__ import annotations

import math

import pytest
from hypothesis import given, settings, strategies as st

from ifc_boq.expr import STEP_TOLERANCE, Expr, fmt
from ifc_boq.rules import RuleEngine

E = Expr()
FAST = settings(max_examples=300, deadline=None)
STEPS = st.sampled_from([0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 10])
NUMBERS = st.floats(min_value=-1e6, max_value=1e6, allow_nan=False, allow_infinity=False)


# ------------------------------------------------------------------ literals (A-22, ENG-001)
@FAST
@given(st.text(alphabet=st.characters(blacklist_categories=("Cs",)), max_size=40))
def test_any_text_written_as_a_literal_evaluates_to_itself(text):
    literal = '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t") + '"'
    assert E.evaluate(literal, {}) == text


# ------------------------------------------------------------------ step rounding (A-23, ENG-005)
@FAST
@given(NUMBERS, STEPS)
def test_floor_ceil_and_round_bracket_the_value_on_the_step(x, step):
    lo, hi, near = (E.evaluate(f"{fn}(x, {step})", {"x": x}) for fn in ("FLOOR", "CEIL", "ROUND"))
    # within the documented tolerance: a value within 1e-9 of a step of a multiple is that multiple (A-23)
    eps = STEP_TOLERANCE * step + 1e-9 * max(1.0, abs(x))
    assert lo <= x + eps and hi >= x - eps
    assert hi - lo == pytest.approx(0, abs=eps) or hi - lo == pytest.approx(step, abs=eps + 1e-9)
    assert near in (lo, hi) and abs(near - x) <= step / 2 + eps
    for v in (lo, hi, near):
        k = v / step
        assert abs(k - round(k)) < 1e-6, (v, step)


@FAST
@given(st.integers(min_value=-10_000, max_value=10_000), STEPS)
def test_a_multiple_of_the_step_is_its_own_rounding(k, step):
    x = k * step
    for fn in ("FLOOR", "CEIL", "ROUND"):
        assert E.evaluate(f"{fn}(x, {step})", {"x": x}) == pytest.approx(x, abs=1e-9 * max(1.0, abs(x)))


# ------------------------------------------------------------------ null semantics (rules-language.md)
@FAST
@given(NUMBERS, st.sampled_from(["+", "-", "*", "/"]), st.booleans())
def test_arithmetic_with_null_is_null(x, op, left):
    src = f"n {op} x" if left else f"x {op} n"
    if op == "/" and not left and x == 0:
        return
    assert E.evaluate(src, {"n": None, "x": x}) is None


@FAST
@given(NUMBERS, st.sampled_from([">", "<", ">=", "<="]))
def test_an_ordering_with_null_is_false(x, op):
    assert E.evaluate(f"n {op} x", {"n": None, "x": x}) is False
    assert E.evaluate("n = null", {"n": None}) is True


# ------------------------------------------------------------------ printing and parsing numbers
@FAST
@given(st.decimals(min_value=-1_000_000, max_value=1_000_000, places=4, allow_nan=False, allow_infinity=False))
def test_a_printed_number_reads_back_as_itself(d):
    v = float(d)
    assert E.evaluate(fmt(v), {}) == pytest.approx(v, abs=1e-9)
    assert fmt(E.evaluate(fmt(v), {})) == fmt(v)


# ------------------------------------------------------------------ breakdowns: parts add up (A-24, ENG-004)
def engine(by_guid=None) -> RuleEngine:
    e = RuleEngine.__new__(RuleEngine)
    e.val = lambda v: v
    e.defaults = {}
    e.by_guid = by_guid or {}
    return e


LAYERS = st.lists(st.tuples(st.sampled_from(["concrete", "brick", "insulation", "plaster"]),
                            st.floats(min_value=0.001, max_value=0.5)), min_size=1, max_size=6)


def element(layers, area):
    t = sum(th for _, th in layers)
    return {"guid": "g", "gross_area": area, "net_area": area * 0.9, "gross_volume": area * t, "net_volume": area * 0.9 * t,
            "layers": [{"index": i, "material": m, "material_raw": m.title(), "thickness": th} for i, (m, th) in enumerate(layers)]}


@FAST
@given(LAYERS, st.floats(min_value=0.01, max_value=1e4))
def test_layer_and_material_parts_add_up_to_the_element(layers, area):
    el = element(layers, area)
    for bd in ("layer", "material"):
        parts = engine().parts_of({"breakdown": bd}, el)
        for key in ("gross_volume", "net_volume"):
            assert sum(p[key] for p in parts) == pytest.approx(el[key], rel=1e-9), (bd, key)
    materials = engine().parts_of({"breakdown": "material"}, el)
    assert sorted(p["material"] for p in materials) == sorted({m for m, _ in layers})


@FAST
@given(st.lists(st.tuples(st.sampled_from(["a", "b"]), st.floats(min_value=0.0, max_value=100.0),
                          st.floats(min_value=0.0, max_value=1.0)), min_size=1, max_size=8))
def test_face_parts_add_up_and_share_each_sides_openings(faces):
    el = {"guid": "g", "faces": [{"side": s, "gross_area": g, "net_area": g * f} for s, g, f in faces]}
    parts = engine().parts_of({"breakdown": "face"}, el)
    assert sum(p["gross_area"] for p in parts) == pytest.approx(sum(g for _, g, _ in faces))
    for side in {s for s, _, _ in faces}:
        shares = [p["_open_share"] for p in parts if p["side"] == side]
        total = sum(g for s, g, _ in faces if s == side)
        assert sum(shares) == pytest.approx(1.0) if total else all(x == 1.0 for x in shares)


@FAST
@given(st.lists(st.floats(min_value=0.0, max_value=50.0), min_size=1, max_size=6))
def test_child_parts_are_the_children_and_an_element_breakdown_is_the_element(volumes):
    children = {f"c{i}": {"guid": f"c{i}", "name": f"part {i}", "gross_volume": v} for i, v in enumerate(volumes)}
    parent = {"guid": "p", "child_guids": list(children), "gross_volume": sum(volumes)}
    parts = engine(children).parts_of({"breakdown": "child"}, parent)
    assert [p["guid"] for p in parts] == list(children)
    assert math.isclose(sum(p["gross_volume"] for p in parts), parent["gross_volume"], rel_tol=1e-12, abs_tol=1e-12)
    assert engine().parts_of({"breakdown": "element"}, parent) == [parent]
