"""A new model version keeps what the user decided (v1-3, v1-13; F05-AC2, F06-AC3, F08-AC2/AC3).

Duplex v1 -> v2 (`Ifc2x3_Duplex_Architecture_v2.ifc`: one partition wall removed, one door changed,
one window added). Answers and line edits are made on v1 and the same decisions are sent with v2,
as the API does."""
from io import BytesIO

import pytest
from openpyxl import load_workbook

from ifc_boq.export_xlsx import export
from ifc_boq.parse import parse_file
from ifc_boq.paths import FIXTURES
from test_duplex import run

PARTITION = "walls | Interior - Partition (92mm Stud) | False |  | m2"


@pytest.fixture(scope="module")
def v2():
    return parse_file(str(FIXTURES / "ifc" / "Ifc2x3_Duplex_Architecture_v2.ifc"))[0]


def answers(result):
    pick = {"contradiction": lambda q: "geometry",
            "unknown_name": lambda q: "non_physical" if "Roof" in q["id"] else "space.living"}
    return [{"questionId": q["id"], "scope": "project", "answer": pick[q["kind"]](q)} for q in result["questions"]]


def edit(key, **answer):
    return {"scope": "project", "questionId": f"override:{key}", "answer": answer}


def test_answers_on_v1_are_not_asked_again_on_v2_and_still_apply(duplex_parsed, v2):
    """F05-AC2 (TF-004): the same names in a new version ask nothing again."""
    first = run(duplex_parsed)
    decided = answers(first)
    assert {q["kind"] for q in first["questions"]} == {"contradiction", "unknown_name"} and decided
    assert run(duplex_parsed, decisions=decided)["questions"] == []
    unanswered, answered = run(v2), run(v2, decisions=decided)
    assert {q["id"] for q in unanswered["questions"]} == {q["id"] for q in first["questions"]}   # same ids across versions
    assert answered["questions"] == []
    party = next(key for key in {l["key"] for l in answered["lines"]} if key.startswith("walls | Party Wall"))
    by = lambda result: {l["key"]: l["quantity"] for l in result["lines"]}
    assert by(answered)[party] != by(unanswered)[party]                                    # "geometry" applied on v2


def test_every_kind_of_line_edit_survives_a_changed_model_version(duplex_parsed, v2):
    """F06-AC3, F08-AC3 (TF-008): quantity (with reason), text, unit, move and exclusion made on v1 apply on v2,
    the partition's edit over an engine value that changed with the model, and the Excel shows them."""
    first = run(duplex_parsed)
    lines = {l["key"]: l for l in first["lines"]}
    door = next(k for k, l in lines.items() if l["ruleId"] == "doors" and "0864" in k)
    window = next(k for k, l in lines.items() if l["ruleId"] == "windows")
    steel = next(k for k, l in lines.items() if l["ruleId"] == "steel-sections")
    slab = next(k for k, l in lines.items() if l["ruleId"] == "slabs")
    target = "D.02" if lines[slab]["codes"]["acme-cost-codes"]["code"] != "D.02" else "D.01"
    edits = [edit(PARTITION, quantity=117.04, reason="Site survey"),
             edit(door, description="Door 864 mm, edited text"),
             edit(steel, quantity=905, unit="kg", reason="Supplier list"),
             edit(slab, codes={"acme-cost-codes": target}),
             edit(window, excluded=True, reason="Client supplies")]
    result = run(v2, decisions=edits)
    after = {l["key"]: l for l in result["lines"]}
    assert not [q for q in result["questions"] if q["kind"] == "orphan_override"]
    partition = after[PARTITION]
    assert partition["quantity"] == 117.04 and partition["overridden"]["reason"] == "Site survey"
    assert partition["overridden"]["engineQuantity"] != lines[PARTITION]["quantity"]       # the model moved under the edit
    assert after[door]["description"] == "Door 864 mm, edited text"
    assert (after[steel]["quantity"], after[steel]["unit"]) == (905, "kg")
    assert after[slab]["codes"]["acme-cost-codes"]["code"] == target
    assert after[window].get("excluded") is True

    sheet = load_workbook(BytesIO(export(result, {"classifications": [{"id": "acme-cost-codes", "name": "Acme"}]})))["BoQ"]
    rows = {row[1]: row for row in sheet.iter_rows(min_row=6, values_only=True) if row[1]}
    assert "Door 864 mm, edited text" in rows
    partition_row = next(row for row in rows.values() if row[3] == 117.04)
    assert "Site survey" in (partition_row[7] or "")


def test_a_run_lists_the_questions_its_decisions_answered(duplex_parsed):
    """TF-137: the result names the questions that decisions answered, so a run's question list shows those
    and not every decision of the project; a decision for a question the run never raised is not one."""
    first = run(duplex_parsed)
    decided = answers(first) + [{"questionId": "name:space_name:Not in this model", "scope": "project", "answer": "space.living"}]
    result = run(duplex_parsed, decisions=decided)
    assert result["answeredQuestionIds"] == sorted(q["id"] for q in first["questions"])
    assert run(duplex_parsed)["answeredQuestionIds"] == []
