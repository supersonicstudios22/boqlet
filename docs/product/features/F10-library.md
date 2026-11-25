# F10 Library: rule sets, classifications, dictionaries

> **Status (2026-11-22):** Built (gaps). Rule sets, classifications, dictionaries and resolution settings with drafts, versions, publish, preview, Where used, code-list import and Excel templates (`apps/app/src/features/library`, `services/api/src/main/java/com/boqlet/api/library`). A preview may use the caller's own current drafts as its other inputs (TF-133) and follows a change within 3 s (TF-134); a preview on a project's model needs only access to the project (P54 Q43); slot answers are checked against their slots (TF-135); publishing a preset rebases its "Based on it" clones' drafts at once (Q58, TF-140); a draft opened before a newer version (a promotion) merges it or is refused until rebased, never overwriting it (review A-43). Resolution settings have fields for the contradiction thresholds (the rest as JSON) and are checked by the engine before publishing (review WP-A1, A-04); federation settings are still JSON only and unchecked.
> **Not built / differs** (also in [known limitations](../known-limitations.md)):
> - Not built: a manual "rebase on latest", unarchive (no contract operation), renaming ids across documents, a structured version diff (a JSON line diff is shown), "keep other columns" on code-list import.
> - An item text's "Reads as" sample needs a preview run.

## Purpose

The firm's own measuring knowledge, as data it owns: how to measure (rule sets), how to code
and group (classifications), what names mean (dictionaries). Versioned, previewable, shared by
every project. This is the product's main differentiator (docs/decisions.md D11–D17, D23).

The editors in plain language came from the proof of concept's Library and are ported to
`apps/app/src/features/library` (user guides: `docs/product/guides/rules.md`,
`docs/product/guides/classifications.md`, `docs/product/guides/dictionaries.md`). This spec adds what
the product needs around them: layers, versions, permissions, preview against a project model.

## Concepts

| | Rule set | Classification | Dictionary |
|---|---|---|---|
| Engine doc | `RuleSet` or `RuleSetPatch` (rules.ts) | `{codeList: CodeList, map: ClassificationMap}` (classification.ts) | `Dictionary` (dictionary.ts) |
| Changes numbers | yes | never (BR-02) | indirectly (rules match on terms) |
| Typical start | Copy of system "As modelled" as a patch | Import a code list from Excel/CSV, then map items | Names from a model (Names tab) |
| Layers | system / org / project | system / org / project | system (global) / org (company) / project |

Also editable as advanced documents: **federation settings** (discipline ownership) and
**resolution settings**.

## Behaviour

1. **Library home** (`/{org}/library`): tabs per kind; table of presets: name, layer badge,
   based on, latest version, draft exists, last edited by/at, used by N BoQs. System presets
   are listed read-only, with "Make a copy". Filter by layer. Project-layer presets are listed
   in the project's own Library tab (`/{org}/projects/{p}/library`). A **Guided setup** button
   opens the setup wizard (F16), which creates and fills a rule set, a classification and a
   company dictionary through these same editors.
2. **Create:** kind + name + start from (empty / copy of an existing version / patch on a rule
   set version / import code list / an Excel template, §14). Checks `libraryOrgPresets` (402).
   Creates a preset with a draft version.
   - **Clone** (P19): every preset, system or org, has "Clone" in its header. For a rule set
     the user picks **Independent copy** (a full copy, unaffected by later changes to the
     original) or **Based on it** (a patch: only the differences are stored, and the clone
     follows the original's future versions: publishing the original gives each clone based on
     it a draft that extends the new version at once, for its editors to check and publish;
     P54 Q58, TF-140). Classifications and dictionaries are copied.
     The clone opens as a draft named "{name} (copy)".
   - **Guided creation** (P24): a new rule set or classification opens in **guided mode**: the
     setup wizard's step for that kind (F16 steps 1 and 2), one question at a time with the live
     preview, then "Open in the full editor" for everything else. Guided mode can be reopened
     on any draft. The full editor stays the place for every detail.
