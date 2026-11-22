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


def test_check_details_list_the_elements_of_every_check():
    """F03-AC5 (TF-125): each check row opens the viewer with its elements, so the summary carries them."""
    parsed, _ = parse_file(str(FIXTURES / "ifc" / "buildingsmart" / "IFC4X3" / "Building-Architecture.ifc"), overlaps=False)
    details = service.model_summary("m", parsed, False)["checkDetails"]
    checks = parsed["verification"]["checks"]
    assert checks and [d["id"] for d in details] == [c["id"] for c in checks]
    for detail, check in zip(details, checks):
        assert detail == {k: check[k] for k in ("id", "code", "severity", "elementIds", "message")}


def test_check_details_are_capped_per_code_while_the_counts_stay_whole():
    parsed, _ = parse_file(str(FIXTURES / "ifc" / "buildingsmart" / "IFC4X3" / "Building-Architecture.ifc"), overlaps=False)
    many = [{"id": f"chk-{i:05d}", "code": "no_material", "severity": "warning", "elementIds": [f"e{i}"], "message": "m"}
            for i in range(service.CHECK_DETAILS_PER_CODE + 50)]
    parsed["verification"] = {**parsed["verification"], "checks": many, "summary": {"no_material": len(many)}}
    summary = service.model_summary("m", parsed, False)
    assert len(summary["checkDetails"]) == service.CHECK_DETAILS_PER_CODE
    assert summary["checks"] == {"no_material": len(many)}
