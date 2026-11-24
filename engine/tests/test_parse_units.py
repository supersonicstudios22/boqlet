"""
Mass, plane-angle and property-level units in the parser (review A-29, ENG-021): an IfcQuantityWeight in a project
measured in grams or pounds is read in kg, a property or quantity with its own `Unit` is converted by that unit,
and plane angles are given in degrees. The review's samples are SI, so they do not change.
"""
from __future__ import annotations

import ifcopenshell
import ifcopenshell.api
import pytest

from ifc_boq.parse import parse_file


def model(tmp_path, mass_unit) -> str:
    f = ifcopenshell.file(schema="IFC4")
    project = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcProject", name="Units")
    metre = f.createIfcSIUnit(None, "LENGTHUNIT", None, "METRE")
    radian = f.createIfcSIUnit(None, "PLANEANGLEUNIT", None, "RADIAN")
    ifcopenshell.api.run("unit.assign_unit", f, units=[metre, mass_unit(f), radian])
    site = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcSite", name="Site")
    ifcopenshell.api.run("aggregate.assign_object", f, relating_object=project, products=[site])
    beam = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcBeam", name="Beam")
    ifcopenshell.api.run("spatial.assign_container", f, relating_structure=site, products=[beam])
    qto = ifcopenshell.api.run("pset.add_qto", f, product=beam, name="Qto_BeamBaseQuantities")
    ifcopenshell.api.run("pset.edit_qto", f, qto=qto, properties={"GrossWeight": 500.0})
    millimetre = f.createIfcSIUnit(None, "LENGTHUNIT", "MILLI", "METRE")
    qto.Quantities = list(qto.Quantities) + [f.createIfcQuantityLength("CutLength", None, millimetre, 7421.3)]
    pset = ifcopenshell.api.run("pset.add_pset", f, product=beam, name="Pset_Test")
    pset.HasProperties = [
        f.createIfcPropertySingleValue("Depth", None, f.createIfcLengthMeasure(310.0), millimetre),
        f.createIfcPropertySingleValue("Slope", None, f.createIfcPlaneAngleMeasure(0.5235987756), None),
        f.createIfcPropertySingleValue("Load", None, f.createIfcMassMeasure(2000.0), None),
    ]
    path = tmp_path / "units.ifc"
    f.write(str(path))
    return str(path)


def grams(f):
    return f.createIfcSIUnit(None, "MASSUNIT", None, "GRAM")


def pounds(f):
    kg = f.createIfcSIUnit(None, "MASSUNIT", "KILO", "GRAM")
    factor = f.createIfcMeasureWithUnit(f.createIfcMassMeasure(0.45359237), kg)
    dims = f.createIfcDimensionalExponents(0, 1, 0, 0, 0, 0, 0)
    return f.createIfcConversionBasedUnit(dims, "MASSUNIT", "pound", factor)


def beam(path):
    doc, _ = parse_file(path, overlaps=False)
    return next(e for e in doc["elements"] if e["ifcClass"] == "IfcBeam")


@pytest.mark.parametrize("unit,kg", [(grams, 0.5), (pounds, 500 * 0.45359237)])
def test_weights_are_read_in_kilograms(tmp_path, unit, kg):
    e = beam(model(tmp_path, unit))
    assert e["quantities"]["reported"]["Qto_BeamBaseQuantities"]["GrossWeight"] == pytest.approx(kg, rel=1e-6)
    assert e["psets"]["Pset_Test"]["Load"] == pytest.approx(kg * 4, rel=1e-6)


def test_a_value_with_its_own_unit_is_converted_by_it(tmp_path):
    e = beam(model(tmp_path, grams))
    assert e["psets"]["Pset_Test"]["Depth"] == pytest.approx(0.31)
    assert e["quantities"]["reported"]["Qto_BeamBaseQuantities"]["CutLength"] == pytest.approx(7.4213)


def test_plane_angles_are_in_degrees(tmp_path):
    e = beam(model(tmp_path, grams))
    assert e["psets"]["Pset_Test"]["Slope"] == pytest.approx(30.0, rel=1e-6)
