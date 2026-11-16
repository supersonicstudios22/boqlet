"""PostgreSQL queue consumer. IFC work runs in a child process for each lease."""
from __future__ import annotations

import argparse
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
HEARTBEAT_SECONDS = 3


def _process(envelope, send):
    os.environ.pop("ENGINE_QUEUE_DSN", None)
    from .worker import execute
    from .worker_http import storage

    def progress(stage, pct, message):
        send.send({"stage": stage, "pct": pct, "message": message})

    with send:
        send.send(execute(envelope, storage(), progress))


def _failure(envelope, code, message):
    return {"jobId": envelope["jobId"], "status": "failed",
            "error": {"code": code, "message": message, "retryable": True}}


def _execute(connection, worker, envelope, stopping, timeout):
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    child = context.Process(target=_process, args=(envelope, send), daemon=True)
    job_id, attempt = envelope["jobId"], envelope["attempt"]
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
                    result = _failure(envelope, "engine_timeout", "The worker exceeded the configured time limit.")
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
        if not accepted:
            LOG.info("Result for job %s attempt %s no longer owns the lease", job_id, attempt)
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
                        LOG.info("Working on %s job %s (attempt %s)", envelope["type"], envelope["jobId"], envelope["attempt"])
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

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
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
