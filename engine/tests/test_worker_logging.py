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
