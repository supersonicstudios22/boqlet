"""The BoQ workbook follows the sheet's line order (TF-049, F06-AC3, BR-28)."""
import json
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook
from test_duplex import run

from ifc_boq.export_xlsx import export, subtotal


def _rows(workbook_bytes):
    sheet = load_workbook(BytesIO(workbook_bytes))["BoQ"]
    # Column I keeps the line key (hidden, for the edits round trip); A (Ref) the position number (C-23).
    return [(sheet.cell(row, 9).value, sheet.cell(row, 1).value) for row in range(6, sheet.max_row + 1)
            if sheet.cell(row, 9).value]


def test_ref_is_the_position_number_a_number_where_it_is_one(duplex_parsed):
    """Review C-23 (QS-016): Ref held the group code on every line, the item number sat in a text column "No.".
    Ref is the position number now (the sheet's rule: code, separator, running number), a number without a
    classification; the group rows keep their codes; no "No." column."""
    result = run(duplex_parsed)
    coded = load_workbook(BytesIO(export(result, {"boqId": "c-23", "classifications": [
        {"id": "acme-cost-codes", "name": "ACME", "separator": "."}]})))["BoQ"]
    assert coded["J5"].value is None
    refs = {}
    for row in range(6, coded.max_row + 1):
        if key := coded.cell(row, 9).value:
            refs[key] = coded.cell(row, 1).value
    by_code: dict = {}
    for line in result["lines"]:
        if not line.get("excluded"):
            code = line["codes"]["acme-cost-codes"]["code"]
            by_code[code] = by_code.get(code, 0) + 1
            assert refs[line["key"]] == f"{code}.{by_code[code]}"
    headings = {coded.cell(r, 1).value for r in range(6, coded.max_row + 1) if not coded.cell(r, 9).value and coded.cell(r, 1).value}
    assert headings and headings <= {step["code"] for line in result["lines"] for step in line["codes"]["acme-cost-codes"]["path"]}

    plain = load_workbook(BytesIO(export(result, {"boqId": "c-23"})))["BoQ"]
    numbers = [plain.cell(r, 1).value for r in range(6, plain.max_row + 1) if plain.cell(r, 9).value]
    assert numbers == list(range(1, len(numbers) + 1)) and all(isinstance(n, int) for n in numbers)


def test_rows_follow_the_line_order_and_numbers_run_in_sequence(duplex_parsed):
    result = run(duplex_parsed)
    meta = {"boqId": "tf-049", "classifications": [{"id": "acme-cost-codes", "name": "ACME cost codes"}]}
    engine_order = [key for key, _ in _rows(export(result, meta))]
    # Within one section, the user moved the second line above the first (sortAfter: null) and
    # placed the last line of the section after the first one (a sortHint).
    section = {}
    for line in result["lines"]:
        code = line["codes"].get("acme-cost-codes")
        section.setdefault(code["path"][0]["code"] if code else "~", []).append(line["key"])
    keys = next(keys for keys in section.values() if len(keys) >= 3)
    first, second, last = keys[0], keys[1], keys[-1]
    order = [key for key in engine_order if key not in (first, second, last)]
    at = engine_order.index(first)
    order[at:at] = [second, first, last]
    numbers = {key: f"N{index}" for index, key in enumerate(order, 1)}

    rows = _rows(export(result, {**meta, "positionNumbers": numbers, "lineOrder": order}))
    assert [key for key, _ in rows] == order
    assert [number for _, number in rows] == [f"N{index}" for index in range(1, len(order) + 1)]


def test_without_a_line_order_the_engine_order_stays(duplex_parsed):
    result = run(duplex_parsed)
    meta = {"boqId": "tf-049", "classifications": [{"id": "acme-cost-codes", "name": "ACME cost codes"}]}
    unordered = [key for key, _ in _rows(export(result, meta))]
    partial = [key for key, _ in _rows(export(result, {**meta, "lineOrder": [unordered[-1]]}))]
    assert sorted(partial) == sorted(unordered)


