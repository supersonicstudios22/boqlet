"""The BoQ workbook follows the sheet's line order (TF-049, F06-AC3, BR-28)."""
from io import BytesIO

from openpyxl import load_workbook

from ifc_boq.export_xlsx import export
from test_duplex import run


def _rows(workbook_bytes):
    sheet = load_workbook(BytesIO(workbook_bytes))["BoQ"]
    # Column I keeps the line key (hidden, for the edits round trip); J the position number.
    return [(sheet.cell(row, 9).value, sheet.cell(row, 10).value) for row in range(6, sheet.max_row + 1)
            if sheet.cell(row, 9).value]


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
