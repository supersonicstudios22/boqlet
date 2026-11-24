"""Workbook round-trip metadata and read-only proposals for edits from Excel."""
from __future__ import annotations

from contextlib import closing
from hashlib import sha256
import json
import math
import re
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

from openpyxl.styles import Protection
from openpyxl.utils.exceptions import InvalidFileException

from .xlsx_guard import JOB_LIMIT, UNCACHED, WorkbookRefused, open_workbook, uncached_formulas

KEY_COL = 9  # I, after Ref, Description, Unit, Quantity, Rate, Amount, Source, Notes
FIRST = 6
COLS = {"ref": "A", "description": "B", "unit": "C", "quantity": "D"}


def annotate(wb, boq_id, primary, rows):
    ws = wb["BoQ"]
    ws.cell(row=FIRST - 1, column=KEY_COL, value="Line key")
    snap = wb.create_sheet("_boqlet")
    snap.append(["boqId", boq_id, "primary", primary or ""])
    snap.append(["key", "ref", "description", "unit", "quantity", "top"])
    unlocked = Protection(locked=False)
    for row, key, top in rows:
        ws.cell(row, KEY_COL, key).data_type = "s"
        values = [key, *(ws.cell(row, column).value for column in range(1, 5)), top]
        snap.append(values)
        for cell in snap[snap.max_row]:
            if cell.data_type == "f":
                cell.data_type = "s"
        for column in range(1, 6):
            ws.cell(row, column).protection = unlocked
    ws.column_dimensions["I"].hidden = True
    ws.protection.sheet = True
    ws.protection.insertRows = False
    ws.protection.deleteRows = False
    ws.protection.sort = False
    snap.sheet_state = "veryHidden"


SPACES = (" ", "\u00a0", "\u202f", "\u2009")
GROUPED = re.compile(r"[+-]?\d{1,3}(?:[.,]\d{3})+")


def parse_number(v, number_format: dict | None = None) -> tuple[float | None, str | None]:
    """A quantity a person typed (review A-30, ENG-018): (value, None), or (None, why not). Number cells are taken as
    they are. Text is read with the firm's separators (`OrgSettings.numberFormat`, sent by the API): "1,234" is
    1234 where "," separates thousands and 1.234 where it is the decimal mark; a thousands mark that does not
    group three digits, or the other separator, is refused rather than guessed. Without a format, text with both
    separators, or one separator before exactly three digits ("1,234": 1234 or 1.234?), is refused."""
    if v is None or v == "":
        return None, None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return (float(v), None) if math.isfinite(v) else (None, f"\"{v}\" is not a number.")
    s = str(v).strip()
    for space in SPACES:
        s = s.replace(space, "")
    if number_format and number_format.get("decimal") in (".", ","):
        dec = number_format["decimal"]
        thousands = number_format.get("thousands")
        other = "," if dec == "." else "."
        if thousands == "'":
            s = s.replace("'", "")
        if thousands == other:
            whole, _, fraction = s.partition(dec)
            groups = whole.lstrip("+-").split(other)
            if other in fraction or (len(groups) > 1 and (not 1 <= len(groups[0]) <= 3 or any(len(g) != 3 for g in groups[1:]))):
                return None, (f"\"{v}\" is not a number in this firm's format (\"{other}\" groups thousands, "
                              f"\"{dec}\" is the decimal mark).")
            s = s.replace(other, "")
        elif other in s:
            return None, f"\"{v}\": the decimal mark is \"{dec}\" in this firm's numbers, not \"{other}\"."
        s = s.replace(dec, ".")
    else:
        if "," in s and "." in s or GROUPED.fullmatch(s):
            return None, (f"\"{v}\" could be read two ways (thousands or decimals); type it as a number cell or "
                          f"without a thousands mark.")
        s = s.replace(",", ".")
    try:
        parsed = float(s)
    except (ValueError, OverflowError):
        return None, f"\"{v}\" is not a number."
    return (parsed, None) if math.isfinite(parsed) else (None, f"\"{v}\" is not a number.")


def number(v):
    """A value boqlet itself wrote into the workbook's hidden snapshot (a number; text from older exports)."""
    if v is None or v == "":
        return None, True
    try:
        parsed = float(str(v).replace(" ", "").replace(" ", "").replace(",", "."))
        if math.isfinite(parsed):
            return parsed, True
    except (ValueError, OverflowError):
        pass
    return None, False


def read(src, info):
    report = {"overrides": [], "manualItems": [], "problems": []}
    try:
        with closing(open_workbook(src, JOB_LIMIT)) as wb:
            return _read(wb, info, report)
    except WorkbookRefused as exc:
        return {"overrides": [], "manualItems": [], "problems": [{"row": 0, "message": str(exc)}]}
    except (BadZipFile, InvalidFileException, ParseError, ValueError, KeyError, IndexError, OSError):
        return {"overrides": [], "manualItems": [], "problems": [{"row": 0, "message": "This file is not an Excel workbook."}]}




def _problem(report, row, column, message):
    report["problems"].append({"sheet": "BoQ", "row": row, "column": column, "message": message})


