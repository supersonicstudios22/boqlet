"""Internal HTTP transport for worker jobs and RPCs.

`/jobs` and `/rpc` need `Authorization: Bearer <BOQLET_WORKER_TOKEN>` when the worker has a token (review A-36,
DEC-64): the API sends it (`boqlet.worker.token`), anything else gets 401. Without a token the worker keeps the
pilot's network-boundary control (P54 Q47) and says so at start; `/health` never needs it.
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from threading import Event

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from starlette.responses import StreamingResponse

from . import rpc
from .paths import CACHE
from .storage import LocalStorage, S3Storage, Storage
from .worker import JOB_TYPES, JobCancelled, execute, health

TOKEN_ENV = "BOQLET_WORKER_TOKEN"
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.slots = asyncio.Semaphore(max(1, int(os.environ.get("ENGINE_HTTP_CONCURRENCY", "1"))))
    if not os.environ.get(TOKEN_ENV):
        logger.warning("%s is not set: /jobs and /rpc accept calls without a credential", TOKEN_ENV)
    yield


def authorised(authorization: str | None = Header(default=None)) -> None:
    """The caller holds the worker token (constant-time compare); a no-op while none is configured."""
    token = os.environ.get(TOKEN_ENV, "")
    if not token:
        return
    scheme, _, given = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(given.strip().encode(), token.encode()):
        raise HTTPException(401, "A valid worker token is required", headers={"WWW-Authenticate": "Bearer"})


# An internal service: no interactive docs or schema to browse.
app = FastAPI(title="Boqlet engine worker", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.get("/health")(health)


@lru_cache(maxsize=1)
def storage() -> Storage:
    location = os.environ.get("ENGINE_STORAGE", "file://" + str(CACHE / "worker"))
    if location.startswith("file://"):
        return LocalStorage(Path(location[7:]))
    if location.startswith("s3://") and location[5:]:
        return S3Storage(location[5:], endpoint_url=os.environ.get("ENGINE_S3_ENDPOINT"))
    raise RuntimeError("ENGINE_STORAGE must be file://<directory> or s3://<bucket>")


@app.post("/jobs/{kind}", dependencies=[Depends(authorised)])
async def jobs(kind: str, envelope: dict, request: Request):
    if kind not in JOB_TYPES:
        raise HTTPException(404, "Unknown job type")
    if envelope.get("type") != kind or not envelope.get("jobId"):
        raise HTTPException(422, "The job type and id must match the envelope")
    backend = storage()

    async def stream():
        messages = asyncio.Queue()
        loop = asyncio.get_running_loop()
        cancelled = Event()

        def progress(stage, pct, message):
            if cancelled.is_set():
                raise JobCancelled()
            loop.call_soon_threadsafe(messages.put_nowait, {
                "jobId": envelope["jobId"], "stage": stage, "pct": pct, "message": message,
            })

        async def run():
            async with request.app.state.slots:
                if not cancelled.is_set():
                    result = await asyncio.to_thread(execute, envelope, backend, progress)
                    messages.put_nowait(result)

        task = asyncio.create_task(run())
        try:
            while True:
                message = await messages.get()
                yield (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")
                if "status" in message:
                    break
        finally:
            cancelled.set()
            # Keep the slot occupied until an in-flight engine call reaches its next checkpoint.
            if task.done():
                task.result()

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.post("/rpc/{op}", dependencies=[Depends(authorised)])
def invoke(op: str, request: dict):
    if op not in rpc.OPERATIONS:
        raise HTTPException(404, "Unknown RPC operation")
    try:
        return rpc.call(op, request, storage())
    except FileNotFoundError as exc:
        raise HTTPException(404, "RPC input was not found") from exc
    except rpc.Busy as exc:
        raise HTTPException(503, str(exc), headers={"Retry-After": "5"}) from exc
    except (KeyError, TypeError, ValueError, RecursionError) as exc:
        # bad input is the caller's (422 -> the API's 400 engine_input), never an outage (review A-27)
        raise HTTPException(422, str(exc) if not isinstance(exc, RecursionError) else "The input is nested too deeply") from exc
