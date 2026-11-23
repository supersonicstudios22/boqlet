"""
Decisions that change a number are counted and named on the line (review WP-A2, A-06, QS-010): answering the
Duplex party wall's two contradictions with "geometry" moves its line, so `stats.decisionsApplied` counts both,
the line's trace names them with who answered and when, and the Excel says so.
"""
from __future__ import annotations

import io

import pytest
from openpyxl import load_workbook

from ifc_boq import presets
from ifc_boq.export_xlsx import export
from ifc_boq.pipeline import get_boq

PARTY = "contradiction:{}:IfcWall:Party Wall - CMU Residential Unit Dimising Wall"
ANSWERS = [{"questionId": PARTY.format(what), "scope": "project", "answer": "geometry",
            "decidedBy": "Ana Estimator", "decidedAt": "2026-11-23T09:30:00Z"} for what in ("volume", "thickness")]


def run(parsed, decisions):
    rs, lib = presets.load_rule_set("as-modelled")
    return get_boq(parsed, rs, [presets.load_classification("acme-cost-codes")], [presets.load_dictionary("global-seed")],
                   presets.resolution(), decisions, lib)


@pytest.fixture(scope="module")
def answered(duplex_parsed):
    return run(duplex_parsed, ANSWERS)


def party_line(result):
    return next(l for l in result["lines"] if l["ruleId"] == "walls" and "Party Wall" in l["description"])


def test_every_decision_the_run_used_is_counted(duplex_parsed, answered):
    assert run(duplex_parsed, [])["stats"]["decisionsApplied"] == 0
    assert answered["stats"]["decisionsApplied"] == 2
    assert set(answered["answeredQuestionIds"]) == {PARTY.format("volume"), PARTY.format("thickness")}


def test_the_party_wall_line_names_both_decisions_with_author_and_date(answered):
    line = party_line(answered)
    named = {d["questionId"]: d for e in line["trace"]["elements"] for d in e.get("decisions", [])}
    assert set(named) == {PARTY.format("volume"), PARTY.format("thickness")}
    assert all(d["answer"] == "geometry" and d["by"] == "Ana Estimator" and d["at"] == "2026-11-23T09:30:00Z"
               for d in named.values())


def test_a_decision_without_metadata_is_still_named(duplex_parsed):
    bare = [{k: v for k, v in d.items() if k not in ("decidedBy", "decidedAt")} for d in ANSWERS]
    line = party_line(run(duplex_parsed, bare))
    decisions = [d for e in line["trace"]["elements"] for d in e.get("decisions", [])]
    assert decisions and all(set(d) == {"questionId", "answer"} for d in decisions)


def test_the_excel_counts_the_decisions_and_names_them_per_element(answered):
    wb = load_workbook(io.BytesIO(export(answered, {"decisions": ANSWERS})))
    inputs = {row[0].value: row[1].value for row in wb["Inputs"].iter_rows() if row[0].value}
    assert inputs["Decisions applied"] == 2
    notes = [row[3].value or "" for row in wb["Calculation"].iter_rows()]
    assert any(f"per decision {PARTY.format('volume')} = \"geometry\" (Ana Estimator, 2026-11-23)" in n for n in notes)
