# Limitations history (archived)

> **Archived.** Sections moved out of the old `docs/11-roadmap-and-open-questions.md` on 2026-11-21
> because they describe builds that no longer exist: the proof of concept's dev build (removed in
> FE-046, git tag `poc-final`) and phase 1 of the product build on the mock API (removed by P53).
> Current limitations: [../product/known-limitations.md](../product/known-limitations.md).

## Known limitations of the dev build

- The API is **synchronous**; large files block the request. Upload limit 300 MB (`IFC_BOQ_MAX_UPLOAD_MB`).
- **Answers live in browser memory** for the current model and are sent with every run; reloading
  the page loses them. The CLI accepts a decisions file.
- The **Library** keeps unsaved drafts in browser memory (lost on reload). **Save** writes a draft to
  `presets/user/` (git-ignored, local to this machine, no versions or history); BoQ runs then offer it.
  Shipped presets are never overwritten, a changed one is saved under a new name as a full copy
  (not as a patch on the shipped one). Saving under a renamed id leaves the old file. Runs read
  `presets/` and `presets/user/`; the engine reloads them on every run.
- **Renaming across documents**: renaming an item offers to update the classification maps that use
  its id (as drafts to save) and, in a set based on another, replaces the parent's item and follows its
  calculated items; renaming an answer follows items that choose by it, follow-up questions and
  `p.x = "…"` in formulas. Not followed: description templates that print the old answer, and maps
  or rule sets stored anywhere but this machine (there is no shared store yet).
- **Cached parses** made before parse format 2 are parsed again on the next upload of the same file
  (`PARSE_FORMAT` in `parse.py`), which takes as long as a first upload.
- **Readable formulas** cover formula fields only. Description templates (`{thickness*1000}`) and
  line-split expressions (`IF(p.lines_by_storey, storey, "")`) are read back in words (item sentence,
  "Reads as", split chips) but still typed as code; dictionary terms inside formulas stay as ids
  (`"board.plasterboard"`). The item sentence recognises the common shapes (`IF(cond, field, "")`,
  `COALESCE`, `= null`); other formulas show in their readable form.
- The rule-set editor was clicked through by a headless browser script (item forms, the new-item
  starter, the sentence's jumps), not yet by a person against the 56 questions; expect rough edges.
- **Classification rows** say which rules decide a line's code from the map and the rule set's items
  alone; a condition on line values (material, element type, storey) is shown in words, not checked
  against a model. The BoQ view shows each line's actual code after Generate.
- **BoQ items** have no preview: what an item takes and the lines it makes are seen only after
  Generate. A preview against the loaded model (through the engine) is the next step for the form.
- No auth, single user, CORS allows only localhost:5173. Not for deployment beyond the Vercel demo
  (17): there, IFC files up to 4.4 MB, the engine forgets models between instances (the app re-sends
  them), and Library saves are temporary.
- `engine/.cache` grows with every upload and run; delete it freely.
- On Windows, uvicorn's auto-reload stops the old engine worker with a Ctrl+C console event. When
  `npm run dev:poc` runs without a console window (started by an IDE task or a background tool rather than a
  terminal), the event never arrives: the reload hangs and the old worker keeps serving the old code
  (new endpoints answer "Not Found"). Run it in a terminal, or restart it after engine changes and end
  any leftover `python.exe ... spawn_main` processes.
- The full result (lines, log) is returned in every response; fine for small models, page it in
  the platform.
- The UI loads the Archivo font from Google Fonts; offline it falls back to the system font.
- `npm audit` reports a moderate advisory in Vite 5's bundled esbuild that affects only the dev
  server; upgrading to Vite 6+ is a breaking change left for later.

## Known limitations of the product build (phase 1, `apps/app` + `apps/mock-api`)

Things the product build didn't do at the end of phase 1, on the mock, with the task that deals
with each. Phase 2 closed many of them (the real engine, Java, sign-in, the sample project);
FE-041 and FE-042 re-check each item against Java and the real engine and strike what is fixed.

- The limit dialog (402) says which limit was reached but offers no upgrade path yet (FE-019, FE-035).
- Deleting an org hides it at once; the 30-day removal of its data (BR-52) is not simulated by the
  mock.
- Sign-up in phase 1 is the mock's: any name and email, no verification (the real provider comes
  after BE-000, FE-043).
