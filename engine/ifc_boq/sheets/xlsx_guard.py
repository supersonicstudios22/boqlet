"""Open a user's .xlsx safely: refuse zip bombs from the zip directory, before openpyxl decompresses anything.

Every reader of an uploaded workbook (code lists, preset templates, BoQ edits) opens it through `open_workbook`.
The sizes come from the central directory; zipfile stops reading a member at its declared size (and fails its
CRC check if there is more), so a member can't expand past what the directory says.
"""
from __future__ import annotations

from io import BytesIO
from zipfile import ZipFile

from openpyxl import load_workbook

MAX_MEMBERS = 4096
# openpyxl loads shared strings and styles whole, at up to ~8x their XML size in memory, so the quick readers
# in the rpc engine (code lists, templates; 1.5 GB container) get a lower cap than the BoQ edits job.
QUICK_LIMIT = 64 << 20
JOB_LIMIT = 256 << 20
# Real workbook parts compress about 10:1; deflate bombs reach 300-1000:1. Small parts may pack tighter.
MAX_RATIO = 100
RATIO_FROM = 1 << 20


class WorkbookTooLarge(ValueError):
    pass


def check(data: bytes, limit: int = QUICK_LIMIT) -> None:
    """Raise WorkbookTooLarge for a workbook that expands too far (BadZipFile if it isn't a zip at all)."""
    with ZipFile(BytesIO(data)) as zipped:
        members = zipped.infolist()
    if len(members) > MAX_MEMBERS:
        raise WorkbookTooLarge(f"The workbook is too large: it has more than {MAX_MEMBERS} parts.")
    if sum(member.file_size for member in members) > limit:
        raise WorkbookTooLarge(f"The workbook is too large: it expands to more than {limit >> 20} MB.")
    if any(m.file_size > RATIO_FROM and m.file_size > MAX_RATIO * m.compress_size for m in members):
        raise WorkbookTooLarge(f"The workbook is too large for its file size: a part expands more than {MAX_RATIO} times.")


def open_workbook(data: bytes, limit: int = QUICK_LIMIT):
    """A read-only, data-only openpyxl workbook (no formulas evaluated, no external links), after `check`."""
    check(data, limit)
    return load_workbook(BytesIO(data), read_only=True, data_only=True, keep_links=False)