3. **Edit draft:** the editors (`apps/app/src/features/library/rule-set`, `classification`, `dictionary`):
   - rule set: Settings (slot questions by section), BoQ items (item sentences, forms), Advanced
     (questions setup, JSON); readable formulas;
   - classification: Codes per line (table), Code list (with "About this list", import, and
     the **item text** of each code, §13), Advanced (map rules, JSON);
   - dictionary: Names in the model, Names it explains, Meanings, Advanced.
   Drafts **autosave** (`PUT /presets/{id}/draft`, debounced 1 s; ETag to detect a parallel
   edit, `409 draft_conflict` → reload or overwrite dialog). Every save runs the engine check
   (`POST /presets/check` inside the backend) and returns `problems[]`, shown inline.
4. **Publish:** only with zero problems; change note required → immutable version n+1.
   Projects pinned to a version stay pinned; "latest" pickers move to the new one for new
   revisions only (BR-07). A draft remembers the version it started from (review A-43, D104). If a
   newer version was published meanwhile (a promoted name answer publishes a dictionary at once),
   publishing a **dictionary** draft takes that version's changes where the draft left them alone
   and says what it kept; a **rule set** or other kind, or a dictionary entry both sides changed
   differently, is refused (`409 draft_stale`) until the editor rebases: "Keep my draft" (on top of
   the newer version) or "Start again from version n" (`POST /presets/{id}/draft/rebase`). A
   promotion also writes its entry into an open draft. The editor shows "Version n was published
   after this draft started".
5. **Versions:** history list (number, note, by, at), view any version read-only, diff two
   versions as JSON diff (structured diff later), "restore as draft".
6. **Preview** (rule sets, classifications, dictionaries): pick a project and model
   version(s) the user can access → `POST /presets/{presetId}/preview {draft: true | versionId, modelVersionIds[], otherInputs?}`
   → `preview` job → BoQ lines + questions shown in a compact sheet beside the editor, and
   "what changed vs the published version" (diff of the two previews, EN-005). No run is
   stored and no usage of BoQ data is changed. Preview counts as processing (usage event).
7. **Names in a model** (dictionary editor): pick a model version → `POST /model-versions/{id}/names`
   with the draft dictionary layers → table of raw names, counts, resolved term, method,
   "worth asking". Assign terms inline (adds entries to the draft).
8. **Code-list import** (classification editor): upload xlsx/csv →
   `POST /codelists/read` (sheets, rows, column guess) → map columns → `POST /codelists/build`
   → codes + problems + stats → into the draft. (`classification/code-import.tsx`.) The column mapping
   labels the code's `description` column **Item text**. The engine already guesses it from
   headers like "description", "opis", "Langtext" (`codelist_import.py`).
9. **Where used:** `GET /presets/{presetId}/usage` → BoQ revisions (project, BoQ, revision,
   status, version used). When working BoQs use an older version: **Move working BoQs to
   version n** (`POST /presets/{presetId}/move-to-latest`, review A-44), optionally with the
   projects' defaults; each moves as an edit of its inputs would (pending, not regenerated);
   saved versions never move; BoQs in review, ones the caller can't edit and archived projects
   are listed as skipped. Rename of ids across documents within the org: specified, **not built** (see Status).
10. **Archive:** hides from pickers. Runs and saved versions keep their snapshots. An archived
   preset stops being a default for new projects.
11. **Default for new projects** (review A-45, D107): a library editor ticks it on a published
   company rule set (one per org: ticking another replaces it), classification or dictionary
   (several allowed); new projects start from those presets' latest versions (F02 §2). Audited
   (`preset.default_set`, `preset.default_cleared`). **Star** is a favourite marker only.
12. **Permissions:** org presets: library editors and admins edit; members view and pick.
    Project presets: project lead and estimators edit.
12. **Licensing guardrails** (BR-53): no upload of standards documents for extraction; the
    "based on" field is free text; UI copy never says "compliant". A one-time notice on first
    rule-set creation explains "bring your own licence" (D30–D31). The same applies to item
    texts: a firm may import texts it holds a licence for (a commercial text library); system
    presets ship none.
