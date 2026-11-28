"""
Questions a person can act on (review WP-C4): what an answer can move, in plain words, with the questions that
change nothing kept apart. Synthetic documents from test_reported_quantities.py; the Duplex for a real run.
"""
from __future__ import annotations

import copy

from test_reported_quantities import doc, slab

from ifc_boq import presets
from ifc_boq.pipeline import AFFECTED_LINES, affected_lines, get_boq


def run(parsed: dict, decisions: list | None = None) -> dict:
    rs, lib = presets.load_rule_set("as-modelled")
    return get_boq(parsed, rs, [], [presets.load_dictionary("global-seed")], presets.resolution(), decisions or [], lib)


# ------------------------------------------------------------------ C-15: affected lines, plain words, no effect
def test_a_contradiction_lists_the_lines_its_elements_feed_and_reads_plainly():
    el = slab({"BaseQuantities": {"GrossArea": 50.0, "NetVolume": 13.0}}, layer_thickness=0.2)   # mesh 10 m3: +30 %
    r = run(doc(el, layer_thickness=0.2))
    (q,) = [q for q in r["questions"] if q["kind"] == "contradiction"]
    keys = {l["key"] for l in r["lines"] if any(e["guid"] in q["guids"] for e in l["trace"]["elements"])}
    assert keys and {a["key"] for a in q["affectedLines"]} == keys and q["affectedLineCount"] == len(keys)
    line = next(l for l in r["lines"] if l["key"] == q["affectedLines"][0]["key"])
    assert q["affectedLines"][0] == {"key": line["key"], "description": line["description"], "unit": line["unit"],
                                     "quantity": line["quantity"]}
    assert "the file gives the volume as 13 m3; the geometry measures 10 m3 (-23%)" in q["message"]
    assert q["message"].endswith("Which should we use?") and "disagree" not in q["message"]