def _sheet(workbook_bytes, name="BoQ"):
    return load_workbook(BytesIO(workbook_bytes))[name]


def _coded(result, codes):
    """The result with the first lines put under the given code paths of a system "nested"."""
    import copy
    out = copy.deepcopy(result)
    for line, path in zip(out["lines"], codes):
        line["codes"]["nested"] = {"system": "nested", "code": path[-1][0], "title": path[-1][1], "source": "map",
                                   "path": [{"code": c, "title": t} for c, t in path]}
    return out


def test_groups_nest_by_the_code_path_in_numeric_order_with_counts_and_shared_unit_totals(duplex_parsed):
    """TF-054 (F06 §3, F12-AC1): the sheet's groups, every level, "2" before "10"; each subtotal counts its
    lines and sums the quantity when they share a unit; amounts are SUBTOTALs, so levels don't add twice."""
    result = run(duplex_parsed)
    two, ten = [("2", "Two"), ("2.1", "Two one")], [("10", "Ten"), ("10.1", "Ten one")]
    result = _coded(result, [two, two, ten, ten])
    lines = result["lines"]
    lines[0].update(unit="m2", quantity=1.5)
    lines[1].update(unit="m2", quantity=2.25)
    lines[2].update(unit="m3", quantity=3.0)
    lines[3].update(unit="nr", quantity=4)
    sheet = _sheet(export(result, {"classifications": [{"id": "nested", "name": "Nested"}]}))
    rows = {r: [sheet.cell(r, c).value for c in range(1, 9)] for r in range(6, sheet.max_row + 1)}
    headings = [(v[0], v[1]) for v in rows.values() if v[0] and v[2] in (None, "") and v[3] in (None, "")]
    assert headings[:4] == [("2", "Two"), ("2.1", "Two one"), ("10", "Ten"), ("10.1", "Ten one")]
    subtotal = {v[1]: (r, v) for r, v in rows.items() if str(v[1] or "").startswith("Subtotal")}
    r21, two_one = subtotal["Subtotal Two one"]
    assert two_one[2] == "m2" and two_one[3].startswith("=SUBTOTAL(9,D") and two_one[5].startswith("=SUBTOTAL(9,F")
    assert two_one[7] == "2 lines"
    assert subtotal["Subtotal Two"][1][3].startswith("=SUBTOTAL(9,D") and subtotal["Subtotal Two"][1][7] == "2 lines"
    ten_row = subtotal["Subtotal Ten"][1]
    assert ten_row[2] in (None, "") and ten_row[3] in (None, "") and ten_row[7] == "2 lines"   # m3 and nr: no sum
    total = next(v for v in rows.values() if v[1] == "TOTAL")
    assert total[5] == f"=SUBTOTAL(9,F6:F{max(r for r, v in rows.items() if v[1] == 'TOTAL') - 1})"


def test_quantities_show_the_decimals_the_sheet_shows(duplex_parsed):
    """TF-055: 0.4 item is not "0", 12.345 m3 is not 12.35."""
    result = run(duplex_parsed)
    first = next(l for l in result["lines"] if l["quantity"] is not None)
    second = next(l for l in result["lines"] if l["quantity"] is not None and l is not first)
    third = next(l for l in result["lines"] if l["quantity"] is not None and l not in (first, second))
    first.update(unit="item", quantity=0.4)
    second.update(unit="m3", quantity=12.345)
    third.update(unit="nr", quantity=12)
    sheet = _sheet(export(result, {"boqId": "b", "classifications": [{"id": "acme-cost-codes", "name": "ACME"}]}))
    formats = {sheet.cell(r, 9).value: sheet.cell(r, 4).number_format for r in range(6, sheet.max_row + 1) if sheet.cell(r, 9).value}
    assert formats[first["key"]].startswith("#,##0.0;") and formats[second["key"]].startswith("#,##0.000;")
    assert formats[third["key"]].startswith("#,##0;")


