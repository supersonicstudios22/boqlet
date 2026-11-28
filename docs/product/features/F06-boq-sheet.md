# F06 BoQ sheet

> **Status (2026-11-22):** Built. Virtualised sheet, grouping, line detail and "How it is calculated", every edit kind, manual lines, undo, positions and live co-editing are built. Keyboard editing: the selected line has an active cell (ArrowLeft/Right), F2 or Enter edits it (TF-159); the grid is one Tab stop (TF-161). Numbers follow the org's format (TF-021). An edit refused because the session ended or the API was unreachable is kept and offered again (TF-146, TF-183). The "not in the models" notice's collapse is a per-user server preference (P54 Q55, TF-109). A line with a quantity that some elements did not feed, or that rests on an open contradiction, shows "To confirm" with the reason ("2 of 3 elements measured") and is found by the "to confirm" filter (review WP-A2, A-05; `toConfirm` on the line, contract change C20). "How it is calculated" names the decisions a step's elements rest on, with who answered and when ("Per Ana's decision of 23 Nov 2026: the value measured from the geometry"; A-06, C21); the run counts every decision it used. The workspace fills the screen on the Sheet tab (review WP-C1, C-01): the project's name and sections on one line, the BoQ's name, state, run figures and actions on one line, the "not in the models" counts and the run's warnings at the end of the tabs row, one filter bar (Group by, a Filters popover whose choices show as removable chips, search) and the actions in a fixed order (Undo · Add line · Excel · Model · Columns, one "⋯" menu below 1280 px); the grid takes the rest of the height and is the page's one scroll container (≥ 20 rows at 1440×900); the bulk bar floats over the grid's foot. A status gutter next to No. marks derived, manual and to-confirm lines whatever the width or the 3D pane (C-02; the Source column is gone). A line's detail is a resizable drawer over the model pane (or beside the grid without it, at most 45 %), so Description keeps ≥ 320 px at 1440 px; the selected line's description wraps to two lines; "Model open" and the split are server-side user preferences, and a first visit opens the model narrow (C-03, contract change C27). Keyboard: no focus jump on load (also under StrictMode), "Skip to the sheet", one Tab stop per toolbar, focus rings on the separators, `g s` / `g q` / `?` (C-04). While a BoQ's first run works, the Sheet tab shows the grid's outline with "Generating… lines appear when the run finishes" instead of "Generate the BoQ"; later runs keep the previous sheet on screen (C-05). A header click sorts the lines inside their groups (ascending, descending, back to the sheet's order; `aria-sort`; the same choice by keyboard in Columns › Sort), lines without a value last; Columns offers the row height (Compact 28 / Default 32 / Comfortable 36 px) and "Wrap text" (descriptions clamped at three lines, rows measured by the virtualiser), both server-side user preferences (contract change C28); a column's right edge drags to resize and double-clicks to fit, the widths kept per BoQ in this browser, "Reset column widths" puts them back (review WP-C2, C-06). "Group by" also offers Storey and "Measured as" (the rule that measured the line), without a classification: a view, numbers unchanged; a BoQ with no classification opens by storey when its lines have storeys, and the sheet's Excel is grouped the same way (`groupBy` `~storey` / `~rule`, contract change C29; C-07). Edits, manual lines, answers and changed inputs the run doesn't have yet are named in one banner under the header ("3 edits and 1 answer not applied yet." · Apply now (generate again) · What's waiting · "Save version waits until they are applied."), the edits counted from the run's lines (C-08). The command palette (⌘K / Ctrl+K, top bar) lists the BoQ's actions ("Generate again", "Export Excel", "Go to the questions") with projects, BoQs, models and presets found by name (`GET /orgs/{orgId}/search`, only what the person can open; contract change C30; C-09). The line detail names each element's measured inputs and where each came from (a property, the layer set, the measured faces, volume ÷ thickness…), and lists the measure log entries of its elements (review WP-C3, C-10; `inputs` on trace elements, `elementLog`, contract change C31). Its shares and their total show 3 decimals with the line's unit, and units in log text read m², m³ (C-11).
> **Not built / differs** (also in [known limitations](../known-limitations.md)):
> - Above 20,000 lines the sheet opens grouped on the server (review B-19, `features/boq-sheet/large-sheet.tsx`): the groups of the "Group by" system collapsed with their subtotals, a group's lines loaded 500 at a time, a line's detail as usual. That view is read-only for now (no inline edits, moves, manual lines or the shared filter with the 3D view), and the Changes and Exports tabs still load every line (N-40).

