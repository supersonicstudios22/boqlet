"""Open a user's .xlsx safely: refuse zip bombs from the zip directory, before openpyxl decompresses anything.

Every reader of an uploaded workbook (code lists, preset templates, BoQ edits) opens it through `open_workbook`.
The sizes come from the central directory; zipfile stops reading a member at its declared size (and fails its
CRC check if there is more), so a member can't expand past what the directory says.
"""
from __future__ import annotations

import re
from io import BytesIO
from xml.etree.ElementTree import iterparse
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


class WorkbookRefused(ValueError):
    """A workbook the readers refuse before openpyxl reads it; the message says why."""


class WorkbookTooLarge(WorkbookRefused):
    pass


MACROS = "This workbook contains macros (.xlsm). Save it as an Excel workbook without macros (.xlsx) and try again."


def check(data: bytes, limit: int = QUICK_LIMIT) -> None:
    """Raise WorkbookRefused for a workbook with macros, WorkbookTooLarge for one that expands too far
    (BadZipFile if it isn't a zip at all)."""
    with ZipFile(BytesIO(data)) as zipped:
        members = zipped.infolist()
    # A VBA project means macros: never run here, but refused as security.md says (an .xlsm by any name).
    if any(m.filename.lower().rsplit("/", 1)[-1] == "vbaproject.bin" for m in members):
        raise WorkbookRefused(MACROS)
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


SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
UNCACHED = "This cell holds a formula with no saved value, so it reads as empty. Type the value, or open and save the file in Excel."


def uncached_formulas(wb, sheets=None, columns=None, limit: int = 50) -> list[tuple[str, int, str]]:
    """(sheet, row, column) of formula cells without a saved value (TF-177).

    Data-only reading gives such a cell as empty (tools like openpyxl save formulas without results; no
    formula is ever evaluated here), so a reader reports them instead of reading a blank. Streams the sheet
    XML of an `open_workbook` workbook; `sheets` and `columns` (letters) narrow it to what the reader reads."""
    found = []
    for ws in wb.worksheets:
        path = getattr(ws, "_worksheet_path", None)
        if path is None or (sheets is not None and ws.title not in sheets):
            continue
        with wb._archive.open(path) as source:
            for _, element in iterparse(source):
                if element.tag == SHEET_NS + "c":
                    value = element.find(SHEET_NS + "v")
                    # No value, or an empty one that isn't a cached empty text (Excel writes t="str" for that).
                    if element.find(SHEET_NS + "f") is not None and (
                            value is None or (not value.text and element.get("t") != "str")):
                        column, row = re.fullmatch(r"([A-Z]+)(\d+)", element.get("r", "") or "A0").groups()
                        if columns is None or column in columns:
                            found.append((ws.title, int(row), column))
                            if len(found) >= limit:
                                return found
                    element.clear()
                elif element.tag == SHEET_NS + "row":
                    element.clear()
    return found
