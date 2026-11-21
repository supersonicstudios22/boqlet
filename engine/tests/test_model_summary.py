"""The model summary leaves out what a model doesn't state (api.ts ModelSummary: optional, never null).
An IFC4X3 sample with a storey without elevation made the mock answer 500 (TS-004, v1 criterion 2)."""
from ifc_boq import service
from ifc_boq.parse import parse_file
from ifc_boq.paths import FIXTURES


def test_storeys_without_elevation_leave_it_out():
    parsed, _ = parse_file(str(FIXTURES / "ifc" / "buildingsmart" / "IFC4X3" / "Building-Architecture.ifc"), overlaps=False)
    storeys = service.model_summary("m", parsed, False)["storeys"]
    assert storeys
    for storey in storeys:
        assert all(value is not None for value in storey.values())
        assert isinstance(storey.get("elevation", 0.0), (int, float))
