"""Exported workbooks in a real spreadsheet application (review B-11, F12-AC1, FM-45).

openpyxl writes formulas without their values, so the other export tests can only read the formula text.
Here LibreOffice opens the three workbooks boqlet hands over (a working BoQ, a saved version, the change
report), prints each to PDF and saves each as .xlsx again with every formula recalculated; openpyxl then
reads the values LibreOffice computed. The expected totals come from the engine result and the sheet's
layout (which lines sit under which heading), never from the formulas being checked.

Marked `libreoffice`: skipped without `soffice` on the PATH (or `SOFFICE`), except with
`BOQLET_REQUIRE_LIBREOFFICE=1`, which CI sets so a missing install fails instead of skipping.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook

from ifc_boq.diff import compare
from ifc_boq.export_xlsx import export
from ifc_boq.parse import parse_file
from ifc_boq.paths import FIXTURES
from ifc_boq.sheets import boq_import, diff_export
from test_duplex import run

pytestmark = pytest.mark.libreoffice

SOFFICE = os.environ.get("SOFFICE") or shutil.which("soffice") or shutil.which("libreoffice")
CODES = {"id": "acme-cost-codes", "name": "ACME cost codes"}
# Tools > Options > LibreOffice Calc > Formula > "Recalculation on file load" for Excel 2007 and newer:
# 0 = always. The default (never) would keep the values the file carries, and openpyxl writes none.
RECALCULATE = """<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
"""


@pytest.fixture(scope="module")
def soffice():
    if not SOFFICE:
        if os.environ.get("BOQLET_REQUIRE_LIBREOFFICE") == "1":
            pytest.fail("BOQLET_REQUIRE_LIBREOFFICE=1 but soffice is not installed")
        pytest.skip("LibreOffice (soffice) is not installed")
    return SOFFICE


def convert(soffice, tmp_path: Path, source: Path, target: str) -> Path:
    """`soffice --convert-to <target>` with a profile of its own that recalculates on load."""
    profile = tmp_path / "libreoffice-profile"
    (profile / "user").mkdir(parents=True, exist_ok=True)
    (profile / "user" / "registrymodifications.xcu").write_text(RECALCULATE, encoding="utf-8")
    extension = target.split(":")[0]
    out = tmp_path / f"converted-{extension}"
    done = subprocess.run([soffice, f"-env:UserInstallation={profile.as_uri()}", "--headless", "--norestore",
                           "--convert-to", target, "--outdir", str(out), str(source)],
                          capture_output=True, text=True, timeout=300)
    produced = out / f"{source.stem}.{extension}"
    assert done.returncode == 0 and produced.is_file() and produced.stat().st_size > 0, (done.stdout, done.stderr)
    return produced


def print_and_resave(soffice, tmp_path: Path, name: str, contents: bytes):
    """The workbook printed to PDF and saved again by LibreOffice; returns the re-saved bytes."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    source = tmp_path / f"{name}.xlsx"
    source.write_bytes(contents)
    pdf = convert(soffice, tmp_path, source, "pdf")
    assert pdf.read_bytes().startswith(b"%PDF") and pdf.stat().st_size > 1024
    return convert(soffice, tmp_path, source, "xlsx:Calc MS Excel 2007 XML").read_bytes()


def layout(sheet):
    """Which line keys each subtotal row covers, from the headings, lines and subtotals as they are laid out
    (column I holds a line's key, a heading has a title and nothing else, a subtotal starts "Subtotal")."""
    open_groups, covered, lines, total = [], {}, {}, None
    for row in range(6, sheet.max_row + 1):
        title, key = sheet.cell(row, 2).value, sheet.cell(row, 9).value
        if key:
            lines[row] = key
            for group in open_groups:
                group.append(key)
        elif str(title or "").startswith("Subtotal "):
            covered[row] = open_groups.pop()
        elif title == "TOTAL":
            total = row
        elif title:
            open_groups.append([])
    assert not open_groups and total
    return covered, lines, total


