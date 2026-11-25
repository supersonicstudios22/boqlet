"""
Breakdowns (review A-24, ENG-004): the parts of an element measured by layer, material, face or child add up
to the element. Material groups used to keep the element's whole gross volume each (Duplex walls 1,094 m3 for
240 m3 of walls). Parts are layer area x layer thickness, so a notched wall's parts are a little more than its
solid (DEC-87): the engine logs that (`log.quantity.parts_volume`).
"""
from __future__ import annotations

import copy
from collections import defaultdict

import pytest

from ifc_boq import presets
from ifc_boq.pipeline import get_boq
from ifc_boq.rules import flatten


def run_with(parsed, *items):
    rs, lib = presets.load_rule_set("as-modelled")
    flat = copy.deepcopy(flatten(rs, {}))
    flat["items"] += list(items)
    return get_boq(copy.deepcopy(parsed), flat, [], [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)


def walls_by(breakdown: str, start: str = "gross", kind: str = "volume", unit: str = "m3") -> dict:
    return {"id": f"walls-by-{breakdown}", "label": f"Walls by {breakdown}", "match": {"ifcClass": "IfcWall"},
            "quantity": {"kind": kind, "start": start, "unit": unit}, "breakdown": breakdown, "lineKey": [],
            "description": breakdown, "claims": [f"check-{breakdown}"]}


def per_element(result, rule_id) -> dict[str, float]:
    out = defaultdict(float)
    for line in result["lines"]:
        if line["ruleId"] == rule_id:
            for e in line["trace"]["elements"]:
                out[e["guid"]] += e["quantity"] or 0
    return out


@pytest.fixture(scope="module")
def duplex_breakdowns(duplex_parsed):
    return run_with(duplex_parsed, walls_by("element"), walls_by("layer"), walls_by("material"))


def test_material_groups_add_up_like_layers_not_n_times_the_element(duplex_breakdowns):
    whole = per_element(duplex_breakdowns, "walls-by-element")
    layers, materials = per_element(duplex_breakdowns, "walls-by-layer"), per_element(duplex_breakdowns, "walls-by-material")
    assert sum(whole.values()) == pytest.approx(239.76, abs=0.01)
    # each material its own share: the groups add up to the layers (243.70 m3), not 1,094 m3
    assert sum(materials.values()) == pytest.approx(sum(layers.values()), abs=1e-4)
    assert sum(materials.values()) == pytest.approx(243.70, abs=0.01)
    for g in whole:
        assert materials[g] == pytest.approx(layers[g], abs=1e-5), g


def test_parts_add_up_to_the_element_except_notched_walls_which_are_logged(duplex_breakdowns):
    whole = per_element(duplex_breakdowns, "walls-by-element")
    layers = per_element(duplex_breakdowns, "walls-by-layer")
    off = {g for g, v in whole.items() if abs(layers[g] / v - 1) > 0.02}
    assert 0 < len(off) <= 4                     # the Duplex's notched walls (DEC-87)
    assert all(layers[g] == pytest.approx(v, rel=0.02) for g, v in whole.items() if g not in off)
    logged = {e["guid"] for e in duplex_breakdowns["log"] if e.get("code") == "log.quantity.parts_volume"}
    assert off <= logged


def measured(parsed) -> dict[str, dict]:
    from ifc_boq.log import CalcLog
    from ifc_boq.measure import build
    from ifc_boq.names import Resolver
    out, _ = build(copy.deepcopy(parsed), Resolver([presets.load_dictionary("global-seed")], presets.resolution()), CalcLog())
    return {e["guid"]: e for e in out}


def test_face_parts_add_up_to_the_element_faces(duplex_parsed):
    r = run_with(duplex_parsed, walls_by("face", start="gross", kind="area", unit="m2"))
    faces = per_element(r, "walls-by-face")
    els = measured(duplex_parsed)
    assert faces
    for g, v in faces.items():
        assert v == pytest.approx(sum(f["gross_area"] or 0 for f in els[g]["faces"]), abs=1e-5), g


def test_child_parts_add_up_to_a_rolled_up_aggregate(duplex_parsed):
    """An aggregate without a body of its own (the Duplex roofs and stairs) is the sum of its parts."""
    item = {"id": "aggregates-by-child", "label": "Aggregates by part", "match": {"ifcClass": ["IfcRoof", "IfcStair"]},
            "quantity": {"kind": "volume", "start": "net", "unit": "m3"}, "breakdown": "child", "lineKey": [],
            "description": "child", "claims": ["check-child"]}
    r = run_with(duplex_parsed, item)
    parts = defaultdict(float)
    els = measured(duplex_parsed)
    for line in r["lines"]:
        if line["ruleId"] == "aggregates-by-child":
            for e in line["trace"]["elements"]:
                parts[els[e["guid"]].get("parent_guid") or e["guid"]] += e["quantity"] or 0
    rolled = {g: e for g, e in els.items() if e["ifc_class"] in ("IfcRoof", "IfcStair") and e.get("child_guids")
              and e["provenance"].get("net_volume") == "derived"}
    assert rolled
    for g, e in rolled.items():
        assert parts[g] == pytest.approx(e["net_volume"], abs=1e-5), g


# ------------------------------------------------------------------ missing values asked per element (review A-25)
def test_a_missing_value_is_asked_once_per_element_and_the_answer_fills_every_part(duplex_parsed):
    """ENG-003: a layer breakdown with onMissing "ask" raised one `missing:{rule}:{guid}` per layer, 50 duplicate
    ids on the Duplex, and the API could not store the run. One question per element now, its occurrences the
    parts; the answer is used for each part that has no value."""
    item = {"id": "wall-mass", "label": "Wall mass", "match": {"ifcClass": "IfcWall"}, "breakdown": "layer",
            "quantity": {"kind": "mass", "basis": "reported", "unit": "kg"}, "onMissing": "ask", "lineKey": [],
            "description": "Wall mass", "claims": ["mass"]}
    r = run_with(duplex_parsed, item)
    asked = [q for q in r["questions"] if q["id"].startswith("missing:wall-mass:")]
    ids = [q["id"] for q in asked]
    assert asked and len(ids) == len(set(ids))
    assert all(q["id"] == f"missing:wall-mass:{q['guids'][0]}" for q in asked)
    assert any(q["occurrences"] > 1 for q in asked)                    # layered walls: one question, several parts
    every = [q["id"] for q in r["questions"]]
    assert len(every) == len(set(every))
    q = next(q for q in asked if q["occurrences"] > 1)
    flat, classes, dicts, resolution = _flat_with(item)
    rs, lib = presets.load_rule_set("as-modelled")
    r2 = get_boq(copy.deepcopy(duplex_parsed), flat, classes, dicts, resolution,
                 [{"questionId": q["id"], "scope": "project", "answer": 10}], lib)
    parts = [e for l in r2["lines"] if l["ruleId"] == "wall-mass" for e in l["trace"]["elements"] if e["guid"] == q["guids"][0]]
    assert len(parts) == q["occurrences"] and all(e["quantity"] == pytest.approx(10) for e in parts)
    assert q["id"] not in {x["id"] for x in r2["questions"]}


def _flat_with(*items):
    rs, lib = presets.load_rule_set("as-modelled")
    flat = copy.deepcopy(flatten(rs, {}))
    flat["items"] += list(items)
    return flat, [], [presets.load_dictionary("global-seed")], presets.resolution()


def test_question_ids_are_unique_in_every_result(duplex_breakdowns):
    ids = [q["id"] for q in duplex_breakdowns["questions"]]
    assert len(ids) == len(set(ids))
