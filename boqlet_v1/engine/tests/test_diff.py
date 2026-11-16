import json
from pathlib import Path
from time import monotonic

import pytest

from ifc_boq.diff import compare
from ifc_boq.parse import parse_file
from ifc_boq.paths import FIXTURES
from ifc_boq.worker import validate
from test_duplex import run


def test_duplex_revision_matches_known_changes(duplex_parsed):
    changed, _ = parse_file(str(FIXTURES / "ifc" / "Ifc2x3_Duplex_Architecture_v2.ifc"))
    first, second = run(duplex_parsed), run(changed)
    def model(parsed, result, version):
        return [{"name": "Architecture", "modelId": "arch", "parsed": parsed,
                 "traceId": result["models"][0]["id"], "versionId": version}]

    result = compare(first, second, model(duplex_parsed, first, "1"), model(changed, second, "2"),
                     inputs_changed=["inputs.models"])
    validate(result, "run-diff")
    expected = json.loads((Path(__file__).parent / "fixtures/duplex_v1_v2_diff.json").read_text(encoding="utf8"))
    assert {key: result["summary"][key] for key in expected["summary"]} == expected["summary"]
    assert {item["guid"]: item["change"] for item in result["elements"]} == expected["elements"]
    actual = {item["lineKey"]: item for item in result["lines"]}
    assert actual.keys() == expected["lines"].keys()
    for key, (delta, cause) in expected["lines"].items():
        assert actual[key]["delta"] == pytest.approx(delta, abs=0.011)
        assert actual[key]["causes"] == [cause]


def test_large_diff_compares_40000_lines_under_five_seconds():
    lines = [{"key": str(i), "ruleId": "walls", "ruleKind": "item", "description": f"Wall {i}",
              "quantity": i, "unit": "m2", "codes": {}} for i in range(40_000)]
    start = monotonic()
    base = {"lines": lines}
    unchanged = compare(base, base)
    assert unchanged["summary"]["linesUnchanged"] == 40_000
    changed = compare(base, {"lines": [{**lines[0], "quantity": 1}, *lines[1:]]})
    assert changed["summary"]["linesChanged"] == 1
    assert monotonic() - start < 5
