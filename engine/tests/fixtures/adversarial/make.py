"""Writes the adversarial IFC corpus (review B-02): small, hand-built, licence-clean files that look like the
review's broken samples (S11-S14): not STEP, empty, binary, cut short, no IfcProject, unnamed and repeated
property sets, elements with no geometry. `expected.json` says what each must give; `test_adversarial.py` checks it.

Run from engine/: `.venv/Scripts/python tests/fixtures/adversarial/make.py` (only when a file is added)."""
from __future__ import annotations

from pathlib import Path

import ifcopenshell
import ifcopenshell.api

HERE = Path(__file__).parent


def _model(name: str):
    f = ifcopenshell.file(schema="IFC4")
    project = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcProject", name=name)
    ifcopenshell.api.run("unit.assign_unit", f, units=[f.createIfcSIUnit(None, "LENGTHUNIT", None, "METRE")])
    site = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcSite", name="Site")
    ifcopenshell.api.run("aggregate.assign_object", f, relating_object=project, products=[site])
    storey = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcBuildingStorey", name="Level 0")
    ifcopenshell.api.run("aggregate.assign_object", f, relating_object=site, products=[storey])
    return f, storey


def _wall(f, storey, name: str):
    wall = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcWall", name=name)
    ifcopenshell.api.run("spatial.assign_container", f, relating_structure=storey, products=[wall])
    return wall


def odd_psets() -> str:
    """A wall with an unnamed property set and two sets sharing a name (S12-style), quantities in both."""
    f, storey = _model("Odd sets")
    wall = _wall(f, storey, "Wall with odd sets")
    unnamed = ifcopenshell.api.run("pset.add_pset", f, product=wall, name="Pset_Temp")
    ifcopenshell.api.run("pset.edit_pset", f, pset=unnamed, properties={"Colour": "Red"})
    unnamed.Name = None
    for i, value in enumerate(("First", "Second")):
        pset = ifcopenshell.api.run("pset.add_pset", f, product=wall, name=f"Pset_WallCommon_{i}")
        ifcopenshell.api.run("pset.edit_pset", f, pset=pset, properties={"Reference": value, "IsExternal": True})
        pset.Name = "Pset_WallCommon"            # the API merges sets of one name; a file can repeat it
    qto = ifcopenshell.api.run("pset.add_qto", f, product=wall, name="Qto_WallBaseQuantities")
    ifcopenshell.api.run("pset.edit_qto", f, qto=qto, properties={"Length": 4.0, "Height": 3.0, "Width": 0.2, "NetSideArea": 12.0})
    return f.to_string()


def no_geometry() -> str:
    """Walls, a slab and a door with neither a body nor reported quantities."""
    f, storey = _model("No geometry")
    for name in ("Wall A", "Wall B"):
        _wall(f, storey, name)
    for cls in ("IfcSlab", "IfcDoor"):
        el = ifcopenshell.api.run("root.create_entity", f, ifc_class=cls, name=cls[3:])
        ifcopenshell.api.run("spatial.assign_container", f, relating_structure=storey, products=[el])
    return f.to_string()


def no_project() -> str:
    """A fragment: a wall and a storey but no IfcProject (a library or an export of a selection)."""
    f = ifcopenshell.file(schema="IFC4")
    ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcWall", name="Loose wall")
    return f.to_string()


def main() -> None:
    whole = odd_psets()
    files = {
        "not-step.ifc": "This is a text file someone renamed to .ifc.\n",
        "empty.ifc": "",
        "odd-psets.ifc": whole,
        "no-geometry.ifc": no_geometry(),
        "no-project.ifc": no_project(),
        "truncated.ifc": whole[: len(whole) * 2 // 3],
    }
    for name, text in files.items():
        (HERE / name).write_text(text, encoding="utf-8", newline="\n")
    (HERE / "binary.ifc").write_bytes(bytes(range(256)) * 8)


if __name__ == "__main__":
    main()
