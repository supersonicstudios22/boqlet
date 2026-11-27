"""A model that outgrows the worker fails with `too_complex` instead of being killed (review B-22)."""
import pytest

from ifc_boq import parse
from ifc_boq.paths import FIXTURES

DUPLEX = str(FIXTURES / "ifc" / "Ifc2x3_Duplex_Architecture.ifc")


def test_a_parse_past_the_memory_limit_fails_as_too_complex(monkeypatch):
    monkeypatch.setenv(parse.PARSE_MEMORY_ENV, "100")
    monkeypatch.setattr(parse, "resident_mb", lambda: 5_000.0)
    with pytest.raises(parse.IfcFileError) as failure:
        parse.parse_file(DUPLEX)
    assert failure.value.code == "too_complex"
    assert "5,000 MB" in str(failure.value) and "100 MB" in str(failure.value)


def test_without_a_limit_or_under_it_the_parse_goes_on(monkeypatch):
    monkeypatch.delenv(parse.PARSE_MEMORY_ENV, raising=False)
    calls = []
    monkeypatch.setattr(parse, "resident_mb", lambda: calls.append(1) or 5_000.0)
    assert parse.memory_limit_mb() is None
    monkeypatch.setenv(parse.PARSE_MEMORY_ENV, "not a number")
    assert parse.memory_limit_mb() is None
    monkeypatch.setenv(parse.PARSE_MEMORY_ENV, "9000")
    parsed, _ = parse.parse_file(DUPLEX)
    assert parsed["elements"] and calls  # it looked, and 5,000 MB is under 9,000


def test_resident_memory_reads_this_process():
    used = parse.resident_mb()
    assert used is None or used > 1
