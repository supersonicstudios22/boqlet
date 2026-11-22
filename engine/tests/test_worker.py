import json
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from conftest import DUPLEX
from ifc_boq import presets, worker_http
from ifc_boq.storage import LocalStorage, read_json_gzip
from ifc_boq.worker import execute
from test_duplex import HAND_BOQ, q


def envelope(kind, data, prefix):
    return {"jobId": kind + "-1", "type": kind, "orgId": "test", "attempt": 1, "contract": "1",
            "input": data, "outputPrefix": prefix}


def test_worker_duplex_http(tmp_path, monkeypatch):
    storage = LocalStorage(tmp_path)
    monkeypatch.setattr(worker_http, "storage", lambda: storage)
    storage.put_file("uploads/source.ifc", DUPLEX)
    with TestClient(worker_http.app) as client:
        parsed = client.post("/jobs/parse", json=envelope("parse", {
            "modelVersionId": "duplex", "sourceKey": "uploads/source.ifc", "fileName": DUPLEX.name,
        }, "parsed/duplex/"))
        assert parsed.headers["content-type"].startswith("application/x-ndjson")
        events = [json.loads(line) for line in parsed.text.splitlines()]
        stages = [event["stage"] for event in events[:-1]]
        assert [s for i, s in enumerate(stages) if i == 0 or s != stages[i - 1]] == ["download", "read", "geometry", "verify", "write"]
        assert events[-1]["status"] == "succeeded", events[-1]
        artifacts = events[-1]["output"]["artifacts"]
        assert all(storage.exists(key) for key in artifacts.values())
        assert storage.get_bytes(artifacts["geometryKey"]).startswith(b"glTF")

        code_list, mapping = presets.load_classification("acme-cost-codes")
        trades, trade_map = presets.load_classification("demo-trades")
        rules, _ = presets.load_rule_set("as-modelled")
        job = envelope("run", {
            "models": [{"id": "duplex", **artifacts}], "ruleSet": {"doc": rules},
            "classifications": [{"codeList": code_list, "map": mapping}, {"codeList": trades, "map": trade_map}],
            "dictionaries": [presets.load_dictionary("global-seed")],
            "resolution": presets.resolution(), "federation": presets.federation(),
            "manualItems": [{"id": "site-hoarding", "kind": "preliminary", "description": "Site hoarding",
                             "unit": "m", "quantity": 42, "codes": {code_list["id"]: "D.02"}}],
            "export": {"xlsx": True},
        }, "runs/duplex/")
        result = execute(job, storage)
        assert result["status"] == "succeeded", result
        doc = read_json_gzip(storage, result["output"]["resultKey"])
        for rule_id, contains, expected, _ in HAND_BOQ:
            assert q(doc, rule_id, contains) == pytest.approx(expected, rel=2e-3, abs=0.011)
        manual = next(line for line in doc["lines"] if line["key"] == "site-hoarding")
        assert manual["ruleId"] == "boq.site-hoarding"
        assert manual["codes"][code_list["id"]]["code"] == "D.02"
        assert manual["codes"][code_list["id"]]["source"] == "item"
        assert manual["codes"][trades["id"]]["code"] == "00"
        assert manual["codes"][trades["id"]]["source"] == "map"
        assert storage.get_bytes(result["output"]["xlsxKey"]).startswith(b"PK")
        verify_edit_round_trip(storage, result["output"]["resultKey"], code_list)

        draft, _ = presets.load_rule_set("demo-tweaked")
        preview = execute(envelope("preview", {**job["input"],
            "ruleSet": {"doc": draft, "library": [rules]}, "compareWith": {"doc": rules},
        }, "previews/duplex/"), storage)
        assert preview["status"] == "succeeded", preview
        changes = read_json_gzip(storage, preview["output"]["diffKey"])["changes"]
        assert any(change["change"] == "changed" and change["after"]["ruleId"] == "walls" for change in changes)
        assert all(change.get("before") != change.get("after") for change in changes)
        assert not storage.exists("previews/duplex/boq.xlsx")

        check = client.post("/rpc/check", json={"kind": "rules", "doc": rules})
        assert check.json()["problems"] == presets.check("rules", rules)
        assert client.get("/health").json()["contract"] == "1"


