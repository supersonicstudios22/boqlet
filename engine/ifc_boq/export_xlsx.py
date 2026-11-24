"""
export_xlsx.py - BoqResult -> Excel workbook.

Sheets
  BoQ          priced-bill layout grouped by the first classification system; Rate is an
               input column, Amount and subtotals are live formulas
  Calculation  every line with the formula, parameters and each element's contribution
  Lines        flat table of all lines with codes in every system (for filtering / pivots)
  Log          the calculation log
  Questions    open questions, warnings and the parser's verification checks
  Inputs       model, rule set (with parameter values), dictionaries, classifications, decisions
"""
from __future__ import annotations

import io
import json
import re
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from .sheets.boq_import import annotate
from .trace_steps import describe as describe_step

F = "Arial"
H_FONT = Font(name=F, size=10, bold=True, color="FFFFFF")
H_FILL = PatternFill("solid", fgColor="3B2A6B")
SEC_FILL = PatternFill("solid", fgColor="E9E4F5")
SUB_FILL = PatternFill("solid", fgColor="F2F2F2")
FLAG_FILL = PatternFill("solid", fgColor="FFF2CC")
IN_FILL = PatternFill("solid", fgColor="FFFF00")
NORMAL = Font(name=F, size=10)
BOLD = Font(name=F, size=10, bold=True)
INPUT = Font(name=F, size=10, color="0000FF")
TITLE = Font(name=F, size=14, bold=True)
SMALL = Font(name=F, size=9, italic=True, color="595959")
THIN = Side(style="thin", color="D0D0D0")
BOX = Border(top=THIN, bottom=THIN, left=THIN, right=THIN)
NUM = '#,##0.00;-#,##0.00;"-"'
WRAP = Alignment(wrap_text=True, vertical="top")


def _header(ws, row, cols, widths):
    for i, (c, w) in enumerate(zip(cols, widths), 1):
        x = ws.cell(row=row, column=i, value=c)
        x.font, x.fill, x.border = H_FONT, H_FILL, BOX
        x.alignment = Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = w


def decision_note(d: dict) -> str:
    """A decision an element rests on, for the Calculation sheet (A-06): "per decision contradiction:...= geometry (A. Person, 2026-11-23)"."""
    who = ", ".join(x for x in (d.get("by"), (d.get("at") or "")[:10]) if x)
    return f"per decision {d['questionId']} = {json.dumps(d.get('answer'))}" + (f" ({who})" if who else "")


def to_confirm_note(c: dict) -> str:
    """Why a line with a quantity is yellow (review A-05): "To confirm: 2 of 3 elements measured"."""
    parts = []
    if c["measured"] < c["elements"]:
        parts.append(f"{c['measured']} of {c['elements']} elements measured")
    if c.get("questions"):
        n = len(c["questions"])
        parts.append(f"rests on {n} open question{'s' if n > 1 else ''} about the file's quantities")
    return "To confirm: " + "; ".join(parts)


def _row(ws, row, values, font=NORMAL, fill=None, wrap_cols=(), formula_cols=()):
    for i, v in enumerate(values, 1):
        x = ws.cell(row=row, column=i, value=v)
        if x.data_type == "f":
            if i in formula_cols:
                vars(ws.parent).setdefault("boqlet_formulas", set()).add((ws.title, x.coordinate))
            else:
                x.data_type = "s"
        x.font, x.border = font, BOX
        if fill:
            x.fill = fill
        if i in wrap_cols:
            x.alignment = WRAP


def _decimals(value) -> int:
    """The decimals a quantity has (up to 6, as the sheet shows them: sheet.tsx)."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return 2
    text = f"{round(value, 6):.6f}".rstrip("0")
    return len(text.split(".")[1])


def _text_only(wb) -> None:
    """Every formula the workbook didn't write on purpose becomes text (TF-040, security.md "no formulas
    evaluated"): openpyxl makes any string starting with "=" a formula, wherever user text lands."""
    own = getattr(wb, "boqlet_formulas", set())
    for ws in wb:
        for row in ws.iter_rows():
            for cell in row:
                if cell.data_type == "f" and (ws.title, cell.coordinate) not in own:
                    cell.data_type = "s"


def _qfmt(value, decimals=None):
    """A quantity's number format with the decimals it has: 0.4 item is not "0", 12.345 m3 is not 12.35 (TF-055)."""
    d = _decimals(value) if decimals is None else decimals
    base = "#,##0" + ("." + "0" * d if d else "")
    return f'{base};-{base};"-"'


