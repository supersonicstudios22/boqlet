from io import BytesIO

from openpyxl import load_workbook

from ifc_boq import presets
from ifc_boq.sheets import templates


def test_shipped_preset_workbooks_round_trip_unchanged():
    rules = presets.rule_sets()
    documents = [("rule_set", rule) for rule in rules.values()]
    documents.extend(("dictionary", dictionary) for dictionary in presets.dictionaries().values())
    documents.extend(("classification", {"codeList": entry["codeList"], "map": entry["map"]})
                     for entry in presets.classifications().values() if entry["available"])
    for kind, doc in documents:
        data = {"kind": kind, "doc": doc, "library": list(rules.values())}
        imported = templates.read(data, templates.write(data))
        assert imported["changes"] == [], (kind, imported)
        assert imported["problems"] == [], (kind, imported)


def test_rule_template_reports_three_edits_and_invalid_choice_cell():
    rule, library = presets.load_rule_set("as-modelled")
    data = {"kind": "rule_set", "doc": rule, "library": list(library.values())}
    book = load_workbook(BytesIO(templates.write(data)))
    sheet = book["Settings"]
    edits = {"include_proxies": "no" if rule["params"]["include_proxies"]["value"] else "yes",
             "lines_by_storey": "yes", "wall_opening_threshold": 0.25}
    for row in sheet.iter_rows(min_row=2):
        if row[0].value in edits:
            row[5].value = edits[row[0].value]
        if row[0].value == "wall_unit":
            row[5].value = "invalid choice"
            invalid_row = row[0].row
    output = BytesIO()
    book.save(output)
    book.close()
    result = templates.read(data, output.getvalue())
    assert len(result["changes"]) == 3, result
    assert any(problem.get("sheet") == "Settings" and problem.get("row") == invalid_row and problem.get("column") == "F"
               for problem in result["problems"])
