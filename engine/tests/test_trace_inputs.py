"""
Each element of a line names its measured inputs and where they came from (review WP-C3, C-10, QS-011): the
Duplex foundation wall's area is the mean of its measured faces, its volume is read from
PSet_Revit_Dimensions.Volume and its thickness from the material layer set; a slab layer's volume is its area
times the layer's thickness; an answered contradiction names its question and the value it replaced.
"""
from __future__ import annotations

import pytest

from ifc_boq import presets
from ifc_boq.pipeline import get_boq

PARTY = "contradiction:{}:IfcWall:Party Wall - CMU Residential Unit Dimising Wall"


def run(parsed, decisions=(), rules="as-modelled"):
    rs, lib = presets.load_rule_set(rules)
    return get_boq(parsed, rs, [presets.load_classification("acme-cost-codes")], [presets.load_dictionary("global-seed")],
                   presets.resolution(), list(decisions), lib)


@pytest.fixture(scope="module")
def result(duplex_parsed):
    return run(duplex_parsed)


def line(result, rule, text):
    return next(l for l in result["lines"] if l["ruleId"] == rule and text in l["description"])


def inputs(element):
    return {i["field"]: i for i in element.get("inputs", [])}


def test_the_foundation_wall_names_its_area_volume_and_thickness_sources(result):
    wall = line(result, "walls", "Foundation - Concrete (417mm)")
    first = next(e for e in wall["trace"]["elements"] if e["name"].endswith(":140479"))
    got = inputs(first)
    assert got["net_area"] == {"field": "net_area", "value": 11.0, "provenance": "geometry", "basis": "faces"}
    assert got["net_volume"] == {"field": "net_volume", "value": 4.587, "provenance": "reported", "basis": "property",
                                 "from": "PSet_Revit_Dimensions.Volume"}
    assert got["thickness"] == {"field": "thickness", "value": 0.417, "provenance": "reported", "basis": "layer_set"}
    # the gross area only repeats the net one (no openings): not listed for it
    assert "gross_area" not in got
    assert [i["field"] for i in first["inputs"]][0] == "net_area"


def test_every_element_of_a_measured_line_has_inputs_with_a_known_basis(result):
    bases = {"property", "attribute", "layer_set", "mesh", "parts", "faces", "sides", "box", "extent", "up_faces", "surface",
             "vertical_faces", "volume_thickness", "volume_area", "plus_openings", "less_openings", "openings",
             "surface_volume", "box_sides", "same", "area_thickness", "face", "profile", "material", "name"}
    for l in result["lines"]:
        if l["ruleId"] in ("walls", "slabs", "footings", "roofs", "steel-sections", "formwork-footings"):
            for e in l["trace"]["elements"]:
                assert e.get("inputs"), (l["key"], e["name"])
                for i in e["inputs"]:
                    assert i.get("basis") in bases and isinstance(i["value"], float | int), (l["key"], i)
                    assert i["basis"] != "property" or "." in i["from"]


def test_a_layer_part_has_its_area_times_the_layer_thickness(duplex_parsed):
    concrete = [l for l in run(duplex_parsed)["lines"] if l["ruleId"] == "slab-concrete"]
    multi = [e for l in concrete for e in l["trace"]["elements"] if inputs(e).get("net_volume", {}).get("basis") == "area_thickness"]
    for e in multi:
        got = inputs(e)
        assert got["net_volume"]["uses"] == ["net_area", "thickness"]
        assert got["net_volume"]["value"] == pytest.approx(got["net_area"]["value"] * got["thickness"]["value"], rel=1e-6)


def test_steel_names_its_cut_length_and_profile(result):
    steel = line(result, "steel-sections", "W310X60")
    got = inputs(steel["trace"]["elements"][0])
    assert got["length"]["from"] == "PSet_Revit_Structural.Cut Length"
    assert got["nominal_mass_per_length"] == {"field": "nominal_mass_per_length", "value": 60.0, "basis": "profile", "from": "W310X60"}


def test_an_answered_contradiction_names_its_question_and_the_value_it_replaced(duplex_parsed):
    answered = run(duplex_parsed, [{"questionId": PARTY.format(w), "scope": "project", "answer": "geometry"} for w in ("volume", "thickness")])
    plate = lambda result: next(inputs(e) for e in line(result, "walls", "Party Wall")["trace"]["elements"]  # noqa: E731
                                if e["name"].endswith(":139234"))
    got = plate(answered)["thickness"]
    assert got == {"field": "thickness", "value": 0.493, "provenance": "geometry", "basis": "sides", "stated": 0.55,
                   "question": PARTY.format("thickness")}
    # unanswered: the stated thickness is used and the geometry's differing value is named
    assert plate(run(duplex_parsed))["thickness"] == {"field": "thickness", "value": 0.55, "provenance": "reported",
                                                      "basis": "layer_set", "geometry": 0.493}


def test_a_stated_area_the_faces_replace_names_its_property(result):
    party = line(result, "walls", "Party Wall")
    got = next(inputs(e) for e in party["trace"]["elements"] if e["name"].endswith(":143239"))["net_area"]
    assert got["basis"] == "faces" and got["stated"] == 38.4062 and got["from"].startswith("PSet_Revit_Dimensions.")


def test_a_derived_line_names_the_inputs_of_its_formula(result):
    edge = line(result, "formwork-slab-edges", "Edge formwork")
    fields = {f for e in edge["trace"]["elements"] for f in inputs(e)}
    assert {"perimeter", "thickness"} <= fields
