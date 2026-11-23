"""
Measurement defaults (review WP-A3: A-09..A-13).

A-09: a wall's area is its measured faces net of openings; volume / thickness is the cross-check
(the thickness contradiction) and the fallback when the faces are not measured.

Each test builds a minimal parsed document by hand (one element, known geometry), so the rule is
pinned without an IFC file; the Duplex test (test_duplex.py) covers the real party walls.
"""
from __future__ import annotations

import pytest

from ifc_boq import presets
from ifc_boq.log import CalcLog
from ifc_boq.measure import build
from ifc_boq.names import Resolver


def wall(*, guid: str = "wall-1", length: float = 10.0, height: float = 3.0, t: float = 0.3,
         volume: float | None = None, side_a: float | None = None, side_b: float | None = None,
         thin_extent: float | None = None, closed: bool = True, reported: dict | None = None,
         sides: bool = True) -> dict:
    """A wall along x as the parser describes it. By default a closed prism length x height x t;
    `volume`, `side_a` / `side_b` and `thin_extent` describe a body that is not a full prism."""
    face = length * height
    vol = volume if volume is not None else face * t
    geo = {
        "hasBody": True, "closed": closed, "watertight": closed, "volume": vol,
        "surfaceArea": 2 * face + 2 * (length + height) * t,
        "bboxMin": [0.0, 0.0, 0.0], "bboxMax": [length, t, height],
        "obbExtents": [length, height, thin_extent or t],
        "obbAxes": [[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]],
        "contacts": [], "representationTypes": ["SweptSolid"],
    }
    if sides:
        geo["sides"] = {"a": face if side_a is None else side_a, "b": face if side_b is None else side_b,
                        "axis": [0.0, 1.0, 0.0]}
    return {
        "id": guid, "ifcClass": "IfcWall", "ifcClassBase": "IfcWall", "name": "Basic Wall:Test",
        "objectType": "Test wall", "predefinedType": None, "typeId": None, "storeyId": "storey-1",
        "attributes": {}, "psets": {}, "typePsets": {}, "childIds": [], "classificationIds": [],
        "materialRef": {"kind": "layerSet", "layerSetId": "ls-1"},
        "quantities": {"reported": reported or {}, "geometry": geo},
    }


def doc(*elements: dict, t: float = 0.3, openings: list | None = None) -> dict:
    return {
        "header": {"source": {"sha256": "0" * 64, "fileName": "synthetic.ifc"}, "ifcSchema": "IFC4",
                   "disciplineGuess": "architecture", "authoringApp": {"fullName": "hand written"}},
        "stats": {"elementCount": len(elements), "openingCount": len(openings or []), "spaceCount": 0},
        "verification": {"summary": {}, "checks": []},
        "catalogues": {"materials": [{"id": "m-1", "name": "Concrete"}],
                       "layerSets": [{"id": "ls-1", "totalThickness": t, "layers": [{"materialId": "m-1", "thickness": t}]}],
                       "types": [], "profiles": [], "classifications": []},
        "spatial": [{"id": "storey-1", "kind": "storey", "name": "Level 0", "elevation": 0.0}],
        "openings": openings or [], "relationships": [], "elements": list(elements),
    }


def measure(parsed: dict, answers: dict | None = None):
    resolution = presets.resolution()
    rv = Resolver([presets.load_dictionary("global-seed")], resolution)
    questions: list[dict] = []
    out, _ = build(parsed, rv, CalcLog(), answers=answers, questions=questions, settings=resolution)
    return {m["guid"]: m for m in out}, {q["id"]: q for q in questions}


THICKNESS_Q = "contradiction:thickness:IfcWall:Test wall"


# ---------------------------------------------------------------- A-09: wall area from the faces
def test_a_prismatic_wall_gives_the_same_area_either_way():
    m, qs = measure(doc(wall()))
    w = m["wall-1"]
    assert w["net_area"] == pytest.approx(30.0) and w["provenance"]["net_area"] == "geometry"
    assert w["net_volume"] == pytest.approx(9.0) and not qs


def test_a_notched_wall_takes_its_faces_not_volume_over_thickness():
    """A 1 m wide, half-thickness notch over the full height: the faces stay 30 m2, the volume
    drops to 8.55 m3 (volume / thickness would say 28.5 m2). 5 % thinner: no question."""
    m, qs = measure(doc(wall(volume=10 * 3 * 0.3 - 1 * 3 * 0.15)))
    w = m["wall-1"]
    assert w["net_area"] == pytest.approx(30.0) and w["provenance"]["net_area"] == "geometry"
    assert w["gross_area"] == pytest.approx(30.0)
    assert w["net_volume"] == pytest.approx(8.55)                       # the volume is untouched
    assert THICKNESS_Q not in qs


def test_faces_net_of_openings_and_gross_adds_them_back():
    """The parser measures the faces with the openings cut: 30 - 2 = 28 m2 net, 30 m2 gross."""
    op = {"id": "op-1", "hostId": "wall-1", "width": 1.0, "height": 2.0, "area": 2.0, "depth": 0.3}
    m, _ = measure(doc(wall(volume=(30 - 2) * 0.3, side_a=28.0, side_b=28.0), openings=[op]))
    w = m["wall-1"]
    assert w["net_area"] == pytest.approx(28.0) and w["gross_area"] == pytest.approx(30.0)


def test_unequal_faces_take_their_mean():
    m, _ = measure(doc(wall(side_a=30.0, side_b=27.0, volume=28.5 * 0.3)))
    assert m["wall-1"]["net_area"] == pytest.approx(28.5)


def test_volume_over_thickness_is_the_cross_check():
    """Faces 30 m2 but 7.5 m3 at 0.3 m (25 m2, the body is 0.25 m thick on average): the existing
    thickness contradiction asks; the area stays the measured faces."""
    m, qs = measure(doc(wall(volume=7.5)))
    assert THICKNESS_Q in qs
    assert m["wall-1"]["net_area"] == pytest.approx(30.0)


@pytest.mark.parametrize("variant", [
    dict(sides=False),                         # no faces measured (no body sides)
    dict(closed=False),                        # open mesh: its faces are not trusted
    dict(thin_extent=0.9),                     # the box is 3x the thickness: a curved or bent wall
])
def test_without_measured_faces_volume_over_thickness_stays(variant):
    m, _ = measure(doc(wall(volume=8.55, reported={"BaseQuantities": {"NetVolume": 8.55}}, **variant)))
    w = m["wall-1"]
    assert w["net_area"] == pytest.approx(28.5) and w["provenance"]["net_area"] == "derived"
