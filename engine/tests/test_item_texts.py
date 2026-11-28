from io import BytesIO

from openpyxl import load_workbook
from test_duplex import run

from ifc_boq import presets
from ifc_boq.export_xlsx import export
from ifc_boq.pipeline import get_boq


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


def test_preview_lines_carry_the_engine_filled_item_text(duplex_parsed):
    """F10-AC5 (TF-136): the Library's "Reads as" sample comes from the preview line, filled by the engine."""
    from ifc_boq.preview import sample

    codes, mapping = presets.load_classification("acme-cost-codes")
    for code in codes["codes"]:
        code["description"] = "Walls {thickness} m thick"
    rules, library = presets.load_rule_set("as-modelled")
    result = get_boq(duplex_parsed, rules, [(codes, mapping)], [presets.load_dictionary("global-seed")],
                     presets.resolution(), rule_library=library)
    line = next(line for line in result["lines"] if line["ruleId"] == "walls" and "Exterior - Brick on Block" in line["description"])
    preview = sample(line)
    assert preview["codes"] == {codes["id"]: {"code": line["codes"][codes["id"]]["code"], "text": "Walls 0.417 m thick"}}
    uncoded = sample({**line, "codes": {}})
    assert "codes" not in uncoded
    plain = sample({**line, "codes": {codes["id"]: {k: v for k, v in line["codes"][codes["id"]].items() if k != "text"}}})
    assert plain["codes"] == {codes["id"]: {"code": line["codes"][codes["id"]]["code"]}}


def test_the_shipped_example_code_lists_carry_item_texts_that_never_move_a_quantity(duplex_parsed):
    """Review C-23 (QS-016): no shipped code list had an item text, so every description read "Wall, <Revit type>,
    417 mm". The two example lists carry illustrative texts in our own words (rule 8): each wraps the line's
    description, so every line under a coded item reads as an item to price; quantities stay (rule 6)."""
    for name in ("acme-cost-codes", "demo-trades"):
        codes, mapping = presets.load_classification(name)
        assert presets.check("classifications", {"codeList": codes, "map": mapping}) == []
        items = [code for code in codes["codes"] if code.get("description")]
        assert len(items) >= 9 and all("{description}" in code["description"] for code in items), name
    plain = run(duplex_parsed, classes=())
    coded = run(duplex_parsed, classes=("acme-cost-codes", "demo-trades"))
    assert {l["key"]: l["quantity"] for l in coded["lines"]} == {l["key"]: l["quantity"] for l in plain["lines"]}
    texts = [l["codes"]["acme-cost-codes"].get("text") for l in coded["lines"]]
    assert sum(bool(t) for t in texts) >= len(texts) - 2
    wall = next(l for l in coded["lines"] if l["ruleId"] == "walls" and "Exterior - Brick on Block" in l["description"])
    assert wall["codes"]["acme-cost-codes"]["text"].startswith(f"External wall: {wall['description']};")
    assert not [w for w in coded["warnings"] if w["code"] == "item_text_blank"]
