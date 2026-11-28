# F12 Exports

> **Status (2026-11-28):** Built. The workbook prints landscape, one page wide, with repeated headers and a footer; the Free-plan watermark is the header of every printed page (review C-21). The sheet's Excel never exports a stale run silently: with edits or answers waiting it asks "Generate and export" or "Export the last run", whose cover says what it leaves out; run Excel names carry the run's time (review A-41). Run Excel, frozen version Excel, change-report Excel and Excel edits import (`apps/app/src/features/exports`, Java `boq/BoqExports`, engine `export_xlsx.py`, `sheets/boq_import.py`). The workbook follows the sheet's order and positions (TF-049), nests sections by the full code path with subtotals (TF-054) and shows each quantity with its own decimals (TF-055); the edits import keeps new rows in their group (TF-051).
> **Not built / differs:**
> - F12-AC1 is half automated: since review B-11 CI opens the run, saved-version and change-report workbooks in LibreOffice (printed to PDF, saved again with every formula recalculated; the recalculated amounts, subtotals and total equal the engine's, protection and the edits import survive). Opening them in Microsoft Excel is still a check by hand.

## Formats in v1

| Export | Content | Produced by | Trigger |
|---|---|---|---|
| **BoQ Excel** (per run) | Sheet grouped by a chosen classification, or by storey or "measured as" (`groupBy` `~storey` / `~rule`, review C-07; Ref and the numbers stay the first classification's, and the edits import reads those sections as headings): ref, description, unit, quantity, source, notes; nested sections as the sheet, each with its line count and, when the unit is shared, its quantity; amounts as SUBTOTAL formulas; a "Lines" sheet with every column; a "Trace" sheet (line → elements); a "Questions" sheet; cover sheet: project, BoQ, revision, run time, presets and versions, status (WORKING watermark unless it is a saved version; free-plan watermark per entitlements) | engine `export_xlsx.export` (extended: EN-006) | `POST /runs/{runId}/exports` |
| **Saved version Excel** | Same, with version label, save date, who saved it, note; frozen when saved (BR-25) | engine | when the version is saved |
| **Change report Excel** | Line changes with before/after/Δ/Δ%/causes; element changes | engine | `POST /diffs/{diffId}/export` |
| **Decisions CSV** | Project decisions table | backend | decisions page |
| **Audit CSV** | Filtered audit events | backend | audit page |

## Behaviour

- **Description column:** the line's item text in the export's grouping classification when
  its code has one (P14), else the rule set's line text. Item texts wrap in the cell. The
  "Lines" sheet has both: a column "Measured as" (rule set's line text) and one item-text
  column per classification that has texts.
- **Not in the models** (P15, BR-12): a note above the BoQ table: "Quantities are taken from
  the models only. Work not modelled as objects is included only where derived or added by
  hand (N manual lines)." Translated through the export's message catalogue.

- Exports are **jobs** (`export_xlsx`; modules add their own, e.g. `pricing.*`), usually done in
  seconds. The UI shows a spinner, then downloads via `GET /exports/{exportId}/download`
  (302 to a signed URL). Small CSVs stream directly.
- Every export records `Export {id, kind, subjectId, fileName, storageKey, createdBy, createdAt}`
  and an audit event. Downloads of saved-version exports are audited too (`export.downloaded`).
- File names: `{projectCode or name}_{boqName}_Rev{label}_{yyyy-mm-dd}_run{yyyymmdd-HHmmss}.xlsx`, sanitised;
  the first date is the export's, `run…` when the run finished (UTC), so two runs' files never share a
  name and an older run is not read as today's (A-41, CAS-027).
  The change report keeps `..._{yyyy-mm-dd}_changes.xlsx`.
- **The sheet's Excel and pending inputs** (A-41, DEC-38): the sheet shows the run with the edits and
  answers saved since, but a workbook is always written from a run (only the engine computes). When the
  working version has pending changes, the Excel button asks: **Generate and export** (the default for
  someone who can edit the BoQ: a new run, then its Excel) or **Export the last run**. The last run's
  workbook then has a cover row "Not included" ("Changes made after this run (time): line edits,
  answers. Generate the BoQ again to include them.") and a note in the BoQ sheet's header line; the API
  passes the revision's `pendingChanges` to the export job as `meta.pendingChanges`. Nothing is
  regenerated without asking.
- **Printing** (review C-21): every sheet of the BoQ workbook prints with no page setup by hand:
  landscape, one page wide (as many pages down as it needs), its header row repeated on every page,
  the BoQ sheet's print area Ref to Notes (the hidden line key is not printed), and a footer
  "project · BoQ · version (· WORKING)" with "Page x of y". The paper size is the printer's. The
  Duplex BoQ prints on two landscape pages (checked in LibreOffice by `test_export_libreoffice.py`).
- **Watermark** (`exportWatermark`, Free plan; review C-21, PRD-026): "Made with boqlet (Free plan)" in
  the header of every sheet, so on every printed page. No cell carries it (it was Cover!A19). The
  share page of such an org shows a small "Made with boqlet" note with a link (F18).
- Locale: number formats and date formats from the project locale. Column headers are
  translated through the export's message catalogue (English in v1, P07).
- Units: as in the run (metric or imperial per project).

## Editing in Excel and importing back (P20)

The BoQ Excel can be edited and uploaded back, so people who prefer Excel lose nothing on the
next revision.

- The BoQ sheet carries each line's key in a hidden, protected column; the workbook is
  otherwise free to edit.
- **Import edits** (BoQ workspace › Exports, draft revisions, estimator+): upload the edited
  file → `import_boq_edits` job (engine, EN-006) → a review list: quantity, description and
  unit changes per line, lines moved to another section (a row moved under another group
  heading or its Ref changed), lines deleted (proposed as exclusions), new rows without a key
  (proposed as manual lines under the group they sit in), rows it couldn't read. The user
  ticks what to apply and gives a reason where F06 §6 requires one. Applied changes become
  line edits and manual lines like any made in the sheet.
- A quantity typed as text is read with the firm's separators (Organisation settings, number format): "1,234" is 1234 where "," groups thousands and 1.234 where it is the decimal mark; a thousands mark that does not group three digits, or the other separator, is that row's problem rather than a guess (review A-30, D94). Number cells are taken as they are. The review list shows the value read.
- Rate and Amount columns are ignored on import (no prices in the BoQ, P04).
- A file exported from another BoQ, or from a run whose line keys no longer exist, is reported
  line by line ("line not in this BoQ"), never applied blindly.

Pricing module exports (priced BoQ, offer comparison, offer request workbook, pricebook
template) belong to the module (F20 §5); the core export offers module code the BoQ workbook
data through `ExportDataService` and knows nothing about prices.

## Later

GAEB DA XML, ÖNORM A 2063, CSV of lines, IfcCostSchedule, PDF print layout.

## API

`POST /runs/{runId}/exports`, `GET /revisions/{revisionId}/exports`, `GET /exports/{exportId}`,
`GET /exports/{exportId}/download`, `POST /diffs/{diffId}/export`,
`GET /projects/{projectId}/decisions.csv`, `GET /projects/{projectId}/audit.csv`,
`POST /revisions/{revisionId}/edits-import`, `GET /jobs/{jobId}/edits-import-report`,
`POST /boqs/{boqId}/overrides/batch` (apply the reviewed edits).

## Acceptance criteria

- [ ] A Duplex run's Excel opens in Excel and LibreOffice without repair prompts, and its totals match the sheet.
- [ ] With a classification that has item texts, the BoQ sheet's Description column holds the filled texts, and the "Lines" sheet holds both texts.
- [ ] An export of the working version carries a WORKING watermark. A saved version's export doesn't, and is frozen.
- [ ] A Duplex BoQ Excel with one quantity changed, one row moved to another section, one row deleted and one row added imports as exactly one quantity edit, one move, one proposed exclusion and one proposed manual line.