def _natural(code: str):
    """Codes in the sheet's order: digit runs compare as numbers, "2" before "10" (model.ts byCode)."""
    return [(0, int(part), "") if part.isdigit() else (1, 0, part.lower()) for part in re.findall(r"\d+|\D+", code)]


SEPARATORS = {".": "point", ",": "comma", " ": "space", "\u00a0": "space", "\u202f": "space", "'": "apostrophe", "": "none"}


def _number_format(fmt: dict) -> str:
    """The org's number format in words with a sample (TF-108), e.g. "1 234 567,89 (decimal comma, thousands space)"."""
    decimal, thousands = fmt.get("decimal", "."), fmt.get("thousands", "")
    sample = f"1{thousands}234{thousands}567{decimal}89"
    return f"{sample} (decimal {SEPARATORS.get(decimal, repr(decimal))}, thousands {SEPARATORS.get(thousands, repr(thousands))})"


class _Group:
    """A section of the BoQ sheet: one level of the grouping code's path."""

    def __init__(self, code: str, title: str):
        self.code, self.title, self.children, self.lines = code, title, {}, []

    def child(self, code: str, title: str) -> "_Group":
        return self.children.setdefault(code, _Group(code, title))

    def all_lines(self) -> list:
        return [*self.lines, *(line for child in self.children.values() for line in child.all_lines())]

    def sorted_children(self) -> list:
        return sorted(self.children.values(), key=lambda g: (g.code == "~", _natural(g.code)))


def _description(line, primary):
    if "description" in line.get("overridden", {}).get("fields", []):
        return line["description"]
    return line.get("codes", {}).get(primary, {}).get("text") or line["description"]