def test_the_not_in_the_models_note_and_the_cover_read_as_f12_says(duplex_parsed):
    """TF-058, TF-108: the F12 note with the BoQ's own manual lines (not the rule set's preliminaries),
    and the number format in words, not JSON."""
    from ifc_boq import presets
    from ifc_boq.pipeline import get_boq
    rules, library = presets.load_rule_set("as-modelled")
    result = get_boq(duplex_parsed, rules, [presets.load_classification("acme-cost-codes")], [presets.load_dictionary("global-seed")],
                     presets.resolution(), rule_library=library,
                     manual_items=[{"id": "hoarding", "kind": "preliminary", "description": "Site hoarding", "unit": "m", "quantity": 42}])
    assert sum(l["ruleKind"] == "manual" for l in result["lines"]) > 1        # the rule set's preliminaries too
    data = export(result, {"boq": "Tender", "classifications": [{"id": "acme-cost-codes", "name": "ACME"}],
                           "numberFormat": {"decimal": ",", "thousands": " "}})
    assert _sheet(data)["A4"].value == ("Quantities are taken from the models only. Work not modelled as objects is "
                                         "included only where derived or added by hand (1 manual line).")
    cover = {row[0]: row[1] for row in _sheet(data, "Cover").iter_rows(min_row=3, values_only=True) if row[0]}
    assert cover["Number format"] == "1 234 567,89 (decimal comma, thousands space)"


def test_an_unedited_export_with_nested_groups_imports_as_nothing_to_apply(duplex_parsed):
    """The edits import reads the nested sections back (TF-054 with TF-051's headings)."""
    from ifc_boq.sheets import boq_import
    two, ten = [("2", "Two"), ("2.1", "Two one")], [("10", "Ten"), ("10.1", "Ten one"), ("10.1.5", "Ten one five")]
    result = _coded(run(duplex_parsed), [two, two, ten, [("10", "Ten")]])
    data = export(result, {"boqId": "b", "classifications": [{"id": "nested", "name": "Nested"}]})
    assert boq_import.read(data, {"boqId": "b", "primary": "nested", "lines": result["lines"]}) == {"overrides": [], "manualItems": [], "problems": []}


def test_user_text_that_starts_with_an_equals_sign_is_never_a_formula(duplex_parsed):
    """TF-040 (security.md: no formulas evaluated): names, notes and labels stay text in every sheet; the
    only formulas are the workbook's own amounts and subtotals."""
    import copy
    result = copy.deepcopy(run(duplex_parsed))
    evil = '=HYPERLINK("https://example.invalid","codes")'
    result["ruleSet"]["name"] = evil
    result["ruleSet"]["meta"]["chain"] = "=1+1"
    first = result["lines"][0]
    first["notes"] = ["=2+2"]
    meta = {"boqId": "b", "boq": "=3+3", "project": "=4+4", "revision": "=5", "modelName": evil, "modelId": "=6+6",
            "dictionaries": ["=7+7"], "classifications": [{"id": "acme-cost-codes", "name": evil}],
            "decisions": [{"questionId": "=q", "answer": "x", "note": "=8+8"}], "issueNote": "=9+9", "watermark": "=10"}
    book = load_workbook(BytesIO(export(result, meta)))
    formulas = [(sheet.title, cell.coordinate, cell.value) for sheet in book for row in sheet.iter_rows() for cell in row
                if cell.data_type == "f"]
    assert formulas and all(v.startswith(("=IF(OR(D", "=SUBTOTAL(9,")) for _, _, v in formulas), [f for f in formulas if not f[2].startswith(("=IF(OR(D", "=SUBTOTAL(9,"))]
    texts = {cell.value for sheet in book for row in sheet.iter_rows() for cell in row if isinstance(cell.value, str)}
    assert evil in texts and "=8+8" in texts