def test_the_duplex_party_wall_thickness_reads_as_the_file_says_and_the_geometry_measures(duplex_parsed):
    rs, lib = presets.load_rule_set("as-modelled")
    r = get_boq(copy.deepcopy(duplex_parsed), rs, [], [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)
    q = next(q for q in r["questions"] if q["id"].startswith("contradiction:thickness:IfcWall:"))
    assert "the file says 0.55 m thick; the geometry measures" in q["message"]
    assert q["affectedLines"] and q["affectedLineCount"] >= len(q["affectedLines"])


def test_a_name_no_rule_reads_has_no_effect_and_names_its_elements(duplex_parsed):
    rs, lib = presets.load_rule_set("as-modelled")
    r = get_boq(copy.deepcopy(duplex_parsed), rs, [], [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)
    names = [q for q in r["questions"] if q["kind"] == "unknown_name"]
    assert names
    for q in names:
        assert q["guids"], q["id"]
        assert q.get("noEffect") is (None if q["blocking"] else True)
        assert "Used" not in q["message"]


def test_affected_lines_are_capped_in_boq_order():
    lines = [{"key": f"k{i}", "description": f"Line {i}", "unit": "m2", "quantity": float(i),
              "trace": {"elements": [{"guid": "g"}]}} for i in range(AFFECTED_LINES + 5)]
    questions = [{"id": "q", "guids": ["g", "g"]}, {"id": "none"}, {"id": "other", "guids": ["x"]}]
    affected_lines(questions, lines)
    assert [a["key"] for a in questions[0]["affectedLines"]] == [f"k{i}" for i in range(AFFECTED_LINES)]
    assert questions[0]["affectedLineCount"] == AFFECTED_LINES + 5
    assert "affectedLines" not in questions[1]
    assert questions[2]["affectedLines"] == [] and questions[2]["affectedLineCount"] == 0


# ------------------------------------------------------------------ C-16: names that can always be answered
from ifc_boq.names import UNSPECIFIED, Resolver, TermIndex  # noqa: E402

import pytest  # noqa: E402


def seed_resolver() -> Resolver:
    return Resolver([presets.load_dictionary("global-seed")], presets.resolution())


@pytest.mark.parametrize("field, raw, cls, term", [
    # the S09 and S07 names that blocked: everyday materials, abbreviations, placeholders
    ("layer_material", "Damp-proofing", "IfcWall", "membrane.damp_proof"),
    ("material", "Laminate, Ivory, Matte", "IfcSlab", "finish.laminate"),
    ("type_name", "Wall-Ext_102Bwk-75Ins-100LBlk-12P", "IfcWall", "wall.external"),
    ("type_name", "Wall-Partn_12P-70MStd-12P", "IfcWall", "wall.partition"),
    ("type_name", "Int Wall 100", "IfcWall", "wall.internal"),
    ("layer_material", "SH_resin Floor", "IfcSlab", "finish.resin"),
    ("layer_material", "Carpet (1)", "IfcSlab", "finish.carpet"),
    ("material", "Softwood, Lumber", "IfcMember", "timber.lumber"),
    ("material", "Vinyl sheet", "IfcCovering", "finish.vinyl"),
    ("material", "Air", "IfcWall", UNSPECIFIED), ("layer_material", "Default", "IfcSlab", UNSPECIFIED),
    ("type_name", "<By Category>", "IfcDoor", UNSPECIFIED),
    # what the new entries must not take
    ("material", "Laminated glass", "IfcWindow", "glass"), ("layer_material", "Misc. Air Layers - Air Space", "IfcWall", "air_gap"),
    ("type_name", "Interior Door 900", "IfcDoor", None), ("material", "Render", "IfcWall", "finish.plaster"),
])
def test_the_seed_resolves_everyday_names_abbreviations_and_placeholders(field, raw, cls, term):
    assert seed_resolver().resolve(field, raw, {"ifc_class": cls})["term"] == term


def test_terms_that_fit_a_name_come_from_its_words_and_the_ifc_data():
    index = TermIndex(seed_resolver().terms)
    assert index.candidates("Wall-Ext_102Bwk", "element_type")[0] == "wall.external"
    assert index.candidates("Damp course", "material")[0] == "membrane.damp_proof"
    assert index.candidates("Bitumen felt", "material")[0] == "bituminous"
    # no word fits, but every element is an IfcWall and IsExternal says which kind
    assert index.candidates("Type A", "element_type", external=False, walls=True)[0] == "wall.internal"
    assert index.candidates("Type A", "element_type", external=True, walls=True)[0] == "wall.external"
    assert index.candidates("Type A", "element_type") == []
    assert UNSPECIFIED not in index.candidates("Default none", "other")
    assert len(index.candidates("concrete wall steel brick block", "material")) == 3


def layered(material: str) -> dict:
    parsed = doc(slab(layer_thickness=0.2), layer_thickness=0.2)
    parsed["catalogues"]["materials"][0]["name"] = material
    return parsed


def test_a_placeholder_layer_is_asked_without_blocking_and_suggests_not_relevant():
    r = run(layered("Default"))
    (q,) = [q for q in r["questions"] if q["id"] == "name:layer_material:Default"]
    assert q["blocking"] is False and q["suggestion"] == UNSPECIFIED and q["params"]["placeholder"] is True
    assert "looks like a placeholder" in q["message"]
    answered = run(layered("Default"), decisions=[{"questionId": q["id"], "answer": UNSPECIFIED}])
    assert q["id"] not in {x["id"] for x in answered["questions"]}


def test_a_blocking_name_answered_not_relevant_stops_blocking_and_is_logged():
    r = run(layered("Glurk 42"))
    (q,) = [q for q in r["questions"] if q["id"] == "name:layer_material:Glurk 42"]
    assert q["blocking"] is True and "suggestion" not in q
    answered = run(layered("Glurk 42"), decisions=[{"questionId": q["id"], "answer": UNSPECIFIED}])
    assert q["id"] not in {x["id"] for x in answered["questions"]}
    assert q["id"] in answered["answeredQuestionIds"]
    assert any(e.get("code") == "log.decision.answer_applied" and e["params"]["questionId"] == q["id"] for e in answered["log"])