- Unknown fields are rejected only at the top level of a request body in the mock (nested objects
  pass); Java should reject them at every level.
- The sample project (FL-1 step 5) is created empty: its Duplex model, BoQ and answered questions need
  a parse and a run when the sample is created. Questions exist since FE-010; filling the sample is
  still open (with the seed's Duplex BoQ, mock-api.md "Seed data").
- The dashboard's "Needs you" list (filled at the end of phase 1, after FE-040; it had stayed empty): reviews
  assigned to me, changes requested on what I submitted, my runs that need input, newer model versions for
  BoQs I created, my jobs failed in the last 7 days. Computed by the mock on each request; refreshed on the
  realtime events of reviews, runs, BoQs, model versions, jobs and notifications. Modules add no kinds yet.
- Project cards count reviews as 0 until those exist (FE-031).
- Project default presets can't be chosen in the project's settings yet. A new project starts with the
  org's starred presets (FE-021, F02 §2), else As modelled and the global seed dictionary; per-BoQ
  pickers exist since FE-008; the wizard's "Publish all" sets defaults (FE-028).
- Models: scope rules can't be edited in the app yet (they need the Library's selector UI, ported with
  the rule-set editor in FE-022; no task names the model setting itself);
  check rows don't open the viewer yet (FE-016, F03-AC5); multipart uploads over 100 MB and resuming an
  interrupted upload are not built; abandoned `awaiting_upload` versions are not cleaned up after 24 h
  (the mock's scheduler, M6); processing minutes are counted for runs only, not parses (FE-019).
- BoQs (FE-008): Save version calls `POST /revisions/{id}/issue`, which the mock answers
  `501 not_implemented` until FE-031 (the button's blocking rule, BR-22, works); the Questions tab shows
  an old run can't be opened or compared from the run history yet (FE-030); a BoQ's model scope is shown, not editable (with the selector UI, FE-022); "Generate a BoQ" is offered on
  the model version page, not yet in the ready notification (FE-018).
- Sheet (FE-009): no position numbers in the No. column (FE-040); Description shows the rule set's line
  text, not item texts (FE-027, EN-010); "Show in 3D" opens the Viewer tab; on
  screens 1280 px and wider the sheet shows the model beside it (FE-014); the app loads up to 20,000 lines at once and doesn't yet switch to the
  server-side grouping above that (the mock serves it; FE-045).
- Sign-out (fixed at the end of M1, FE-012's work): a late 401 or the auth gate could overtake the
  redirect of a tab signed out with a reason; `src/auth/leaving.ts` lets the first redirect win.
- Entitlements (FE-019): the mock bills through the `manual` adapter only (no provider, no webhooks,
  no subscription status other than active; overrides per org come with the backend); the portal just
  returns. The free-plan banner about export watermarks waits for the real export (EN-006, F12). Usage
  before FE-019 has no project and isn't in "by project".
- Notifications (FE-018): the kinds the mock sends so far are a model version ready, a run that needs
  input, and job results for runs and exports; the others arrive with their features (versions,
  reviews, membership, limits, the pricing module's). `model_version.ready` is never emailed (F13: only
  when parsing took over 2 min); offer batching comes with MP1. Email preferences hold the core
  categories only. The bell's count refreshes on new notifications and on this tab's reads, not on reads
  in another tab.
- Run Excel (FE-017): written by the engine worker since EN-006 (cover, positioning, WORKING and plan
  watermarks, locked hidden line keys, "Excluded lines" and "Calculation" sheets); checked with openpyxl,
  not yet opened in Excel or LibreOffice by hand. The export job's toast is the sheet's own; the bell and
  job notifications are FE-018.
- Viewer (FE-016, FE-014): the *Changes* colour mode and F07-AC6 come with the change report (FE-030,
  EN-002). The shared filter bar has the sheet's filters plus code group and "only these lines": IFC
  class, type and material aren't on a line (they would need the element's properties, F07 §9) and
  "changed since a revision" needs FE-030. In the Viewer tab, *Source* and *Edited* use the run's edits;
  beside the sheet they use its current edits. The split layout and its width aren't remembered. Coverage's "excluded" is every element neither measured,
  unmatched nor covered by a parent (the PoC result doesn't say why an element was left out). Picking
  needs a click on a visible element; above 200,000 elements the merged meshes and id-buffer picking of
  architecture.md are not built (FE-045). "Show in 3D" from a question carries at most 300 GlobalIds in
  its URL.
- Not in the models (FE-015): collapsing the notice is remembered per user in this browser (`localStorage`,
  keyed by user id), not across devices: there is no user-preference endpoint in the contract. The sheet
  builds groups only from lines, so a group with no lines never shows; the paragraph is the empty state of a
  sheet with no lines and the help of the "Add line" dialog. The save-version tick comes with FE-031 (M3).
- How it is calculated (FE-013): the steps are the engine's own (EN-013), recorded where it calculates;
  the mock and Java add the edit's author. Runs made before EN-013 have no steps ("Generate again"). The edit
  step shows the edit the run applied; an edit made since shows in the line's edits, not in the steps, until
  the next run.
- Sessions (FE-012): the mock knows no place for a session (no IP lookup), so the takeover question
  names the device and the last activity only; a platform admin can't end a session yet (F19, FE-038);
  tokens without a session id (the shared suites, e2e helpers, dev tools) skip the one-session check in
  the mock: Java needs its own test-token strategy (`tests/support/users.ts`, BE-000).
- Line edits and manual lines (FE-011): the engine applies edits (EN-003: derived lines follow an edited
  quantity, an edit whose line is gone raises an `orphan_override` question) and a manual line's chosen codes
  (EN-007); a manual line has no notes (`ManualItem` has no field for them); undo keeps the last 20 edits of
  the open sheet only (not across reloads). The engine's check doesn't
  syntax-check a manual item's `formula` key (`presets.py` EXPR_KEYS): the app sends the formula as a
  formula slot the item points to, which it does check (EN-007 should add `formula` to the checked keys).
- Questions and decisions (FE-010): no "Show in 3D" or element properties from a question (F05 §9,
  FE-016); no model filter (questions carry no model; FE-016 with the element index); promoting needs an
  org dictionary: they can be created since FE-021 (Studio Demo has "Studio names"), and F05-AC5 is
  checked end to end with the dictionary editor (FE-024);
  F05-AC2 (a new model version asks nothing again) is checked with new model versions (FE-029);
  clearing a name answer keeps the entry it added to the project dictionary (edit it in the Library,
  FE-024); on the decisions page, rule and code answers are edited as text (the lists come from a run);
  the BR-23 dry run is skipped when no BoQ of the project is in review or approved, so answering stays one
  request; "used by latest runs" is approximate in the mock (mock-api.md "Decisions").
- Phase-1 interim (FE-008): federation and resolution settings are stored with the inputs but not sent
  to the engine (the PoC API takes neither; EN-001). A rule-set patch on an org or project version is run
  and checked with its parents saved or passed under `mock-<versionId>` (FE-021).
- Library (FE-021…FE-028): the three editors are the PoC's, ported (FE-022 rule sets, FE-023
  classifications, FE-024 dictionaries); federation and resolution settings are edited as JSON. Guided
  mode (FE-026) is the wizard's "How you measure" step for a rule set; for a classification it is the
  full classification editor with a short intro. Not yet: "rebase on latest" for a patch whose parent is
  archived, renaming an item id across classification maps (the PoC's `onItemRenamed`), and the import's
  "keep other columns" (`CodeListBuildRequest` has no `extra`). The "bring your own licence" notice is
  remembered per browser. An item text's "Reads as" sample needs a preview run in the panel beside the
  editor, and codes that only some lines of an item get (split by a condition) show no sample (conditions
  are never evaluated in the browser). Comparing two versions is a line diff of the JSON with sorted keys
  (F10 §5: a structured diff later). Archive can't be undone (the contract has no unarchive). Draft saves
  aren't audited (autosave); creating, renaming, starring, archiving, discarding and publishing are. The
  version list names who published a version, not who last saved a draft.
- Setup wizard (FE-028): steps 0, 1 (1a checklist, 1b details, 1c the six measuring screens, from the
  rule set's data and its setup markers, EN-011), 2, 3 and 4 work, with resume, the dashboard gate (P18),
  the Library's Guided setup button, the members' "not finished yet" notice and the sheet hint. Simpler
  than F16 for now: step 2 is the full classification editor (import, Codes per line with all the rule
  set's items, not only those switched on, no "Suggest codes" by name), step 3 the full dictionary editor
  (its Names tab, not filtered to "worth asking"); the review summarises in counts, not the editors' story
  sentences; the sample Duplex isn't offered as a model (the sample project is still created empty);
  "Setup in progress by {name}" for a second admin and "Start separately" aren't built (both work on the
  same drafts); a wall line measured in m³ shows in the preview as a new line and the m² one as removed
  (the unit is part of a line's key). v1 criterion 12 and F16-AC1 (a person new to the app, under 15
  minutes) are not checked by a person; the flows are automated in `e2e/setup.spec.ts`.
- Library drafts: a patch's draft follows its parent's latest published version when saved (F10 §2
  "Based on it"); a published version keeps the exact parent it was made on (data-model.md). Read-only
  users (members, and everyone on a system preset) see the editors inside a disabled fieldset: tabs,
  list rows and links work, but the filter boxes and pickers used only for looking (the dictionary's
  model-version picker, the classification's rule-set picker and code filter) are disabled too.
- Library preview (FE-025): a worker preview job since EN-005 (draft against published); one project's model
  versions at a time; no BoQ data changes, and the time counts as processing.
- Item texts (FE-027): filled by the engine since EN-010 with the rule template evaluator; an item
  text shows on one line in the sheet (rows are 32 px for the virtualised sheet; F06 §2's three-line
  clamp is not built), in full as a tooltip and in the line detail with "Measured as".
- Excel templates (FE-026): worker RPC since EN-012; a classification's Codes per line round-trips only
  single-item map rules (complex rules stay unchanged); the empty template on the create page is the kind's master preset's layout.
- Component tests: Testing Library and next-intl resolve the workspace root's React 18 while the app
  uses React 19, so render tests need the in-file workaround in
  `src/features/library/rule-set/rule-set-editor.test.tsx` (FE-046 removes the PoC and its React 18).
- New model versions (FE-029): "Reopen to update" is checked in the mock's unit tests only; a confirmed
  BoQ can't be reached in the UI until Confirm lands (FE-031), which adds it to the e2e flow. A BoQ that
  is in review or approved shows the badge without "Use vN" until FE-031 builds the warning that sends it
  back to the working state (BR-23). One notification per BoQ and person: three BoQs on one model give
  three.
- Change report (FE-030): computed by the engine worker since EN-002 (elements by GlobalId per model,
  parsed material references, causes from the run snapshots); F08-AC1 runs on the Duplex v1/v2 pair (EN-008).
  The default comparison is the last saved version's run. Lines are listed in full (no paging in the table)
  and the elements table shows 100 at a time.
- Versions (FE-031): a saved version opened read-only shows its frozen run's lines, but the line edits panel
  lists the BoQ's current edits (the frozen copy is kept, not shown yet). Position numbers aren't frozen
  (they come with FE-040). The review's warning before an edit is the Withdraw review button (the working
  version is read-only while in review); answering a question that a version in review used warns through
  the decisions dry run (FE-010) and withdraws it. Confirming with nothing new closes the working version
  (kept, hidden from the version list) and reopening takes it up again. Approval switched on for an org whose
  plan lacks `approvalWorkflow` is refused with `402`; the settings toggle doesn't say so before trying.
  The Excel export of the working version right after a save shares the saved version's run.
- Exports (FE-032): the Excel is still the PoC layout (no cover sheet, the WORKING mark is in the title line, not
  a watermark) until EN-006; F12-AC1 (opens without repair prompts) and AC2 are checked only through openpyxl;
  importing edits is FE-037. The audit CSV is the project's only (the org audit page and its CSV come with
  FE-033); its data column is the event's JSON.
- Audit (FE-033): the action filter offers a fixed list (F09's minimum set and the actions the build writes; the API has no list of the actions used); details show the event data's plain values. Retention hides older events in lists and CSVs; nothing is deleted in the mock.
- Notifications (FE-034): `limit.near` / `limit.reached` cover the org-wide usage limits; per-action limits (models per BoQ, file size) only answer `402`. The email categories are F13's five core ones (FE-018); modules add theirs with MP1.
- Versions e2e (FE-035): v1 criterion 3 runs on a v2 that renames one wall (no deleted or changed element, so no line changes) until EN-008's Duplex v1/v2 pair; criterion 4 is checked for one click to the formula, parameters, shares and the 3D view, not walked through by a person (M).
- Share links (FE-036): no rate limiting in the mock (the backend's, BE-030); the public page's sheet is a plain grouped table (no virtualisation, no filters beyond search), its line detail shows settings by their slot names (the rule set isn't public) and its viewer colours by element type only (no coverage). Models in the public viewer are named "Model 1, 2…" (file names aren't shared).
- Edits import (FE-037): read by the engine worker since EN-006 against the export's locked hidden keys and
  its stored snapshot; clearing a keyed row proposes an exclusion; a new row without a quantity and unit reads
  as a section heading. Rows are proposals only: applying needs the reasons F06 §6 asks for. Formatting and
  the Rate/Amount columns are ignored.
- Platform admin (FE-038): the console has no Vendors section (the pricing module's, P48: a later phase) and no links to ops dashboards (none exist before BE-025). The overview and funnel are computed live by the mock; the funnel follows the records, not audit events (the backend may use either, F19 "Data"); share-link views count on the day a link was last opened (no per-view log). Revenue is empty (no billing provider). A suspended org's writes answer `409 org_suspended`; the app shows a banner but doesn't hide the buttons. Users have no sign-up date before FE-038 (seeded users count from the seed). Tags need a reason, as the contract asks for every `PATCH /admin/orgs/{id}`.
- Extension registries (FE-039): no module is registered (the pricing module is for a later phase, P48), so every point is checked only by the unit tests' test module, not end to end. Module i18n namespaces aren't loaded yet (`src/i18n/request.ts` loads the core's list; FE-P1 adds a module's). Selection actions show only in the bulk bar, which appears to people who can edit; a module badge map is merged anew on each render when two modules add badges. `admin.metrics`, `audit.actions`, `entitlements.keys`, `me.extensions` and `account.kinds` (modules.md) aren't frontend registries yet: the core reads unknown audit actions, entitlements and `me` keys as plain data. Org slugs now refuse the app's own route names (`admin`, `account`, `notifications`, …; a bug until FE-039, an org there was unreachable); a module's area path must be reserved by its backend. A module's area is served at `/areas/{area}` behind a rewrite of `/{area}` (next.config, from the modules in the build), so `areas` is reserved too. Fixed on the way: the notification bell's times now use the shared relative-time hook (next-intl's `ENVIRONMENT_FALLBACK` warning filled the e2e logs).
- Co-editing (FE-040): the sheet numbers what it shows (the backend's rule, `positionNo` from the run for everything else); the Excel (PoC layout until EN-006) and the public share page don't show position numbers yet. Presence lives in the mock process's memory; the marker shows while someone has a cell editor open, not while they only look at a line; a closed tab drops out after 45 s (a page left inside the app leaves at once). The notice after someone else changed my line offers "Keep mine" (my value saved again, as the later edit); undo is per tab. Fixed on the way: a saved version opened read-only overlaid the working version's edits (it now shows `frozen.adjustments`, BR-25), and re-editing a quantity with Enter submitted the reason dialog with the old reason at once.
- Phase-1 interim: the mock reads check details from the PoC engine's cache on the same machine, and
  drops the `null` optional fields the PoC sends in names (the worker should omit them, EN-001).


## What an engineer still needs before building the platform

From the readiness review (Oct 2026): a v1 scope; the data model with fields (10 gives the
entity tree); key user flows as wireframes (upload, review questions, approve, export);
non-functional targets; acceptance criteria; the open decisions above. The glossary (01), the
rule format (06) and the engine (05) now exist.