def test_the_rule_chain_reads_names_and_versions_never_a_version_id(duplex_parsed):
    """Review A-34 (VER-007): BoQ!A2 read "Rules: Petra Design Studio rules (version-9d493c18-... -> petra-...)": the API
    gives each parent version the id `version-<uuid>`, and the chain was built from ids."""
    import copy

    from ifc_boq import presets
    from ifc_boq.pipeline import get_boq
    base, _ = presets.load_rule_set("as-modelled")
    parent = {**copy.deepcopy(base), "id": "version-9d493c18-0000-4000-8000-000000000000", "version": "1"}
    mine = {"schemaVersion": "1.0", "id": "petra-rules", "name": "Petra rules", "version": "3", "extends": parent["id"],
            "meta": {}, "params": {}}
    result = get_boq(copy.deepcopy(duplex_parsed), mine, [], [presets.load_dictionary("global-seed")], presets.resolution(),
                     [], {parent["id"]: parent})
    want = f"Petra rules v3 → {base['name']} v1"
    assert result["ruleSet"]["meta"]["chainLabel"] == want
    book = load_workbook(BytesIO(export(result, {"boq": "Duplex"})))
    a2 = book["BoQ"]["A2"].value
    assert a2.startswith(f"Rules: {want}  |") and "version-" not in a2
    inputs = {row[0].value: row[1].value for row in book["Inputs"].iter_rows(min_row=2) if row[0].value}
    assert inputs["Rule set chain"] == want


def test_a_run_exported_with_changes_waiting_says_what_it_leaves_out(duplex_parsed):
    """Review A-41 (CAS-002): the API passes the revision's pending changes when it exports the working
    version's current run; the Cover and the BoQ header say the file is the last run, without them."""
    result = run(duplex_parsed)
    meta = {"boq": "Tender", "revision": "A", "status": "working", "generatedAt": "2026-11-25T10:15:00Z",
            "classifications": [{"id": "acme-cost-codes", "name": "ACME"}]}
    plain = export(result, meta)
    cover = {row[0]: row[1] for row in _sheet(plain, "Cover").iter_rows(min_row=3, values_only=True) if row[0]}
    assert "Not included" not in cover
    assert "not included" not in _sheet(plain)["A2"].value

    stale = export(result, {**meta, "pendingChanges": ["adjustments", "decisions", "inputs.ruleSet", "something.new"]})
    cover = {row[0]: row[1] for row in _sheet(stale, "Cover").iter_rows(min_row=3, values_only=True) if row[0]}
    assert cover["Generated"] == "2026-11-25T10:15:00Z"
    assert cover["Not included"] == ("Changes made after this run (2026-11-25T10:15:00Z): line edits, answers, rule set, "
                                     "something.new. Generate the BoQ again to include them.")
    assert _sheet(stale)["A2"].value.endswith("|  Changes after this run are not included (see Cover)")


_VECTORS = json.loads((Path(__file__).resolve().parents[2] / "fixtures" / "subtotals.json").read_text("utf-8"))["vectors"]


@pytest.mark.parametrize("vector", _VECTORS, ids=[v["name"] for v in _VECTORS])
def test_a_group_subtotal_matches_the_shared_vectors(vector):
    """BR-63: the sheet (Vitest) and the grouped /lines view (JUnit) run the same vectors."""
    got = subtotal(vector["lines"])
    want = vector["expected"]
    assert (got["count"], got["unit"]) == (want["count"], want["unit"])
    assert got["quantity"] == (None if want["quantity"] is None else pytest.approx(want["quantity"]))


def test_a_subtotal_row_counts_and_sums_only_the_lines_in_the_totals(duplex_parsed):
    result = run(duplex_parsed)
    lines = [line for line in result["lines"] if line["unit"] == "m2"][:3]
    for line in lines:
        line["codes"] = {"x": {"system": "x", "code": "1", "title": "One", "path": [{"code": "1", "title": "One"}]}}
    lines[1]["excluded"] = True
    wb = load_workbook(BytesIO(export({**result, "lines": lines}, {"classifications": [{"id": "x", "name": "X"}]})))
    row = next(r for r in wb["BoQ"].iter_rows(values_only=True) if r[1] == "Subtotal One")
    assert row[2] == "m2" and row[3] == "=SUBTOTAL(9,D7:D8)" and row[7] == "2 lines"


