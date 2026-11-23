"""
Reported quantities vs the geometry (review WP-A1: A-01..A-04).

Which reported value measure.py adopts, and when the geometry wins: generic `BaseQuantities` names,
exporter unit errors (a stated value 1000x the closed mesh), impossible quantity sets (NetArea larger
than GrossArea), area contradictions, slab thickness from the thin axis, and the contradiction
thresholds as resolution settings.

Most tests build a minimal parsed document by hand (one element, known geometry), so each rule is
pinned without an IFC file. The `review_sample` tests re-run the review's real samples
(docs/review/_samples, fetched by docs/review/tools/fetch-samples.sh; skipped when absent, e.g. in CI).
"""
from __future__ import annotations

import copy
from pathlib import Path

import pytest

from ifc_boq import presets
from ifc_boq.log import CalcLog
from ifc_boq.measure import build
from ifc_boq.names import Resolver

SAMPLES = Path(__file__).resolve().parents[2] / "docs" / "review" / "_samples"


def slab(reported: dict | None = None, *, guid: str = "slab-1", name: str = "Floor:Test", type_name: str = "Test floor",
         dx: float = 10.0, dy: float = 5.0, t: float = 0.2, layer_thickness: float | None = None,
         closed: bool = True, cls: str = "IfcSlab") -> dict:
    """A closed box slab dx x dy x t as the parser describes it (geometry block) plus reported quantity sets."""
    top = dx * dy
    el = {
        "id": guid, "ifcClass": cls, "ifcClassBase": cls, "name": name, "objectType": type_name,
        "predefinedType": "FLOOR", "typeId": None, "storeyId": "storey-1", "attributes": {},
        "psets": {}, "typePsets": {}, "childIds": [], "classificationIds": [],
        "materialRef": {"kind": "layerSet", "layerSetId": "ls-1"} if layer_thickness else None,
        "quantities": {
            "reported": reported or {},
            "geometry": {
                "hasBody": True, "closed": closed, "watertight": closed,
                "volume": top * t, "surfaceArea": 2 * top + 2 * (dx + dy) * t,
                "bboxMin": [0.0, 0.0, 0.0], "bboxMax": [dx, dy, t],
                "obbExtents": sorted([dx, dy, t], reverse=True),
                "obbAxes": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
                "sides": {"a": top, "b": top, "axis": [0.0, 0.0, 1.0]},
                "contacts": [], "representationTypes": ["SweptSolid"],
            },
        },
    }
    return el


def doc(*elements: dict, layer_thickness: float | None = None) -> dict:
    return {
        "header": {"source": {"sha256": "0" * 64, "fileName": "synthetic.ifc"}, "ifcSchema": "IFC4",
                   "disciplineGuess": "architecture", "authoringApp": {"fullName": "hand written"}},
        "stats": {"elementCount": len(elements), "openingCount": 0, "spaceCount": 0},
        "verification": {"summary": {}, "checks": []},
        "catalogues": {"materials": [{"id": "m-1", "name": "Concrete"}],
                       "layerSets": [{"id": "ls-1", "totalThickness": layer_thickness,
                                      "layers": [{"materialId": "m-1", "thickness": layer_thickness}]}]
                       if layer_thickness else [],
                       "types": [], "profiles": [], "classifications": []},
        "spatial": [{"id": "storey-1", "kind": "storey", "name": "Level 0", "elevation": 0.0}],
        "openings": [], "relationships": [], "elements": list(elements),
    }


def measure(parsed: dict, answers: dict | None = None, settings: dict | None = None):
    resolution = {**presets.resolution(), **(settings or {})}
    rv = Resolver([presets.load_dictionary("global-seed")], resolution)
    questions: list[dict] = []
    log = CalcLog()
    out, _ = build(parsed, rv, log, answers=answers, questions=questions)
    return {m["guid"]: m for m in out}, {q["id"]: q for q in questions}, log


# ---------------------------------------------------------------- A-01: generic BaseQuantities names
def test_generic_base_quantities_gross_area_is_read():
    """A-01: an IFC4 export with only `BaseQuantities.GrossArea` (the S09 sample house) gives the slab its area."""
    el = slab({"BaseQuantities": {"GrossArea": 50.0, "Width": 0.2}})
    m, _, _ = measure(doc(el))
    s = m["slab-1"]
    assert s["net_area"] == pytest.approx(50.0) and s["provenance"]["net_area"] == "reported"


