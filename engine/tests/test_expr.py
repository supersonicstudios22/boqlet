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


# ------------------------------------------------------------------ string literals (review A-22, ENG-001)
@pytest.mark.parametrize("src,ctx,expected", [
    ('"béton"', {}, "béton"),
    ('name = "Ziegel ä"', {"name": "Ziegel ä"}, True),
    ('CONTAINS(name, "béton")', {"name": "Béton armé"}, True),
    ('LOWER("ÉTÉ") = "été"', {}, True),
    ('"Бетон" + " " + "混凝土"', {}, "Бетон 混凝土"),
    ('props["Pset_Ståhl.Höhe"]', {"props": {"Pset_Ståhl.Höhe": 3}}, 3),
])
def test_non_ascii_literals_are_kept_as_written(src, ctx, expected):
    assert E.evaluate(src, ctx) == expected


@pytest.mark.parametrize("src,expected", [
    (r'"a\"b"', 'a"b'), (r'"back\\slash"', "back\\slash"), (r'"tab\tend"', "tab\tend"), (r'"line\nnext"', "line\nnext"),
    (r'"\u00e9t\u00e9"', "été"), (r'"keep \d as written"', r"keep \d as written"),
])
def test_only_the_documented_escapes_are_decoded(src, expected):
    assert E.evaluate(src, {}) == expected


def test_arbitrary_unicode_literals_round_trip():
    """A seeded property test (Hypothesis is not installed; B-02 adds it): any text, written as a literal with
    its quote and backslash escaped, evaluates to itself."""
    import random
    rnd = random.Random(20261124)
    alphabet = [chr(c) for c in range(32, 0x2FF)] + list("ÄÖÜßéèçøåłšžđćБетонΣ混凝土🧱\"\\\t")
    for _ in range(500):
        text = "".join(rnd.choice(alphabet) for _ in range(rnd.randint(0, 24)))
        literal = '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\t", "\\t") + '"'
        assert E.evaluate(literal, {}) == text, literal


# ------------------------------------------------------------------ step rounding (review A-23, ENG-005)
@pytest.mark.parametrize("src,expected", [
    ("FLOOR(0.3, 0.1)", 0.3), ("FLOOR(4.35, 0.05)", 4.35), ("CEIL(0.3, 0.1)", 0.3), ("ROUND(0.3, 0.1)", 0.3),
    ("FLOOR(0.29, 0.1)", 0.2), ("CEIL(0.31, 0.1)", 0.4), ("FLOOR(2.675, 0.01)", 2.67), ("CEIL(1.11, 0.5)", 1.5),
    ("FLOOR(7.3, 0.5)", 7.0), ("ROUND(4.35, 0.05)", 4.35), ("FLOOR(-0.3, 0.1)", -0.3), ("CEIL(-0.31, 0.1)", -0.3),
    ("FLOOR(2.7)", 2), ("CEIL(2.1)", 3),
])
def test_step_functions_are_exact_on_decimal_steps(src, expected):
    assert E.evaluate(src, {}) == expected     # exact: no float tail


def test_a_multiple_of_the_step_stays_itself():
    """Property: FLOOR, CEIL and ROUND of k x step at that step give k x step, for the usual steps."""
    for step in (0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5):
        for k in range(-200, 201):
            x = k * step
            want = round(x, 10)
            for fn in ("FLOOR", "CEIL", "ROUND"):
                assert E.evaluate(f"{fn}(x, {step})", {"x": x}) == want, (fn, x, step)


def test_rule_rounding_and_the_functions_agree():
    from ifc_boq.rules import RuleEngine
    engine = RuleEngine.__new__(RuleEngine)
    engine.val = lambda v: v
    for x in (0.3, 4.35, 2.675, 0.125, 1.005, 7.3, 12.4999):
        for step in (0.01, 0.05, 0.1, 0.5):
            assert engine.round_(x, {"step": step, "mode": "down"}) == E.evaluate(f"FLOOR(x, {step})", {"x": x})
            assert engine.round_(x, {"step": step, "mode": "up"}) == E.evaluate(f"CEIL(x, {step})", {"x": x})
            assert engine.round_(x, {"step": step, "mode": "nearest"}) == E.evaluate(f"ROUND(x, {step})", {"x": x})