def _sections(sheet):
    """(heading, [line keys], subtotal row values) per top-level section, in sheet order."""
    out, current = [], None
    for r in range(6, sheet.max_row + 1):
        values = [sheet.cell(r, c).value for c in range(1, 10)]
        if values[8]:
            current[1].append(values[8])
        elif str(values[1] or "").startswith("Subtotal"):
            current[2] = values
        elif values[1] and values[1] != "TOTAL" and values[2] in (None, "") and values[3] in (None, ""):
            current = [values[1], [], None, values[0]]
            out.append(current)
    return out


@pytest.mark.parametrize("grouping", ["~storey", "~rule"])
def test_a_bill_without_a_classification_groups_by_storey_or_rule_with_subtotals(duplex_parsed, grouping):
    """Review C-07 (DEC-58): an unclassified BoQ reads in storey or "measured as" sections, each with its count and
    (shared unit) sum as BR-63 defines it. A view only: the same lines and numbers as the flat export (rule 6)."""
    from ifc_boq.export_xlsx import section_path
    result = run(duplex_parsed)
    for line in result["lines"]:
        line["codes"] = {}
    flat = _sheet(export(result, {"boqId": "b"}))
    grouped = _sheet(export(result, {"boqId": "b", "groupBy": grouping}))
    keyed = lambda s: {s.cell(r, 9).value: s.cell(r, 4).value for r in range(6, s.max_row + 1) if s.cell(r, 9).value}
    assert keyed(grouped) == keyed(flat)
    sections = _sections(grouped)
    assert len(sections) > 1 and all(ref in (None, "") for *_, ref in sections)
    by_key = {line["key"]: line for line in result["lines"]}
    labels = {rule["id"]: rule["label"] for rule in result["ruleSet"]["items"] + (result["ruleSet"].get("derived") or [])}
    for heading, keys, total, _ in sections:
        lines = [by_key[k] for k in keys]
        paths = {json.dumps(section_path(line, grouping, None, labels)) for line in lines}
        assert len(paths) == 1, heading
        expected = subtotal(lines)
        assert total[7] == f"{expected['count']} line{'' if expected['count'] == 1 else 's'}"
        assert (total[2] or None) == (expected["unit"] if expected["quantity"] is not None else None)
    headings = [heading for heading, *_ in sections]
    if grouping == "~rule":
        manual_first = next(i for i, l in enumerate(result["lines"]) if l["ruleKind"] == "manual")
        assert headings[-1] == "Added by hand" and manual_first >= 0
        rule_order = list(dict.fromkeys(labels[l["ruleId"]] for l in result["lines"] if l["ruleKind"] != "manual"))
        assert headings[:-1] == rule_order
    else:
        storeys = [h for h in headings if h not in ("Several storeys", "No storey")]
        assert storeys and storeys == sorted(storeys, key=lambda s: [int(t) if t.isdigit() else t.lower() for t in __import__("re").split(r"(\d+)", s)])
    assert grouped["A2"].value.split("|")[1].strip() == f"Grouping: {'Storey' if grouping == '~storey' else 'Measured as'}"


