"""Review C-24 (CAS-025, QS-016): lines of one rule never share a description."""
import copy
from collections import Counter

from test_duplex import run

from ifc_boq import presets
from ifc_boq.pipeline import get_boq
from ifc_boq.rules import flatten


def _duplicates(result):
    counts = Counter((line["ruleId"], line["description"]) for line in result["lines"])
    return [key for key, n in counts.items() if n > 1]


def test_split_lines_name_what_tells_them_apart_and_keep_keys_and_quantities(duplex_parsed):
    """The Duplex had two "Edge formwork to slabs" (8.78 and 6.11 m2): each now names its slab type; keys stay."""
    result = run(duplex_parsed)
    assert _duplicates(result) == []
    edges = sorted(line["description"] for line in result["lines"] if line["ruleId"] == "formwork-slab-edges")
    assert edges == ["Edge formwork to slabs, 127mm Slab on Grade", "Edge formwork to slabs, 150mm Exterior Slab on Grade"]
    for line in result["lines"]:
        if line["ruleId"] == "formwork-slab-edges":
            assert line["key"].startswith("formwork-slab-edges | slab-concrete | ")


def test_every_example_rule_set_gives_distinct_descriptions(duplex_parsed):
    for rules in ("as-modelled", "standard-style-example", "acme-house-rules", "demo-tweaked"):
        assert _duplicates(run(duplex_parsed, rules, classes=("demo-trades",))) == [], rules


def test_the_rule_sets_words_read_a_flag_and_a_thickness_and_a_missing_value(duplex_parsed):
    """`lineKeyWords` (as-modelled): `is_external` reads external / internal, a missing one "external or internal
    not stated"; without words a value reads as it is. A child rule set merges the words by field."""
    rules, library = presets.load_rule_set("as-modelled")
    assert set(rules["lineKeyWords"]) >= {"is_external", "thickness"}
    child = {"schemaVersion": "1.0", "id": "child", "name": "Child", "version": "1", "extends": "as-modelled",
             "meta": {}, "params": {}, "lineKeyWords": {"thickness": {"value": "{value*100} cm"}}}
    flat = flatten(child, {**library, "as-modelled": rules})
    assert flat["lineKeyWords"]["thickness"] == {"value": "{value*100} cm"} and "is_external" in flat["lineKeyWords"]

    from ifc_boq.expr import Expr
    from ifc_boq.rules import RuleEngine
    engine = RuleEngine.__new__(RuleEngine)
    engine.rules, engine.x = rules, Expr()
    lines = [{"ruleId": "walls", "description": "Wall, Timber Clad", "key": k, "keys": keys} for k, keys in (
        ("a", {"type": "Timber Clad", "is_external": True, "thickness": 0.202}),
        ("b", {"type": "Timber Clad", "is_external": None, "thickness": 0.202}),
        ("c", {"type": "Timber Clad", "is_external": False, "thickness": 0.15}),
        ("d", {"type": "Timber Clad", "is_external": False, "thickness": 0.15}),
    )]
    engine.distinguish(lines)
    assert [line["description"] for line in lines] == [
        "Wall, Timber Clad, external, 202 mm", "Wall, Timber Clad, external or internal not stated, 202 mm",
        "Wall, Timber Clad, internal, 150 mm (1)", "Wall, Timber Clad, internal, 150 mm (2)"]


def test_a_rule_without_words_reads_the_values_themselves(duplex_parsed):
    rules, library = presets.load_rule_set("as-modelled")
    bare = copy.deepcopy(rules)
    bare.pop("lineKeyWords")
    result = get_boq(copy.deepcopy(duplex_parsed), bare, [], [presets.load_dictionary("global-seed")], presets.resolution(),
                     [], library)
    assert _duplicates(result) == []
