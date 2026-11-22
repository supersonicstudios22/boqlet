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
