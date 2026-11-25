"""
Plausibility warnings (review WP-A2, A-07, A-08): what an element is and how big it is. Warnings only: they never
change a number and never block. Synthetic documents from test_reported_quantities.py; sample checks marked slow.
"""
from __future__ import annotations

import pytest
from test_reported_quantities import doc, review_sample, sample_lines, slab

from ifc_boq import presets
from ifc_boq.pipeline import get_boq


def run(parsed: dict, settings: dict | None = None) -> dict:
    rs, lib = presets.load_rule_set("as-modelled")
    return get_boq(parsed, rs, [], [presets.load_dictionary("global-seed")], {**presets.resolution(), **(settings or {})}, [], lib)


def implausible(result: dict, check: str | None = None) -> list[dict]:
    return [w for w in result["warnings"] if w["code"] == "implausible" and (check is None or w["params"]["check"] == check)]


def pile(guid: str = "pile-1") -> dict:
    """A steel pile exported as an IfcSlab: 0.3 x 0.3 m in plan, 6 m long, Width (its 'thickness') 6 m."""
    return slab({"Qto_SlabBaseQuantities": {"GrossArea": 0.09, "NetVolume": 0.54, "Width": 6.0}}, guid=guid,
                name="M_Steel-Tube:Tube 300:1", type_name="Tube 300", dx=0.3, dy=0.3, t=6.0)


# ---------------------------------------------------------------- A-07
def test_a_slab_thicker_than_it_is_wide_is_implausible():
    r = run(doc(pile("p1"), pile("p2")))
    (w,) = implausible(r, "slab_thickness")
    assert w["params"]["count"] == 2 and sorted(w["guids"]) == ["p1", "p2"]
    assert w["params"]["thickness"] == pytest.approx(6.0) and w["params"]["width"] == pytest.approx(0.3)


def test_a_slab_thicker_than_the_limit_is_implausible():
    thick = slab({"BaseQuantities": {"GrossArea": 50.0, "Width": 2.0}}, t=2.0)
    assert implausible(run(doc(thick)), "slab_thickness")
    assert not implausible(run(doc(thick), {"plausibility": {"maxSlabThickness": 2.5}}), "slab_thickness")


def test_a_slab_named_like_a_pad_pile_or_cap_is_implausible_in_several_languages():
    for name, word in (("Pad 2", "pad"), ("Pfahl 600", "pfahl"), ("Pieu béton", "pieu"), ("M_Pile-Steel Pipe", "pile")):
        (w,) = implausible(run(doc(slab({"BaseQuantities": {"GrossArea": 50.0}}, type_name=name))), "slab_name")
        assert w["params"]["word"] == word, name
    assert not implausible(run(doc(slab({"BaseQuantities": {"GrossArea": 50.0}}, type_name="Capital floor"))), "slab_name")
    none = run(doc(slab({"BaseQuantities": {"GrossArea": 50.0}}, type_name="Pad 2")), {"plausibility": {"slabNameWords": []}})
    assert not implausible(none, "slab_name")


def test_an_ordinary_slab_raises_no_warning_and_no_number_changes():
    plain = doc(slab({"BaseQuantities": {"GrossArea": 50.0}}))
    r = run(plain)
    assert not implausible(r)
    named = run(doc(slab({"BaseQuantities": {"GrossArea": 50.0}}, type_name="Pad 2")))
    assert [l["quantity"] for l in named["lines"]] == [l["quantity"] for l in r["lines"]]
    assert named["status"] == r["status"]


def test_a_floor_line_larger_than_footprint_times_storeys_is_implausible():
    """The building's footprint 50 m2 (reported), one storey: a 120 m2 floor line is more than the building holds."""
    big = slab({"BaseQuantities": {"GrossArea": 120.0}}, dx=12.0, dy=10.0)
    parsed = doc(big)
    parsed["spatial"].append({"id": "b-1", "kind": "building", "name": "Building",
                              "quantities": {"Qto_BuildingBaseQuantities": {"FootprintArea": 50.0}}, "psets": {}})
    (w,) = implausible(run(parsed), "line_area")
    assert w["params"]["limit"] == pytest.approx(50.0) and w["params"]["area"] == pytest.approx(120.0)
    assert not implausible(run(parsed), "storey_area")                          # 120 m2 is not more than 3 x 50
    (s,) = implausible(run(parsed, {"plausibility": {"storeySlabAreaFactor": 2}}), "storey_area")
    assert s["params"]["factor"] == 2.0 and s["params"]["storey"] == "Level 0"


def test_a_floor_line_equal_to_the_derived_footprint_is_not_implausible():
    """One storey, footprint derived from the slabs themselves: the line equals footprint x storeys (S10), no warning."""
    r = run(doc(slab({"BaseQuantities": {"GrossArea": 120.006}}, dx=12.0, dy=10.0)))   # line 120.01 > 120.006
    assert r["building"]["provenance"]["footprint_area"] == "derived"
    assert not implausible(r, "line_area")


@pytest.mark.slow
def test_s07_warns_on_pad_2_and_the_600mm_piles():
    """A-07 acceptance (QS-013, LEAD-016)."""
    r = sample_lines(review_sample("S07-revit-arc-ifc4.ifc"))
    types = {w["params"].get("typeName") for w in implausible(r)}
    assert {"Pad 2", "600mm Diameter"} <= types


@pytest.mark.slow
def test_s03_and_s05_raise_no_plausibility_warning(duplex_parsed):
    assert not implausible(sample_lines(duplex_parsed))
    assert not implausible(sample_lines(review_sample("S03-simple-scene-architecture-ifc2x3.ifc")))


# ---------------------------------------------------------------- A-08
def unhosted(result: dict) -> list[dict]:
    return [w for w in result["warnings"] if w["code"] == "unhosted_opening"]


def test_the_duplex_v2_window_without_a_host_is_named_with_the_nearest_wall():
    """A-08 acceptance (QS-018): v2 of the Duplex has a window with no IfcRelFillsElement; v1 has none."""
    from ifc_boq.parse import parse_file
    from ifc_boq.paths import FIXTURES
    v2 = parse_file(str(FIXTURES / "ifc" / "Ifc2x3_Duplex_Architecture_v2.ifc"))[0]
    (w,) = unhosted(run(v2))
    assert w["guids"][0] == "1FM6kRbt1Q98O7nMvcxWi0" and w["params"]["ifcClass"] == "IfcWindow"
    assert w["params"]["wall"] and len(w["guids"]) == 2


def test_the_duplex_v1_has_no_unhosted_door_or_window(duplex_parsed):
    assert not unhosted(run(duplex_parsed))
