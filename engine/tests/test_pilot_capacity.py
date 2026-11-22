"""The pilot's engine worker slots (ops/pilot/compose.yaml): runs and previews have their own (P54, Q61, TF-180)."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

COMPOSE = Path(__file__).resolve().parents[2] / "ops" / "pilot" / "compose.yaml"
REQUIRED = ("STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY", "DB_ADMIN_PASSWORD", "DB_PASSWORD", "QUEUE_PASSWORD",
            "IDENTITY_DB_PASSWORD", "IDENTITY_ADMIN_PASSWORD", "INVITATION_SECRET", "PILOT_RELEASE", "PILOT_STATE_DIR")
# The memory the Boqlet containers may take on the shared 24 GB pilot host (docs/operations/pilot.md "Worker capacity").
BUDGET = 12 * 1024 ** 3


@pytest.fixture(scope="module")
def services() -> dict:
    if not shutil.which("docker"):
        pytest.skip("docker compose resolves the pilot Compose file")
    env = {**os.environ, **{name: "x" for name in REQUIRED}}
    for name in [n for n in env if n.startswith("ENGINE_") or n in ("MAX_UPLOAD_MIB",)]:
        env.pop(name)                                       # the file's defaults, not this machine's settings
    done = subprocess.run(["docker", "compose", "-f", str(COMPOSE), "config", "--format", "json"],
                          capture_output=True, text=True, env=env, timeout=60)
    if done.returncode != 0 and "docker daemon" in done.stderr.lower():
        pytest.skip(done.stderr)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)["services"]


def test_runs_and_previews_have_a_worker_slot_of_their_own(services):
    api = services["api"]["environment"]
    workers = {name: s["environment"] for name, s in services.items() if s.get("command") == ["boqlet-worker"]}
    interactive = [name for name, env in workers.items() if env.get("ENGINE_QUEUE_TYPES") == "run,preview"]
    assert len(interactive) == 1, workers.keys()
    env = workers[interactive[0]]
    # It claims from the pool the API puts runs and previews in, and the other worker still takes every type.
    assert env["ENGINE_QUEUE_POOL"] == api["BOQLET_ENGINE_MODEL_POOL"]
    assert int(env["ENGINE_QUEUE_CONCURRENCY"]) >= 1
    assert any("ENGINE_QUEUE_TYPES" not in other for name, other in workers.items() if name != interactive[0])


def test_the_default_services_fit_the_memory_budget(services):
    started = [s for s in services.values() if not s.get("profiles")]
    assert all(int(s["mem_limit"]) > 0 for s in started)
    assert sum(int(s["mem_limit"]) for s in started) <= BUDGET