def test_an_area_is_never_derived_from_a_contradicted_volume():
    """A-01: no reported area, a reported volume the closed mesh contradicts (and no unit error):
    the area comes from the geometry's sides, not volume / thickness."""
    el = slab({"BaseQuantities": {"NetVolume": 13.0}}, layer_thickness=0.2)      # geometry: 10 m3 (+30 %)
    m, qs, _ = measure(doc(el, layer_thickness=0.2))
    s = m["slab-1"]
    assert "contradiction:volume:IfcSlab:Test floor" in qs
    assert s["net_volume"] == pytest.approx(13.0)                                  # below the block threshold: kept
    assert s["net_area"] == pytest.approx(50.0) and s["provenance"]["net_area"] == "geometry"


def test_an_uncontradicted_volume_still_gives_the_area():
    el = slab({"BaseQuantities": {"NetVolume": 10.0}}, layer_thickness=0.2)
    m, qs, _ = measure(doc(el, layer_thickness=0.2))
    assert not qs
    assert m["slab-1"]["net_area"] == pytest.approx(50.0) and m["slab-1"]["provenance"]["net_area"] == "derived"


# ---------------------------------------------------------------- the review samples
def review_sample(name: str) -> dict:
    path = SAMPLES / name
    if not path.exists():
        pytest.skip(f"review sample {name} not fetched (bash docs/review/tools/fetch-samples.sh)")
    from ifc_boq.parse import parse_file
    return parse_file(str(path))[0]