def _read(wb, info, report):
    if "BoQ" not in wb.sheetnames or "_boqlet" not in wb.sheetnames:
        report["problems"].append({"row": 0, "message": "This workbook wasn't exported from boqlet (its BoQ sheet or line keys are missing)."})
        return report
    snap = wb["_boqlet"]
    head = next(snap.iter_rows(min_row=1, max_row=1, max_col=4, values_only=True), [None] * 4)
    if head[0] != "boqId" or str(head[1] or "") != info["boqId"]:
        report["problems"].append({"sheet": "BoQ", "row": 0, "message": "This workbook was exported from another BoQ."})
        return report
    primary = head[3] or info.get("primary")
    ws = wb["BoQ"]
    if any(sheet.max_row is None or sheet.max_row > 250_000 for sheet in (ws, snap)):
        report["problems"].append({"sheet": "BoQ", "row": 0, "message": "The workbook exceeds the maximum row count."})
        return report
    exported = {}
    for row in snap.iter_rows(min_row=3, max_col=6, values_only=True):
        if row[0]:
            exported[str(row[0])] = {"ref": row[1] or "", "description": row[2] or "", "unit": row[3] or "", "quantity": row[4], "top": row[5] or ""}
    current = {line["key"]: line for line in info["lines"]}
    # The section rows the export writes: each level of the grouping code's path, and "Unclassified".
    headings = {("", "Unclassified")}
    for line in info["lines"]:
        for node in ((line.get("codes") or {}).get(primary) or {}).get("path", []) if primary else []:
            headings.add((str(node["code"]).strip(), str(node["title"]).strip()))
    # The grouping code list's codes, when the caller sends them: a Ref outside it is that row's problem.
    known = set(info["codes"]) if info.get("codes") is not None else None
    ids = {}
    seen = set()
    heading = ""
    # A formula typed into a read column without a saved value reads as empty: report it, skip the row (TF-177).
    # The export's own subtotal formulas (quantity and amount, TF-054) are not edits.
    blank: dict[int, list[str]] = {}
    for _, row, column in uncached_formulas(wb, sheets={"BoQ"}, columns={*COLS.values(), "I"}, limit=1000):
        blank.setdefault(row, []).append(column)
    for r, row in enumerate(ws.iter_rows(min_row=FIRST, max_col=KEY_COL, values_only=True), FIRST):
        if r in blank:
            label = str(row[1] or "").strip()
            if not row[KEY_COL - 1] and (label.startswith("Subtotal") or label == "TOTAL"):
                continue
            for column in blank[r]:
                _problem(report, r, column, UNCACHED)
            seen.add(str(row[KEY_COL - 1] or ""))      # a line on such a row is not proposed as excluded either
            continue
        ref, desc, unit, qty = row[:4]
        key = row[KEY_COL - 1]
        desc_s = str(desc or "").strip()
        if key and not any(v not in (None, "") for v in (ref, desc, unit, qty)):
            continue
        if not key:
            if not any(v not in (None, "") for v in (ref, desc, unit, qty)):
                continue
            if desc_s.startswith("Subtotal") or desc_s == "TOTAL":
                continue
            ref_s = str(ref or "").strip()
            if qty in (None, "") and not unit:
                if (ref_s, desc_s) in headings or (known is not None and ref_s in known):
                    heading = ref_s
                else:
                    _problem(report, r, COLS["unit"], "A new row needs a unit (and a quantity, or leave that empty to confirm later).")
                continue
            q, why = parse_number(qty, info.get("numberFormat"))
            if why:
                _problem(report, r, COLS["quantity"], why)
                continue
            if not desc_s:
                _problem(report, r, COLS["description"], "A new row needs a description.")
                continue
            code = ref_s or heading
            if primary and ref_s and known is not None and ref_s not in known:
                _problem(report, r, COLS["ref"], f"\"{ref_s}\" is not a code of the grouping classification.")
                continue
            unit_s = str(unit or "item").strip()
            # The id comes from the row's content, so another workbook's new row on the same row number can't
            # collide with it (TF-051); a repeat of the same row in one file gets a suffix.
            base = "xlsx-" + sha256(json.dumps([desc_s, unit_s, q, code], ensure_ascii=False).encode("utf-8")).hexdigest()[:12]
            ids[base] = ids.get(base, 0) + 1
            item = {"id": base if ids[base] == 1 else f"{base}-{ids[base]}", "kind": "other", "description": desc_s,
                    "unit": unit_s, **({"quantity": q} if q is not None else {})}
            report["manualItems"].append({"item": {"item": item, **({"codes": {primary: code}} if primary and code else {})}, "row": r})
            continue
        key = str(key)
        if key not in current or key not in exported:
            _problem(report, r, "I", "This line isn't in this BoQ any more.")
            continue
        if key in seen:
            _problem(report, r, "I", "This line key appears more than once.")
            continue
        seen.add(key)
        was = exported[key]
        edit = {"lineKey": key}
        changes = []
        q, why = parse_number(qty, info.get("numberFormat"))
        if why:
            _problem(report, r, COLS["quantity"], why)
            continue
        before, _ = number(was["quantity"])
        if (q is None) != (before is None) or (q is not None and before is not None and abs(q - before) > 1e-9):
            edit["quantity"] = q
            changes.append("quantity")
        if desc_s != str(was["description"]).strip():
            edit["description"] = desc_s
            changes.append("description")
        unit_s = str(unit or "").strip()
        if unit_s != str(was["unit"]).strip():
            edit["unit"] = unit_s
            if "quantity" not in edit:
                edit["quantity"] = q
            changes.append("unit")
        ref_s = str(ref or "").strip()
        if primary and (ref_s != str(was["ref"]).strip() or (heading and heading != str(was["top"]))):
            code = ref_s if ref_s != str(was["ref"]).strip() else heading
            if code and known is not None and code not in known:
                _problem(report, r, COLS["ref"], f"\"{code}\" is not a code of the grouping classification.")
            elif code:
                edit["codes"] = {primary: code}
                changes.append("moved")
        if changes:
            kind = changes[0] if len(changes) == 1 else "mixed"
            report["overrides"].append({"edit": edit, "change": kind, "row": r})
    for key in exported:
        if key not in seen and key in current and not current[key].get("excluded"):
            report["overrides"].append({"edit": {"lineKey": key, "excluded": True}, "change": "excluded"})
    return report
