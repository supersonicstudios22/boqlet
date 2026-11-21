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
