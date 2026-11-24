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


# ---------------------------------------------------------------- A-10: formwork to footings
def _box(x0, y0, x1, y1, z0=0.0, z1=0.3):
    import trimesh
    b = trimesh.creation.box((x1 - x0, y1 - y0, z1 - z0))
    b.apply_translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    return b


def test_vertical_faces_of_a_pad_and_a_ring():
    from ifc_boq.geometry import vertical_faces
    pad = vertical_faces(_box(0, 0, 1.2, 1.2, 0, 0.5), [])
    assert pad["area"] == pytest.approx(4 * 1.2 * 0.5) and pad["contact"] == 0
    ring = _box(0, 0, 6, 6).difference(_box(0.5, 0.5, 5.5, 5.5, -1, 1))
    vf = vertical_faces(ring, [])
    assert vf["area"] == pytest.approx((4 * 6 + 4 * 5) * 0.3)      # outer and inner sides: 13.2 m2
    assert vf["contact"] == 0


def test_a_strip_loses_the_faces_against_its_neighbours():
    """Strip 10 x 0.9 x 0.3; one end butts a cross footing, the other ends free; a second strip
    overlaps its side for 0.9 m. Formwork: both long sides and the free end, less 0.9 x 0.3 of side."""
    from ifc_boq.geometry import vertical_faces
    strip = _box(0, 0, 10, 0.9)
    cross = _box(10, -1, 10.9, 2)                       # touching the east end
    branch = _box(4, 0.8, 4.9, 3)                       # overlaps the north side by 0.1 m
    vf = vertical_faces(strip, [cross, branch])
    assert vf["area"] == pytest.approx(2 * (10 + 0.9) * 0.3)
    assert vf["contact"] == pytest.approx(0.9 * 0.3 + 0.9 * 0.3, rel=0.02)
    assert vertical_faces(strip, [_box(20, 0, 21, 1)])["contact"] == 0  # a solid that does not touch


def footing(vertical: dict | None, *, length=10.0, width=0.9, height=0.3) -> dict:
    el = wall(guid="footing-1", length=length, height=height, t=width)
    el.update(ifcClass="IfcFooting", ifcClassBase="IfcFooting", materialRef=None,
              attributes={"OverallWidth": width})
    g = el["quantities"]["geometry"]
    g.pop("sides")
    g["bboxMax"] = [length, width, height]
    if vertical:
        g["verticalFaces"] = vertical
    return el


def test_a_footing_measures_its_vertical_faces():
    m, _ = measure(doc(footing({"area": 6.54, "contact": 0.27})))
    f = m["footing-1"]
    assert f["vertical_face_area"] == pytest.approx(6.27) and f["provenance"]["vertical_face_area"] == "geometry"


def test_without_the_parse_field_the_box_sides_stand_in():
    """A parse from before A-10 has no `verticalFaces`: 2 x (length + width) x height."""
    m, _ = measure(doc(footing(None)))
    f = m["footing-1"]
    assert f["vertical_face_area"] == pytest.approx(2 * (10 + 0.9) * 0.3)
    assert f["provenance"]["vertical_face_area"] == "derived"


# ---------------------------------------------------------------- A-11: finishes on their own face, by the opening rule
def lined_wall_doc(layers: list[tuple[str, float]], sense: str = "POSITIVE") -> dict:
    """A 10 x 3 m wall along x with a 0.8 m2 and a 1.5 m2 opening (faces 30 - 2.3 = 27.7 m2 each), its
    layer set stacked along +y (local y of an unrotated placement) from the first layer to the last."""
    t = sum(th for _, th in layers)
    ops = [{"id": "op-small", "hostId": "wall-1", "width": 0.8, "height": 1.0, "area": 0.8, "depth": t},
           {"id": "op-big", "hostId": "wall-1", "width": 1.0, "height": 1.5, "area": 1.5, "depth": t}]
    el = wall(t=t, volume=27.7 * t, side_a=27.7, side_b=27.7)
    el["materialRef"] = {"kind": "layerSet", "layerSetId": "ls-1", "direction": "AXIS2", "sense": sense}
    el["placement"] = {"origin": [0.0, 0.0, 0.0], "xAxis": [1.0, 0.0, 0.0], "zAxis": [0.0, 0.0, 1.0]}
    d = doc(el, t=t, openings=ops)
    d["catalogues"]["materials"] = [{"id": f"m-{i}", "name": n} for i, (n, _) in enumerate(layers)]
    d["catalogues"]["layerSets"] = [{"id": "ls-1", "totalThickness": t,
                                     "layers": [{"materialId": f"m-{i}", "thickness": th} for i, (_, th) in enumerate(layers)]}]
    return d


