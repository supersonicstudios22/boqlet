import json
from pathlib import Path

from ifc_boq import presets
from ifc_boq.names import Resolver, decision_entries

MESSY = json.loads((Path(__file__).parent / "messy_names.json").read_text(encoding="utf-8"))


def resolver(*ids, decisions=()):
    return Resolver([presets.load_dictionary(i) for i in ids], presets.resolution(), decision_entries(list(decisions)))


def test_multilingual_names_resolve():
    rv = resolver("global-seed", "acme-company", "project-duplex")
    got = {(x["raw"], x["ctx"]["ifc_class"]): rv.resolve(x["field"], x["raw"], x["ctx"])["term"] for x in MESSY}
    assert got[("BETON MB30", "IfcSlab")] == "concrete"
    assert got[("Gipsana ploča 12,5 mm", "IfcWall")] == "board.plasterboard"
    assert got[("Ytong 25cm", "IfcWall")] == "masonry.block.aac"
    assert got[("Stahl S355", "IfcBeam")] == "metal.steel"
    assert got[("Kupatilo", "IfcSpace")] == "space.bathroom"
    assert got[("Porotherm 25 S P+E", "IfcWall")] == "masonry.block.clay"      # company layer
    assert got[("CT", "IfcCovering")] == "finish.ceramic_tile"                  # company layer, context
    assert got[("CT", "IfcSlab")] == "concrete.screed"                          # project layer, context
    assert got[("CT", "IfcWall")] is None                                       # unknown -> question
    assert got[("Material X9", "IfcWall")] is None


def test_decision_layer_wins():
    rv = resolver("global-seed", decisions=[{"questionId": "name:material:Material X9", "answer": "masonry.brick"}])
    assert rv.resolve("material", "Material X9", {"ifc_class": "IfcWall"})["term"] == "masonry.brick"


def test_extractors():
    rv = resolver("global-seed")
    out = rv.extract("name", "M_W-Wide Flange:W310X60:W310X60:207325", {"ifc_class": "IfcBeam"})
    assert out["type_name"]["value"] == "W310X60"
    assert out["family"]["value"] == "M_W-Wide Flange"
    assert rv.extract("material", "Armirani beton C30/37", {})["strength_class"]["value"] == "C30/37"


# ------------------------------------------------------------------ which name fields block (review A-26, ENG-009)
def _fields(items=None, maps=None):
    from ifc_boq.rules import referenced_fields
    return referenced_fields({"items": items or [], "derived": [], "manual": []}, maps or [])


def test_words_in_labels_ids_and_literals_do_not_make_a_field_referenced():
    """ENG-009: a regex over the JSON made every unknown material block because a label said "material"."""
    assert _fields([{"id": "w", "label": "Walls (any material)", "match": {"ifcClass": "IfcWall"}, "claims": ["layers"],
                     "description": "Walls, any type_name", "note": "element_type is ignored"}]) == set()
    assert _fields([{"id": "w", "match": {"expr": 'name = "material layers"'}}]) == set()


def test_fields_read_by_expressions_selectors_breakdowns_and_templates_count():
    assert _fields([{"id": "a", "match": {"expr": 'UNDER(material, "concrete")'}}]) == {"material"}
    assert _fields([{"id": "a", "match": {"field": "element_type", "op": "under", "value": "wall"}}]) == {"element_type"}
    assert _fields([{"id": "a", "match": {"ifcClass": "IfcWall"}, "breakdown": "layer"}]) == {"layers"}
    assert _fields([{"id": "a", "match": {"ifcClass": "IfcWall"}, "breakdown": "material"}]) == {"layers", "material"}
    assert _fields([{"id": "a", "match": {"ifcClass": "IfcWall"}, "description": "Wall {type_name}"}]) == {"type_name"}
    assert _fields([{"id": "a", "match": {"ifcClass": "IfcWall"}, "lineKey": ["src.family_name"]}]) == {"family_name"}
    assert _fields([{"id": "a", "match": {"ifcClass": "IfcSpace"},
                     "quantity": {"kind": "formula", "unit": "m2", "expr": 'SUM(src.layers.area WHERE UNDER(material, "x"))'}}]) \
        == {"layers", "material"}
    assert _fields(maps=[{"rules": [{"id": "m", "match": {"where": 'UNDER(element_type, "wall.external")'}, "code": "D.01"}]}]) \
        == {"element_type"}
    assert _fields(maps=[{"rules": [{"id": "m", "match": {"tag": "x"}, "code": {"lookup": "space_type", "table": {}}}]}]) \
        == {"space_type"}


def test_shipped_presets_reference_what_they_did_before():
    """The system presets give the same sets as the regex did (checked for every rule set x classification)."""
    from ifc_boq.rules import enabled_view, flatten, referenced_fields
    acme = presets.load_classification("acme-cost-codes")[1]
    want = {"as-modelled": {"family_name", "layers", "material", "type_name"},
            "standard-style-example": {"element_type", "family_name", "layers", "material", "type_name"},
            "demo-custom": {"element_type", "material"}}
    for rid, fields in want.items():
        rs, lib = presets.load_rule_set(rid)
        view = enabled_view(flatten(rs, lib))
        assert referenced_fields(view, []) == fields, rid
        assert referenced_fields(view, [acme]) == fields | {"element_type"}, rid
