"""The HTTP worker's shared secret (review A-36, DEC-64): with BOQLET_WORKER_TOKEN set, /jobs and /rpc need it."""
import pytest
from fastapi.testclient import TestClient

from ifc_boq import worker_http

TOKEN = "test-worker-token-0123456789abcdef"
JOB = {"jobId": "x", "type": "parse", "orgId": "o", "attempt": 1, "contract": "1", "input": {}, "outputPrefix": "p/"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv(worker_http.TOKEN_ENV, TOKEN)
    with TestClient(worker_http.app) as c:
        yield c


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN},
                                     {"Authorization": f"Basic {TOKEN}"}, {"Authorization": f"Bearer {TOKEN}x"}])
def test_jobs_and_rpc_refuse_a_caller_without_the_token(client, headers):
    for path, body in (("/jobs/parse", JOB), ("/rpc/check", {}), ("/rpc/no-such-op", {}), ("/jobs/no-such-job", {})):
        r = client.post(path, json=body, headers=headers)
        assert r.status_code == 401, (path, headers, r.status_code)
        assert r.headers["www-authenticate"] == "Bearer"


def test_the_token_lets_the_call_through(client):
    r = client.post("/rpc/check", json={"kind": "dictionaries", "doc": {}}, headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200 and r.json()["ok"] is False
    assert client.post("/rpc/no-such-op", json={}, headers={"Authorization": f"bearer {TOKEN}"}).status_code == 404


def test_health_needs_no_token_and_the_docs_are_off(client):
    assert client.get("/health").json()["ok"] is True
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_without_a_token_the_worker_keeps_the_network_boundary(monkeypatch):
    monkeypatch.delenv(worker_http.TOKEN_ENV, raising=False)
    with TestClient(worker_http.app) as c:
        assert c.post("/rpc/no-such-op", json={}).status_code == 404
