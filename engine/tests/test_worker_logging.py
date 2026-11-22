"""The queue worker's JSON log lines (ENGINE_LOG_FORMAT=json, BE-025) carry the job fields."""
import json
import logging

from ifc_boq.worker_queue import JsonLogFormatter


def test_json_log_line_carries_job_fields():
    record = logging.LogRecord("ifc_boq.worker_queue", logging.INFO, __file__, 1, "Job %s %s", ("parse", "succeeded"), None)
    record.jobId, record.jobType, record.durationMs = "j-1", "parse", 1234
    line = json.loads(JsonLogFormatter().format(record))
    assert line["message"] == "Job parse succeeded"
    assert line["log.level"] == "INFO"
    assert (line["jobId"], line["jobType"], line["durationMs"]) == ("j-1", "parse", 1234)
    assert "orgId" not in line


def test_queue_jobs_start_from_a_fork_server_where_the_platform_has_one():
    """TF-134: spawning a process per job imported the engine each time (~1.6-2.7 s); a fork server that
    imported it once starts each job in ~0.2 s. Windows has no fork: it spawns."""
    import multiprocessing

    from ifc_boq import worker_queue
    expected = "forkserver" if "forkserver" in multiprocessing.get_all_start_methods() else "spawn"
    assert worker_queue._job_context().get_start_method() == expected


def test_a_new_stage_is_reported_before_the_next_heartbeat(monkeypatch):
    """TF-192: progress went to the database only with the heartbeat (every 3 s), so a warm parse that ends
    within one heartbeat (the Duplex: about 3 s) never showed a stage. A new stage is reported within 0.5 s."""
    import multiprocessing
    import threading
    import time
    from threading import Event

    from ifc_boq import worker_queue

    class ThreadProcess:                                   # the job "process" runs in a thread of this one
        def __init__(self, target, args, daemon):
            self.thread = threading.Thread(target=target, args=args, daemon=daemon)
        def start(self): self.thread.start()
        def is_alive(self): return self.thread.is_alive()
        def join(self, timeout=None): self.thread.join(timeout)
        def terminate(self): pass
        def kill(self): pass
        def close(self): pass

    class SendEnd:                                         # the parent's close() leaves the thread's end open
        def __init__(self, connection): self.connection = connection
        def send(self, message): self.connection.send(message)
        def close(self): pass
        def __enter__(self): return self
        def __exit__(self, *exc): self.connection.close()

    class Context:
        @staticmethod
        def Pipe(duplex):
            receive, send = multiprocessing.Pipe(duplex=duplex)
            return receive, SendEnd(send)
        Process = ThreadProcess

    def job(envelope, send):                                # a parse that ends in 1.2 s, well inside one heartbeat
        with send:
            send.send({"stage": "download", "pct": 0, "message": "Downloading model"})
            send.send({"stage": "geometry", "pct": 20, "message": "Measuring"})
            time.sleep(1.2)
            send.send({"jobId": envelope["jobId"], "status": "succeeded", "output": {}, "metrics": {}})

    class Connection:
        def __init__(self): self.reports = []
        def execute(self, sql, params):
            if "queue_renew" in sql:
                self.reports.append(params[3] and params[3].obj["stage"])
                return Result("active")
            return Result(True)

    class Result:
        def __init__(self, value): self.value = value
        def fetchone(self): return [self.value]

    monkeypatch.setattr(worker_queue, "_job_context", lambda: Context)
    monkeypatch.setattr(worker_queue, "_process", job)
    connection = Connection()
    worker_queue._execute(connection, "w", {"jobId": "j", "type": "parse", "attempt": 1}, Event(), 30)
    assert "geometry" in connection.reports, connection.reports
