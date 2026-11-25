import json
from io import BytesIO
from pathlib import Path
from time import monotonic

import pytest
from openpyxl import load_workbook
from test_duplex import run

from ifc_boq.diff import compare
from ifc_boq.parse import parse_file
from ifc_boq.paths import FIXTURES
from ifc_boq.storage import LocalStorage, write_json_gzip
from ifc_boq.worker import execute, validate


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


# ------------------------------------------------------------------ hand-built expectations (review B-03)
def _line(key, quantity, shares, unit="m2", **extra):
    return {"key": key, "ruleId": key.split(" | ")[0], "ruleKind": "item", "description": key, "quantity": quantity,
            "unit": unit, "codes": {}, "trace": {"elements": [{"guid": g, "quantity": v} for g, v in shares]}, **extra}


BEFORE = {"lines": [_line("walls | A", 10.0, [("w1", 4.0), ("w2", 6.0)]), _line("doors | D", 2, [("d1", 1), ("d2", 1)], "nr"),
                    _line("slabs | S", 5.0, [("s1", 5.0)]), _line("stairs | T", 1, [("t1", 1)], "nr", excluded=True)]}
AFTER = {"lines": [_line("walls | A", 6.0, [("w2", 6.0)]), _line("doors | D", 2, [("d1", 1), ("d2", 1)], "nr"),
                   _line("roofs | R", 3.0, [("r1", 3.0)])]}


def test_hand_built_runs_give_the_diff_worked_out_by_hand():
    """Not captured output: wall w1 (4 m2) goes, the slab line goes, a roof line comes, the doors stay, and an
    excluded line is not compared. Deltas after - before; one line of each kind."""
    result = compare(BEFORE, AFTER)
    assert {k: result["summary"][k] for k in ("linesAdded", "linesRemoved", "linesChanged", "linesUnchanged")} == \
        {"linesAdded": 1, "linesRemoved": 1, "linesChanged": 1, "linesUnchanged": 1}
    lines = {item["lineKey"]: (item["change"], item["delta"]) for item in result["lines"]}
    assert lines == {"walls | A": ("changed", -4.0), "slabs | S": ("removed", -5.0), "roofs | R": ("added", 3.0)}
    assert compare(BEFORE, BEFORE)["summary"]["linesChanged"] == 0


def test_an_edit_changed_on_one_side_is_the_cause():
    edited = {"lines": [{**AFTER["lines"][0], "quantity": 7.0, "overridden": {"fields": ["quantity"], "quantity": 7.0,
                                                                           "engineQuantity": 6.0, "reason": "survey"}}, *AFTER["lines"][1:]]}
    walls = next(item for item in compare(AFTER, edited)["lines"] if item["lineKey"] == "walls | A")
    assert (walls["change"], walls["delta"], walls["causes"]) == ("changed", 1.0, ["override_changed"])


@pytest.mark.xfail(strict=True, reason="N-25: diff._override_keys reads a missing line as a changed edit")
def test_an_added_or_removed_line_is_not_blamed_on_an_edit():
    causes = {item["lineKey"]: item["causes"] for item in compare(BEFORE, AFTER)["lines"]}
    assert "override_changed" not in causes["roofs | R"] + causes["slabs | S"]
