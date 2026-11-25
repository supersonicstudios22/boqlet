"""Review B-02: the adversarial corpus (tests/fixtures/adversarial, made by make.py). Every file has an asserted
outcome: a specific parse error code, or a run (strict invariants, conftest) whose lines and checks are known.
Nothing crashes with an unnamed exception and nothing is dropped: an element without geometry is a flagged line."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from ifc_boq import presets
from ifc_boq.parse import IfcFileError, parse_file
from ifc_boq.pipeline import get_boq

HERE = Path(__file__).parent / "fixtures" / "adversarial"
EXPECTED = {k: v for k, v in json.loads((HERE / "expected.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}


def test_every_file_has_an_expected_outcome():
    assert sorted(EXPECTED) == sorted(p.name for p in HERE.glob("*.ifc"))


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_outcome(name):
    want = EXPECTED[name]
    if "error" in want:
        with pytest.raises(IfcFileError) as caught:
            parse_file(str(HERE / name), overlaps=False)
        assert caught.value.code == want["error"]
        assert str(caught.value)                       # a message the app can show
        return
    doc, _ = parse_file(str(HERE / name), overlaps=False)
    assert sorted({c["code"] for c in doc["verification"]["checks"]}) == want["checks"]
    if "psets" in want:
        assert sorted(doc["elements"][0]["psets"]) == want["psets"]
    rules, library = presets.load_rule_set("as-modelled")
    result = get_boq(doc, rules, [], [presets.load_dictionary("global-seed")], presets.resolution(), [], library)
    got = {line["ruleId"]: line["quantity"] for line in result["lines"] if line["ruleId"] in want["lines"]}
    assert got == want["lines"]
    # rule 5: a line without a number is flagged, never left out
    assert result["stats"]["flaggedLines"] == sum(1 for line in result["lines"] if line["quantity"] is None or line.get("toConfirm"))
