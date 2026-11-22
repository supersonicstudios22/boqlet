"""Workbook round-trip metadata and read-only proposals for edits from Excel."""
from __future__ import annotations

from contextlib import closing
import math
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

from openpyxl.styles import Protection
from openpyxl.utils.exceptions import InvalidFileException

from .xlsx_guard import JOB_LIMIT, WorkbookTooLarge, open_workbook

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


def number(v):
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
    except WorkbookTooLarge as exc:
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
    seen = set()
    heading = ""
    for r, row in enumerate(ws.iter_rows(min_row=FIRST, max_col=KEY_COL, values_only=True), FIRST):
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
            if qty in (None, "") and not unit:
                heading = str(ref or "").strip()
                continue
            q, ok = number(qty)
            if not ok:
                _problem(report, r, COLS["quantity"], f"\"{qty}\" is not a number.")
                continue
            if not desc_s:
                _problem(report, r, COLS["description"], "A new row needs a description.")
                continue
            item = {"id": f"xlsx-{r}", "kind": "other", "description": desc_s, "unit": str(unit or "item").strip(), **({"quantity": q} if q is not None else {})}
            code = str(ref or "").strip() or heading
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
        q, ok = number(qty)
        if not ok:
            _problem(report, r, COLS["quantity"], f"\"{qty}\" is not a number.")
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
            if code:
                edit["codes"] = {primary: code}
                changes.append("moved")
        if changes:
            kind = changes[0] if len(changes) == 1 else "mixed"
            report["overrides"].append({"edit": edit, "change": kind, "row": r})
    for key in exported:
        if key not in seen and key in current and not current[key].get("excluded"):
            report["overrides"].append({"edit": {"lineKey": key, "excluded": True}, "change": "excluded"})
    return report