def test_worker_rejects_unknown_contract_and_unsafe_storage_keys(tmp_path):
    storage = LocalStorage(tmp_path)
    job = envelope("parse", {}, "../outside/")
    assert execute(job, storage)["error"]["code"] == "invalid_input"
    assert execute({**job, "contract": "2"}, storage)["error"]["code"] == "contract_mismatch"


def verify_edit_round_trip(storage, result_key, code_list):
    exported = execute(envelope("export_xlsx", {"resultKey": result_key, "meta": {
        "boqId": "duplex-boq", "project": "Duplex", "boq": "Tender", "revision": "A", "status": "working",
        "watermark": True, "classifications": [{"id": code_list["id"], "name": code_list["name"]}],
        "positionNumbers": {"site-hoarding": "D.02.1"},
    }}, "exports/tender"), storage)
    assert exported["status"] == "succeeded", exported
    workbook = load_workbook(BytesIO(storage.get_bytes(exported["output"]["xlsxKey"])))
    assert workbook.active.title == "Cover"
    sheet = workbook["BoQ"]
    assert "WORKING" in sheet["A1"].value
    assert sheet.protection.sheet and sheet.column_dimensions["I"].hidden
    assert workbook["_boqlet"].sheet_state == "veryHidden"
    rows = [(row, sheet.cell(row, 9).value) for row in range(6, sheet.max_row + 1) if sheet.cell(row, 9).value]
    assert sheet.cell(dict((key, row) for row, key in rows)["site-hoarding"], 10).value == "D.02.1"
    (quantity, quantity_key), (move, move_key), (remove, removed_key), (invalid, _) = rows[:4]
    assert not sheet.cell(quantity, 4).protection.locked and sheet.cell(quantity, 9).protection.locked
    sheet.cell(quantity, 4, 100.5)
    sheet.cell(move, 1, "D.02")
    for column in range(1, 5):
        sheet.cell(remove, column).value = None
    sheet.cell(invalid, 4, "not numeric")
    sheet.append(["D.02", "New allowance", "m", 7])
    edited = BytesIO()
    workbook.save(edited)
    storage.put_bytes("imports/tender.xlsx", edited.getvalue())
    imported = execute(envelope("import_boq_edits", {
        "fileKey": "imports/tender.xlsx", "resultKey": result_key, "boqId": "duplex-boq",
    }, "imports/report"), storage)
    assert imported["status"] == "succeeded", imported
    report = read_json_gzip(storage, imported["output"]["reportKey"])
    by_key = {entry["edit"]["lineKey"]: entry for entry in report["overrides"]}
    assert by_key[quantity_key]["edit"]["quantity"] == 100.5
    assert by_key[move_key]["edit"]["codes"] == {code_list["id"]: "D.02"}
    assert by_key[removed_key]["edit"]["excluded"]
    assert len(by_key) == 3
    assert report["manualItems"][0]["item"]["item"]["quantity"] == 7
    assert report["problems"][0] == {"sheet": "BoQ", "row": invalid, "column": "D", "message": '"not numeric" is not a number.'}


def test_parse_errors_use_the_version_error_codes(tmp_path, monkeypatch):
    """TF-037: state-machines.md ModelVersion failed.error.code: too_large, parse_timeout (retryable once)."""
    from ifc_boq import worker_queue
    storage = LocalStorage(tmp_path)
    storage.put_file("uploads/source.ifc", DUPLEX)
    monkeypatch.setenv("ENGINE_MAX_MODEL_MB", "0")
    failed = execute(envelope("parse", {"modelVersionId": "v", "sourceKey": "uploads/source.ifc", "fileName": "a.ifc"}, "p/"), storage)
    assert failed["error"]["code"] == "too_large", failed
    first = worker_queue._timeout({"jobId": "j", "type": "parse", "attempt": 1})
    second = worker_queue._timeout({"jobId": "j", "type": "parse", "attempt": 2})
    assert first["error"]["code"] == second["error"]["code"] == "parse_timeout"
    assert first["error"]["retryable"] and not second["error"]["retryable"]
    assert worker_queue._timeout({"jobId": "j", "type": "run", "attempt": 1})["error"]["code"] == "engine_timeout"


