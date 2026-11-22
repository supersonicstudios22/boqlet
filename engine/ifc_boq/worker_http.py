"""Internal HTTP transport for worker jobs and RPCs."""
from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from threading import Event

from fastapi import FastAPI, HTTPException, Request
from starlette.responses import StreamingResponse

from . import rpc
from .paths import CACHE
from .storage import LocalStorage, S3Storage, Storage
from .worker import JOB_TYPES, JobCancelled, execute, health

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.slots = asyncio.Semaphore(max(1, int(os.environ.get("ENGINE_HTTP_CONCURRENCY", "1"))))
    yield


app = FastAPI(title="Boqlet engine worker", lifespan=lifespan)
app.get("/health")(health)


@lru_cache(maxsize=1)
def storage() -> Storage:
    location = os.environ.get("ENGINE_STORAGE", "file://" + str(CACHE / "worker"))
    if location.startswith("file://"):
        return LocalStorage(Path(location[7:]))
    if location.startswith("s3://") and location[5:]:
        return S3Storage(location[5:], endpoint_url=os.environ.get("ENGINE_S3_ENDPOINT"))
    raise RuntimeError("ENGINE_STORAGE must be file://<directory> or s3://<bucket>")


@app.post("/jobs/{kind}")
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


@app.post("/rpc/{op}")
def invoke(op: str, request: dict):
    if op not in rpc.OPERATIONS:
        raise HTTPException(404, "Unknown RPC operation")
    try:
        return rpc.call(op, request, storage())
    except FileNotFoundError as exc:
        raise HTTPException(404, "RPC input was not found") from exc
    except rpc.Busy as exc:
        raise HTTPException(503, str(exc), headers={"Retry-After": "5"}) from exc
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
