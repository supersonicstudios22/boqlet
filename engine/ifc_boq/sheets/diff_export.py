"""Render the stored worker change report into an Excel workbook."""
from __future__ import annotations

from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

HEAD = PatternFill("solid", fgColor="EDEAE3")
FILLS = {"added": "BFCDEE", "removed": "EDBEBD", "changed": "F8D2B8"}
SUMMARY = {
    "linesAdded": "Lines added", "linesRemoved": "Lines removed", "linesChanged": "Lines changed",
    "linesUnchanged": "Lines unchanged", "elementsAdded": "Elements added", "elementsRemoved": "Elements removed",
    "elementsChanged": "Elements changed", "questionsNew": "New questions", "questionsResolved": "Resolved questions",
    "guidChurnWarning": "GlobalId churn warning",
}


def _append(sheet, row):
    sheet.append(row)
    for cell in sheet[sheet.max_row]:
        if cell.data_type == "f":
            cell.data_type = "s"


def _table(sheet, columns, widths):
    _append(sheet, columns)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
        cell.fill = HEAD
    sheet.freeze_panes = "A2"
    for position, width in enumerate(widths, 1):
        sheet.column_dimensions[get_column_letter(position)].width = width


def render(diff, meta):
    wb = Workbook()
    summary = wb.active
    summary.title = "Summary"
    _append(summary, [meta.get("title", "BoQ change report")])
    summary["A1"].font = Font(bold=True, size=14)
    _append(summary, [meta.get("fromLabel", "Before"), meta.get("toLabel", "After")])
    for key, label in SUMMARY.items():
        _append(summary, [label, diff["summary"][key]])
    _append(summary, ["Inputs changed", ", ".join(diff["summary"]["inputsChanged"])])
    summary.column_dimensions["A"].width = 34
    summary.column_dimensions["B"].width = 60

    lines = wb.create_sheet("Lines")
    _table(lines, ["Group", "Line key", "Description", "Unit", "Change", "Before", "After", "Delta", "Delta %", "Causes",
                   "Engine before", "Engine after"],
           [28, 40, 48, 8, 10, 14, 14, 14, 10, 40, 14, 14])
    group_by = meta.get("groupBy")
    for line in diff["lines"]:
        before, after = line.get("before") or {}, line.get("after") or {}
        shown = after or before
        group = shown.get("codes", {}).get(group_by, {}).get("path", [])
        _append(lines, [" / ".join(node["title"] for node in group), line["lineKey"], shown["description"],
                        shown["unit"], line["change"], before.get("quantity"), after.get("quantity"),
                        line["delta"], line["deltaPct"], ", ".join(line["causes"]),
                        # an edited quantity: the engine's value under the edit (BR-09)
                        before.get("engineQuantity"), after.get("engineQuantity")])
        cells = lines[lines.max_row]
        cells[4].fill = PatternFill("solid", fgColor=FILLS[line["change"]])
        for cell in (*cells[5:9], *cells[10:12]):
            cell.number_format = "#,##0.000"
    lines.auto_filter.ref = lines.dimensions

    elements = wb.create_sheet("Elements")
    _table(elements, ["GlobalId", "Model", "Change", "Changed fields", "Lines affected"], [26, 28, 10, 36, 60])
    for element in diff["elements"]:
        _append(elements, [element["guid"], element["model"], element["change"], ", ".join(element["fields"]),
                           ", ".join(element["lineKeys"])])
        elements.cell(elements.max_row, 3).fill = PatternFill("solid", fgColor=FILLS[element["change"]])
    elements.auto_filter.ref = elements.dimensions
    output = BytesIO()
    wb.save(output)
    return output.getvalue()
