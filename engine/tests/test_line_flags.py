"""
Lines that need a look although they have a quantity (review WP-A2, A-05): some elements without a value
("2 of 3 elements measured"), or a quantity resting on an open contradiction question. They carry
`toConfirm`, count in `stats.flaggedLines` and are yellow in the Excel. Synthetic documents from
test_reported_quantities.py.
"""
from __future__ import annotations

import copy

import pytest
from openpyxl import load_workbook

from ifc_boq import presets
from ifc_boq.export_xlsx import export
from ifc_boq.pipeline import get_boq
from test_reported_quantities import doc, review_sample, sample_lines, slab


def run(parsed: dict, decisions: list | None = None) -> dict:
    rs, lib = presets.load_rule_set("as-modelled")
    return get_boq(parsed, rs, [], [presets.load_dictionary("global-seed")], presets.resolution(), decisions or [], lib)


def three_slabs(missing: int = 1) -> dict:
    """Three slabs of one type (one line); `missing` of them without any geometry or reported quantity."""
    els = [slab({"BaseQuantities": {"GrossArea": 50.0}}, guid=f"slab-{i}", name=f"Floor:Test:{i}") for i in range(3)]
    for el in els[:missing]:
        el["quantities"] = {"reported": {}, "geometry": {"hasBody": False}}
    return doc(*els)


def slab_area_line(result: dict) -> dict:
    (line,) = [l for l in result["lines"] if l["ruleId"] == "slabs" and l["unit"] == "m2"]
    return line


def test_a_line_with_an_element_without_value_is_to_confirm():
    r = run(three_slabs(missing=1))
    line = slab_area_line(r)
    assert line["quantity"] == pytest.approx(100.0) and line["source"] == "measured"
    assert line["toConfirm"] == {"measured": 2, "elements": 3}
    assert r["stats"]["flaggedLines"] >= 1


def test_a_line_with_every_element_measured_is_unchanged():
    line = slab_area_line(run(three_slabs(missing=0)))
    assert "toConfirm" not in line and line["quantity"] == pytest.approx(150.0)


def test_a_line_fed_by_an_open_contradiction_is_to_confirm_until_answered():
    el = slab({"BaseQuantities": {"GrossArea": 50.0, "NetVolume": 13.0}}, layer_thickness=0.2)   # mesh 10 m3: +30 %
    parsed = doc(el, layer_thickness=0.2)
    qid = "contradiction:volume:IfcSlab:Test floor"
    r = run(copy.deepcopy(parsed))
    fed = [l for l in r["lines"] if l.get("toConfirm")]
    assert fed and all(l["toConfirm"]["questions"] == [qid] for l in fed)
    answered = run(copy.deepcopy(parsed), decisions=[{"questionId": qid, "scope": "project", "answer": "reported"}])
    assert not [l for l in answered["lines"] if l.get("toConfirm")]


def test_a_quantity_edit_confirms_the_line():
    r = run(three_slabs(missing=1))
    key = slab_area_line(r)["key"]
    edited = run(three_slabs(missing=1), decisions=[{"questionId": f"override:{key}", "scope": "project",
                                                     "answer": {"quantity": 150.0, "reason": "Site survey"}}])
    line = next(l for l in edited["lines"] if l["key"] == key)
    assert line["quantity"] == pytest.approx(150.0) and "toConfirm" not in line


def test_the_excel_shows_a_line_to_confirm_in_yellow_with_the_reason(tmp_path):
    r = run(three_slabs(missing=1))
    out = tmp_path / "boq.xlsx"
    out.write_bytes(export(r, {}))
    ws = load_workbook(out)["BoQ"]
    row = next(row for row in ws.iter_rows() if row[2].value == "m2" and row[3].value == pytest.approx(100.0))
    assert row[1].fill.fgColor.rgb.endswith("FFF2CC")
    assert "To confirm: 2 of 3 elements measured" in (row[7].value or "")


@pytest.mark.slow
def test_s09_external_wall_is_two_of_three_measured():
    """A-05 acceptance (QS-008): S09 "Wall, Wall-Ext…" 44.13 m2 from 2 of its 3 walls is to confirm."""
    r = sample_lines(review_sample("S09-samplehouse-ifc4.ifc"))
    (wall,) = [l for l in r["lines"] if l["ruleId"] == "walls" and "Wall-Ext" in l["description"]]
    assert wall["toConfirm"]["measured"] == 2 and wall["toConfirm"]["elements"] == 3


def test_an_aggregate_measured_from_its_parts_inherits_their_open_questions():
    """A roof without a body of its own takes its area from its slabs; a slab's open area question reaches the roof line."""
    part = slab({"Qto_SlabBaseQuantities": {"NetArea": 2 * 50.0 + 2 * 15.0 * 0.2}}, guid="roof-slab", type_name="Roof slab")
    part["parentId"] = "roof-1"
    roof = {**slab({}, guid="roof-1", cls="IfcRoof", name="Roof", type_name="Roof"), "childIds": ["roof-slab"]}
    roof["quantities"] = {"reported": {}, "geometry": {"hasBody": False}}
    r = run(doc(roof, part))
    roof_lines = [l for l in r["lines"] if any(e["guid"] == "roof-1" for e in l["trace"]["elements"])]
    assert roof_lines and all(l["toConfirm"]["questions"] == ["contradiction:area:IfcSlab:Roof slab"] for l in roof_lines)
