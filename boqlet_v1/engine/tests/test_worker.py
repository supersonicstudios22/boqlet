import json

import pytest
from fastapi.testclient import TestClient

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
        assert [event["stage"] for event in events[:-1]] == ["download", "read", "geometry", "verify", "write"]
        assert events[-1]["status"] == "succeeded", events[-1]
        artifacts = events[-1]["output"]["artifacts"]
        assert all(storage.exists(key) for key in artifacts.values())
        assert storage.get_bytes(artifacts["geometryKey"]).startswith(b"glTF")

        code_list, mapping = presets.load_classification("acme-cost-codes")
        rules, _ = presets.load_rule_set("as-modelled")
        job = envelope("run", {
            "models": [{"id": "duplex", **artifacts}], "ruleSet": {"doc": rules},
            "classifications": [{"codeList": code_list, "map": mapping}],
            "dictionaries": [presets.load_dictionary("global-seed")],
            "resolution": presets.resolution(), "federation": presets.federation(),
            "export": {"xlsx": True},
        }, "runs/duplex/")
        result = execute(job, storage)
        assert result["status"] == "succeeded", result
        doc = read_json_gzip(storage, result["output"]["resultKey"])
        for rule_id, contains, expected, _ in HAND_BOQ:
            assert q(doc, rule_id, contains) == pytest.approx(expected, rel=2e-3, abs=0.011)
        assert storage.get_bytes(result["output"]["xlsxKey"]).startswith(b"PK")

        check = client.post("/rpc/check", json={"kind": "rules", "doc": rules})
        assert check.json()["problems"] == presets.check("rules", rules)
        assert client.get("/health").json()["contract"] == "1"


def test_worker_rejects_unknown_contract_and_unsafe_storage_keys(tmp_path):
    storage = LocalStorage(tmp_path)
    job = envelope("parse", {}, "../outside/")
    assert execute(job, storage)["error"]["code"] == "invalid_input"
    assert execute({**job, "contract": "2"}, storage)["error"]["code"] == "contract_mismatch"