## Purpose

The working view of a BoQ: every line, grouped and subtotalled by any attached code system,
traceable to its elements and formula, and fully editable: any line's quantity, text, unit,
section and position can be changed, lines added or excluded (P20). Edits are kept across
regenerations and new model versions, and are always visible as edits (BR-09).

## Layout (BoQ workspace)

```text
┌ Project / BoQ name · Working (last saved B) · run 14:02 · 412 lines · 3 flagged ─ [Generate] [Save version] ┐
│ Tabs: Sheet | Questions (7) | Viewer | … | Versions (+ module tabs)   ⓘ 120 measured · 8 derived · …  │
├──────────────────────────────────────────────────────────────┬─────────────────────────────────────┤
│ Group by [ACME ▾] [Filters ▾] (Source: derived ×) [search…]   Undo · Add line · Excel · Model · Columns │
│ No.    ▪ Item   Description                   Unit    Qty      Storey           │ Line detail      │
│ ▸ 2 Superstructure                                             subtotal …       │ formula          │
│   2.5  External walls                                                            │ params           │
│     2.5.1  Cavity wall, brick on block 290    m²     412.60   measured  L1      │ elements (n)     │
│     2.5.2 D Formwork to walls                 m²     825.20                     │ codes per system │
│ ▸ 9 Preliminaries                                                                │ notes, override  │
│     9.1    Site setup                         item     1      manual             │ [Show in 3D]     │
└──────────────────────────────────────────────────────────────┴─────────────────────────────────────┘
```

## Behaviour

1. **Data:** `GET /runs/{runId}/lines` returns lines with `codes`, `location`, `source`,
   `overridden`. The sheet groups client-side by the chosen system's `codes[system].path`
   (paging with server-side grouping only when lines > 20,000, see NFR). Lines without a code
   in the chosen system go to an "Unclassified" group at the end. They are never hidden (BR-03).
   **Built-in groupings** (review C-07, DEC-58): "Group by" also offers **Storey** (one section per
   storey in natural order, then "Several storeys", then "No storey") and **Measured as** (one
   section per rule, in the rule set's order, then "Added by hand"), each with the BR-63 subtotals;
   they need no classification and never change a number (rule 6). Under them Item, the item texts
   and the position numbers stay those of the first classification, and lines can't be dragged onto
   a section (a storey is no code). Without a classification the sheet opens by storey when the
   lines have storeys; the choice lasts for the visit. The Excel from the sheet uses the same grouping.
2. **Columns:** No. (position number, §13), the status gutter, Item (code in the "Group by" system), Description, Unit, Quantity, Storey, Family, Tags, Notes,
   and one column per extra classification (toggleable). The **status gutter** (review C-02, D112) is an 18 px
   column next to No. that marks a line's source and is always shown: a blue outlined "D" for derived, a
   yellow "M" for manual, an orange "!" for to confirm (with the reason, e.g. "2 of 3 elements measured"),
   nothing for measured; each mark is named by its word for screen readers and on hover. When room is short,
   Storey is hidden first (beside the model), and below 1280 px Item too, so No., the gutter, Description,
   Unit and Quantity stay; a column the person switched on or off keeps their choice. Units are displayed with superscripts
   (m² m³), and numbers use the project locale and the rule set's rounding (already applied by
   the engine). Quantity of flagged lines shows "—" with the reason.
   **Description** shows the line's **item text** in the "Group by" system
   (`codes[system].text`, P14, EN-010) when that code has one, else the rule set's line text
   (`description`). Switching "Group by" switches the texts with the grouping, client-side,
   because every line carries the filled text of each of its codes. Long item texts are one line
   by default; with Columns › "Wrap text" they wrap, clamped to three lines in the row, and are
   always shown in full in the line detail (review C-06).
   **Sorting, density, widths** (review C-06, DEC-46): a header click sorts by that column inside
   each group (the groups keep their code order; ascending, descending, then the sheet's own order
   again); text sorts naturally ("2.9" before "2.10") and lines without a value come last either way.
   The row height is Compact 28, Default 32 or Comfortable 36 px; it and "Wrap text" follow the user
   (server-side preferences). Dragging a column's right edge resizes it, a double-click fits it to
   the widest cell on screen; widths are kept per BoQ in the browser.
