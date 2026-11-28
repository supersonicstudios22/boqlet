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
