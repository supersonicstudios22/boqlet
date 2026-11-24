"""
The unit registry (review A-28, ENG-010): units convert by their own factor (cm, l, mm2, in and g used to convert
by 1), the preset check refuses an unknown unit or one of the wrong dimension, and `minimum` is in the line unit.
"""
from __future__ import annotations

import copy
import json

import pytest

from ifc_boq import presets
from ifc_boq.paths import ROOT
from ifc_boq.pipeline import get_boq
from ifc_boq.rules import flatten
from ifc_boq.units import DIMENSION, PER_SI, UNITS


def run_with(parsed, *items):
    rs, lib = presets.load_rule_set("as-modelled")
    flat = copy.deepcopy(flatten(rs, {}))
    flat["items"] += list(items)
    return get_boq(copy.deepcopy(parsed), flat, [], [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)


def wall_item(rid, kind, unit, **extra):
    return {"id": rid, "label": rid, "match": {"ifcClass": "IfcWall"}, "quantity": {"kind": kind, "unit": unit},
            "lineKey": [], "description": rid, "claims": [rid], **extra}


def total(result, rid):
    """The element values of a rule's lines (lines are rounded to their step; elements to 6 decimals)."""
    return sum(e["quantity"] or 0 for l in result["lines"] if l["ruleId"] == rid for e in l["trace"]["elements"])


@pytest.mark.parametrize("kind,si,unit,factor", [
    ("length", "m", "cm", 100), ("length", "m", "in", 39.37007874), ("area", "m2", "cm2", 1e4), ("area", "m2", "mm2", 1e6),
    ("volume", "m3", "l", 1000),
])
def test_each_unit_converts_by_its_own_factor(duplex_parsed, kind, si, unit, factor):
    r = run_with(duplex_parsed, wall_item("si", kind, si), wall_item("other", kind, unit))
    assert total(r, "si") > 0
    assert total(r, "other") == pytest.approx(total(r, "si") * factor, rel=1e-5)


@pytest.mark.parametrize("kind,unit,words", [
    ("area", "cm", "measures length, but the quantity is a area"),
    ("length", "l", "measures volume"),
    ("count", "furlong", "not a known unit"),
])
def test_the_check_refuses_unknown_units_and_wrong_dimensions(kind, unit, words):
    rs, _ = presets.load_rule_set("as-modelled")
    doc = copy.deepcopy(rs)
    doc["items"].append(wall_item("odd", kind, unit))
    problems = [p for p in presets.check("rules", doc) if "'odd'" in p]
    assert problems and words in problems[0]


def test_shipped_rule_sets_pass_the_unit_check():
    for rid in ("as-modelled", "standard-style-example", "acme-house-rules", "demo-tweaked", "demo-custom"):
        rs, lib = presets.load_rule_set(rid)
        assert not [p for p in presets.check("rules", rs, list(lib.values())) if "unit" in p], rid


def test_minimum_is_stated_in_the_line_unit(duplex_parsed):
    r = run_with(duplex_parsed, wall_item("lengths", "length", "mm", minimum={"value": 100_000, "per": "element"}))
    parts = [e["quantity"] for l in r["lines"] if l["ruleId"] == "lengths" for e in l["trace"]["elements"]]
    assert parts and min(parts) == pytest.approx(100_000)      # 100 m, not 100,000 m


def test_every_registered_unit_has_a_label_in_the_app():
    labels = json.loads((ROOT / "apps" / "app" / "messages" / "en" / "units.json").read_text(encoding="utf-8"))
    assert set(UNITS) <= set(labels)
    assert all(PER_SI[u] > 0 and DIMENSION[u] for u in UNITS)
