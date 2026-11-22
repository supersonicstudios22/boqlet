import pytest

from ifc_boq.expr import Expr, ExprError

E = Expr({"concrete.in_situ": "concrete", "concrete": None})
CTX = {
    "net_area": 41.36, "thickness": 0.417, "p": {"t": 0.5, "f": 1.05},
    "openings": [{"area": 0.62, "kind": "window", "width": 0.819}, {"area": 2.4, "kind": "door", "width": 1.0}],
    "src": {"length": 17.383, "height": 0.3, "material": "concrete.in_situ", "qty": 10,
            "layers": [{"material": "a", "area": 3}, {"material": "b", "area": 4}]},
    "props": {"Pset_WallCommon.FireRating": "EI60"},
}


@pytest.mark.parametrize("src,expected", [
    ("1 + 2 * 3", 7),
    ("net_area + SUM(openings.area WHERE area <= p.t)", 41.36),
    ("net_area + SUM(openings.area WHERE area > p.t)", 44.38),
    ("net_area + SUM(openings.area WHERE area > 1)", 43.76),
    ("COUNT(openings WHERE kind = \"door\")", 1),
    ("COUNT(openings)", 2),
    ("MAX(openings.area)", 2.4),
    ("MIN(1, 2)", 1),
    ("IF(thickness >= 0.25, 1, 2)", 1),
    ("UNDER(src.material, \"concrete\")", True),
    ("UNDER(src.material, \"masonry\")", False),
    ("props[\"Pset_WallCommon.FireRating\"] = \"EI60\"", True),
    ("SUM(src.layers.area WHERE material = \"b\")", 4),
    ("2 * src.length * src.height * p.f", 2 * 17.383 * 0.3 * 1.05),
    ("missing + 1", None),
    ("missing = null", True),
    ("missing > 1", False),
    ("ROUND(3.14159, 0.01)", 3.14),
    ("CEIL(2.01, 0.5)", 2.5),
    ("NOT (1 > 2) AND TRUE", True),
    ("10 / 0", None),
])
def test_values(src, expected):
    v = E.evaluate(src, CTX)
    if isinstance(expected, float):
        assert v == pytest.approx(expected)
    else:
        assert v == expected


def test_explain_substitutes_values():
    v, text = E.explain("2 * src.length * src.height", CTX)
    assert text == "2 * 17.383 * 0.3 = 10.4298"


def test_no_python_eval():
    with pytest.raises(ExprError):
        E.evaluate("__import__('os')", CTX)


@pytest.mark.parametrize("src,expected", [
    ("ROUND(0.125, 0.01)", 0.13), ("ROUND(2.5)", 3), ("ROUND(-2.5)", -3), ("ROUND(1.005, 0.01)", 1.01), ("ROUND(2.4)", 2),
])
def test_round_takes_halves_away_from_zero_as_excel_does(src, expected):
    """TF-059: not Python's banker's rounding."""
    assert E.evaluate(src, CTX) == pytest.approx(expected, abs=1e-12)


def test_line_rounding_takes_halves_up():
    from ifc_boq.rules import RuleEngine
    engine = RuleEngine.__new__(RuleEngine)
    engine.val = lambda v: v
    assert engine.round_(0.125, {"step": 0.01, "mode": "nearest"}) == 0.13
    assert engine.round_(2.5, {"step": 1, "mode": "nearest"}) == 3
    assert engine.round_(2.4999, {"step": 1, "mode": "nearest"}) == 2
