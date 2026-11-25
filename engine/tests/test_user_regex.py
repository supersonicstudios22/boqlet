"""User regexes run on RE2 (review A-35, ENG-006, ENG-022): bounded time, refused when RE2 can't, same matches."""
import copy
import json
import re
import time
from pathlib import Path

import pytest

from ifc_boq import presets, user_regex
from ifc_boq.expr import Expr
from ifc_boq.names import Resolver, fold
from ifc_boq.rules import select

EVIL = "(.|.)*X"                 # catastrophic for a backtracking engine: minutes on 40 characters in Python `re`
NAME = "a" * 40


def entry(rx, id="evil"):
    return {"id": id, "field": "material", "match": {"regex": rx}, "term": "concrete", "source": "user"}


def dictionary(*entries):
    return {"schemaVersion": "1.0", "id": "draft", "name": "draft", "version": "1", "layer": "project",
            "entries": list(entries)}


def test_a_catastrophic_pattern_returns_at_once_in_names_and_selectors():
    rv = Resolver([presets.load_dictionary("global-seed"), dictionary(entry(EVIL))], presets.resolution())
    start = time.perf_counter()
    rv.resolve("material", NAME, {"ifc_class": "IfcWall"})
    assert select({"field": "material", "op": "matches", "value": EVIL}, {"material": NAME}, Expr()) is False
    assert user_regex.search(EVIL, NAME + "X")
    assert time.perf_counter() - start < 0.05      # the acceptance's 10 ms per call, with room for a slow CI machine


@pytest.mark.parametrize("pattern, words", [
    ("(?=concrete)c", "look-arounds"),
    ("(?<!pre)cast", "look-arounds"),
    (r"(a)\1", "back-references"),
    ("a" * 501, "limit is 500"),
    (r"\bбетон\b", "ASCII"),
    (r"(unclosed", "RE2 does not accept"),
])
def test_patterns_re2_cannot_run_are_refused_with_a_reason(pattern, words):
    assert words in user_regex.problem(pattern)
    with pytest.raises(user_regex.PatternError):
        user_regex.compile(pattern)


@pytest.mark.parametrize("pattern", [r"(?<t>\d+)\s?mm", r"(?P<t>\d+)", r"\b(beton|b[eé]ton)\b", "бетон", r"\\bé",
                                     r"(?:^|\PL)бетон(?:\PL|$)", "x" * 500])
def test_ordinary_patterns_pass(pattern):
    assert user_regex.problem(pattern) is None


def test_named_groups_in_either_spelling_extract():
    assert user_regex.search(r"(?<t>\d+)\s?MM", "Wall 200mm").groupdict() == {"t": "200"}
    assert user_regex.search(r"ABC", "xabcx", ignore_case=False) is None
    assert user_regex.search(r"ABC", "xabcx")


def test_a_word_in_another_script_matches_with_letter_classes():
    rx = r"(?:^|\PL)бетон(?:\PL|$)"
    assert user_regex.search(rx, "Бетон C30/37") and user_regex.search(rx, "армирани бетон")
    assert not user_regex.search(rx, "бетонски")


def test_the_dictionary_check_refuses_what_re2_refuses():
    problems = presets.check("dictionaries", dictionary(entry("(?=concrete)c"), entry("ok", id="fine")))
    assert len(problems) == 1 and "evil" in problems[0] and "look-arounds" in problems[0], problems
    x = {"id": "x-long", "field": "type_name", "regex": "(?<t>" + "a" * 500 + ")", "outputs": {"t": {"target": "profile"}}}
    problems = presets.check("dictionaries", {**dictionary(entry("ok")), "extractors": [x]})
    assert any("x-long" in p and "limit is 500" in p for p in problems), problems


def test_the_rules_check_refuses_a_matches_selector_re2_refuses():
    lib = presets.rule_sets()
    doc = copy.deepcopy(lib["as-modelled"])
    item = next(i for i in doc["items"] if i["id"] == "walls")
    item["match"] = {"all": [item["match"], {"field": "type_name", "op": "matches", "value": r"(\w)\1"}]}
    problems = presets.check("rules", doc)
    assert any("back-references" in p for p in problems), problems


def test_a_stored_pattern_re2_refuses_fails_the_run_with_its_entry_id():
    with pytest.raises(ValueError, match="'evil'.*look-arounds"):
        Resolver([dictionary(entry("(?=x)y"))], presets.resolution())


def _shipped_patterns():
    for d in presets.dictionaries().values():
        for e in d["entries"]:
            if "regex" in e["match"]:
                yield d["id"], e["id"], e["match"]["regex"], not e.get("caseSensitive", False), e.get("ignoreAccents", True)
        for x in d.get("extractors", []):
            yield d["id"], x["id"], x["regex"], True, None


def _corpus():
    names = {x["raw"] for x in json.loads((Path(__file__).parent / "messy_names.json").read_text(encoding="utf-8"))}
    for d in presets.dictionaries().values():
        for e in d["entries"]:
            for how, v in e["match"].items():
                if how != "regex":
                    names.update(v if isinstance(v, list) else [v])
    names |= {"Betón armado", "Hormigón HA-25", "Gipsana ploča 12,5 mm", "Čelik S355", "Stahlbeton C30/37",
              "concrete_reinforced_in-situ", "ReinforcingSteel", "Mauerwerk 24cm", "Maçonnerie", "Außenwand",
              "Dämmung 16 cm", "Šljunak 0-32", "spavaća soba", "Wohnzimmer", "Kupatilo", "Escalera",
              "HEA 200", "IPE300", "W310X60", "SHS 100x100x5", "CHS 168.3×6.3", "precast concrete stair",
              "Béton préfabriqué", "Betonfertigteil", "Insitu Concrete 225mm", "Concrete Masonry Units", "Бетон"}
    return sorted(names)


def test_every_shipped_pattern_gives_the_same_matches_as_before():
    """Python `re`, as the resolver used it before A-35 (three spellings of the name), against RE2."""
    corpus, checked = _corpus(), 0
    for did, eid, rx, ignore_case, accents in _shipped_patterns():
        old = re.compile(re.sub(r"\(\?<(?![=!])", "(?P<", rx), re.I if ignore_case else 0)
        for raw in corpus:
            if accents is None:            # an extractor: the raw name, and the groups it captures
                a, b = old.search(raw), user_regex.search(rx, raw)
                assert (a and a.groupdict()) == (b and b.groupdict()), (did, eid, raw)
                continue
            spaced = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", fold(raw, accents, False)).replace("_", " ")
            spellings = dict.fromkeys((raw, fold(raw, accents, False), spaced))
            before = any(old.search(s) for s in spellings)
            after = any(user_regex.search(rx, s, ignore_case) for s in spellings)
            assert before == after, (did, eid, raw)
            checked += 1
    assert checked > 3000