3. **Subtotals:** per group, the count of lines and (only when all lines in a group share one
   unit and at least one is measured) the sum of quantities; excluded lines are out of both
   (BR-63). No money in the sheet: prices live only in the optional pricing
   module's own Pricing tab (P32, F20).
4. **Filters:** source (measured, derived, manual, flagged, overridden), storey, family, model,
   text search over description and code. Filters never change the data, and the header shows
   "Filtered: 37 of 412 lines". The choices sit in a "Filters" popover; each filter in force is a
   chip in the filter bar that removes it, so the bar keeps one row (review C-01).
5. **Line detail panel** (`GET /runs/{runId}/lines/by-key?key=`), a drawer with its own scroll
   (review C-03): over the model when the model is open (resizable from its left edge), else
   beside the grid at no more than 45 % of the width, so Description keeps its room; the
   selected line's description wraps to two lines in the grid. It shows the item text in full,
   with the rule set's line text under it as "Measured as: Wall, Exterior - Brick on Block,
   417 mm" (so the user always sees what was measured), unit, quantity, source; the **trace**: formula in readable form (`apps/app/src/features/library/lib/readable.ts`),
   parameter values, elements table (GlobalId, name, model, share of quantity, note, and each
   element's measured inputs with where they came from: "Net volume 4.587 m³ · from
   PSet_Revit_Dimensions.Volume", "Thickness 0.417 m · from the material layer set", the
   geometry's value when it differs, the answer that chose a value; review C-10), source
   line for derived lines (clickable); codes in every system with their source (map rule,
   decision, IFC, default); location; notes; how its elements were measured (the measure
   log entries of its elements, the first 200); log entries for this line (filtered log).
   "Show in 3D" selects the line's elements in the viewer (F07).
   **How it is calculated** (P25, a main selling point): the top of the detail answers the
   question in plain words before any formula, built from the engine's structured trace
   steps (EN-013) with the readable-formula and item-sentence code (`apps/app/src/features/boq-sheet/how-calculated.tsx`):
   *"Area of both faces of 12 walls of type 'Exterior - Brick on Block' = 312.40 m². Minus 8
   openings larger than 0.5 m² (rule set answer 'Wall opening size limit') = −45.24 m².
   Result 267.16 m²."* Each step can be expanded to its elements; each rule-set value links to
   the Settings question it came from ("Your answer: 0.5 m²" → the Library); a derived line
   shows its chain ("Formwork = 2 × wall area of line 2.5.1" → that line); an edited line
   shows the engine's value, the edit, who and why. The formula in readable form, the
   parameters and the elements table stay below for checking. The same explanation is in the
   Excel "Calculation" sheet (F12) and in share links (F18).
6. **Line edits** (draft revisions, estimator+, P20). The sheet is edited like a spreadsheet:
   - **Overwrite** a cell: quantity (or "mark as flagged"), description (the item text or line
     text), unit. Changing the unit needs a new quantity too (`409 unit_needs_quantity`): a
     number in m² doesn't become m³ by relabelling.
   - **Move** a line to another section: drag it onto a group row, or change its Ref to another
     code of the "Group by" system. The move is the line's code in that system; other
     systems keep theirs.
   - **Reorder** lines within a section by dragging. Order is presentation only.
   - **Exclude** a line: it leaves the totals and the exports' BoQ sheet, but stays in the sheet
     struck through under the "Excluded" filter, and in an "Excluded lines" sheet of the
     Excel (BR-03). Its derived lines leave it out too, as for an edit to 0 (P54); "How it is
     calculated" shows the source as excluded.
   - **Bulk:** select lines (checkboxes, shift-click, a section, a filter result or elements in
     the 3D view) → move to section, exclude, plus any action a module adds (extension point
     `sheet.selectionActions`; pricing: request offers).
   Every edit of a line is one `LineOverride` (by line key) with the changed fields. A reason
   is required for quantity changes and exclusions, optional for text, unit, moves and order.
   Edits are saved as they are made (`POST /boqs/{boqId}/overrides`), show at once, and apply
   on the next run (only the engine computes, rule 4; review C-08, DEC-38): until then one banner
   under the BoQ header names what waits ("3 edits and 1 answer not applied yet."), lists it on
   "What's waiting" (each edited, added, removed or undone line, the answers, the changed inputs),
   offers **Apply now (generate again)** to whoever can generate, and says that Save version waits
   until they are applied. The edits are counted from the run's lines (each carries the edits it
   was generated with); a BoQ grouped on the server names them without a count. The sheet's Excel
   asks first (A-41). Applied that way, quantity edits feed derived lines (formwork follows an edited concrete
   area, EN-003), and so do exclusions. Edited cells carry a marker; hovering shows the engine's value; "Restore"
   per field or per line removes the edit. The last 20 edits can be undone (Ctrl+Z). Filter
   "Edited" lists them. Edits are carried to new revisions and appear in the change report
   (`override_changed`), the review screen (F09) and the Excel (F12).
