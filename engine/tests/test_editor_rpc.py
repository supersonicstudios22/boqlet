"""The Library editors' engine calls (review B-13, ENG-017, FM-42): "Reads as" and samples are filled by
the engine, and a slot rename parses the expressions instead of a regex over the document."""
import pytest

from ifc_boq import rpc


def _sample(template, line=None, filled=None, filled_from=None):
    item = {"template": template, **({"line": line} if line else {}), **({"filled": filled} if filled else {}),
            **({"filledFrom": filled_from} if filled_from else {})}
    return rpc.call("item-text-sample", {"items": [item]}, None)["results"][0]


def test_reads_as_without_a_line_keeps_the_blanks_and_names_the_plain_fields():
    got = _sample("Wall {thickness*1000} mm {material}")
    assert got["pieces"] == [{"text": "Wall "}, {"blank": "{thickness*1000}"}, {"text": " mm "},
                             {"blank": "{material}", "name": "material"}]
    assert got["text"] == "Wall {thickness*1000} mm {material}"


def test_a_sample_line_is_filled_with_the_engines_number_format_and_expressions():
    got = _sample("Wall {thickness*1000} mm, {quantity} {unit}, {material}",
                  {"keys": {"thickness": 0.2, "material": "Concrete"}, "unit": "m2", "quantity": 12.34567})
    # the client used to print String(q): 12.34567 and 0.2*1000 = 200.00000000000003 left unevaluated
    assert got["text"] == "Wall 200 mm, 12.346 m2, Concrete"
    assert got["pieces"][1] == {"blank": "{thickness*1000}", "value": "200"}


def test_a_blank_the_line_has_no_value_for_stays_as_written():
    assert _sample("{fire_rating} door", {"keys": {}, "unit": "item", "quantity": 1})["text"] == "{fire_rating} door"


def test_values_read_as_a_run_writes_them_and_objects_and_empty_values_stay_blank():
    line = {"keys": {"is_external": True, "layers": {"a": 1}, "storey": "", "type_name": "Brick 240"}}
    got = _sample("{is_external} {layers} {storey} {type_name}", line)
    # a run writes yes/no (expr.fmt); the client used to print "true"
    assert got["text"] == "yes {layers} {storey} Brick 240"


def test_empty_braces_are_text_as_in_a_run():
    # the engine's blank needs at least one character (templates.BLANK); the client's regex took "{}"
    assert _sample("A {} b")["pieces"] == [{"text": "A {} b"}]


def test_the_text_the_engine_filled_in_a_preview_gives_every_blank_its_value():
    got = _sample("{src.width} x {material}", None, "0.3 x Steel")
    assert [p.get("value") for p in got["pieces"] if "blank" in p] == ["0.3", "Steel"]
    # an edited template no longer matches the filled text: values come from the line instead
    edited = _sample("Edited {material}", {"keys": {"material": "Oak"}}, "0.3 x Steel")
    assert edited["text"] == "Edited Oak"
    # a draft being typed keeps the values the engine filled for the saved template, blank by blank
    draft = _sample("{material}, {src.width} wide", None, "0.3 x Steel", "{src.width} x {material}")
    assert draft["text"] == "Steel, 0.3 wide"


def test_a_page_of_samples_is_capped():
    with pytest.raises(ValueError, match="At most 500"):
        rpc.call("item-text-sample", {"items": [{"template": "x"}] * 501}, None)


def test_a_rename_never_touches_a_string_literal_or_a_label():
    doc = {
        "params": {"x": {"type": "number", "value": 1}, "a": {"type": "number", "value": 2, "label": "Uses p.a"}},
        "rules": [{
            "id": "r", "label": "Wall p.a",
            "quantity": 'IF(name = "p.a", p.a, p.ab + p.a.b)',
            "description": 'Wall {p.a * 1000} mm {expr: CONCAT("p.a", p.a)} {"a"}',
            "unitParam": {"param": "a"}, "dependsOn": {"param": "a"},
        }],
    }
    out = rpc.call("rename-param", {"doc": doc, "from": "a", "to": "depth"}, None)
    rule = out["doc"]["rules"][0]
    assert rule["quantity"] == 'IF(name = "p.a", p.depth, p.ab + p.depth.b)'
    assert rule["description"] == 'Wall {p.depth * 1000} mm {expr: CONCAT("p.a", p.depth)} {"a"}'
    assert rule["label"] == "Wall p.a"
    assert rule["unitParam"] == {"param": "depth"} and rule["dependsOn"] == {"param": "depth"}
    assert list(out["doc"]["params"]) == ["x", "depth"]
    assert out["doc"]["params"]["depth"]["label"] == "Uses p.a"
    assert out["changes"] == 7


def test_a_rename_refuses_a_name_that_is_not_a_slot_name():
    with pytest.raises(ValueError, match="slot name"):
        rpc.call("rename-param", {"doc": {}, "from": "a", "to": "1bad"}, None)