13. **Item texts** (P14, BR-11): in a real BoQ the item's written description is what is
    priced ("Laying external walls {thickness} cm thick in hollow clay blocks, 1:2:6 mortar.
    Measured per m³."). It is the code's `description` field in the code list, written once
    by the firm and reused on every project:
    - **Code list tab:** each code row shows its short name and, under it, an **Item text**
      box. The box has the insert buttons and "Reads as" preview of the rule-set editor's line
      text (the field picker): click "thickness" instead of typing `{thickness}`. Blanks use the
      same syntax as a rule's line text (`{name}`, `{thickness*1000}`, `{expr: …}`), filled by
      the engine only (BR-01).
    - **Codes per line tab:** under each row, the item text of the chosen code, filled from
      the preview model's first matching line when a preview model is picked, as a sample.
    - **Check:** a blank whose name the engine does not know is a problem (same check as
      rule-set line texts). A blank that a particular line has no value for is not a problem
      here; the run leaves it visible and warns (EN-010).
    - Codes without an item text are fine: their lines keep the rule set's line text.
14. **Excel templates** (P24): every rule set, classification and dictionary can be
    downloaded as an Excel workbook, filled in or changed in Excel, and uploaded back.
    - **Rule set:** a "Settings" sheet with one row per question (section, question,
      explanation, unit, the current answer in a yellow column with a dropdown of allowed
      answers, the default); a read-only "BoQ items" sheet listing what each item measures
      and which answers it uses; a "Read me" sheet.
    - **Classification:** a "Codes" sheet (code, short name, parent, item text) and a
      "Codes per line" sheet (BoQ item → code, with a dropdown of codes).
    - **Dictionary:** a "Names" sheet (name or pattern, match kind, meaning with a dropdown of
      terms).
    - A blank template ("Download empty template") is offered on Create.
    - **Upload back** (`POST /presets/{presetId}/template-import`): the engine reads the file
      (read-only, data-only, security.md) and returns the proposed draft, the changes against
      the current draft ("12 answers changed, 3 codes added, 1 item text changed") and the
      problems by sheet, row and column. The user reviews and applies; nothing is saved before
      that. Rows the engine can't read are listed, never dropped silently.

## Edge cases

- A patch whose parent version is archived: still flattens (archived ≠ deleted). The editor
  offers "rebase on latest", showing the parent changes.
- Two editors on one draft: optimistic concurrency via ETag (see above). No real-time
  co-editing in v1.
- Very large code lists (Uniclass): stored in object storage, edited with paged tables.

## API

`GET /orgs/{orgId}/presets`, `POST /orgs/{orgId}/presets`, `GET /presets/{presetId}`,
`PATCH /presets/{presetId}`, `POST /presets/{presetId}/archive`,
`GET /presets/{presetId}/versions`, `GET /preset-versions/{versionId}`,
`PUT /presets/{presetId}/draft`, `DELETE /presets/{presetId}/draft`, `POST /presets/{presetId}/draft/rebase`,
`POST /presets/{presetId}/publish`, `POST /presets/check`, `POST /presets/{presetId}/preview`,
`GET /presets/{presetId}/template.xlsx`, `POST /presets/{presetId}/template-import`,
`GET /presets/{presetId}/usage`, `GET /orgs/{orgId}/terms`, `POST /model-versions/{versionId}/names`,
`POST /codelists/read`, `POST /codelists/build`.

## Acceptance criteria

- [ ] A library editor copies "As modelled" as a patch, changes three Settings, previews on the Duplex and sees the changed lines next to the editor.
- [ ] Publishing with problems is impossible. Publishing creates version n+1, and older versions are read-only.
- [ ] A BoQ version saved with preset version 1 still shows version-1 numbers after preset version 2 is published.
- [ ] Importing an xlsx code list with 3 levels builds the hierarchy and reports duplicates.
- [ ] Importing an xlsx with an "Opis" column fills the item texts; an item text with `{thickness}` shows "Reads as" with the preview model's value, and the published classification's lines carry the filled text in the sheet and the Excel.
- [ ] A member without library rights can view and pick org presets but sees no edit actions, and the API returns `403` on edits.
- [ ] Cloning "As modelled" as "Based on it" stores only changed answers, and a later system version of "As modelled" shows up in the clone; "Independent copy" does not change.
- [ ] A rule set downloaded as Excel, with three answers changed in Excel and uploaded back, shows exactly those three changes for review, and a wrong answer in a row is reported with its sheet, row and column.