7. **Manual lines** (draft, estimator+): "Add line" between any two rows or at the end of any
   group, or a toolbar button: description, unit, quantity (or a formula over `building.*`, validated by the
   engine through `POST /presets/check`), code per classification (prefilled with the group
   the user clicked), notes. Saved as `ManualItem` (`POST /boqs/{boqId}/manual-items`), applied on
   the next run as an engine manual item, so it is coded, logged and exported like any line.
   Edit and delete in place.
8. **Warnings**: run warnings (e.g. models don't overlap in space, missing meshes), each with
   affected elements. Closed they are one button ("2 warnings") at the end of the workspace's tabs
   row beside the source counts; open, the list shows above the sheet (review C-01).
9. **Log tab:** `GET /runs/{runId}/log` paged, filter by stage, level, rule, line key, element
   GlobalId (`apps/app/src/features/boq-sheet/log-tab.tsx`).
10. **Keyboard:** arrow keys move the selection, Enter opens detail, `/` focuses search.
    Selection is shared with the viewer. Opening the page leaves focus where it is (no jump to
    a button); a second skip link, "Skip to the sheet", puts the grid three Tab stops from the
    top; the filter bar and the actions are one Tab stop each (arrows inside, `role="toolbar"`);
    the resize separators show a focus ring; `g s` goes to the sheet's grid, `g q` to the
    questions, `?` lists every key (review C-04).
11. **Read-only modes:** saved versions, confirmed BoQs, and users without edit rights, see the sheet with no
    edit actions. Saved versions and confirmed BoQs are read-only for everyone (F09).
12. **Not in the models** (P15, BR-12): the app says plainly that it measures only what the
    models contain, and that the rest is the user's to add:
    - A notice on every sheet: the counts by source ("120 measured · 8 derived · 3 manual · 2 to
      confirm") at the end of the workspace's tabs row, with a button that opens the paragraph
      under it: "This BoQ contains what the models contain. Work not modelled as objects (for
      example earthworks, plaster, screed, waterproofing, reinforcement, scaffolding, site setup)
      is in it only if your rule set derives it or you add it." Collapsible to the counts line
      per user; never removed. "Add line" is the sheet toolbar's (review C-01: the notice no
      longer repeats it).
    - The same paragraph is the empty state of a group with no lines and of the "Add line"
      dialog's help.
    - Saving a version asks for a confirmation (F09 §2).
    - The Excel export carries it as a note (F12).
    The examples come from the message catalogue (EN-004), not from the rule set: they are a
    reminder, not a check. The app does not try to guess what is missing.

