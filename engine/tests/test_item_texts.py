from io import BytesIO

from openpyxl import load_workbook

from ifc_boq import presets
from ifc_boq.export_xlsx import export
from ifc_boq.pipeline import get_boq
from test_duplex import run


def test_item_text_uses_rule_expressions_without_changing_quantities(duplex_parsed):
    before = run(duplex_parsed)
    wall = next(line for line in before["lines"] if line["ruleId"] == "walls" and "Exterior - Brick on Block" in line["description"])
    codes, mapping = presets.load_classification("acme-cost-codes")
    selected = next(code for code in codes["codes"] if code["code"] == wall["codes"][codes["id"]]["code"])
    selected["description"] = "External walls {thickness*100} cm, measured per {unit}; {fire_rating}"
    assert presets.check("classifications", {"codeList": codes, "map": mapping}) == []
    rules, library = presets.load_rule_set("as-modelled")
    result = get_boq(duplex_parsed, rules, [(codes, mapping)], [presets.load_dictionary("global-seed")],
                     presets.resolution(), rule_library=library)
    line = next(line for line in result["lines"] if line["key"] == wall["key"])
    assert line["codes"][codes["id"]]["text"] == "External walls 41.7 cm, measured per m2; {fire_rating}"
    assert {line["key"]: line["quantity"] for line in result["lines"]} == {
        line["key"]: line["quantity"] for line in before["lines"]
    }
    warnings = [warning for warning in result["warnings"] if warning["code"] == "item_text_blank"
                and warning["params"]["lineKey"] == line["key"]]
    assert [warning["params"]["blank"] for warning in warnings] == ["fire_rating"]
    book = load_workbook(BytesIO(export(result, {"classifications": [{"id": codes["id"], "name": codes["name"]}]})))
    assert line["codes"][codes["id"]]["text"] in [cell.value for cell in book["BoQ"]["B"]]
    assert "Measured as" in [cell.value for cell in book["Lines"][1]]
    assert f"{codes['name']} item text" in [cell.value for cell in book["Lines"][1]]
    book.close()


def test_preset_reports_unknown_template_fields_and_bad_syntax():
    codes, mapping = presets.load_classification("acme-cost-codes")
    codes["codes"][0]["description"] = "{unavailable_field} and {thickness*}"
    problems = presets.check("classifications", {"codeList": codes, "map": mapping})
    assert any("unknown item text field 'unavailable_field'" in problem for problem in problems)
    assert any("{thickness*}" in problem for problem in problems)
