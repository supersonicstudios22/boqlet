import json
from io import BytesIO
from pathlib import Path
from time import monotonic

import pytest
from openpyxl import load_workbook

from ifc_boq.diff import compare
from ifc_boq.parse import parse_file
from ifc_boq.paths import FIXTURES
from ifc_boq.storage import LocalStorage, write_json_gzip
from ifc_boq.worker import execute, validate
from test_duplex import run


def test_duplex_revision_matches_known_changes(duplex_parsed, tmp_path):
    changed, _ = parse_file(str(FIXTURES / "ifc" / "Ifc2x3_Duplex_Architecture_v2.ifc"))
    first, second = run(duplex_parsed), run(changed)
    def model(parsed, result, version):
        return [{"name": "Architecture", "modelId": "arch", "parsed": parsed,
                 "traceId": result["models"][0]["id"], "versionId": version}]

    result = compare(first, second, model(duplex_parsed, first, "1"), model(changed, second, "2"),
                     inputs_changed=["inputs.models"])
    validate(result, "run-diff")
    expected = json.loads((Path(__file__).parent / "fixtures/duplex_v1_v2_diff.json").read_text(encoding="utf8"))
    assert {key: result["summary"][key] for key in expected["summary"]} == expected["summary"]
    assert {item["guid"]: item["change"] for item in result["elements"]} == expected["elements"]
    actual = {item["lineKey"]: item for item in result["lines"]}
    assert actual.keys() == expected["lines"].keys()
    for key, (delta, cause) in expected["lines"].items():
        assert actual[key]["delta"] == pytest.approx(delta, abs=0.011)
        assert actual[key]["causes"] == [cause]
    storage = LocalStorage(tmp_path)
    write_json_gzip(storage, "diff/result.json.gz", result)
    output = execute({"type": "export_xlsx", "contract": "1", "outputPrefix": "export/diff",
                      "input": {"diffKey": "diff/result.json.gz"}}, storage)
    assert output["status"] == "succeeded", output
    workbook = load_workbook(BytesIO(storage.get_bytes(output["output"]["xlsxKey"])), read_only=True)
    assert workbook.sheetnames == ["Summary", "Lines", "Elements"]
    assert workbook["Elements"].max_row == 4
    assert workbook["Lines"].max_row == 6


def test_large_diff_compares_40000_lines_under_five_seconds():
    lines = [{"key": str(i), "ruleId": "walls", "ruleKind": "item", "description": f"Wall {i}",
              "quantity": i, "unit": "m2", "codes": {}} for i in range(40_000)]
    start = monotonic()
    base = {"lines": lines}
    unchanged = compare(base, base)
    assert unchanged["summary"]["linesUnchanged"] == 40_000
    changed = compare(base, {"lines": [{**lines[0], "quantity": 1}, *lines[1:]]})
    assert changed["summary"]["linesChanged"] == 1
    assert monotonic() - start < 5


def test_an_edited_line_is_listed_when_the_model_under_it_changes(duplex_parsed):
    """F08-AC3, BR-09 (TF-093): the edit stays, the engine's value under it moves, and the report says so.
    Elements are compared by what the model gives them, not by the edit spread over them."""
    changed, _ = parse_file(str(FIXTURES / "ifc" / "Ifc2x3_Duplex_Architecture_v2.ifc"))
    key = "walls | Interior - Partition (92mm Stud) | False |  | m2"
    edit = [{"questionId": "override:" + key, "scope": "project", "answer": {"quantity": 117.04, "reason": "site survey"}}]
    first, second = run(duplex_parsed, decisions=edit), run(changed, decisions=edit)

    def model(parsed, result, version):
        return [{"name": "Architecture", "modelId": "arch", "parsed": parsed,
                 "traceId": result["models"][0]["id"], "versionId": version}]

    result = compare(first, second, model(duplex_parsed, first, "1"), model(changed, second, "2"),
                     inputs_changed=["inputs.models"], from_decisions=edit, to_decisions=edit)
    validate(result, "run-diff")
    lines = {item["lineKey"]: item for item in result["lines"]}
    edited = lines[key]
    assert edited["change"] == "changed" and edited["causes"] == ["elements_removed"]
    assert edited["before"]["quantity"] == edited["after"]["quantity"] == 117.04 and edited["delta"] == 0
    assert edited["before"]["engineQuantity"] == pytest.approx(106.4, abs=0.011)
    assert edited["after"]["engineQuantity"] == pytest.approx(96.38, abs=0.011)
    expected = json.loads((Path(__file__).parent / "fixtures/duplex_v1_v2_diff.json").read_text(encoding="utf8"))
    assert {item["guid"]: item["change"] for item in result["elements"]} == expected["elements"]
    unedited = {k: v for k, v in lines.items() if k != key}
    assert all("override_changed" not in item["causes"] for item in unedited.values()), unedited
    from ifc_boq.sheets.diff_export import render
    sheet = load_workbook(BytesIO(render(result, {})), read_only=True)["Lines"]
    row = next(row for row in sheet.iter_rows(min_row=2, values_only=True) if row[1] == key)
    assert row[5] == row[6] == 117.04 and row[10:12] == (edited["before"]["engineQuantity"], edited["after"]["engineQuantity"])