def test_libreoffice_recalculates_the_boq_to_the_engine_totals(duplex_parsed, soffice, tmp_path):
    """Every line amount, every subtotal at every level and the total, as LibreOffice computes them, equal
    the engine's quantities times the rates typed into the rate column; protection and the edits round trip
    survive LibreOffice saving the file."""
    result = run(duplex_parsed)
    meta = {"boqId": "b-11", "project": "Duplex", "boq": "Tender", "revision": "A", "status": "working",
            "classifications": [CODES]}
    workbook = load_workbook(BytesIO(export(result, meta)))
    sheet = workbook["BoQ"]
    covered, lines, total_row = layout(sheet)
    by_key = {line["key"]: line for line in result["lines"]}
    rates = {}
    for index, (row, key) in enumerate(lines.items()):
        rates[key] = round(1.25 + (index % 7) * 3.5, 2)
        sheet.cell(row, 5).value = rates[key]       # what an estimator types into the yellow column
    typed = BytesIO()
    workbook.save(typed)

    saved = print_and_resave(soffice, tmp_path, "boq", typed.getvalue())
    values = load_workbook(BytesIO(saved), data_only=True)["BoQ"]

    def amount(key):
        quantity = by_key[key]["quantity"]
        return 0 if quantity is None else quantity * rates[key]

    for row, key in lines.items():
        assert values.cell(row, 4).value == pytest.approx(by_key[key]["quantity"]), key
        assert values.cell(row, 6).value == pytest.approx(amount(key), rel=1e-9, abs=1e-9), key
    shared_units = 0
    for row, keys in covered.items():
        assert values.cell(row, 6).value == pytest.approx(sum(map(amount, keys)), rel=1e-9, abs=1e-9), row
        units = {by_key[key]["unit"] for key in keys}
        if len(units) == 1 and any(by_key[key]["quantity"] is not None for key in keys):
            shared_units += 1
            expected = sum(by_key[key]["quantity"] or 0 for key in keys)
            assert values.cell(row, 4).value == pytest.approx(expected, rel=1e-9, abs=1e-9), row
        else:
            assert values.cell(row, 4).value in (None, ""), row
    assert shared_units and len(covered) > shared_units      # both kinds of subtotal were checked
    grand = sum(map(amount, lines.values()))
    assert grand > 0 and values.cell(total_row, 6).value == pytest.approx(grand, rel=1e-9)
    # Nested subtotals are not counted twice: SUBTOTAL skips them, so the total is the lines' sum (above).

    assert values.protection.sheet
    first_line = next(iter(lines))
    assert not values.cell(first_line, 5).protection.locked and values.cell(first_line, 9).protection.locked
    # Saved by LibreOffice and imported again: the rates are not edits, so there is nothing to apply.
    imported = boq_import.read(saved, {"boqId": "b-11", "primary": CODES["id"], "lines": result["lines"]})
    assert imported == {"overrides": [], "manualItems": [], "problems": []}


def test_a_saved_version_and_the_change_report_print_and_open_again(duplex_parsed, soffice, tmp_path):
    """A saved (issued) version with its cover and the Duplex v1 -> v2 change report convert to PDF without
    errors and keep their sheets when LibreOffice saves them."""
    first = run(duplex_parsed)
    issued = export(first, {"boqId": "b-11", "project": "Duplex", "boq": "Tender", "revision": "B",
                            "status": "issued", "issuedBy": "A. Estimator", "issuedAt": "2026-11-25T10:00:00Z",
                            "issueNote": "For tender", "watermark": True, "classifications": [CODES]})
    resaved = load_workbook(BytesIO(print_and_resave(soffice, tmp_path / "issued", "issued", issued)), data_only=True)
    assert resaved.sheetnames == load_workbook(BytesIO(issued)).sheetnames
    cover = {row[0]: row[1] for row in resaved["Cover"].iter_rows(min_row=3, max_col=2, values_only=True) if row[0]}
    assert (cover["Version"], cover["Status"], cover["Saved by"]) == ("B", "issued", "A. Estimator")
    assert "(WORKING)" not in resaved["BoQ"]["A1"].value

    changed, _ = parse_file(str(FIXTURES / "ifc" / "Ifc2x3_Duplex_Architecture_v2.ifc"))
    second = run(changed)

    def model(parsed, result, version):
        return [{"name": "Architecture", "modelId": "arch", "parsed": parsed,
                 "traceId": result["models"][0]["id"], "versionId": version}]

    diff = compare(first, second, model(duplex_parsed, first, "1"), model(changed, second, "2"),
                   inputs_changed=["inputs.models"])
    report = diff_export.render(diff, {})
    reopened = load_workbook(BytesIO(print_and_resave(soffice, tmp_path / "changes", "changes", report)))
    assert reopened.sheetnames == ["Summary", "Lines", "Elements"]
    assert reopened["Lines"].max_row == load_workbook(BytesIO(report))["Lines"].max_row
