"""
Wall codes (review A-21, QS-007): the shipped maps place a wall by its dictionary type, fall back to the IFC
IsExternal flag, and never send an unplaced wall to a real code; a map rule's `expect` warns when the code
contradicts the model (`code_check`). Classification only labels lines: no number moves (rule 6, BR-02).
"""
from __future__ import annotations

import pytest

from ifc_boq import presets
from ifc_boq.classify import classify
from ifc_boq.log import CalcLog
from ifc_boq.names import Resolver

EXPR = Resolver([presets.load_dictionary("global-seed")], presets.resolution()).expr   # knows the term tree (UNDER)


def wall_line(key: str, element_type=None, is_external=None, material=None, rule_id="walls") -> dict:
    return {"key": key, "ruleId": rule_id, "ruleKind": "item", "tags": ["wall"], "unit": "m2", "source": "measured",
            "description": key, "quantity": 10.0, "keys": {},
            "_fields": {"ifc_class": "IfcWall", "element_type": element_type, "is_external": is_external,
                        "material": material, "family": "planar"}, "_mixed": []}


def codes(system: str, lines: list[dict]) -> tuple[dict, list[dict]]:
    code_list, cmap = presets.load_classification(system)
    warnings: list[dict] = []
    classify(lines, code_list, cmap, EXPR, CalcLog(), {}, [], warnings)
    return {l["key"]: l["codes"].get(code_list["id"], {}).get("code") for l in lines}, warnings


@pytest.mark.parametrize("element_type, is_external, code", [
    ("wall.external", None, "D.01"),
    (None, True, "D.01"),             # S01, S07, S09: no external type, IsExternal TRUE
    ("wall.partition", None, "D.02"),
    ("wall.party", True, "D.02"),     # the Duplex party wall: the dictionary type wins over IsExternal
    (None, False, "D.02"),
    (None, None, "Z.99"),             # neither the type nor the flag places it: to be classified
    ("wall", None, "Z.99"),
])
def test_acme_places_a_wall_by_type_then_is_external(element_type, is_external, code):
    got, _ = codes("acme-cost-codes", [wall_line("w", element_type, is_external)])
    assert got["w"] == code


def test_a_code_that_contradicts_is_external_warns():
    got, warnings = codes("acme-cost-codes", [wall_line("party", "wall.party", True), wall_line("ext", "wall.external", False),
                                              wall_line("ok", "wall.external", True), wall_line("plain", None, None)])
    assert got == {"party": "D.02", "ext": "D.01", "ok": "D.01", "plain": "Z.99"}
    checks = {w["params"]["description"]: w["params"] for w in warnings if w["code"] == "code_check"}
    assert set(checks) == {"party", "ext"}
    assert checks["party"]["mapRuleId"] == "internal-walls" and checks["party"]["code"] == "D.02"


def test_demo_trades_masonry_only_for_masonry_walls():
    got, _ = codes("demo-trades", [wall_line("brick", material="masonry.brick"), wall_line("board", material="board.plasterboard"),
                                   wall_line("concrete", material="concrete.in_situ"), wall_line("none")])
    assert got == {"brick": "02", "board": "99", "concrete": "01", "none": "99"}


def test_the_shipped_maps_pass_the_preset_check():
    for system in ("acme-cost-codes", "demo-trades", "uniclass2015-ef"):
        code_list, cmap = presets.load_classification(system)
        assert presets.check("classifications", {"codeList": code_list, "map": cmap}) == [], system