def export(result: dict, meta: dict) -> bytes:
    wb = Workbook()
    systems = meta.get("classifications", [])          # [{id, name}]
    group_by = meta.get("groupBy")
    if group_by:
        systems = sorted(systems, key=lambda system: system["id"] != group_by)
    primary = systems[0]["id"] if systems else None
    lines = result["lines"]
    if order := meta.get("lineOrder"):
        # The sheet's order (F06 §13, BR-28): reorders and placed manual lines live in the backend's
        # index, not in the engine result. Lines it doesn't list keep the engine's order after them (TF-049).
        rank = {key: index for index, key in enumerate(order)}
        lines = sorted(lines, key=lambda line: rank.get(line["key"], len(rank)))
    text_systems = {system for line in lines for system, code in line["codes"].items() if code.get("text")}

    # ------------------------------------------------------------------ BoQ
    ws = wb.active
    ws.title = "BoQ"
    label = meta.get("revision")
    status = meta.get("status")
    working = status in {"working", "draft", "review", "approved"} if status else False
    title = meta.get("boq") or meta.get("modelName", "")
    ws["A1"] = f"Bill of Quantities - {title}" + (f" ({label})" if label else "") + (" (WORKING)" if working else "")
    ws["A1"].font = TITLE
    rule_meta = result["ruleSet"].get("meta") or {}
    ws["A2"] = (f"Rules: {rule_meta.get('chainLabel') or result['ruleSet']['name']}  |  "
                f"Grouping: {systems[0]['name'] if systems else 'none'}  |  Status: {result['status']}  |  "
                f"Generated {meta.get('generatedAt', datetime.now().isoformat(timespec='seconds'))}")
    ws["A2"].font = SMALL
    ws["A3"] = "Enter rates in the yellow column. Amounts and totals are formulas. Yellow rows are flagged: quantity to be confirmed."
    ws["A3"].font = SMALL
    # The BoQ's own manual lines (the app's count), not the rule set's preliminaries (TF-108); F12's wording (TF-058).
    manual_count = sum(l["ruleId"].startswith("boq.") and not l.get("excluded") for l in lines)
    ws["A4"] = ("Quantities are taken from the models only. Work not modelled as objects is included only where "
                f"derived or added by hand ({manual_count} manual line{'' if manual_count == 1 else 's'}).")
    ws["A4"].font = SMALL
    _header(ws, 5, ["Ref", "Description", "Unit", "Quantity", "Rate", "Amount", "Source", "Notes"],
            [10, 70, 7, 12, 11, 14, 10, 50])
    ws.freeze_panes = "A6"
    # Groups nest by the grouping code's path, every level, in the sheet's numeric order (F06 §3, TF-054).
    root = _Group("", "")
    for l in lines:
        if l.get("excluded"):
            continue
        c = l["codes"].get(primary) if primary else None
        node = root
        for step in (c["path"] if c and c.get("path") else [{"code": "~", "title": "Unclassified"}]):
            node = node.child(str(step["code"]), step["title"])
        node.lines.append(l)
    roundtrip_rows = []
    position_numbers = meta.get("positionNumbers") or {}
    if position_numbers:
        ws["J5"] = "No."
        ws["J5"].font, ws["J5"].fill, ws["J5"].border = H_FONT, H_FILL, BOX
        ws.column_dimensions["J"].width = 12

    def write_line(r, l, section):
        c = l["codes"].get(primary) if primary else None
        flagged = l["quantity"] is None or bool(l.get("toConfirm"))
        notes = [*([to_confirm_note(l["toConfirm"])] if l.get("toConfirm") else []), *l.get("notes", [])]
        description = _description(l, primary)
        if description != l["description"]:
            notes = [*notes, f"Measured as: {l['description']}"]
        if measured := l.get("overridden", {}).get("engineDescription"):
            notes = [*notes, f"Measured as: {measured}"]
        if reason := l.get("overridden", {}).get("reason"):
            if not any(reason in note for note in notes):
                notes = [*notes, "Reason: " + reason]
        _row(ws, r, [c["code"] if c else "", description, l["unit"], l["quantity"], None,
                     f"=IF(OR(D{r}=\"\",E{r}=\"\"),0,D{r}*E{r})", l["source"], "; ".join(notes)],
             NORMAL, FLAG_FILL if flagged else None, wrap_cols=(2, 8), formula_cols=(6,))
        ws.cell(row=r, column=4).number_format = _qfmt(l["quantity"])
        ws.cell(row=r, column=5).fill = IN_FILL
        ws.cell(row=r, column=5).font = INPUT
        ws.cell(row=r, column=5).number_format = NUM
        ws.cell(row=r, column=6).number_format = NUM
        roundtrip_rows.append((r, l["key"], section))
        if position := position_numbers.get(l["key"]):
            ws.cell(r, 10, str(position)).data_type = "s"

    def write_group(group, r, depth):
        """A section's heading, its lines, its sub-sections and its subtotal. SUBTOTAL skips the nested
        subtotals, so every level sums its lines once; the quantity only when the unit is shared, as the sheet."""
        _row(ws, r, [group.code if group.code != "~" else "", group.title, "", "", "", "", "", ""], BOLD, SEC_FILL)
        ws.cell(row=r, column=2).alignment = Alignment(indent=depth)
        r += 1
        first = r
        for l in group.lines:
            # The section a line was exported under: what the edits import compares a moved row with.
            write_line(r, l, group.code if group.code != "~" else "")
            r += 1
        for child in group.sorted_children():
            r = write_group(child, r, depth + 1)
        members = group.all_lines()
        units = {l["unit"] for l in members}
        shared = next(iter(units)) if len(units) == 1 and any(l["quantity"] is not None for l in members) else None
        _row(ws, r, ["", f"Subtotal {group.title}", shared or "", f"=SUBTOTAL(9,D{first}:D{r - 1})" if shared else "", "",
                     f"=SUBTOTAL(9,F{first}:F{r - 1})", "", f"{len(members)} line{'' if len(members) == 1 else 's'}"],
             BOLD, SUB_FILL, formula_cols=(4, 6))
        ws.cell(row=r, column=2).alignment = Alignment(indent=depth)
        if shared:
            ws.cell(row=r, column=4).number_format = _qfmt(None, max(_decimals(l["quantity"]) for l in members))
        ws.cell(row=r, column=6).number_format = NUM
        return r + 2

    r = 6
    for group in root.sorted_children():
        r = write_group(group, r, 0)
    _row(ws, r, ["", "TOTAL", "", "", "", f"=SUBTOTAL(9,F6:F{max(r - 1, 6)})", "", ""],
         Font(name=F, size=11, bold=True), formula_cols=(6,))
    ws.cell(row=r, column=6).number_format = NUM
    if meta.get("boqId"):
        annotate(wb, str(meta["boqId"]), primary, roundtrip_rows)

    if meta.get("project") or meta.get("boq") or label or meta.get("watermark"):
        cover = wb.create_sheet("Cover", 0)
        cover["A1"] = "Bill of Quantities"
        cover["A1"].font = TITLE
        cover.column_dimensions["A"].width = 24
        cover.column_dimensions["B"].width = 82
        details = [
            ("Project", meta.get("project")), ("Bill", meta.get("boq")), ("Version", label),
            ("Status", "WORKING" if working else status), ("Model", meta.get("modelName")),
            ("Grouping", systems[0]["name"] if systems else None), ("Generated", meta.get("generatedAt")),
            ("Saved by", meta.get("issuedBy")), ("Saved at", meta.get("issuedAt")), ("Note", meta.get("issueNote")),
            ("Locale", meta.get("locale")), ("Number format", _number_format(meta["numberFormat"])
             if meta.get("numberFormat") else None),
        ]
        for row, (heading, value) in enumerate(((name, data) for name, data in details if data is not None), 3):
            _row(cover, row, [heading, value], wrap_cols=(2,))
        if meta.get("watermark"):
            _row(cover, 19, [meta["watermark"] if isinstance(meta["watermark"], str) else "Made with boqlet"], SMALL)
        wb.active = cover

    excluded = [line for line in lines if line.get("excluded")]
    if excluded:
        we = wb.create_sheet("Excluded lines")
        _header(we, 1, ["Key", "Description", "Unit", "Quantity", "Reason"], [34, 60, 10, 14, 58])
        we.freeze_panes = "A2"
        for i, line in enumerate(excluded, start=2):
            _row(we, i, [line["key"], line["description"], line["unit"], line["quantity"],
                         line.get("overridden", {}).get("reason")])

    # ------------------------------------------------------------------ Calculation
    wc = wb.create_sheet("Calculation")
    wc["A1"] = "How every quantity was calculated"
    wc["A1"].font = TITLE
    wc["A2"] = "Each line: its formula and parameters, then every element's contribution with the values used."
    wc["A2"].font = SMALL
    _header(wc, 4, ["Line / element", "Quantity", "Unit", "Formula / explanation", "Element GUID"], [60, 12, 7, 110, 26])
    wc.freeze_panes = "A5"
    r = 5
    for l in lines:
        params = ", ".join(f"{k}={json.dumps(v)}" for k, v in l["trace"].get("params", {}).items())
        _row(wc, r, [l["description"], l["quantity"], l["unit"],
                     f"{l['trace']['formula']}" + (f"   [{params}]" if params else ""), ""], BOLD, SEC_FILL, wrap_cols=(1, 4))
        wc.cell(row=r, column=2).number_format = _qfmt(l["quantity"])
        r += 1
        for item in l["trace"].get("steps", []):
            _row(wc, r, ["    " + describe_step(item), item["value"], item.get("unit"), "", ""], SMALL)
            r += 1
        for e in l["trace"]["elements"]:
            note = "; ".join(x for x in [e.get("note"), *map(decision_note, e.get("decisions") or ())] if x)
            _row(wc, r, ["    " + (e.get("name") or e["guid"]), e["quantity"], l["unit"], note, e["guid"]],
                 NORMAL, None, wrap_cols=(1, 4))
            wc.cell(row=r, column=2).number_format = _qfmt(e["quantity"])
            r += 1
        if l.get("trace", {}).get("sourceLine"):
            _row(wc, r, ["    derived from line: " + l["trace"]["sourceLine"], "", "", "", ""], SMALL)
            r += 1

    # ------------------------------------------------------------------ Lines
    wl = wb.create_sheet("Lines")
    cols = ["Key", "Rule", "Kind", "Description", "Unit", "Quantity", "Source"]
    widths = [40, 18, 9, 60, 7, 12, 10]
    for s in systems:
        cols += [f"{s['name']} code", f"{s['name']} title"]
        widths += [12, 30]
        if s["id"] in text_systems:
            cols.append(f"{s['name']} item text")
            widths.append(50)
    cols.append("Measured as")
    widths.append(60)
    cols += ["Formula", "Elements", "Storey", "Notes"]
    widths += [50, 9, 16, 40]
    _header(wl, 1, cols, widths)
    wl.freeze_panes = "A2"
    for i, l in enumerate(lines, 2):
        vals = [l["key"], l["ruleId"], l["ruleKind"], _description(l, primary), l["unit"], l["quantity"], l["source"]]
        for s in systems:
            c = l["codes"].get(s["id"])
            vals += [c["code"] if c else "", c["title"] if c else ""]
            if s["id"] in text_systems:
                vals.append(c.get("text", "") if c else "")
        vals.append(l.get("overridden", {}).get("engineDescription", l["description"]))
        loc = l.get("location") or {}
        vals += [l["trace"]["formula"], len(l["trace"]["elements"]), loc.get("storey") or ", ".join(loc.get("storeys", [])),
                 "; ".join([*([to_confirm_note(l["toConfirm"])] if l.get("toConfirm") else []), *l.get("notes", [])])]
        _row(wl, i, vals)
        wl.cell(row=i, column=6).number_format = _qfmt(l["quantity"])
    wl.auto_filter.ref = f"A1:{get_column_letter(len(cols))}{len(lines) + 1}"

    # ------------------------------------------------------------------ Log
    wg = wb.create_sheet("Log")
    _header(wg, 1, ["#", "Stage", "Level", "Message", "Rule", "Line", "Element"], [6, 10, 9, 120, 18, 30, 24])
    wg.freeze_panes = "A2"
    for i, e in enumerate(result["log"], 2):
        _row(wg, i, [e["seq"], e["stage"], e["level"], e["message"], e.get("ruleId"), e.get("lineKey"), e.get("guid")],
             NORMAL, FLAG_FILL if e["level"] == "warning" else None)
    wg.auto_filter.ref = f"A1:G{len(result['log']) + 1}"

    # ------------------------------------------------------------------ Questions
    wq = wb.create_sheet("Questions")
    _header(wq, 1, ["Type", "Id / code", "Blocking", "Message", "Elements"], [16, 40, 9, 110, 10])
    r = 2
    for q in result["questions"]:
        _row(wq, r, ["question: " + q["kind"], q["id"], "yes" if q["blocking"] else "no", q["message"], len(q.get("guids") or [])],
             NORMAL, FLAG_FILL if q["blocking"] else None, wrap_cols=(4,))
        r += 1
    for w in result["warnings"]:
        _row(wq, r, ["warning", w["code"], "", w["message"], len(w.get("guids") or [])], NORMAL, None, wrap_cols=(4,))
        r += 1
    for c in result["checks"]:
        _row(wq, r, ["check: " + c["severity"], c["code"], "", c["message"], len(c.get("elementIds") or [])], NORMAL, None, wrap_cols=(4,))
        r += 1

    # ------------------------------------------------------------------ Inputs
    wi = wb.create_sheet("Inputs")
    wi["A1"] = "Inputs of this run"
    wi["A1"].font = TITLE
    rs = result["ruleSet"]
    info = [("Model", meta.get("modelName")), ("Model id (sha256)", meta.get("modelId")),
            ("Rule set", f"{rs['name']} ({rs['id']} v{rs['version']})"), ("Rule set chain", rs["meta"].get("chainLabel") or rs["meta"].get("chain")),
            ("Dictionaries", ", ".join(meta.get("dictionaries", []))),
            ("Classifications", ", ".join(s["name"] for s in systems)),
            ("Decisions applied", result["stats"]["decisionsApplied"]),
            ("Elements", result["stats"]["elements"]), ("Measured", result["stats"]["measuredElements"]),
            ("Excluded", result["stats"]["excludedElements"]), ("Unmatched", result["stats"]["unmatchedElements"]),
            ("Engine time (ms)", result["stats"]["durationMs"])]
    for i, (k, v) in enumerate(info, 3):
        wi.cell(row=i, column=1, value=k).font = BOLD
        wi.cell(row=i, column=2, value=v).font = NORMAL
    r = 4 + len(info)
    _header(wi, r, ["Parameter", "Value", "Unit", "Label"], [28, 40, 8, 70])
    for name, p in rs["params"].items():
        r += 1
        _row(wi, r, [name, json.dumps(p.get("value")) if not isinstance(p.get("value"), (int, float, str)) else p.get("value"),
                     p.get("unit", ""), p.get("label", "")])
    if len(result.get("models", [])) > 1:
        r += 2
        _header(wi, r, ["Model (federation)", "Discipline", "Taken", "Of elements / left to others / duplicates / excluded / taken without owner"],
                [28, 40, 8, 70])
        for m in result["models"]:
            r += 1
            _row(wi, r, [m["fileName"], m["discipline"], m["taken"],
                         f"{m['elements']} / {m['leftToOthers']} / {m['duplicates']} / {m['excludedByScope']} / {m['takenWithoutOwner']}"])
    if meta.get("decisions"):
        r += 2
        _header(wi, r, ["Decision (question id)", "Answer", "", ""], [28, 40, 8, 70])
        for d in meta["decisions"]:
            r += 1
            _row(wi, r, [d["questionId"], json.dumps(d.get("answer")), "", d.get("note", "")])

    if meta.get("publicShare"):
        del wb["Questions"]
        del wb["Inputs"]
        if not meta.get("publicLog"):
            del wb["Log"]
        if not meta.get("publicLineDetail"):
            del wb["Calculation"]
            del wb["Lines"]
    for sheet in wb.worksheets:
        sheet.sheet_view.showGridLines = False
    _text_only(wb)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
