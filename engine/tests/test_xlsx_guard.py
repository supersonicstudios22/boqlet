"""Zip bombs in a user's .xlsx are refused from the zip directory, before openpyxl decompresses anything (TF-039)."""
import base64
import zipfile
from io import BytesIO

import pytest
from fastapi.testclient import TestClient

from ifc_boq import codelist_import, presets, worker_http
from ifc_boq.sheets import boq_import, templates
from ifc_boq.storage import LocalStorage

SHEET = (b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
         b'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>')
PARTS = {
    "[Content_Types].xml": b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    b'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    b'<Default Extension="xml" ContentType="application/xml"/>'
    b'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    b'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    b'<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    "_rels/.rels": b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    b'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": b'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    b'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="BoQ" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    b'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    b'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": SHEET,
}


def workbook(shared_strings_mb: int) -> bytes:
    """A valid workbook whose shared strings expand to the given size (deflate packs them about 280:1)."""
    item = b"<si><t>" + b"B" * 100 + b"</t></si>"
    chunk = item * ((1 << 20) // len(item))
    out = BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, body in PARTS.items():
            z.writestr(name, body)
        with z.open("xl/sharedStrings.xml", "w", force_zip64=True) as f:
            f.write(b'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Code</t></si><si><t>Title</t></si>')
            for _ in range(shared_strings_mb):
                f.write(chunk)
            f.write(b"</sst>")
    return out.getvalue()


@pytest.fixture(scope="module")
def bomb():
    data = workbook(512)  # 512 MB of shared strings in under 2 MB
    assert len(data) < 2 << 20, len(data)
    return data


@pytest.fixture
def no_decompressing(monkeypatch):
    """Any read of a member's bytes fails the test: the guard must decide from the zip directory alone."""
    def refuse(*args, **kwargs):
        raise AssertionError("a workbook member was decompressed")
    monkeypatch.setattr(zipfile.ZipFile, "open", refuse)


def test_code_list_reader_refuses_a_bomb(bomb, no_decompressing):
    with pytest.raises(ValueError, match="too large"):
        codelist_import.read_table("codes.xlsx", bomb)


def test_template_reader_refuses_a_bomb(bomb, no_decompressing):
    rule, library = presets.load_rule_set("as-modelled")
    result = templates.read({"kind": "rule_set", "doc": rule, "library": list(library.values())}, bomb)
    assert "too large" in result["error"]
    assert "doc" not in result


def test_boq_edits_reader_refuses_a_bomb(bomb, no_decompressing):
    report = boq_import.read(bomb, {"boqId": "b", "lines": []})
    assert report["overrides"] == [] and report["manualItems"] == []
    assert len(report["problems"]) == 1 and "too large" in report["problems"][0]["message"]


@pytest.fixture(scope="module")
def packed():
    return workbook(8)


def test_a_tightly_packed_part_is_refused_below_the_size_cap(packed, no_decompressing):
    # 8 MB is under every size cap, but no real workbook part packs 280:1.
    with pytest.raises(ValueError, match="too large"):
        codelist_import.read_table("codes.xlsx", packed)


def test_a_small_workbook_still_reads():
    sheets = codelist_import.read_table("codes.xlsx", workbook(0))["sheets"]
    assert sheets[0]["rows"] == [["Code", "Title"]]


def test_rpc_answers_a_bomb_with_422(bomb, tmp_path, monkeypatch):
    storage = LocalStorage(tmp_path)
    storage.put_bytes("internal/code-lists/u/bomb", bomb)
    monkeypatch.setattr(worker_http, "storage", lambda: storage)
    with TestClient(worker_http.app) as client:
        response = client.post("/rpc/codelist-read", json={"fileKey": "internal/code-lists/u/bomb", "fileName": "codes.xlsx"})
        assert response.status_code == 422, response.text
        assert "too large" in response.json()["detail"]
        rule, library = presets.load_rule_set("as-modelled")
        response = client.post("/rpc/template-import", json={
            "kind": "rule_set", "doc": rule, "library": list(library.values()),
            "file": base64.b64encode(bomb).decode("ascii")})
        assert response.status_code == 200 and "too large" in response.json()["error"], response.text