@pytest.mark.parametrize("grouping", ["~storey", "~rule"])
def test_an_unedited_export_grouped_by_storey_or_rule_imports_as_nothing_to_apply(duplex_parsed, grouping):
    """The edits import reads a storey or rule section as a heading, never as a new row or a move (C-07)."""
    from ifc_boq.sheets import boq_import
    result = run(duplex_parsed)
    meta = {"boqId": "b", "groupBy": grouping, "classifications": [{"id": "acme-cost-codes", "name": "ACME"}]}
    data = export(result, meta)
    info = {"boqId": "b", "primary": "acme-cost-codes", "lines": result["lines"]}
    assert boq_import.read(data, info) == {"overrides": [], "manualItems": [], "problems": []}
    # Ref is the line's position in the first classification (C-23), and changing it still moves the line:
    # to a code typed in, or to the section of a position number typed in.
    from openpyxl import load_workbook
    wb = load_workbook(BytesIO(data))
    ws = wb["BoQ"]
    row = next(r for r in range(6, ws.max_row + 1) if ws.cell(r, 9).value and ws.cell(r, 1).value)
    key = ws.cell(row, 9).value
    code = next(l for l in result["lines"] if l["key"] == key)["codes"]["acme-cost-codes"]["code"]
    assert str(ws.cell(row, 1).value).startswith(code + ".")
    for typed, moved in (("99", "99"), ("H.03.7", "H.03"), (f"{code}.42", None)):
        ws.cell(row, 1).value = typed
        out = BytesIO()
        wb.save(out)
        report = boq_import.read(out.getvalue(), info)
        assert [o["edit"] for o in report["overrides"]] == ([{"lineKey": key, "codes": {"acme-cost-codes": moved}}] if moved else []), typed


def test_every_sheet_prints_landscape_one_page_wide_with_its_header_row_and_a_footer(duplex_parsed):
    """Review C-21 (CAS-003, QS-016): the BoQ prints without page setup by hand: landscape, one page wide,
    the header row on every page, only the visible columns, and a footer naming the bill and the page."""
    result = run(duplex_parsed)
    meta = {"boqId": "c-21", "project": "Duplex & Co", "boq": "Tender", "revision": "B",
            "classifications": [{"id": "acme-cost-codes", "name": "ACME cost codes"}]}
    book = load_workbook(BytesIO(export(result, meta)))
    titles = {"BoQ": "$5:$5", "Calculation": "$4:$4", "Lines": "$1:$1", "Log": "$1:$1", "Questions": "$1:$1"}
    for name, rows in titles.items():
        sheet = book[name]
        assert sheet.page_setup.orientation == "landscape", name
        assert sheet.sheet_properties.pageSetUpPr.fitToPage, name
        assert (sheet.page_setup.fitToWidth, sheet.page_setup.fitToHeight) == (1, 0), name
        assert sheet.print_title_rows == rows, name
        # "&" is a header/footer code: a project's own "&" is written doubled.
        assert sheet.oddFooter.left.text == "Duplex && Co · Tender · B", name
        assert sheet.oddFooter.right.text == "Page &P of &N", name
        assert not sheet.oddHeader.center.text, name
    boq = book["BoQ"]
    # Ref to Notes: the hidden line key (I) is not printed.
    assert boq.print_area == f"'BoQ'!$A$1:$H${boq.max_row}"


def test_the_free_plan_watermark_is_on_every_printed_page_not_a_cell(duplex_parsed):
    """Review C-21 (PRD-026, CAS-029): the watermark was one deletable cell, Cover!A19. It is the header of
    every sheet now, and no cell says it."""
    result = run(duplex_parsed)
    meta = {"boqId": "c-21", "project": "Duplex", "boq": "Tender", "watermark": True,
            "classifications": [{"id": "acme-cost-codes", "name": "ACME cost codes"}]}
    book = load_workbook(BytesIO(export(result, meta)))
    for sheet in book.worksheets:
        if sheet.sheet_state == "visible":
            assert sheet.oddHeader.center.text == "Made with boqlet (Free plan)", sheet.title
    cells = [cell.value for sheet in book for row in sheet.iter_rows() for cell in row if isinstance(cell.value, str)]
    assert not any("Made with boqlet" in value for value in cells)


def _issue_meta(**extra):
    return {"boqId": "c-22", "profile": "issue", "firm": "Studio North", "client": "City of Example", "project": "Duplex",
            "boq": "Tender", "revision": "B", "status": "issued", "date": "28 November 2026",
            "generatedAt": "2026-11-28T09:00:00Z", "issuedBy": "A. Estimator", "issueNote": "For tender",
            "locale": "en", "modelName": "duplex.ifc", "modelId": "sha256-of-the-file",
            "classifications": [{"id": "acme-cost-codes", "name": "ACME cost codes"}], **extra}


