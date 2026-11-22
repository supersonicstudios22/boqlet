"""PostgreSQL queue consumer. IFC work runs in a child process for each lease."""
from __future__ import annotations

import argparse
import json
import logging
import multiprocessing
import os
import signal
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

from .worker import JOB_TYPES

LOG = logging.getLogger(__name__)
JOB_FIELDS = ("jobId", "jobType", "attempt", "jobStatus", "durationMs", "orgId")


class JsonLogFormatter(logging.Formatter):
    """One JSON object per line (`ENGINE_LOG_FORMAT=json`, deployment.md "Observability"): time,
    level, logger, message and the job fields a record carries (`extra=`), so the worker's lines join
    the API's by `jobId`."""

    def format(self, record):
        line = {"@timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S") + f".{int(record.msecs):03d}Z",
                "log.level": record.levelname, "log.logger": record.name, "message": record.getMessage()}
        line.update({key: getattr(record, key) for key in JOB_FIELDS if hasattr(record, key)})
        if record.exc_info:
            line["error.stack_trace"] = self.formatException(record.exc_info)
        return json.dumps(line, ensure_ascii=False, default=str)


def configure_logging():
    handler = logging.StreamHandler()
    if os.environ.get("ENGINE_LOG_FORMAT", "").lower() == "json":
        formatter = JsonLogFormatter()
        formatter.converter = time.gmtime
        handler.setFormatter(formatter)
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
HEARTBEAT_SECONDS = 3


def _process(envelope, send):
    os.environ.pop("ENGINE_QUEUE_DSN", None)
    from .worker import execute
    from .worker_http import storage

    def progress(stage, pct, message):
        send.send({"stage": stage, "pct": pct, "message": message})

    with send:
        send.send(execute(envelope, storage(), progress))


def _failure(envelope, code, message, retryable=True):
    return {"jobId": envelope["jobId"], "status": "failed",
            "error": {"code": code, "message": message, "retryable": retryable}}


def _timeout(envelope):
    """A parse over the limit is `parse_timeout`, retried once (a model that always times out isn't parsed
    three times; state-machines.md, engine-worker.md); other jobs keep `engine_timeout` (TF-037)."""
    if envelope.get("type") == "parse":
        return _failure(envelope, "parse_timeout", "Parsing the model exceeded the configured time limit.",
                        retryable=int(envelope.get("attempt") or 1) < 2)
    return _failure(envelope, "engine_timeout", "The worker exceeded the configured time limit.")


def _execute(connection, worker, envelope, stopping, timeout):
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    child = context.Process(target=_process, args=(envelope, send), daemon=True)
    job_id, attempt = envelope["jobId"], envelope["attempt"]
    fields = {"jobId": job_id, "jobType": envelope["type"], "attempt": attempt, "orgId": envelope.get("orgId")}
    started = time.monotonic()
    deadline = time.monotonic() + timeout
    heartbeat = 0.0
    progress = None
    result = None
    child.start()
    send.close()
    try:
        with receive:
            while not stopping.is_set():
                now = time.monotonic()
                if now >= heartbeat:
                    state = connection.execute(
                        "SELECT public.queue_renew(%s, %s::uuid, %s, %s)",
                        (worker, job_id, attempt, None if progress is None else Jsonb(progress)),
                    ).fetchone()[0]
                    if state == "lost":
                        return
                    if state == "cancel":
                        result = {"jobId": job_id, "status": "cancelled"}
                        break
                    heartbeat = now + HEARTBEAT_SECONDS
                    progress = None
                if now >= deadline:
                    result = _timeout(envelope)
                    break
                if receive.poll(min(0.25, deadline - now)):
                    try:
                        update = receive.recv()
                    except EOFError:
                        break
                    if "status" in update:
                        result = update
                        break
                    progress = update
        if stopping.is_set():
            return
        if result is None:
            result = _failure(envelope, "engine_process_failed", "The engine process exited before returning a result.")
        accepted = connection.execute(
            "SELECT public.queue_finish(%s, %s::uuid, %s, %s)", (worker, job_id, attempt, Jsonb(result)),
        ).fetchone()[0]
        took = int((time.monotonic() - started) * 1000)
        LOG.info("Job %s %s %s after %s ms", envelope["type"], job_id, result.get("status"), took,
                 extra={**fields, "jobStatus": result.get("status"), "durationMs": took})
        if not accepted:
            LOG.info("Result for job %s attempt %s no longer owns the lease", job_id, attempt, extra=fields)
    finally:
        if child.is_alive():
            child.join(0.2)
        if child.is_alive():
            child.terminate()
            child.join(2)
        if child.is_alive():
            child.kill()
            child.join()
        child.close()


def _work(dsn, pool, types, stopping, timeout, poll_seconds):
    worker = uuid4()
    while not stopping.is_set():
        try:
            with psycopg.connect(dsn, autocommit=True, connect_timeout=5,
                                 options="-c statement_timeout=8000") as connection:
                while not stopping.is_set():
                    envelope = connection.execute(
                        "SELECT public.queue_claim(%s, %s, %s)", (worker, pool, types),
                    ).fetchone()[0]
                    if envelope is None:
                        stopping.wait(poll_seconds)
                    else:
                        LOG.info("Working on %s job %s (attempt %s)", envelope["type"], envelope["jobId"], envelope["attempt"],
                                 extra={"jobId": envelope["jobId"], "jobType": envelope["type"], "attempt": envelope["attempt"],
                                        "orgId": envelope.get("orgId")})
                        _execute(connection, worker, envelope, stopping, timeout)
        except (psycopg.Error, OSError) as failure:
            LOG.warning("Queue worker unavailable (%s); retrying", type(failure).__name__)
            stopping.wait(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pool", default=os.environ.get("ENGINE_QUEUE_POOL", "default"))
    parser.add_argument("--types", default=os.environ.get("ENGINE_QUEUE_TYPES", ",".join(sorted(JOB_TYPES))))
    parser.add_argument("--concurrency", type=int, default=os.environ.get("ENGINE_QUEUE_CONCURRENCY", "1"))
    parser.add_argument("--timeout-seconds", type=float, default=os.environ.get("ENGINE_QUEUE_JOB_TIMEOUT_SECONDS", "1800"))
    parser.add_argument("--poll-seconds", type=float, default=os.environ.get("ENGINE_QUEUE_POLL_SECONDS", "1"))
    config = parser.parse_args()
    dsn = os.environ.get("ENGINE_QUEUE_DSN")
    types = sorted(set(value.strip() for value in config.types.split(",") if value.strip()))
    if not dsn or not config.pool or not types or set(types) - JOB_TYPES:
        parser.error("Set ENGINE_QUEUE_DSN and use a valid pool and job type list.")
    if config.concurrency < 1 or config.timeout_seconds <= 0 or config.poll_seconds <= 0:
        parser.error("Concurrency, timeout and poll interval must be positive.")

    configure_logging()
    stopping = Event()
    for name in (signal.SIGINT, signal.SIGTERM):
        signal.signal(name, lambda signum, frame: stopping.set())
    with ThreadPoolExecutor(max_workers=config.concurrency) as slots:
        tasks = [slots.submit(_work, dsn, config.pool, types, stopping, config.timeout_seconds, config.poll_seconds)
                 for _ in range(config.concurrency)]
        try:
            while not stopping.wait(0.5):
                for task in tasks:
                    if task.done():
                        task.result()
                        raise RuntimeError("A queue worker slot stopped unexpectedly.")
        finally:
            stopping.set()


if __name__ == "__main__":
    main()