def paint(parsed: dict, **params) -> float:
    from ifc_boq.pipeline import get_boq
    rs = {"schemaVersion": "1.0", "id": "t", "name": "t", "version": "1", "extends": "as-modelled",
          "params": {k: {"value": v} for k, v in params.items()}}
    _, lib = presets.load_rule_set("as-modelled")
    r = get_boq(parsed, rs, [], [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)
    return sum(l["quantity"] for l in r["lines"] if l["ruleId"] == "paint-walls")


def test_paint_measures_the_faces_that_carry_plasterboard():
    one = lined_wall_doc([("Concrete Masonry Units", 0.19), ("Plasterboard", 0.0125)])
    both = lined_wall_doc([("Plasterboard", 0.0125), ("Metal Stud Layer", 0.1), ("Plasterboard", 0.0125)])
    assert paint(one) == pytest.approx(27.7) and paint(both) == pytest.approx(2 * 27.7)
    m, _ = measure(one)
    faces = {f["side"]: f.get("layer_material") for f in m["wall-1"]["faces"]}
    assert faces == {"a": "board.plasterboard", "b": "masonry.block"}   # the last layer faces +y: side a
    m, _ = measure(lined_wall_doc([("Concrete Masonry Units", 0.19), ("Plasterboard", 0.0125)], sense="NEGATIVE"))
    assert {f["side"]: f.get("layer_material") for f in m["wall-1"]["faces"]} == {"a": "masonry.block", "b": "board.plasterboard"}


def test_paint_follows_the_wall_opening_rule_unless_it_has_its_own():
    """Openings up to 1 m2 kept in the walls: the 0.8 m2 one stays in the paint too (27.7 + 0.8);
    with a rule of its own, paint deducts every opening while the walls keep the small one."""
    d = lined_wall_doc([("Concrete Masonry Units", 0.19), ("Plasterboard", 0.0125)])
    assert paint(d) == pytest.approx(27.7)
    kept = dict(wall_opening_mode="over_threshold", wall_opening_threshold=1.0)
    assert paint(d, **kept) == pytest.approx(28.5)
    assert paint(d, **kept, finish_openings="own", finish_opening_mode="all") == pytest.approx(27.7)


# ---------------------------------------------------------------- A-12: reveals belong to finishes, once per face
# the two openings of lined_wall_doc: (2h + w) = 2.8 m and 4.0 m of reveal edge, 6.8 m in all
REVEAL_EDGE = 2 * 1.0 + 0.8 + 2 * 1.5 + 1.0


def test_finish_reveals_are_added_once_per_face_with_half_the_depth():
    """(Lines are rounded to 0.01 m2.) A finish face adds the reveals of the openings it deducts at half the opening's depth (the
    frame is taken as central); paint on both faces of a wall adds each reveal's full depth once."""
    both = lined_wall_doc([("Plasterboard", 0.0125), ("Metal Stud Layer", 0.1), ("Plasterboard", 0.0125)])
    assert paint(both, finish_add_reveals=True) == pytest.approx(2 * 27.7 + REVEAL_EDGE * 0.125)
    one = lined_wall_doc([("Concrete Masonry Units", 0.19), ("Plasterboard", 0.0125)])
    assert paint(one, finish_add_reveals=True) == pytest.approx(27.7 + REVEAL_EDGE * 0.2025 / 2, abs=0.005)
    # only the deducted openings get reveals: the walls keep the 0.8 m2 one, so does the paint
    kept = dict(wall_opening_mode="over_threshold", wall_opening_threshold=1.0)
    assert paint(one, finish_add_reveals=True, **kept) == pytest.approx(28.5 + 4.0 * 0.2025 / 2, abs=0.005)


def test_walls_no_longer_add_reveals_and_the_old_slot_is_gone():
    rs, _ = presets.load_rule_set("as-modelled")
    assert "wall_add_reveals" not in rs["params"] and rs["params"]["finish_add_reveals"]["value"] is False
    text = str(next(i for i in rs["items"] if i["id"] == "walls"))
    assert "addReveals" not in text
    std, _ = presets.load_rule_set("standard-style-example")
    assert std["params"]["finish_add_reveals"]["value"] is True and "wall_add_reveals" not in std["params"]


def wall_lines(parsed: dict, surface: str) -> float:
    """A firm's own wall item with reveals on: `both` faces vs one face."""
    from ifc_boq.pipeline import get_boq
    item = {"id": "walls-rev", "label": "Walls", "family": "planar", "match": {"ifcClass": "IfcWall"},
            "quantity": {"kind": "area", "surface": surface, "start": "gross",
                         "deductions": [{"what": "openings", "mode": "all", "addReveals": True}]},
            "description": "Wall", "lineKey": [], "claims": ["body"], "tags": ["wall"]}
    rs = {"schemaVersion": "1.0", "id": "t", "name": "t", "version": "1", "extends": "as-modelled",
          "remove": ["walls"], "items": [item]}
    _, lib = presets.load_rule_set("as-modelled")
    r = get_boq(parsed, rs, [], [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)
    return sum(l["quantity"] for l in r["lines"] if l["ruleId"] == "walls-rev")


def test_surface_both_counts_each_reveal_once():
    """ENG-023: `both` used to add the full (2h + w) x depth on each face, then double it."""
    t = 0.2
    d = lined_wall_doc([("Concrete Masonry Units", t)])
    assert wall_lines(d, "both") == pytest.approx(2 * 27.7 + REVEAL_EDGE * t)
    assert wall_lines(d, "side_a") == pytest.approx(27.7 + REVEAL_EDGE * t / 2)


# ---------------------------------------------------------------- A-13: slab edges, outer and openings apart
def slab_doc(*, reported: dict | None = None, opening: bool = True) -> dict:
    """A 10 x 6 x 0.2 m concrete slab with a 2 x 1 m void: outer edge 32 m, opening edge 6 m. Its closed
    mesh gives P = (S - 2V/t) / t = both together (38 m)."""
    t, hole = 0.2, (2.0 * 1.0 if opening else 0.0)
    net = 60.0 - hole
    s = 2 * net + (32.0 + (6.0 if opening else 0.0)) * t
    geo = {"hasBody": True, "closed": True, "watertight": True, "volume": net * t, "surfaceArea": s,
           "bboxMin": [0.0, 0.0, 0.0], "bboxMax": [10.0, 6.0, t], "obbExtents": [10.0, 6.0, t],
           "obbAxes": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
           "sides": {"a": net, "b": net, "axis": [0.0, 0.0, 1.0]},
           "contacts": [], "representationTypes": ["SweptSolid"]}
    el = {"id": "slab-1", "ifcClass": "IfcSlab", "ifcClassBase": "IfcSlab", "name": "Floor:Test",
          "objectType": "Test slab", "predefinedType": "FLOOR", "typeId": None, "storeyId": "storey-1",
          "attributes": {}, "psets": {}, "typePsets": {}, "childIds": [], "classificationIds": [],
          "materialRef": {"kind": "layerSet", "layerSetId": "ls-1"},
          "quantities": {"reported": reported or {}, "geometry": geo}}
    ops = [{"id": "void-1", "hostId": "slab-1", "width": 2.0, "height": 1.0, "area": 2.0, "depth": t}] if opening else []
    return doc(el, t=t, openings=ops)


def edge_formwork(parsed: dict, formula: str | None = None) -> float:
    from ifc_boq.pipeline import get_boq
    params = {"formwork_slab_edges_formula": {"value": formula}} if formula else {}
    rs = {"schemaVersion": "1.0", "id": "t", "name": "t", "version": "1", "extends": "as-modelled", "params": params}
    _, lib = presets.load_rule_set("as-modelled")
    r = get_boq(parsed, rs, [], [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)
    return sum(l["quantity"] for l in r["lines"] if l["ruleId"] == "formwork-slab-edges")


def test_the_perimeter_is_split_into_the_outer_edge_and_the_opening_edges():
    m, _ = measure(slab_doc())
    s = m["slab-1"]
    assert s["perimeter"] == pytest.approx(38.0)
    assert s["perimeter_outer"] == pytest.approx(32.0) and s["perimeter_openings"] == pytest.approx(6.0)
    m, _ = measure(slab_doc(opening=False))
    assert m["slab-1"]["perimeter_outer"] == pytest.approx(32.0) and m["slab-1"]["perimeter_openings"] == 0


def test_edge_formwork_choices_do_what_they_say():
    rs, _ = presets.load_rule_set("as-modelled")
    slot = rs["params"]["formwork_slab_edges_formula"]
    outer, both = (c["value"] for c in slot["choices"])
    assert slot["value"] == both                       # the default keeps the opening edges (unchanged numbers)
    d = slab_doc()
    assert edge_formwork(d, outer) == pytest.approx(32.0 * 0.2)
    assert edge_formwork(d, both) == pytest.approx(38.0 * 0.2) == pytest.approx(edge_formwork(d))


def test_a_reported_perimeter_is_taken_as_the_total():
    m, _ = measure(slab_doc(reported={"Qto_SlabBaseQuantities": {"Perimeter": 38.0}}))
    s = m["slab-1"]
    assert s["provenance"]["perimeter"] == "reported"
    assert s["perimeter_outer"] == pytest.approx(32.0) and s["perimeter_openings"] == pytest.approx(6.0)
    assert any("taken as the outer edge and the edges of openings" in w for w in s["warnings"])


# ---------------------------------------------------------------- A-11 follow-ups (WP-A3 exit check)
def test_a_wall_of_one_material_carries_it_on_both_faces():
    """S03's plumbing wall is a 24 mm board with a single material (no layer set): both faces are
    plasterboard, so both are painted (it had no paint at all after A-11)."""
    d = lined_wall_doc([("Plasterboard", 0.024)])
    d["elements"][0]["materialRef"] = {"kind": "single", "materialId": "m-0"}
    d["catalogues"]["layerSets"] = []
    m, _ = measure(d)
    assert m["wall-1"]["layers"] == []
    assert {f["side"]: f.get("layer_material") for f in m["wall-1"]["faces"]} == {"a": "board.plasterboard", "b": "board.plasterboard"}
    assert paint(d) == pytest.approx(2 * 27.7)


def test_faces_rebuilt_for_rooms_keep_their_layers():
    """Federation rebuilds a wall's faces when rooms of another model lie on it (F02): each new face
    keeps the outermost layer of its side."""
    from ifc_boq.measure import keep_face_layers
    old = [{"side": "a", "layer_material": "board.plasterboard", "layer_material_raw": "Gypsum"},
           {"side": "b", "layer_material": "concrete", "layer_material_raw": "Concrete"}]
    new = [{"side": "a", "space": "r1"}, {"side": "a"}, {"side": "b", "space": "r2"}]
    keep_face_layers(old, new)
    assert [f.get("layer_material") for f in new] == ["board.plasterboard", "board.plasterboard", "concrete"]


# ---------------------------------------------------------------- A-14: in-situ concrete from a slab's concrete layers
def layered_slab(layers: list[tuple[str, float]], *, volume: float | None = None) -> dict:
    """slab_doc's 10 x 6 m slab (no opening) with the given layer set, total thickness = the sum."""
    d = slab_doc(opening=False)
    t = sum(th for _, th in layers)
    el = d["elements"][0]
    g = el["quantities"]["geometry"]
    g["volume"] = volume if volume is not None else 60.0 * t
    g["surfaceArea"] = 2 * 60.0 + 32.0 * t
    g["obbExtents"], g["bboxMax"] = [10.0, 6.0, t], [10.0, 6.0, t]
    d["catalogues"]["materials"] = [{"id": f"m-{i}", "name": n} for i, (n, _) in enumerate(layers)]
    d["catalogues"]["layerSets"] = [{"id": "ls-1", "totalThickness": t,
                                     "layers": [{"materialId": f"m-{i}", "thickness": th} for i, (_, th) in enumerate(layers)]}]
    return d


def concrete(parsed: dict, **params) -> float:
    from ifc_boq.pipeline import get_boq
    rs = {"schemaVersion": "1.0", "id": "t", "name": "t", "version": "1", "extends": "as-modelled",
          "params": {k: {"value": v} for k, v in params.items()}}
    _, lib = presets.load_rule_set("as-modelled")
    r = get_boq(parsed, rs, [], [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)
    return sum(l["quantity"] for l in r["lines"] if l["ruleId"] == "slab-concrete")


S09_BUILD_UP = [("Concrete, Sand/Cement Screed", 0.065), ("Rigid insulation", 0.08), ("Air", 0.15),
                ("Concrete Masonry, Floor Block", 0.1), ("Concrete, Precast", 0.075)]


def test_in_situ_concrete_is_the_concrete_layers_only():
    """CAS-017: S09's 470 mm floor build-up was all in-situ concrete. Now only its in-situ concrete
    layers count: screed, precast and blocks do not (a block is masonry, even "Concrete Masonry")."""
    assert concrete(layered_slab(S09_BUILD_UP)) == 0
    d = layered_slab([("Concrete, Sand/Cement Screed", 0.05), ("Rigid insulation", 0.1), ("Reinforced Concrete", 0.2)])
    assert concrete(d) == pytest.approx(60.0 * 0.2)
    # the firm may count every concrete layer (screed and precast too)
    assert concrete(d, slab_concrete_layers="all_concrete") == pytest.approx(60.0 * 0.25)
    m, _ = measure(layered_slab(S09_BUILD_UP))
    assert [l["material"] for l in m["slab-1"]["layers"]][3] == "masonry.block"


def test_a_single_layer_slab_keeps_its_own_volume():
    """A slab of one layer is that layer: its concrete is the element's volume, not area x layer thickness
    (S05's 127 mm slabs unchanged)."""
    d = layered_slab([("Concrete", 0.2)], volume=12.6)        # a thickened edge: 0.6 m3 more than 60 x 0.2
    assert concrete(d) == pytest.approx(12.6)


def test_a_slab_without_layers_counts_by_its_material():
    d = slab_doc(opening=False)
    d["elements"][0]["materialRef"] = {"kind": "single", "materialId": "m-1"}
    d["catalogues"]["layerSets"] = []
    assert concrete(d) == pytest.approx(60.0 * 0.2)
