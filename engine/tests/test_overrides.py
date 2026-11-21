from io import BytesIO

import pytest
from openpyxl import load_workbook

from ifc_boq.export_xlsx import export
from test_duplex import run


def edit(key, **answer):
    return {"scope": "project", "questionId": f"override:{key}", "answer": answer}


def test_quantity_edit_flows_into_element_derived_formula(duplex_parsed):
    before = run(duplex_parsed)
    wall = next(line for line in before["lines"] if line["ruleId"] == "walls" and "Foundation - Concrete" in line["description"])
    wall_elements = {part["guid"] for part in wall["trace"]["elements"]}
    original_derived = next(line for line in before["lines"] if line["ruleId"] == "formwork-walls")
    extra = sum(part["quantity"] or 0 for part in original_derived["trace"]["elements"] if part["guid"] in wall_elements)
    assert extra > 0
    result = run(duplex_parsed, decisions=[edit(wall["key"], quantity=wall["quantity"] * 2, reason="Site survey")])
    by_key = {line["key"]: line for line in result["lines"]}
    assert by_key[wall["key"]]["overridden"]["engineQuantity"] == pytest.approx(wall["quantity"], abs=1e-6)
    assert by_key[wall["key"]]["quantity"] == pytest.approx(wall["quantity"] * 2, abs=1e-6)
    derived = by_key[original_derived["key"]]
    assert derived["quantity"] == pytest.approx(original_derived["quantity"] + extra, abs=0.021)
    assert any("source quantity edited" in trace["note"] for trace in derived["trace"]["elements"])
    assert any(log["code"] == "log.decision.line_override" and log["lineKey"] == wall["key"] for log in result["log"])


def test_codes_exclusion_orphans_and_xlsx(duplex_parsed):
    systems = ("acme-cost-codes", "demo-trades")
    original = run(duplex_parsed, classes=systems)
    item = next(line for line in original["lines"] if {"acme-cost-codes", "demo-trades"} <= line["codes"].keys())
    old_code = item["codes"][systems[0]]["code"]
    target_code = "D.02" if old_code != "D.02" else "D.01"
    result = run(duplex_parsed, classes=systems, decisions=[
        edit(item["key"], codes={systems[0]: target_code}, description="=1+2", excluded=True, reason="Out of contract"),
        edit("removed line", quantity=1, reason="Historical"),
    ])
    line = next(line for line in result["lines"] if line["key"] == item["key"])
    assert line["codes"][systems[0]]["code"] == target_code
    assert line["codes"][systems[1]] == item["codes"][systems[1]]
    assert line["overridden"]["engineCodes"] == {systems[0]: old_code}
    assert line["overridden"]["engineDescription"] == item["description"]
    assert any(q["id"] == "orphan:removed line" and not q["blocking"] for q in result["questions"])
    book = load_workbook(BytesIO(export(result, {})))
    assert "=1+2" not in [cell.value for cell in book["BoQ"]["B"]]
    assert book["Excluded lines"]["B2"].value == "=1+2"
    assert book["Excluded lines"]["B2"].data_type == "s"
    assert book["Excluded lines"]["E2"].value == "Out of contract"
    assert any(cell.data_type == "f" for cell in book["BoQ"]["F"])
    book.close()


def test_unit_requires_quantity(duplex_parsed):
    with pytest.raises(ValueError, match="requires a quantity"):
        run(duplex_parsed, decisions=[edit("old", unit="m")])
