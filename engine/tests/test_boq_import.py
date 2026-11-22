"""Edits read back from an exported BoQ workbook (F12-AC4, sheets/boq_import.py)."""
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook

from ifc_boq import presets
from ifc_boq.sheets import boq_import
from ifc_boq.storage import LocalStorage, write_json_gzip
from ifc_boq.worker import execute
from test_duplex import run


@pytest.fixture(scope="module")
def exported(duplex_parsed, tmp_path_factory):
    result = run(duplex_parsed)
    storage = LocalStorage(Path(tmp_path_factory.mktemp("export")))
    write_json_gzip(storage, "r/result.json.gz", result)
    codes, _ = presets.load_classification("acme-cost-codes")
    output = execute({"jobId": "x", "type": "export_xlsx", "contract": "1", "outputPrefix": "e", "input": {
        "resultKey": "r/result.json.gz",
        "meta": {"boqId": "b1", "classifications": [{"id": codes["id"], "name": codes["name"]}]}}}, storage)
    assert output["status"] == "succeeded", output
    return result, codes, storage.get_bytes(output["output"]["xlsxKey"])


def edited(data, change):
    book = load_workbook(BytesIO(data))
    change(book["BoQ"])
    out = BytesIO()
    book.save(out)
    return out.getvalue()


def row_of(sheet, description):
    return next(row[0].row for row in sheet.iter_rows(min_row=6) if row[1].value == description)


def new_rows(rows):
    def change(sheet):
        at = row_of(sheet, "Subtotal Ground slabs")
        sheet.insert_rows(at, len(rows))
        for offset, values in enumerate(rows):
            for column, value in enumerate(values, 1):
                sheet.cell(at + offset, column, value)
    return change


def test_new_rows_keep_their_group_and_incomplete_ones_are_reported(exported):
    """TF-051: a row with a description only is a problem, not a heading, and doesn't take the group away."""
    result, codes, data = exported
    info = {"boqId": "b1", "primary": codes["id"], "lines": result["lines"]}
    report = boq_import.read(edited(data, new_rows([[None, "Note only"], [None, "Extra wall", "m2", 5]])), info)
    assert [entry["item"]["item"]["description"] for entry in report["manualItems"]] == ["Extra wall"]
    assert report["manualItems"][0]["item"]["codes"] == {codes["id"]: "B.02"}
    assert any(p["column"] == "C" and "unit" in p["message"] for p in report["problems"]), report["problems"]
    assert not report["overrides"]


def test_new_row_ids_come_from_their_content_not_their_row(exported):
    result, codes, data = exported
    info = {"boqId": "b1", "primary": codes["id"], "lines": result["lines"]}
    first = boq_import.read(edited(data, new_rows([[None, "Extra wall", "m2", 5]])), info)["manualItems"]
    second = boq_import.read(edited(data, new_rows([[None, "Extra door", "nr", 1]])), info)["manualItems"]
    twice = boq_import.read(edited(data, new_rows([[None, "Extra wall", "m2", 5], [None, "Extra wall", "m2", 5]])), info)["manualItems"]
    ids = [entry["item"]["item"]["id"] for entry in first + second]
    assert len(set(ids)) == 2 and all(i.startswith("xlsx-") and i != f"xlsx-{entry['row']}" for i, entry in zip(ids, first + second))
    assert len({entry["item"]["item"]["id"] for entry in twice}) == 2


def test_a_ref_that_is_not_a_code_is_reported_on_its_row(exported):
    result, codes, data = exported
    info = {"boqId": "b1", "primary": codes["id"], "lines": result["lines"], "codes": [c["code"] for c in codes["codes"]]}

    def change(sheet):
        sheet.cell(row_of(sheet, "Slab, 127mm Slab on Grade"), 1, "B.99")
        new_rows([["ZZ", "Extra wall", "m2", 5], ["D.02", "Extra partition", "m2", 3]])(sheet)
    report = boq_import.read(edited(data, change), info)
    bad = [p for p in report["problems"] if p["column"] == "A"]
    assert len(bad) == 2 and all("not a code" in p["message"] for p in bad), report["problems"]
    assert [entry["item"]["item"]["description"] for entry in report["manualItems"]] == ["Extra partition"]
    assert not any(o["edit"].get("codes") for o in report["overrides"])


def test_a_formula_typed_into_a_quantity_without_a_saved_value_is_reported(exported):
    """TF-177: the export's own Amount formulas are fine; a formula quantity with no saved value is a problem."""
    result, codes, data = exported
    info = {"boqId": "b1", "primary": codes["id"], "lines": result["lines"]}
    assert not boq_import.read(data, info)["problems"]

    def change(sheet):
        sheet.cell(row_of(sheet, "Slab, 127mm Slab on Grade"), 4, "=2*3")
    report = boq_import.read(edited(data, change), info)
    assert any(p["column"] == "D" and "formula" in p["message"] for p in report["problems"]), report["problems"]
    assert not any(o["edit"].get("quantity") is None and o["change"] == "quantity" for o in report["overrides"])


def test_a_text_edit_in_excel_is_proposed_as_a_description_edit(exported):
    """TF-008: the Excel round trip covers text edits too (quantity, move, delete and add: test_worker)."""
    result, codes, data = exported
    info = {"boqId": "b1", "primary": codes["id"], "lines": result["lines"]}
    line = next(l for l in result["lines"] if l["description"] == "Slab, 127mm Slab on Grade")

    def change(sheet):
        sheet.cell(row_of(sheet, line["description"]), 2, "Ground slab 127 mm, edited")
    report = boq_import.read(edited(data, change), info)
    assert report["overrides"] == [{"edit": {"lineKey": line["key"], "description": "Ground slab 127 mm, edited"},
                                    "change": "description", "row": report["overrides"][0]["row"]}]
    assert not report["problems"] and not report["manualItems"]