def sample_lines(parsed: dict) -> dict:
    from ifc_boq.pipeline import get_boq
    rs, lib = presets.load_rule_set("as-modelled")
    cls = [presets.load_classification("acme-cost-codes")]
    r = get_boq(parsed, rs, cls, [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)
    return r


@pytest.mark.slow
def test_s09_slab_areas_are_the_stated_gross_areas():
    """A-01 (QS-001): S09's slab areas are the 146.199 / 80.26 m2 the file states, not volume / thickness of
    the x1000 volume (146,199 m2)."""
    r = sample_lines(review_sample("S09-samplehouse-ifc4.ifc"))
    slabs = {l["description"]: l["quantity"] for l in r["lines"] if l["ruleId"] == "slabs" and l["unit"] == "m2"}
    assert any(q == pytest.approx(146.2, abs=0.01) for q in slabs.values()), slabs
    assert any(q == pytest.approx(80.26, abs=0.01) for q in slabs.values()), slabs


# ---------------------------------------------------------------- A-02: unit-scale guard
@pytest.mark.parametrize("factor", [1000.0, 0.001, 1e6, 1e-6, 1000.0 * 1.019])
def test_a_stated_volume_a_power_of_1000_off_the_mesh_is_a_unit_error(factor):
    """A-02 (QS-001): the geometry is used, the question keeps its id and recommends the geometry."""
    el = slab({"BaseQuantities": {"GrossVolume": 10.0 * factor}}, layer_thickness=0.2)      # mesh: 10 m3
    m, qs, log = measure(doc(el, layer_thickness=0.2))
    s = m["slab-1"]
    assert s["net_volume"] == pytest.approx(10.0) and s["provenance"]["net_volume"] == "geometry"
    assert s["unit_scale"]["net_volume"] in (1e3, 1e-3, 1e6, 1e-6)
    q = qs["contradiction:volume:IfcSlab:Test floor"]
    assert q["suggestion"] == "geometry" and not q["blocking"]
    assert [o["value"] for o in q["answer"]["options"] if o.get("recommended")] == ["geometry"]
    assert q["params"]["unitError"] is True and q["params"]["used"] == "geometry"
    assert "unit error" in q["message"]
    assert any(e.get("code") == "log.measure.unit_scale" for e in log.entries)


@pytest.mark.parametrize("factor", [970.0, 1030.0, 100.0, 2.0])
def test_outside_the_2_percent_band_is_not_a_unit_error(factor):
    """A-02: only 10^±3 / 10^±6 within 2 % count (DEC-31). 999x and 1019x are inside the band (tested as unit errors
    here and above); 970x and 1030x are ordinary contradictions: the stated value is kept."""
    el = slab({"BaseQuantities": {"GrossVolume": 10.0 * factor}}, layer_thickness=0.2)
    m, qs, _ = measure(doc(el, layer_thickness=0.2))
    assert m["slab-1"]["net_volume"] == pytest.approx(10.0 * factor) and "unit_scale" not in m["slab-1"]
    assert qs["contradiction:volume:IfcSlab:Test floor"]["params"]["unitError"] is False


def test_999_times_is_a_unit_error():
    el = slab({"BaseQuantities": {"GrossVolume": 9990.0}}, layer_thickness=0.2)
    m, _, _ = measure(doc(el, layer_thickness=0.2))
    assert m["slab-1"]["net_volume"] == pytest.approx(10.0) and m["slab-1"]["unit_scale"] == {"net_volume": 1000.0}


def test_no_unit_error_guard_on_an_open_mesh():
    el = slab({"BaseQuantities": {"GrossVolume": 10000.0}}, layer_thickness=0.2, closed=False)
    m, _, _ = measure(doc(el, layer_thickness=0.2))
    assert m["slab-1"]["net_volume"] == pytest.approx(10000.0) and "unit_scale" not in m["slab-1"]


def test_answering_reported_keeps_the_stated_value():
    el = slab({"BaseQuantities": {"GrossVolume": 10000.0}}, layer_thickness=0.2)
    m, qs, _ = measure(doc(el, layer_thickness=0.2), answers={"contradiction:volume:IfcSlab:Test floor": "reported"})
    assert m["slab-1"]["net_volume"] == pytest.approx(10000.0) and not qs


def test_a_stated_area_1000_times_the_plate_is_a_unit_error():
    el = slab({"BaseQuantities": {"GrossArea": 50000.0}})
    m, qs, _ = measure(doc(el))
    assert m["slab-1"]["net_area"] == pytest.approx(50.0) and m["slab-1"]["unit_scale"] == {"net_area": 1000.0}
    assert qs["contradiction:area:IfcSlab:Test floor"]["suggestion"] == "geometry"


def test_a_stated_length_1000_times_the_member_is_a_unit_error():
    beam = slab({"Qto_BeamBaseQuantities": {"Length": 6000.0}}, guid="beam-1", cls="IfcBeam", type_name="IPE 200",
                dx=6.0, dy=0.1, t=0.2)
    m, qs, _ = measure(doc(beam))
    assert m["beam-1"]["length"] == pytest.approx(6.0) and m["beam-1"]["unit_scale"] == {"length": 1000.0}
    assert "contradiction:length:IfcBeam:IPE 200" in qs


def test_the_unit_error_note_reaches_the_line_and_the_question_ids_are_stable():
    from ifc_boq.pipeline import get_boq
    el = slab({"BaseQuantities": {"GrossVolume": 10000.0, "GrossArea": 50.0}}, layer_thickness=0.2)
    rs, lib = presets.load_rule_set("as-modelled")
    r = get_boq(doc(el, layer_thickness=0.2), rs, [], [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)
    assert [q["id"] for q in r["questions"] if q["kind"] == "contradiction"] == ["contradiction:volume:IfcSlab:Test floor"]
    assert all(not k.startswith("_") for q in r["questions"] for k in q)
    volume_lines = [l for l in r["lines"] if l["unit"] == "m3"]
    assert volume_lines and all(any("unit error (x1000)" in n for n in l["notes"]) for l in volume_lines)
    assert all(l["quantity"] == pytest.approx(10.0, abs=0.01) for l in volume_lines)


@pytest.mark.slow
def test_s09_floor_volume_is_the_geometry():
    """A-02 (QS-001): S09's x1000 GrossVolume is a unit error; "In-situ concrete, Simple floor" is 13.24 m3."""
    r = sample_lines(review_sample("S09-samplehouse-ifc4.ifc"))
    (concrete,) = [l for l in r["lines"] if l["ruleId"] == "slab-concrete"]
    assert concrete["quantity"] == pytest.approx(13.24, abs=0.01)
    assert r["building"]["gross_volume"] < 1000
    cq = [q for q in r["questions"] if q["kind"] == "contradiction" and q["id"].startswith("contradiction:volume:IfcSlab")]
    assert len(cq) == 2 and all(q["suggestion"] == "geometry" for q in cq)


# ---------------------------------------------------------------- A-03: slab areas and thickness
def test_a_net_area_larger_than_the_gross_area_is_not_used():
    """A-03 (QS-003): Revit 2021 IFC4 writes the whole surface as NetArea; the set's GrossArea is the slab's area."""
    surface = 2 * 50.0 + 2 * 15.0 * 0.2
    el = slab({"Qto_SlabBaseQuantities": {"NetArea": surface, "GrossArea": 50.0, "NetVolume": 10.0, "Width": 0.2}})
    m, qs, _ = measure(doc(el))
    s = m["slab-1"]
    assert s["net_area"] == pytest.approx(50.0) and s["provenance"]["net_area"] == "reported"
    assert any("impossible" in w for w in s["warnings"]) and not qs


def test_an_implausible_reported_area_gives_way_to_the_geometry():
    """A-03: NetArea = surface with no GrossArea in the set (S07 "Pad 2"): an area contradiction, geometry used."""
    el = slab({"Qto_SlabBaseQuantities": {"NetArea": 2 * 50.0 + 2 * 15.0 * 0.2, "NetVolume": 10.0}})
    m, qs, _ = measure(doc(el))
    assert m["slab-1"]["net_area"] == pytest.approx(50.0) and m["slab-1"]["provenance"]["net_area"] == "geometry"
    q = qs["contradiction:area:IfcSlab:Test floor"]
    assert q["suggestion"] == "geometry" and q["params"]["unit"] == "m2" and not q["params"]["unitError"]


def test_a_plausible_area_difference_asks_but_keeps_the_stated_area():
    el = slab({"Qto_SlabBaseQuantities": {"NetArea": 40.0, "NetVolume": 10.0}})         # geometry 50 m2 (+25 %)
    m, qs, _ = measure(doc(el))
    assert m["slab-1"]["net_area"] == pytest.approx(40.0)
    assert qs["contradiction:area:IfcSlab:Test floor"]["suggestion"] == "reported"
    m2, qs2, _ = measure(doc(el), answers={"contradiction:area:IfcSlab:Test floor": "geometry"})
    assert m2["slab-1"]["net_area"] == pytest.approx(50.0) and not qs2


def test_a_gross_area_is_compared_with_the_sides_plus_the_openings():
    el = slab({"BaseQuantities": {"GrossArea": 50.0}})
    parsed = doc(el)
    parsed["elements"][0]["quantities"]["geometry"]["sides"] = {"a": 46.0, "b": 46.0, "axis": [0.0, 0.0, 1.0]}
    parsed["openings"] = [{"id": "o-1", "hostId": "slab-1", "area": 4.0, "width": 2.0, "height": 2.0, "depth": 0.2}]
    _, qs, _ = measure(parsed)
    assert not qs


def test_a_slab_width_beyond_its_thin_axis_is_not_its_thickness():
    """A-03 (QS-003): S08's pile cap states Width 3.8 m (its plan size); it is 1.0 m thick. The thin axis is used and
    the thickness contradiction recommends the geometry."""
    el = slab({"Qto_SlabBaseQuantities": {"GrossArea": 14.44, "NetArea": 44.08, "NetVolume": 14.44, "Width": 3.8,
                                          "Perimeter": 15.2}}, dx=3.8, dy=3.8, t=1.0, type_name="3800 x 3800 x 600mm")
    m, qs, _ = measure(doc(el))
    s = m["slab-1"]
    assert s["thickness"] == pytest.approx(1.0) and s["provenance"]["thickness"] == "geometry"
    assert s["net_area"] == pytest.approx(14.44) and s["perimeter"] == pytest.approx(15.2)
    assert qs["contradiction:thickness:IfcSlab:3800 x 3800 x 600mm"]["suggestion"] == "geometry"
    m2, _, _ = measure(doc(el), answers={"contradiction:thickness:IfcSlab:3800 x 3800 x 600mm": "reported"})
    assert m2["slab-1"]["thickness"] == pytest.approx(3.8)


def test_a_layer_set_thickness_is_still_kept_while_asked():
    """Only a stated quantity gives way to the thin axis; a layer set (a wall's or slab's build-up) is kept and asked."""
    el = slab({}, layer_thickness=0.25)                               # mesh 0.2 m thick
    m, qs, _ = measure(doc(el, layer_thickness=0.25))
    assert m["slab-1"]["thickness"] == pytest.approx(0.25)
    assert qs["contradiction:thickness:IfcSlab:Test floor"]["suggestion"] == "reported"


@pytest.mark.slow
def test_s08_pile_cap_area_and_edge_formwork():
    """A-03 (QS-003): S08 pile cap 3OQjd9jwr1COqcP44Fm6DW: 14.44 m2 (not the 44.08 m2 surface), edge formwork
    15.2 m x 1.0 m = 15.20 m2 (not x 3.8 m)."""
    r = sample_lines(review_sample("S08-revit-str-ifc4.ifc"))
    share = lambda rule: sum(e["quantity"] or 0 for l in r["lines"] if l["ruleId"] == rule
                             for e in l["trace"]["elements"] if e["guid"] == "3OQjd9jwr1COqcP44Fm6DW")
    assert share("slabs") == pytest.approx(14.44, abs=0.01)
    assert share("formwork-slab-edges") == pytest.approx(15.20, abs=0.01)