13. **Position numbers** (P30, BR-28): every line has its own number inside its section: the
    section's code plus a running number (`5.1`, `5.2`, … or `D.01.1` under a deeper code; the
    separator comes from the code list). Numbers follow the line order (engine order, then
    reorders and moves, F06 §6) and renumber at once in the working version as lines are added,
    moved, reordered or excluded (excluded lines get no number). A saved version freezes them:
    its Excel, share links and (pricing module) offer requests keep those numbers. Lines without
    a code in the grouping system are numbered under "Unclassified" (`0.1`, `0.2`). The backend
    computes them (presentation, BR-01 allows it) and returns them as `positionNo`.
14. **Live co-editing** (P31, BR-29): everyone with the BoQ open sees who else is in it
    (avatars in the header, a coloured marker on the line someone is editing). Each saved edit is
    pushed to the others within a second (SSE `boq.line_edited`) and applied to their sheet
    without a reload; generated runs and saved versions arrive the same way. Two people editing
    the same line: the later save wins, and the earlier editor sees "Ana changed this line just
    now" with her value and an undo for their own. Undo (Ctrl+Z) is per person and only for their
    own edits. Edits to different lines never conflict.

## Edge cases

- 20k+ lines (large federated models): virtualised rows, grouping on the server
  (`GET /runs/{runId}/lines?groupBy=system&level=2` returns group rows with counts), lazy
  loading of children.
- A manual line coded to a code that no longer exists in a new classification version: it
  lands in "Unclassified", and an `unclassified` question appears if the map says so.
- Override on a derived line whose source line changes: the override still wins, and the
  change report lists `override_changed`/`rules_changed` causes.

## API

`GET /runs/{runId}/lines`, `GET /runs/{runId}/lines/by-key`, `GET /runs/{runId}/warnings`,
`GET /runs/{runId}/log`, `GET /boqs/{boqId}/overrides`, `POST /boqs/{boqId}/overrides`,
`DELETE /overrides/{overrideId}`, `GET /boqs/{boqId}/manual-items`,
`POST /boqs/{boqId}/manual-items`, `PATCH /manual-items/{itemId}`,
`DELETE /manual-items/{itemId}`, `POST /boqs/{boqId}/overrides/batch`, `POST /presets/check`;
share: `POST /boqs/{boqId}/share-links` (F18). Modules add their own actions through extension
points (pricing: offer requests, F11).

## Acceptance criteria

- [ ] Switching "Group by" between two attached classifications regroups instantly (no request) and keeps every line visible.
- [ ] Every line's detail shows formula, parameters and element shares that sum to the line quantity (within rounding).
- [ ] A quantity edit, a text edit, a move to another section, a reorder and an exclusion each survive regeneration and a new model version, and appear in the Excel export (the quantity edit with its reason).
- [ ] Changing a unit without a quantity is refused with the reason shown; Ctrl+Z undoes the last edit.
- [ ] Every line's detail starts with a plain-words "How it is calculated" whose steps add up to the line quantity, with each rule-set value linked to its Settings question.
- [ ] A manual line added under group "9 Preliminaries" appears there after regeneration, with the code of that group.
- [ ] With a classification that has item texts, Description shows the filled item texts; switching "Group by" to a system without texts shows the rule set's line texts; the line detail shows both.
- [ ] The "not in the models" notice and the counts by source are visible on every draft BoQ sheet, and collapsing it is remembered per user, on the server, so in every browser (`GET /me` `preferences`, Q55, P54).
- [ ] Position numbers renumber at once after a move or exclusion in the working version and stay unchanged in a saved version.
- [ ] Two browsers on the same BoQ: an edit in one appears in the other within 1 s; editing the same line in both keeps the later edit and tells the earlier editor.
- [ ] The sheet scrolls smoothly at 20,000 lines (60 fps target on a mid-range laptop; measured in a perf test).
