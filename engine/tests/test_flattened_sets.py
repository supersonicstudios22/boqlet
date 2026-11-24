"""
S10 (Schependomlaan, a Synchro 4D export of an ArchiCAD model) resolved "0 of 0 distinct names" (review A-33,
VER-006): the exporter drops every IfcMaterial and type and flattens all of an element's property sets into one
`SynchroResourceProperty` whose properties are named "[Pset_WallCommon]IsExternal",
"[ArchiCADProperties]Building Material / Composite / Profile / Fill"... The parser reads those sets back and the
material comes from the property that names it (data/material_sources.json), so the names reach the names stage.
"""
from __future__ import annotations

import ifcopenshell
import ifcopenshell.api

from ifc_boq import presets
from ifc_boq.parse import parse_file
from ifc_boq.pipeline import get_boq


def synchro_like(tmp_path, monkeypatch) -> str:
    import ifcopenshell.api.owner.settings as owner
    f = ifcopenshell.file(schema="IFC2X3")
    org = f.createIfcOrganization(None, "Synchro-like")
    user = f.createIfcPersonAndOrganization(f.createIfcPerson(), org)
    app = f.createIfcApplication(org, "5.0", "Synchro-like", "synchro")
    monkeypatch.setattr(owner, "get_user", lambda _f: user)            # IFC2X3 needs an owner history
    monkeypatch.setattr(owner, "get_application", lambda _f: app)
    project = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcProject", name="Schependomlaan-like")
    ifcopenshell.api.run("unit.assign_unit", f, units=[f.createIfcSIUnit(None, "LENGTHUNIT", "MILLI", "METRE")])
    site = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcSite", name="Site")
    ifcopenshell.api.run("aggregate.assign_object", f, relating_object=project, products=[site])
    wall = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcWallStandardCase", name="binnenblad_(#606884)")
    ifcopenshell.api.run("spatial.assign_container", f, relating_structure=site, products=[wall])
    pset = ifcopenshell.api.run("pset.add_pset", f, product=wall, name="SynchroResourceProperty")
    ifcopenshell.api.run("pset.edit_pset", f, pset=pset, properties={
        "[Pset_WallCommon]IsExternal": True, "[Pset_WallCommon]LoadBearing": False,
        "[ArchiCADProperties]Building Material / Composite / Profile / Fill": "IFC_baksteen_roodbruin_100mm_liggend",
        "[ArchiCADQuantities[IfcElementQuantity/ArchiCAD BIM Quantities]]Net Volume": 1.5})
    path = tmp_path / "synchro.ifc"
    f.write(str(path))
    return str(path)


def test_flattened_sets_are_read_back_and_the_material_named_by_a_property_reaches_the_names(tmp_path, monkeypatch):
    doc, _ = parse_file(synchro_like(tmp_path, monkeypatch), overlaps=False)
    wall = next(e for e in doc["elements"] if e["ifcClass"] in ("IfcWall", "IfcWallStandardCase"))
    assert "SynchroResourceProperty" not in wall["psets"]
    assert wall["psets"]["Pset_WallCommon"] == {"IsExternal": True, "LoadBearing": False}
    assert wall["psets"]["ArchiCADQuantities[IfcElementQuantity/ArchiCAD BIM Quantities]"] == {"Net Volume": 1.5}
    assert any(c["code"] == "pset_split" for c in doc["verification"]["checks"])
    rs, lib = presets.load_rule_set("as-modelled")
    r = get_boq(doc, rs, [], [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)
    summary = next(e for e in r["log"] if e.get("code") == "log.names.summary")
    assert summary["params"]["total"] >= 1
    raws = {q["raw"] for q in r["questions"] if q["kind"] == "unknown_name"} | {
        e["params"]["raw"] for e in r["log"] if e.get("code") == "log.names.resolved"}
    assert "IFC_baksteen_roodbruin_100mm_liggend" in raws


def test_an_ordinary_set_with_a_bracket_in_one_name_is_left_alone(tmp_path):
    f = ifcopenshell.file(schema="IFC4")
    project = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcProject", name="P")
    ifcopenshell.api.run("unit.assign_unit", f, units=[f.createIfcSIUnit(None, "LENGTHUNIT", None, "METRE")])
    beam = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcBeam", name="B")
    pset = ifcopenshell.api.run("pset.add_pset", f, product=beam, name="Pset_Mine")
    ifcopenshell.api.run("pset.edit_pset", f, pset=pset, properties={"[mm]Width": 3.0, "Height": 2.0})
    path = tmp_path / "b.ifc"
    f.write(str(path))
    doc, _ = parse_file(str(path), overlaps=False)
    beam_doc = next(e for e in doc["elements"] if e["ifcClass"] == "IfcBeam")
    assert beam_doc["psets"]["Pset_Mine"] == {"[mm]Width": 3.0, "Height": 2.0}