def test_a_preview_reuses_its_models_and_inputs_and_answers_what_two_runs_answer(tmp_path, monkeypatch):
    """TF-134: a wizard preview (two runs on one Duplex) loads the models once, checks a document it has
    seen once, and its results are those of the two runs made apart."""
    from ifc_boq import worker
    storage = LocalStorage(tmp_path)
    storage.put_file("uploads/source.ifc", DUPLEX)
    parsed = execute(envelope("parse", {"modelVersionId": "v", "sourceKey": "uploads/source.ifc", "fileName": DUPLEX.name}, "m/"), storage)
    rules, library = presets.load_rule_set("demo-tweaked")
    base, _ = presets.load_rule_set("as-modelled")
    job = {"models": [{"id": "v", **parsed["output"]["artifacts"]}], "ruleSet": {"doc": rules, "library": list(library.values())},
           "dictionaries": [presets.load_dictionary("global-seed")], "resolution": presets.resolution(), "federation": presets.federation()}
    loads, checks = [], []
    real_load, real_validator = worker._load_models, worker._validator
    monkeypatch.setattr(worker, "_load_models", lambda *a: loads.append(1) or real_load(*a))
    monkeypatch.setattr(worker, "_validator", lambda name: checks.append(name) or real_validator(name))
    preview = execute(envelope("preview", {**job, "compareWith": {"doc": base, "library": list(library.values())}}, "p/"), storage)
    assert preview["status"] == "succeeded", preview
    assert len(loads) == 1 and "boq-result" not in checks
    assert checks.count("rule-set") <= len({d["id"] for d in [rules, base, *library.values()]})   # each document once at most
    monkeypatch.undo()
    after = read_json_gzip(storage, preview["output"]["resultKey"])
    before = read_json_gzip(storage, preview["output"]["compareResultKey"])
    for result, doc in ((after, rules), (before, base)):
        alone = execute(envelope("run", {**job, "ruleSet": {"doc": doc, "library": list(library.values())}}, f"r/{doc['id']}/"), storage)
        expected = read_json_gzip(storage, alone["output"]["resultKey"])
        assert [(l["key"], l["quantity"]) for l in result["lines"]] == [(l["key"], l["quantity"]) for l in expected["lines"]]


def test_an_invalid_document_is_refused_every_time(monkeypatch):
    from ifc_boq import worker
    bad = {"schemaVersion": "1.0", "id": "x"}
    for _ in range(2):
        with pytest.raises(ValueError, match="dictionary"):
            worker.validate(bad, "dictionary")


def test_a_run_refuses_a_model_scope_with_a_typo(tmp_path):
    """TF-074: `exlude` was ignored and the furniture measured."""
    storage = LocalStorage(tmp_path)
    rules, _ = presets.load_rule_set("as-modelled")
    job = {"models": [{"id": "v", "name": "Architecture", "parsedKey": "missing.json.gz", "scope": {"exlude": [{"ifcClass": "IfcFurnishingElement"}]}}],
           "ruleSet": {"doc": rules}}
    failed = execute(envelope("run", job, "r/"), storage)
    assert failed["status"] == "failed" and failed["error"]["code"] == "invalid_input" and "exlude" in failed["error"]["message"]


def test_the_edits_import_checks_refs_against_the_workbooks_own_grouping():
    """TF-051 follow-up: `groupCodesBySystem[groupBy]` (the grouping the workbook was exported with), else `groupCodes`."""
    from ifc_boq.worker import _group_codes
    job = {"groupBy": "trades", "groupCodes": ["A.01"], "groupCodesBySystem": {"acme": ["A.01"], "trades": ["01", "02"]}}
    assert _group_codes(job) == ["01", "02"]
    assert _group_codes({**job, "groupBy": "other"}) == ["A.01"]
    assert _group_codes({"groupCodes": ["A.01"]}) == ["A.01"]