def test_an_issue_workbook_is_a_cover_and_the_bill_without_internal_ids(duplex_parsed):
    """Review C-22 (PRD-012, CAS-015, DEC-40): the workbook a firm sends has its Cover (firm, client, project, bill,
    version, a readable date), the BoQ and, when asked, the Calculation; no Log, Questions, Inputs or Lines, no rule
    chain, run status, sha256 or locale. The hidden line keys and `_boqlet` stay for the round trip."""
    import copy
    result = copy.deepcopy(run(duplex_parsed))
    first = result["lines"][0]
    first["notes"] = ["the team's own note"]
    first["overridden"] = {"fields": ["quantity"], "reason": "checked on site", "engineQuantity": 1}
    book = load_workbook(BytesIO(export(result, _issue_meta())))
    visible = [sheet.title for sheet in book.worksheets if sheet.sheet_state == "visible"]
    assert visible == ["Cover", "BoQ"] and "_boqlet" in book.sheetnames
    cover = {row[0]: row[1] for row in book["Cover"].iter_rows(min_row=3, values_only=True) if row[0]}
    assert cover == {"Firm": "Studio North", "Client": "City of Example", "Project": "Duplex", "Bill": "Tender",
                     "Version": "B", "Date": "28 November 2026", "Grouping": "ACME cost codes", "Note": "For tender"}
    boq = book["BoQ"]
    assert boq["A2"].value == "Grouping: ACME cost codes  |  Date: 28 November 2026"
    texts = " ".join(str(cell.value) for sheet in book.worksheets if sheet.sheet_state == "visible"
                     for row in sheet.iter_rows() for cell in row if cell.value is not None)
    for internal in ("Rules:", "sha256", "Locale", "the team's own note", "checked on site", "Measured as", "Status: complete"):
        assert internal not in texts, internal
    assert boq.column_dimensions["I"].hidden

    with_calculation = load_workbook(BytesIO(export(result, _issue_meta(calculation=True))))
    assert [s.title for s in with_calculation.worksheets if s.sheet_state == "visible"] == ["Cover", "BoQ", "Calculation"]


def test_the_working_profile_is_the_audit_workbook_unchanged(duplex_parsed):
    result = run(duplex_parsed)
    meta = {k: v for k, v in _issue_meta().items() if k != "profile"}
    working = load_workbook(BytesIO(export(result, {**meta, "profile": "working"})))
    default = load_workbook(BytesIO(export(result, meta)))
    assert working.sheetnames == default.sheetnames == ["Cover", "BoQ", "_boqlet", "Calculation", "Lines", "Log", "Questions", "Inputs"]
    assert working["BoQ"]["A2"].value.startswith("Rules: ")


def test_an_unedited_issue_workbook_imports_as_nothing_to_apply_and_an_edit_reads_back(duplex_parsed):
    """Review C-22: the issue workbook goes through the edits import like the working one."""
    from ifc_boq.sheets import boq_import
    result = run(duplex_parsed)
    data = export(result, _issue_meta())
    info = {"boqId": "c-22", "primary": "acme-cost-codes", "lines": result["lines"]}
    assert boq_import.read(data, info) == {"overrides": [], "manualItems": [], "problems": []}
    book = load_workbook(BytesIO(data))
    sheet = book["BoQ"]
    row = next(r for r in range(6, sheet.max_row + 1) if sheet.cell(r, 9).value)
    sheet.cell(row, 2).value = "Edited by the client"
    edited = BytesIO()
    book.save(edited)
    report = boq_import.read(edited.getvalue(), info)
    assert [o["edit"] for o in report["overrides"]] == [{"lineKey": sheet.cell(row, 9).value, "description": "Edited by the client"}]
