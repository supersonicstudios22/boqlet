# boqlet review — BLUEPRINT

Consolidated plan from the multi-perspective review of `main` at `3868013` (2026-11-23). Inputs:
`docs/review/00-context.md` (architecture, runs, baseline, feature matrix FM-01…FM-123), six persona reports
(`01-engineering.md` ENG-001…032, `02-product.md` PRD-001…028, `03-casual-user.md` CAS-001…032,
`04-civil-engineer.md` QS-001…023, `05-team-lead.md` LEAD-001…023, `06-design.md` UX-001…048) and four
verification files (`verify-engine.md`, `verify-backend.md`, `verify-frontend.md`, `verify-product.md`).
Severities and categories are the **verifiers' final ones**; where a verifier corrected a fact, the item plans
the corrected version. New problems found by the verifiers are `VER-001…VER-007` (list in DEC-05).

This file is the plan; `docs/review/PROGRESS.md` is the tracker. A follow-up session reads both, picks the
next work package (WP) and follows the execution instructions near the end of this file.

---

## 1. Executive summary

**Overall state.** boqlet v1.0.0 is a well-built modular system: a contract-first HTTP API (OpenAPI → Java
interfaces + TS client), centralised tenant isolation that held across 55 cross-org calls, immutable runs with a
rebuildable row index, a real expression parser (never `eval`), deterministic question ids, strong security
basics and an unusually accessible UI (80 axe scans: 0 critical, 1 serious). On clean prismatic elements the
engine is exact (22 independent checks agree to < 0.1 %), traceability ("How it is calculated", the Calculation
sheet, 3D links) is the best the QS reviewer has seen, and revisions are cheap (v2 → change report in < 15 s).
All local gates passed (265 engine tests, 405 app tests, typecheck, lint, build, `api:check`); the full
`mvn verify` failed only on two load-induced timeouts and passed on a targeted re-run.

**Most serious issues** (verified):

1. **Wrong quantities that look right.** Revit 2021 IFC4 exports double every slab area silently
   (`Qto_SlabBaseQuantities.NetArea` = total surface; S07 ×2.22, S08 ×2.54; QS-003, now critical). A reported
   volume 1,000× the closed mesh is adopted and the "recommended" answer keeps it; the area is then derived from
   it because `BaseQuantities.GrossArea` is missing from the area sources (S09: 146,199 m² slab; QS-001 =
   PRD-001 = CAS-001, critical). Contradictions never block, so such a BoQ reaches "complete" (QS-002).
   Several default measuring rules understate or misstate common items (wall area from volume ÷ thickness,
   footing formwork, material breakdown ×4.6, pile caps, proxies billed, federation conflicts resolved silently).
2. **Silent correctness bugs in the one evaluator and the rule engine**: non-ASCII literals mangled
   (ENG-001), FLOOR/CEIL steps (ENG-005), duplicate question ids that make a run fail permanently (ENG-003),
   unknown units converted ×1 (ENG-010), Excel import reads "1,234" as 1.234 (ENG-018).
3. **Security**: user regexes run unbounded on the shared rpc engine and freeze it (GIL), reachable with
   *view* rights (ENG-006); worker HTTP/rpc unauthenticated; no CSP.
4. **Hand-off and control gaps**: browser uploads > 100 MiB cannot work (ENG-002); the sheet's Excel button
   exports the last run without the visible edits (CAS-002); with approval + four-eyes on, an estimator can
   share an unreviewed working version (LEAD-004); a stale library draft silently drops a promoted answer
   (LEAD-001); org rule-set versions never reach existing projects (LEAD-002).
5. **Product readiness**: accuracy never validated against a professional BoQ (PRD-007); the required wizard
   runs before any model exists (PRD-002); Free cannot sell (no prices configured, checkout 409, no trial,
   PRD-003); the Excel is an audit workbook, prints badly, no PDF (CAS-003, CAS-015); demo/ACME presets shown
   to customers (PRD-009); naming questions dominate the review queue (QS-022).
6. **Tests prove the authors' paths**: weak oracles (a tautological scenario assertion, a circular Duplex wall
   method, an all-zero-passes certification test), none of the engine defects covered; the shared suites only
   run inside `NativeWorkerTest`; browser coverage lost in P53.

**Main strengths to defend**: rules/classifications/dictionaries as versioned data the firm owns;
every number traceable to formula, values and elements in the app, the Excel and the share page; questions
instead of guesses, carried across versions; cheap revisions with a correct change report; tool-neutral IFC in
a browser. Section 2 lists what must not break.

**The plan.** 192 items in 45 work packages, four phases: **A** correctness and safety (46 items, 11 WPs),
**B** architecture, refactor and test foundations (24, 6), **C** UX, design and flows (59, 12), **D**
planned-but-missing and newly necessary features (63, 16), with real billing-provider integration the only
thing out of scope (plus the documented non-goals FM-107, FM-108). Phase A changes quantities on purpose; each
such package lists the baseline runs and lines it expects to move.

---

## 2. Keep and reinforce

These must survive every refactor. Each follow-up session checks that its package keeps them (most are
guarded by existing tests; where not, the item that touches them adds a test).

| # | Keep | Why | Evidence |
|---|---|---|---|
| K1 | **Tenant isolation through `ProjectAccess.require` / `OrgAccess`**; another org's ids answer 404 like nonexistent ids | The core security property of a multi-tenant BoQ store | 01-engineering W1 (`docs/review/repro/eng/idor.mjs`, 55 calls all 404); `services/api/.../project/ProjectAccess.java:59-64` |
| K2 | **Strict request validation** (`400 unknown_field`) and **contract-first HTTP** (`packages/api/openapi.yaml` → Java interfaces + TS client, `npm run api:check`) | Keeps the three parts in sync; every API change is reviewed in one file | 01 W2, W3; CLAUDE.md rule 1 |
| K3 | **Session and CSRF design**: Argon2id (OWASP params), opaque `HttpOnly; Secure; SameSite=Lax` cookie, exact-Origin check on unsafe methods, sign-in throttling, `/admin/*` 404 to non-admins | Sound auth basics | 01 W4; `identity/NativeCredentials.java:27`, `NativeIdentityFilter.java:42` |
| K4 | **Parameterised SQL everywhere**; dynamic SQL appends fixed fragments only | No injection surface | 01 W5 |
| K5 | **Upload, workbook and CSV safety**: signed content length, size check on complete, STEP/zip sniffing, single-file `.ifczip`, zip-bomb guards, formula defusing in xlsx and CSV | Untrusted files from the internet | 01 W6, W7; `storage/ObjectStorage.java:68,107,111`, `engine/ifc_boq/sheets/xlsx_guard.py:36-56`, `export_xlsx.py:76-83` |
| K6 | **Runs are immutable** (`result.json.gz` is the record); `run_*` tables are a COPY-filled, prunable, rebuildable index | Right pattern for a data pipeline; makes re-ingestion and recovery safe | 01 W8; `boq/RunIndex.java:125-134`, `maintenance/Maintenance.java:72-85` |
| K7 | **Deliberate concurrency**: `FOR UPDATE` before state changes, partial unique indexes (one active run per revision, one active decision per question), no older run replacing a newer one, `SKIP LOCKED` queue | Co-editing and parallel runs stay consistent | 01 W9; `V7__boqs_and_runs.sql:69,122`, `boq/RunJob.java:76-81` |
| K8 | **One expression evaluator** (`engine/ifc_boq/expr.py`), a real parser with null semantics, aggregates and `explain()`; never `eval`; no second evaluator in Java or the browser | CLAUDE.md rule 4; ENG-001/005 are local fixes, not design faults | 01 W10 |
| K9 | **Deterministic question ids** built from content | Stored decisions survive runs and model versions (rule 9) | 01 W11, 04 W6 (geometry answer re-applies on Duplex v2) |
| K10 | **SSE filtered per member** and DB triggers → `realtime_events` → SSE | Live updates without leaks | 01 W12; `realtime/Realtime.java:115-130` |
| K11 | **Exact measurement of prismatic elements**, unit handling (inch files, mm quantity sets, kernel mm fallback), **opening deductions per element** shown in the trace | The accuracy base the Phase A fixes build on | 04 W1–W3; `docs/review/tools/verify-quantities` → OK 22 |
| K12 | **Traceability**: "How it is calculated" (steps, formula as read and written, settings, element shares, codes, log), viewer highlight, Excel Calculation sheet with GlobalIds | The product's differentiator (O3, P25) | 04 W4, 06 W3, 02 W4, 03 W5 |
| K13 | **The engine detects contradictions** (reported vs geometry) and keeps both values in the log | Phase A turns detection into the right default; do not remove the comparison | 04 W5 |
| K14 | **Revisions**: answers and edits carried over, correct change report (lines, elements, causes, 3D colouring, Excel); a known file is not reprocessed (SHA-256 dedupe, BR-08) | O5, "a new model version takes minutes" | 04 W6–W7, 05 W5–W6, 03 W8 |
| K15 | **Federation de-duplicates by GlobalId** (no double count of shared elements) | O1 "nothing counted twice" | 04 W8 |
| K16 | **Nothing disappears silently**: excluded elements counted and greyed, elements without a value named on their line, unmatched → questions, the "not in the models" notice | O4, rule 5, P15 | 04 W9, 03 W14 |
| K17 | **Approval workflow** server-enforced (submitter can't approve own, confirmed BoQ refuses edits `409`, reopen needs a reason, audited) and **role checks that explain themselves** (`403 required: …`) | O6, team trust | 05 W1, W2 |
| K18 | **Live co-editing** (edits visible within seconds, undo leaves others' edits alone) and the review screen (edits with reasons, comments, compare to last saved) | O6 | 05 W3, W4; `features/boq-sheet/edits.ts:210-226` |
| K19 | **Edits are always shown as edits** and the reason travels (line, Excel notes, share page); manual lines with kinds | P20, O6 | 03 W6, W7 |
| K20 | **Excel as a pricing document**: Rate column, live Amount and SUBTOTAL formulas, sheet protection, hidden line-key column + `veryHidden` `_boqlet` sheet for the round-trip import | O7; the round trip depends on the hidden keys | 03 W9, 04 W11, verify-product PRD-012 |
| K21 | **Plans as data** (`402 limit_reached {limit,current,max}`, `limit_events`), admin console with impact preview and funnel | P57; Phase D builds on it | 02 W7, W8 |
| K22 | **Accessibility baseline**: sheet is a real `treegrid` with roving arrows, F2/Space/Ctrl+A/`/`/Ctrl+Z; visible focus ring; status words never colour-only; announced errors | WCAG 2.2 AA target (nfr.md) | 06 W1, W2, W4, W5, W15 |
| K23 | **Visual language**: one typeface, hairlines, purple only for act/here (P55), dimension-line progress, onboarding poster | P43, P55, design-guidelines | 06 W7, W12, W13 |
| K24 | **Share dialog and share page**: pin vs follow-latest, what is included, expiry, revoke, noindex, calm dead-link page | O7, F18 | 02 W6, 03 W10, 06 W9, W11 |
| K25 | **Input-check report** after upload (schema, tool, classes, checks with "Show in 3D", names, "Generate a BoQ") | Best first-value moment | 02 W2, 03 W4 |
| K26 | **Engine speed at small/mid size** (S09 parse 10.8 s, run 1 s; Duplex parse 4–8 s) | Time to value | 02 W1, 03 W1 |
| K27 | **The Duplex acceptance test against an independent hand BoQ** (`HAND_BOQ`, `fixtures/reference/duplex-hand-boq.xlsx`) and **honest validation docs** | Rule 7; QS-021 makes the walls independent too, it does not remove the test | 01 W16, 04 W12 |
| K28 | **The architecture boundaries**: ArchUnit `CoreArchitectureTest`, the CI deploy gate, `contents: read` CI permissions, the core never depending on pricing (P36) | Keeps the modular monolith modular | 01 W15; CLAUDE.md rule 11 |

---

## 3. Decision log

Every judgement call made while consolidating. "Overturns Pxx — owner to confirm" marks the few places where a
settled decision is changed; those items are still planned, and the item says what to do instead if the owner
declines.

### 3.1 Review-process decisions (made by the main review session)

| Id | Decision | Rationale |
|---|---|---|
| DEC-01 | (a) The review's sample set and the ignore rules for `_scratch/`, `_samples/`, `_screenshots/` live in `docs/review/.gitignore` (not the root `.gitignore`), so the review session wrote only under `docs/review/`. | Write-only-to-`docs/review` rule of the review brief. Follow-up sessions keep it; samples are re-fetched with `bash docs/review/tools/fetch-samples.sh` and never committed (licences, size). |
| DEC-02 | (b) The review brief asked for a separate review branch; **the owner chose to commit the review on `main` instead (2026-11-23)**, consistent with CLAUDE.md (work on `main`). The review commit is not pushed. **Follow-up sessions work on `main` per CLAUDE.md**: small commits, never push red; every green push deploys to the pilot (P51). | Owner decision; one branch, as the repo's rules say. A session that pushes is deploying: run the exit check first. |
| DEC-03 | (c) The pricing module (F11/F17/F20, deferred by P48) is planned in Phase D as an optional, removable module (P36), **last** (WP-D15, WP-D16). | P48 defers it; P36 keeps it removable; PRD-020 recommends the freeze. |
| DEC-04 | (d) **Real billing-provider integration is the only thing out of scope.** Subscription and quota logic (trials, downgrades, plan versions, upgrade requests, usage) is built behind a `PaymentProvider` interface with a stub implementation (WP-D4). | Review brief; BE-D7 (manual billing for pilots), P57 (prices shown, not charged). |
| DEC-05 | (e) The review did not update `docs/changelog.md`, `docs/product/known-limitations.md` or feature status blocks (write-only-to-`docs/review` rule). **Follow-up sessions update them after each item**, per CLAUDE.md. New problems found by the verifiers get ids: **VER-001** share line detail lists element models as raw version-id prefixes (empty `modelNames`, `public-share.tsx:248-256`; verify-frontend §1.8); **VER-002** share 3D panel says "0 elements of this line" for a line with 3 elements (verify-frontend §1.8); **VER-003** model and model-version pages have the bare title "boqlet" (verify-frontend §1.8, UX-020 worse); **VER-004** a 74-byte file shows "SIZE 0 MB" (verify-frontend §1.8); **VER-005** `model_version.ready` sends no email at all (`category = null`, `worker/Jobs.java:360-380`, `realtime/Notifications.java:46-48`; FM-50 missing, not partial; verify-product §1.5); **VER-006** S10 (65 MB Dutch model) resolves "0 of 0 distinct names", so its materials/types never reach the names stage (verify-engine §1.8); **VER-007** the Excel rule-chain label in BoQ!A2 carries a version id where the parent preset's slug is expected ("version-9d493c18-… -> slug"; verify-product PRD-012 detail). | CLAUDE.md working rules; the verifiers asked for these to be planned. |
| DEC-06 | (f) The **engine baseline** is the CLI path (in-process, no JSON round trip); the **stack baseline** is the worker path. S12 differs between them (engine: `TypeError` crash; stack: complete, 5 lines; 00-context §10). A-31 makes the two paths identical; until then a session must not "fix" one layer's S12 by editing the baseline of the other. | 00-context §8, §10. |
| DEC-07 | (g) The full `mvn verify` failed on two load-induced timeouts (`permissions.test.ts` P9 at 60 s; `browserSmokeAgainstJava` overall limit) and passed on a targeted re-run (00-context §4). Exit checks run it on a quiet machine; a timeout-only failure is re-run once with `-Dtest=NativeWorkerTest` and the relevant filter before it is treated as red. B-08 makes the suite load-tolerant. | Avoids false reds; never push on an unexplained red. |

### 3.2 Severity and classification calls

| Id | Decision | Rationale |
|---|---|---|
| DEC-08 | Final severities are the verifiers'. Notable changes from the reports: QS-003 high → **critical** (all Revit 2021 IFC4 slab areas doubled); ENG-020 low → medium; ENG-003, QS-004, QS-007, CAS-004, LEAD-003, PRD-002, PRD-004, PRD-005, CAS-003, UX-001, UX-004, UX-005 → medium; ENG-009, ENG-015, ENG-019, PRD-011, PRD-015, PRD-019, PRD-020, UX-002, UX-014, UX-022, CAS-007, CAS-016 → low. Rejected: **CAS-030** (Unit/Kind selects are labelled implicitly; axe clean) and **CAS-032** (not reproducible; shared-load artefact). | Verifiers reproduced with evidence; the plan uses their facts (e.g. ENG-011 "null" set is *ignored* on the worker path, not adopted; PRD-012 line-key column is already hidden; FM-123 and FM-19 are partial; FM-50 is missing). |
| DEC-09 | **High-severity control and data-integrity gaps go to Phase A** even when they are feature-shaped: LEAD-001 (data loss), LEAD-002 (silent divergence of standards), LEAD-004 (control bypass), CAS-002 (wrong numbers leave the office), ENG-002 (uploads broken). | Phase A = wrong numbers, data loss, security, crashes; these are all "a wrong or unapproved number reaches a client". |
| DEC-10 | **Classification-only defects** (QS-007) are planned in Phase A but rated below quantity defects; the fix must leave every quantity identical (rule 6) and the WP's exit check verifies that. | CLAUDE.md rule 6; verify-engine judgement. |
| DEC-11 | **Medium/low items whose fix is the same code as a high one ride along** in the same package (e.g. QS-008 with QS-001's line flags, ENG-022 with ENG-006's regex engine). | One coherent change per area; fewer baseline recaptures. |

### 3.3 Duplicate clusters merged (each kept every source id)

| Id | Cluster → item | Not merged, because the fix differs |
|---|---|---|
| DEC-12 | QS-001 = PRD-001 = CAS-001 (+ LEAD-016 symptom, + FM-117) → A-01, A-02 (two root causes: missing `BaseQuantities.GrossArea`; adopting a ×1000 reported value) | LEAD-016's general plausibility checks → A-07 with QS-013; QS-002's blocking policy → A-04 |
| DEC-13 | Wizard cluster PRD-002 = PRD-014 = CAS-006 = UX-004 = UX-035 (+ FM-62/63/64, FM-11 gap) → C-34, C-35, C-36 | UX-034 (poster language) → C-37 |
| DEC-14 | Names cluster QS-022 ≈ PRD-006 ≈ CAS-004 (+ FM-98) → C-16 (answerable name questions) and D-06 (names at scale, FM-27) | ENG-009 (blocking detected by regex over JSON) → A-26 |
| DEC-15 | Demo presets PRD-009 = CAS-009 = UX-036 (+ FM-121) → C-42 | LEAD-015 (org policy of allowed presets) → D-29 |
| DEC-16 | Layout pressure UX-003 = CAS-031 = QS-019 = UX-008 (+ UX-026, UX-027) → C-01 (height, toolbar, bulk bar) and C-03 (width: detail drawer, description priority) | UX-001 status gutter → C-02 (it also serves UX-010, UX-044) |
| DEC-17 | Watermark PRD-026 = CAS-029 → C-21 | — |
| DEC-18 | Client Excel PRD-012 = CAS-015 (+ FM-120) → C-22 | QS-016 is split: print setup → C-21, item numbers/texts → C-23, split-line descriptions (with CAS-025) → C-24, CSV/dimension sheet → D-40 |
| DEC-19 | Notifications CAS-026 = UX-023 = LEAD-019 (+ VER-005, FM-50) → C-49 | UX-041 activity entries → C-51 |
| DEC-20 | Set-password CAS-019 = PRD-022 = UX-032 → C-28; onboarding fields CAS-007 = CAS-020 = PRD-023 → C-29; invite promise CAS-021 = PRD-024 = UX-033 (+ FM-05) → C-30; upload CAS-022 = PRD-025 = UX-012 (+ FM-17) → C-38; failed parse CAS-010 = UX-011 → C-39 (engine codes ENG-012 → A-32) | — |
| DEC-21 | Pricing copy PRD-027 = UX-039 = CAS-012 (display part) → C-43; Free cannot sell PRD-003 (+ CAS-012 pass, LEAD-011 price part) → D-16, D-19 | LEAD-011 seat counting by role → D-20 |
| DEC-22 | Reveals ENG-023 ~ QS-020 → A-12 (one slot change: reveals move to finishes and are counted once per face) | QS-009 (finishes ignore the opening rule) → A-11 |
| DEC-23 | Oracles ENG-027 ~ QS-021 → B-02, B-03, B-04 (split by kind of test) | QS-004 wall method → A-09 (changes numbers; B-03 re-derives the hand values independently) |
| DEC-24 | Contradiction/completion ENG-020 ~ QS-002 → A-19 (overlaps) and A-04 (contradictions) | PRD-015 = CAS-023 wording → C-20 |
| DEC-25 | Main-material mechanism CAS-017 ~ LEAD-003 | CAS-017 → A-14 (slab concrete from concrete layers); LEAD-003 → D-24 (org answer policy) |
| DEC-26 | Share edits CAS-028 ~ LEAD-004 | LEAD-004 → A-46 (control); CAS-028 → C-27 (share-dialog option) |
| DEC-27 | Reviewer choice ENG-016 ~ LEAD-009 | ENG-016 → B-14 (`canReview` from the API); LEAD-009 → D-28 (approval policy) |
| DEC-28 | Share labels UX-009 = UX-046 = VER-001 (+ VER-002) → C-25; UX-010 + CAS-016 + FM-67 → C-26 | — |
| DEC-29 | Viewers' Changes tab LEAD-020 = FM-39 → C-14 | — |
| DEC-30 | Disabled reasons UX-013 ~ UX-014 → C-52; dashboard UX-018 = LEAD-023 (+ UX-038) → C-50 | — |

Count: 19 merged clusters (DEC-12…DEC-30). Elsewhere a finding is listed in more than one item only when
its parts need different fixes (coverage table, section 7).

### 3.4 Conflict resolutions (personas, code vs spec)

| Id | Conflict | Decision | Rationale |
|---|---|---|---|
| DEC-31 | **Reported value vs geometry** (QS-001/003): "always geometry" vs "always the file" | Unit-scale ratios (10^±3, 10^±6 within 2 %) are treated as exporter unit errors: the geometry is used, the question stays (non-blocking, geometry recommended) and the line carries a note. Other contradictions above a **block threshold** (default 50 %, a resolution setting) block, with the recommendation chosen by plausibility (closed mesh → geometry). Below it, as today. | Keeps K13 (both values logged) and rule 5; fixes the critical cases without blocking every Revit model. |
| DEC-32 | QS-002 "downgrade name questions that only affect a code" | **Not adopted.** Name answers also move quantities (Air → `air_gap` creates a 68,713 m³ concrete line, verify-engine §4); blocking stays as today except that A-27 detects referenced fields from the AST, and C-16 gives blocking name questions a "Not relevant" answer. | Verifier evidence; rule 5. |
| DEC-33 | ENG-008 "claim `body` by default" | **Not adopted.** Instead a non-blocking `double_count` warning when an element feeds two *item* rules of the same quantity family without a declared claim (A-20); a new BR in `business-rules.md`. | Wall + paint + formwork legitimately share an element; a default claim would fire on every finish rule. |
| DEC-34 | Wall area method (QS-004) and the Duplex test (QS-021) | Wall area comes from the measured faces net of openings; volume ÷ thickness becomes a cross-check that raises a contradiction (A-09). `HAND_BOQ` party-wall values are re-derived by hand from the faces and updated in the same commit with the reason (rule 7); B-03 re-derives the remaining walls independently. | Rule 7 allows intended changes with a stated reason; the face area is the reference method (04 A2). |
| DEC-35 | Reveals (QS-020, ENG-023) | Reveals belong to finishes (plaster, paint, lining) and are counted once per face with depth per face; the `wall_add_reveals` slot moves from the walls item to the finish items; `standard-style-example` is updated. `rules-language.md` presets table changes. | QS practice; avoids overstating structure and the double count. |
| DEC-36 | Proxies (QS-014) | Proxies are no longer billed by default: `include_proxies` default `false` in `as-modelled.json`; proxies become `unmatched` questions grouped by type (never silently dropped), with an answer to measure one by count/area/volume. | Rule 5; entourage objects never belong in a BoQ. |
| DEC-37 | Federation duplicates (QS-006) and overlaps (ENG-020) | Same-GlobalId copies that differ in class, type, material, thickness or quantity beyond tolerance raise a `duplicate_conflict` question showing both values; the default answer is the **owning discipline's** copy. Overlap questions block by default (`federation.overlapBlocking: true`, a federation setting); no new run status (avoids a types-wide status change). | Hidden discipline clashes and "complete" with a double count are worse than one more question. |
| DEC-38 | **Casual vs power user — edits and Excel** (CAS-002, CAS-005) | Keep rule 4 (only the engine computes): no client-side "apply edits". The sheet's Excel button, when inputs are pending, offers "Generate and export" (default) or "Export the last run" and says what is missing; no silent auto-regenerate (processing minutes, large models). The pending state gets a clearer banner (C-08). | verify-backend judgement; one evaluator. |
| DEC-39 | **Wizard depth** (P18 vs PRD-002/CAS-006) | **P18 is kept** (the wizard stays required for a new org). It becomes cheap and useful: the sample Duplex exists from org creation and is the wizard's preview model, one button publishes the whole suggested setup, steps 2–3 show summary cards instead of embedded editors, formulas sit behind a closed disclosure, no-effect questions are hidden. | Satisfies casual users (one click) and firms (the wizard previews on a real model) without overturning P18 / P54 Q57. |
| DEC-40 | **Client-facing vs audit Excel** (PRD-012, CAS-015, QS-016) | Two export profiles, `issue` (Cover with firm and client, BoQ, optional Calculation; no internal ids) and `working` (today's workbook). Contract first: `profile` on the export request (`packages/api/openapi.yaml`). The run/sheet default stays `working`; the frozen saved-version export and the share page download default to `issue`. The hidden line-key column and `_boqlet` sheet stay in both (round trip, K20). | Both personas get their document; round-trip import keeps working. |
| DEC-41 | **Showing edits on share pages** (CAS-028 vs P54 Q52) | P54 Q52 stays the default (edited quantity shown as edited with the engine's value, no reason). The share dialog gets "Show edit marks and the measured value" (default on); off shows the quantity only. F18 §2 ("no edits history") is corrected to P54 Q52. | Doesn't overturn P54; gives contractors the choice. |
| DEC-42 | **Approval vs sharing** (LEAD-004: F09 "a formal check before something leaves the office" vs F18 "share the working version") | When the org has `approvalRequired`, people who can't approve may create links only to saved (issued) versions or `latest_issued`; leads/approvers keep working-version links with the WORKING watermark. An org setting "Share only saved versions" applies it to everyone. F18 §1 is amended to defer to F09. | The firm's control must hold; the spec conflict is resolved in favour of the control. |
| DEC-43 | **Decisions per project vs per BoQ** (ENG-032, LEAD-003) | Keep project-wide decisions (F05, O5, rule 9); no rule-set id in question ids (would orphan stored decisions). The answer dialog shows the scope ("applies to 3 BoQs", from the existing `dryRun`) and who answered before (C-17). Org-level consistency is a Phase D feature (D-24: conflicting answers across projects, promotion of non-name answers as proposals). | Verifier: scoping to BoQs contradicts F05/O5. |
| DEC-44 | **Project defaults** (LEAD-002) | No floating "latest of preset X" defaults (a regenerate would silently move quantities to a new standard, against BR-07). Instead: default pickers at project creation and in project settings (FM-12), a "newer version available" badge on project defaults and BoQ inputs (like models), a "move to latest" action per BoQ and a bulk one in "where used", and a warning on archived defaults (FM-13). | verify-backend judgement. |
| DEC-45 | **Starring** (LEAD-008: two starred rule sets, `updated_at` picks; a draft save flips the default) | One explicit org default per preset kind (a radio "Default for new projects"), set deliberately and audited; draft saves never change it. Starring stays a favourite marker only. F10 and F02 change. | Removes a silent, order-dependent default. |
| DEC-46 | **Sheet density** (UX-007, UX-048 vs guidelines) | Implement the guidelines' density switch (Compact 28 / Default 32 / Comfortable 36), default 32 px; sortable headers inside groups (grouped order stays the default); column resize; a "Wrap text" toggle giving the F06 three-line clamp. | Guidelines are owner-confirmed (P41/P43); power users ask for it. |
| DEC-47 | **UX-001 Source column hidden beside 3D** (TF-107 trade-off) | Replace the hidden column by an always-visible narrow **status gutter** (icon + tag, `aria-label`) next to the line number; Storey drops first when width is short. The same component marks status on the share page and at 1024 px. | Resolves the TF-107 trade-off instead of reversing it. |
| DEC-48 | **UX-013 "keep primary buttons enabled"** vs the guidelines' disabled style | Keep the disabled style; add a visible reason next to the button and inline validation under fields. | verify-frontend judgement 8. |
| DEC-49 | **UX-016 checkbox accent**: `--link` (purple) vs `--foreground` (ink) | Ink (`--foreground`); purple is reserved for act/here (P55). | verify-frontend left it to the owner; P55 decides it. |
| DEC-50 | **UX-002 focus jump** fix | Fix the StrictMode-unsafe guard in `useRefocusWhenLost` (compare the previous dependency value, not a mount flag); refocus only after a user-initiated change. | Root cause per verify-frontend; production unaffected today but the guard is fragile. |
| DEC-51 | **Failed upload numbering** (UX-011 "don't number a version until it parses") | Keep version numbers (history stays honest); label failed ones "failed attempt", let them be removed (uses the existing `DELETE /model-versions/{id}`), show them in the models list, and let a failed job be dismissed from Needs you. | Renumbering would break references in notifications and audit. |
| DEC-52 | **Single session and splash** (PRD-028 vs P22, P56) | **Keep P22 and P56.** Only honour `prefers-reduced-motion` (skip the animation). The two-device request is recorded for the owner. | Settled decisions; the splash is already skippable. |
| DEC-53 | **Market and export formats** (PRD-005) | No change of first market (personas.md names a class of design-led markets, several use Excel). Phase D adds an export-format adapter with CSV, PDF and a dimension sheet first (D-40), then GAEB DA XML / ÖNORM A 2063 / IfcCostSchedule adapters (D-41) after a sourcing check: exchange-format schemas only, never licensed standard texts or tables (rule 8). | International principle (P35), rule 8, Q12 stays the market question. |
| DEC-54 | **Rates in the core** (PRD-021 vs P32/P36) | A simple firm rate library keyed by item code is built as the **first slice of the optional pricing module** (D-60), behind its flag and plan entitlement, removable (P36). Not core. | Keeps P32/P36; delivers the cost-check job early within Phase D. |
| DEC-55 | **Pricing model** (PRD-019, LEAD-011) | The commercial model stays the admin's data (P57, P17). Code adds only mechanisms plans can't express today: an expiring plan / pass (D-16), seat counting by role (D-20). Prices are not seeded by code. | P57: limits and prices are data. |
| DEC-56 | **Imperial** (PRD-016) | Interim: the unit-system choice says "Output is metric for now" (onboarding, project, rule-set editor) instead of hiding it (keeps the stored preference); D-09 builds imperial output on the unit registry. | International principle; no silent ignore. |
| DEC-57 | **Preset cleanup** (PRD-009) | Preset ids and files stay (tests, the CLI default and the review baseline use `acme-cost-codes`, `demo-trades`, `acme-house-rules`, `demo-tweaked`). They are marked `example` in the seed (`V5__Seed_system_presets.java` / a new migration) and hidden from pickers and the wizard by default; the Library shows them under "Examples" with "Show examples"; "Duplex project answers" is used only by the sample project. Federation and Resolution move under "Advanced". | No baseline churn; customers stop seeing fixtures. |
| DEC-58 | **Grouping without a classification** (CAS-008) | The sheet offers grouping by storey and by "measured as" (rule) without a classification — a view, no number changes (rule 6). New orgs get no default classification (the stack baseline relies on that); the wizard's step 2 offers "Use simple trade sections" as a choice. | Rule 6; avoids an unasked default. |
| DEC-59 | **Sample project decisions** (QS-017) | Seeded decisions are attributed to a system actor ("boqlet sample"), and the party-wall contradiction is left open with an explanatory note so the sample teaches it. | Audit honesty; teaching value. |
| DEC-60 | **Viewers and the change report** (LEAD-020, FM-39) | Show Changes to everyone who can view the BoQ (the API already allows it). **Refines P54 Q44 — owner to confirm**; if declined, document Changes as "editors only" in F09/screens.md and close LEAD-020 as by design. | The change report is what read-only managers want most. |
| DEC-61 | **Approval policy** (LEAD-009 vs F09 §4 "approver or lead") | Keep the default; add an org option "Only the chosen reviewers may approve" and a notice to the chosen reviewers when someone else approves; optional strict approver ≠ saver. F09 §4 gains the option. | Extends, doesn't overturn. |
| DEC-62 | **Legacy OIDC/Keycloak path** (ENG-029) | Remove it in B-16 — **owner to confirm** (it removes the documented rollback path in `docs/operations/auth-and-deploys.md:19`). If the owner declines, keep it, add a test that boots it, and label it "rollback only" in the code and docs. | A rollback across the native-auth migrations (V15+) is no longer realistic; a second auth path costs security effort. |
| DEC-63 | **Staging** (FM-78 vs P51) | Planned (D-58) but **overturns P51 — owner to confirm**; the item is not executed until confirmed. | P51 says one environment "until further notice". |
| DEC-64 | **Worker authentication** (FM-74 vs P54 Q47) | A shared secret on worker HTTP/rpc is added now (A-36); scoped storage identity later (D-50). P54 Q47 accepted the gap *for the pilot*; closing it does not overturn it. | ENG-006 makes the engine the weakest boundary. |
| DEC-65 | **Regex dialect** (ENG-006, ENG-022) | User patterns run on RE2 (`google-re2`, linear time); the documented dialect becomes "RE2 syntax" in `packages/types/src/dictionary.ts` (types first) and the guides; patterns RE2 refuses are rejected at check with a clear message. | One fix settles both findings. |
| DEC-66 | **Usage minutes** (FM-57) | Minutes are the engine's processing time (`durationMs`), as built; `plans-and-limits.md` is corrected (queue waits are not billed). | Fairer to customers; the code already does it. |
| DEC-67 | **Share rate limit** (FM-68) | Keep 300/min (configurable, `BOQLET_PUBLIC_SHARE_REQUESTS_PER_MINUTE`); F18 is corrected (a share view makes several calls). | Spec number was arbitrary; code value works. |
| DEC-68 | **"Generate a BoQ" from the model-ready notification** (FM-23) | Accept the built behaviour (the notification opens the version page, which has the primary "Generate a BoQ"); F04 is corrected. | Same outcome, one click more, no code. |
| DEC-69 | **Email language** (FM-49) | Emails follow the user's UI locale; while the UI is English-only, emails are English; the Serbian templates stay for when an `sr` UI ships (D-08). F13 is corrected. | P07/P35; consistency. |
| DEC-70 | **`ownedOrgsPerUser` on ownership transfer** (FM-08; F01 vs plans-and-limits disagree) | Enforce it on transfer too (D-14); `plans-and-limits.md` "Definitions" is aligned with F01. | Otherwise the limit is trivially bypassed. |
| DEC-71 | **Mobile < 768 px** (CAS-016, UX-043) | Out of v1 scope (nfr.md); only the cheap fixes (quantity cell wraps, chrome doesn't overflow) are planned. | nfr.md. |
| DEC-72 | **Who may create projects** (LEAD-013) | New org setting, default "every member" (today's permissions.md); `permissions.md` documents the setting. | Teams ask for it; default unchanged. |
| DEC-73 | **S10 "0 names"** (VER-006) | Treated as a suspected engine defect in Phase A (A-33): investigate first; if names are genuinely all resolved by IFC class, document that and close. | A 65 MB real model with zero names is implausible. |
| DEC-74 | **Order inside Phase A** | Engine quantity packages first (WP-A1…A5) because their baseline changes compound; each package recaptures the baseline before the next starts. | Keeps baseline diffs attributable to one item. |
| DEC-75 | **Global search** (FM-31) is planned in Phase C (C-09) as a power-user flow, not Phase D. | It is navigation, not a new capability. |
| DEC-76 | **Reference-project accuracy validation** (PRD-007, FM-83) is the first Phase D package (WP-D1), before commercial work. | "Before any paid pilot" (PRD-007); trust precedes billing. |

### 3.6 Judgement calls made while executing packages

Calls a package session made where an item was ambiguous or its text disagreed with the code or with another
item. The package's PROGRESS.md row points here.

| Id | Package / item | Decision | Rationale |
|---|---|---|---|
| DEC-77 | WP-A1 A-02 | **999× is a unit error.** A-02's Tests line lists "999 (not a unit error)", but the rule it implements (DEC-31, A-02's approach) is "within 2 % of 10^±3 / 10^±6", and 999 is 0.1 % from 1000. The 2 % rule is kept; tests pin 999× and 1019× as unit errors and 970×, 1030× as ordinary contradictions. | The documented rule wins over one example in a test list; a band narrower than 0.1 % would miss real exports rounded to a few digits. |
| DEC-78 | WP-A1 A-03 | **"Width exceeds the plan dimensions" applies only to clear plates** (the gate the existing thickness check uses: thin axis ≤ half the middle one, sides within 30 %). | S07/S08 steel piles are modelled as `IfcSlab` BASESLAB with `Width` = their 6 m length, consistent with their stated volume and area; their "plan" is 0.3 m, so the literal rule would turn every pile into a 0.3 m plate. |
| DEC-79 | WP-A1 A-02…A-04 | **A contradiction's `suggestion` is what the engine uses while nobody answers**, as `Question.suggestion` is documented ("what the engine would use if nobody answers"); "recommended" and "used" are therefore the same. A question collecting several elements suggests the geometry as soon as one of them uses it (unit error, implausible value, a plate's stated Width); each element's own line note and log say what it used. | One meaning for `suggestion` in the contract; a recommendation the engine does not follow would leave the ×1000 value in a blocking run's interim sheet. |
| DEC-80 | WP-A1 A-04 | **`presets/settings/resolution.json` is not edited**; the defaults (10 / 50) live in the type's docs and `measure.py`. | `V5__Seed_system_presets` seeds system presets once: a new key in the file would reach fresh databases only, and the pilot's copy would differ from every developer's. Absent keys take the defaults everywhere. |
| DEC-81 | WP-A1 A-04 | **Resolution drafts are checked by the engine before publishing** (`presets.check("resolution")`, registered in `Library.java` CHECKS); `ResolutionSettings` gains optional `id` / `name`. Federation drafts stay unchecked (N-01). | A-04's "preset check refuses bad values" needs the check to run; the new scenario showed that the Library writes `id`/`name` into every resolution preset, which the schema refused, so a run on an org resolution preset could not pass the worker's schema check (a pre-existing defect, fixed because A-04's acceptance depends on it). |
| DEC-82 | WP-A1 | **The baseline is recaptured once, in the package's last commit**, not per item; each item's baseline effect is recorded in PROGRESS.md's log with its item id. | The Phase A text ("every package that moves numbers recaptures the baseline in its last commit"); a full capture takes ~50 min. |
| DEC-83 | WP-A2 A-05 | **A line fed by any open contradiction is "to confirm"**, blocking or not, unit errors included, and `stats.flaggedLines` counts these lines (no new stats key); the line keeps its `source`; a person's quantity edit confirms it. A-05's acceptance "lines with no missing data unchanged" is read as *quantities* unchanged. | A-05's title asks for contradiction-fed lines; Java keeps a fixed set of stats keys (`RunJob.retain`), so a new key would need a contract change for one count. The Duplex party-wall line becomes "to confirm", which matches DEC-59 (the sample keeps that contradiction open to teach it). |
| DEC-84 | WP-A2 A-06 | **The trace names contradiction answers and `missing_data` values**, with the author's display name and the time from the job input; name and `unmatched` answers are counted in `decisionsApplied` but not named per element (a known limitation). `TraceDecision.answer` is schema `{}`; public share lines drop trace decisions (BR-56). | Those two kinds change how an element is measured; name answers act through the dictionary layer and need their own wiring. The Java generator cannot read a nested multi-type field, and the existing BR-56 scenario caught the share leak. |
| DEC-85 | WP-A2 A-07 | **Name words are a multilingual default list in the resolution settings, matched as whole words** (not regexes, so no ReDoS before A-35); the floor-line check covers floor slabs only, with a 1 % margin; pile caps warn too ("cap" is in the item's list); no "treat as IfcPile / IfcFooting" action, because no reclassification rule exists (the item's own condition). | CLAUDE.md rule 10 (no single-language defaults); S03's pitched roof and S10's one-storey slabs were false positives at the exit check. |
| DEC-86 | WP-A2 A-08 | **Every door or window that fills no opening warns, one warning each**, also on models that have no openings at all (S10: 464). Grouping them is a later item (N-06). | The item asks for each element with its nearest wall; S10 genuinely has no `IfcOpeningElement`, so none of its walls is reduced. |
| DEC-87 | WP-A3 A-09 | **Faces are a wall's area only when its oriented box is at most 1.5x its thickness thick** (besides the existing clear-plate gate and a horizontal thin axis); otherwise volume / thickness stays. **Layer volumes stay layer area x layer thickness** (the documented breakdown rule), so a notched wall's layers add up to a little more than its volume (known-limitations "Wall area"). Consequence: an answer to a wall's thickness or volume contradiction no longer moves its m2 area (only m3, thickness-based quantities and the description); `test_versions.py` now checks the answer on the line trace instead. | The item's risk line (curved walls: faces are selected by normal); a box much thicker than the wall is a curved or bent wall whose faces the normal test only partly finds. Scaling layers to the volume would change the breakdown contract and every layer line; A-24 (WP-A6) owns breakdown volumes. |
| DEC-88 | WP-A3 A-10 | **Contact faces are detected geometrically, against solids of the structural classes in the same model, whatever their material; `PARSE_FORMAT` is not bumped.** A point 2 cm outside a vertical face, on a fixed 0.2 m lattice, lying inside another closed footing, wall, slab, column, pile or beam (winding number; no spatial index, `rtree` is not installed) marks contact. The field is optional: a parse made before A-10 falls back to 2 x (length + width) x height. | The item says "less faces in contact with other concrete where detectable": the parser does not resolve materials, and formwork is not needed against any solid. Bumping the format would make every run on the pilot's stored parses fail (`parse_format_mismatch`; nothing re-parses automatically), the comment in `parse.py` now says when to bump. |
| DEC-89 | WP-A3 A-11 | **Paint to plasterboard becomes an item rule** (face breakdown, `claims: ["paint"]`), not a derived rule with a new expression function; **`paint_walls_formula` is removed** with its room-faces choice; the "separate slot the firm may change" is `finish_openings` (`as_walls` default / `own`) with three `finish_opening_*` slots. Three engine fixes the item needs: `partFilter` after breakdown, face parts deduct their share of the openings, and a side's room faces are scaled to the side when the uncovered sliver is too small to be a face. Which face carries which layer comes from the IFC layer-set usage and the placement (already parsed); unknown, the last layer goes on side a (noted). | A derived rule only evaluates an expression: following the wall's five opening modes there would need a second deduction implementation (rule 4: one place). A distinct claim keeps A-20's "two item rules of one family without a claim" quiet. A firm patch that set the removed slot still runs (patches are validated on their own), its value ignored; `presets.check` refuses it in a new draft. |
| DEC-90 | WP-A3 A-12 | **Reveal depth per face = the opening's depth / 2 (frame taken as central), for every `addReveals`, not only on finishes; the wall slot is removed, not renamed** (`finish_add_reveals` on `paint-walls`). The package's expected "S05/S03/S07/S09-standard wall areas lose reveals" does not happen: standard-style-example removes the `walls` item and its `wall-layers` never had `addReveals`, so `wall_add_reveals: true` changed nothing (no baseline run has an `add.reveals` step); those runs' paint lines gain reveals instead. `room-walls` (a formula over the room's net wall area) gets no reveals. | The opening's frame position is not parsed ("or the opening's depth on that face" is not available); half per face makes `both` and two face parts agree. One rule for every deduction keeps a firm's own `addReveals` consistent with the preset's. |
| DEC-91 | WP-A3 A-13 | **The slab-edge default stays "outer edge and the edges of openings"** (now `(src.perimeter_outer + src.perimeter_openings) * src.thickness`, the same number as the old `src.perimeter * src.thickness`); "Outer edge only" is the other choice. `perimeter_openings` comes from the openings' plan boxes, `perimeter_outer` = perimeter less that; a reported `Perimeter` is the total; a perimeter not longer than its openings' edges is taken as outer. Firm patches holding the old second formula are not rewritten. | The old default's label said "outer edge" while it measured both; keeping the number (formwork to opening edges is formwork) avoids a silent drop in every BoQ with slab openings. The opening outline is not parsed (box only). Stored patches are firm data (never edited by a code change). |
| DEC-92 | WP-A3 exit check | **A repeatable Flyway migration publishes changed system presets as new versions, parents first; pinned versions stay** (D81). Done inside WP-A3 rather than as a new item, because the package's preset changes (A-10 to A-13) otherwise never reach the stack or the pilot, and its expected baseline names the stack runs. No version is edited in place; the version ids continue V5's naming (`...:<slug>:<n>`); a fresh database gets no extra version. | The stack layer of the first full compare showed A-09 (engine) but not A-10/A-11 (presets): V5 seeds once and nothing else writes system presets. Editing version 1 in place would silently move pinned BoQs (rule 7 asks for visible changes). |
| DEC-93 | WP-A4 A-14 | **In-situ means concrete layers without screed and precast (default), with a slot for every concrete layer; a single-layer part keeps the element's volumes; N-10 (concrete masonry resolving to concrete) is fixed here.** The item's acceptance "S09: in-situ concrete = precast/concrete layers only" became: S09 has no in-situ concrete (its floors are screed, insulation, air, block and precast; "Simple floor" is screed on a floor block). | CAS-017 itself lists screed and precast among the layers that are not in-situ concrete; the item calls the line "In-situ concrete". Without the dictionary fix the S09 block layers would have stayed "concrete" and the item would have measured blocks. A single layer is the element, so its reported or measured volume is the right one (S05's 127 mm slabs unchanged); A-24 still owns multi-layer volumes. |
| DEC-94 | WP-A5 A-18 | **One `duplicate_conflict` question per GlobalId** (the item's id), not grouped by type; it **blocks** when a quantity differs beyond the resolution settings' `contradictionBlockPct` (the item names no blocking rule; same thresholds as contradictions), and the warn threshold judges quantities as larger / smaller − 1. **The owning discipline is judged on every copy** (a listed, non-`rest` discipline whose selectors match any copy), and this order (body, owner, own copy, model order) applies to all copies, not only conflicting ones (one predictable rule; copies that agree give the same numbers). **Aggregates compare names only**, and a value only one copy has is no conflict. Lines fed by an open one are not marked to confirm (N-13). | The certification roof's two copies are aggregates of different parts (slabs vs girders), so comparing their rolled-up volumes would have blocked a correct federation; F01's 8 steel piles differ only in material, and per-object answers keep the id stable across versions. |
| DEC-95 | WP-A5 A-21 | **IsExternal is a fallback after the dictionary type, not an override**: "add `OR is_external` to external walls" would have coded the Duplex party wall (type `wall.party`, IsExternal TRUE) external, against the documented rule that the type wins (test_duplex); the contradiction becomes a `code_check` warning instead. **The check is data**, a new `MapRule.expect` condition, not wall logic in `classify.py` (rule 3). **Catch-all walls go to ACME's existing `Z.99` "To be classified"** rather than `onUnmapped: ask`, so the run gains no questions; demo-trades' catch-all `masonry` becomes masonry-only (99 Other is its "to be classified"); uniclass2015-ef is not applicable (`EF_25_10 Walls` holds every wall). Standard-style `wall-layers` lines are not keyed by `is_external`, so ACME's wall rules now give `mixed_line` warnings where a layer line mixes external and internal walls (N-14). | The item's own acceptance (S01/S07/S09 external walls coded external) holds either way; the order keeps every existing code that a type decides. |
| DEC-96 | WP-A6 A-24 | **Material groups follow the layer rule (area x thickness), and the sum check logs instead of flagging or scaling.** The item's acceptance "Duplex walls material gross total = 239.76 m3 ± 0.1 %" cannot hold with its own change ("gross_volume = gross_area × t per material group, as for layers"): layers give 243.70 m3 on the Duplex, +1.6 % from its four notched walls (DEC-87), and material groups now equal layers exactly (the ×4.6 is gone). Scaling parts to the solid would move shipped layer lines (`slab-concrete`, `wall-layers` formwork), which the package's expected baseline excludes; flagging every notched wall's lines "to confirm" would mark correct Duplex lines. A warning in the log names both sums (2 % tolerance, at least 1 litre; volume items only); no shipped preset × sample triggers it. | The layer rule is documented (D76, DEC-87); the known-limitations row keeps "layer volumes as a share of the element's volume" as the later fix. |
| DEC-97 | WP-A6 A-27 | **A capped expression is a `/presets/check` problem (200, `ok: false`), not a `400`.** The item's acceptance says "`POST /presets/check` with the repro → `400` with a problem location", but the contract documents only `200 CheckResponse` for that endpoint and every other invalid draft (syntax errors included) comes back as `ok: false` with its problems, which the Library shows inline; a 400 would make one kind of bad expression behave unlike the rest. The location is in the problem text ("nested too deeply at 2000"). The 400 path exists where input is refused rather than checked: the worker's 422 becomes the API's `400 engine_input`. A third cap (200 chained operators) is added because the evaluator recurses once per operator, so a long flat `a + b + ...` within 10,000 characters would still exceed Python's stack. The Java test is the shared scenario (`line-edits.test.ts`, run by `NativeWorkerTest` against Java) rather than `ErrorResponsesTest`, which has no engine. | No contract change for one error; the outage-looking 503 is what the item fixes. |
| DEC-98 | WP-A8 A-31 | **Renamed unnamed sets are kept, not adopted as reported quantities.** S12's unnamed sets hold "Volume", "Total Surface Area" and "Footprint Area" under no set name; no quantity source names `#<id>` sets, so they stay in the element's data (and the `pset_renamed` check) without becoming a reported volume, as on the worker path before. The item's risk ("the renamed sets' quantities now count") would need a source pattern guessing what an unnamed set means; the sources stay data a firm can extend (`quantity_sources.json`). The in-process parity is done in `parse_file` (a JSON round trip of the ParsedModel), not by schema-validating every parse, so the CLI, the review tool and the tests all take the worker's path. | S12's engine lines now equal the stack's (5 lines, same quantities); guessing would change S12 against the stack. |
| DEC-99 | WP-A8 A-34 | **The rule chain is shown as names and versions everywhere, so the engine layer's Excel changes too.** The package expected no engine-layer change (system presets have slug ids), but the fix that meets the acceptance ("Rules: Petra rules v3 → As modelled v1") is one format for every chain: BoQ!A2 and the Inputs sheet's "Rule set chain" read `meta.chainLabel` (each level's name and version, the rule set first), so every engine run's A2 reads e.g. "Rules: As modelled (master template) v1.0.0" instead of "Rules: As modelled (master template) (as-modelled)". `meta.chain` (ids) stays for machines. The API puts the published version number into each level's document, so the stack shows "v3", not the file's "1.0.0". | One label rule instead of a special case for `version-` ids; the cell text is the only difference (no quantity, code or status). |
| DEC-100 | WP-A9 A-35 | **Unsaved dictionaries need the right to edit presets, which an org library editor has on any project they can see; a stored pattern RE2 refuses fails the run; `` next to a non-ASCII letter is refused.** The item says "require `editPresets` (library editor)"; a project-role check alone would have taken P54 Q43's preview away from library editors who are viewers on a project, so `ProjectAccess.presetEditor` accepts owner, admin and library_editor or the project's `editPresets`. A pattern RE2 refuses (published before RE2, or in an unsaved draft) raises a `ValueError` naming the entry (an `engine_input` error), not a silent non-match (CLAUDE.md rule 5). RE2's ``/`\w`/`\d` are ASCII; Latin-script names are also matched accent-folded, so shipped patterns match exactly as before (3,800 pattern x name pairs compared), and `` written next to a non-ASCII letter, which could never match, is refused with the `\pL` spelling. The acceptance's 10 ms: 0.06 ms measured. The editor's `flags` field is not read by the engine (N-17, a known limitation). Found at the targeted scenario run: the generated DTO defaults `draftDictionaries` to `[]`, so the check is on a non-empty list (b94db4f). | P54 Q43 stays as answered; rule 5; international names (rule 10). |
| DEC-101 | WP-A9 A-36 | **The worker enforces the token only once it has one.** The pilot's deploy reuses the root-owned Compose file and `pilot.env` (`deploy-release.sh`; Compose and secrets are operator tasks), so a worker refusing every call without a token would break every rpc on the first green push. Without `BOQLET_WORKER_TOKEN` both sides keep the network-boundary control and the worker logs a warning; the operator sets `WORKER_TOKEN` and recreates `api` and `engine` together (`docs/operations/pilot.md` "Worker token", written before any push). The FastAPI docs and `/openapi.json` are switched off on the internal service as well. | The item's risk line (deploy ordering); never push red. |
| DEC-102 | WP-A9 A-37 | **One body for every `404 not_found`, set in `ApiException`, instead of mapping each access helper.** Mapping per resource (the item's second option) would leave the next helper to get it wrong; every `not_found` now says "The resource was not found." (the specific text stays the exception's message for the log), as do the unknown-route handlers. No test or app text read the specific messages (the app shows its own `not_found` text). | One rule in one place covers BoQs, runs, revisions, presets, models, jobs, notifications. |
| DEC-103 | WP-A9 A-38 | **`proxy.ts`, not `middleware.ts`; inline styles allowed; report-only by default in production with a report endpoint; no `upgrade-insecure-requests`.** Next 16 renamed middleware to `proxy` (bundled docs). Server-rendered `style` attributes need `style-src 'unsafe-inline'` (a nonce would disable it). "Report-only first on the pilot" needs reports someone can read, so `/csp-report` logs a masked `csp.violation` line, and the default stays report-only until the pilot has run one deploy without reports (N-18); `next dev` and the browser smoke enforce, so a violation fails CI. The storage origin is configuration (`BOQLET_STORAGE_ORIGIN`), with "any https origin" when unset so a pilot whose Compose file predates it is not broken. `upgrade-insecure-requests` would break the local stack's plain-http storage, and HSTS already covers the pilot. | The item's approach and risk ("blocked signed-URL uploads or the viewer"); checked in a browser on a dev and a production build. |
| DEC-104 | WP-A9 A-39 | **Editing a link of an archived BoQ is refused too**, with the same `409 boq_archived`; revoking stays allowed. The item names creation; an edit can revive an expired link (P54 Q46), which is sharing again. The contract gains the `409` on `updateShareLink` (it already answered one for revoked links). | "Archived content can't be published" (the item's why). |
| DEC-105 | WP-A10 A-40 | **Resume keeps its state in the tab's memory, and "re-request URLs if expired" is a new endpoint.** The uploader keeps the parts sent and their ETags in memory (`UploadSession`), not in browser storage, so a reload starts a new version (known limitation); `renewModelUpload` (`POST /model-versions/{id}/upload`, contract C22) re-signs the same multipart upload. A renew after 24 h answers `409 upload_expired` without recording the failure (a refusal rolls the transaction back; the hourly sweep or `complete` records it). Parts go three at a time; retries cover no answer, 403 (after renewing), 408, 429 and 5xx. | The item asks for resume "within the URL lifetime (re-request URLs if expired)"; the API had no way to re-sign. Persisting signed URLs and file handles across reloads would need IndexedDB and the File System Access API, more than the item's M effort. |
| DEC-106 | WP-A10 A-41 | **The dialog names what changed, not "N edits and M answers"; the file name ends `_run<yyyyMMdd-HHmmss>` (UTC), not `_run<HHMM>`; the BoQ sheet's header line carries the note too.** `pendingChanges` (the header's words: line edits, answers, models, ...) is what the API knows without a new count; counting edits would need a contract change for one dialog. The run's date and seconds are in the name because the browser check exported a run from three days earlier as `..._2026-11-25_run1335` (read as today), and two runs a few seconds apart would share `HHMM`. "Generate and export" is offered only to someone who can edit the BoQ (`editBoqs`); others see why and export the last run. | The item's own fallback ("or run number") shows the name format is open; runs have no number in the contract. |
| DEC-107 | WP-A10 A-42 | **Label by effect, binding unchanged.** `exportWatermark` keeps true = watermark (Java, the presets, the overrides all read it so); its name becomes "Watermark on exports" in the one `errors.limit.name` key (editor, billing page, limit dialog), and the editor's switch reads "On" rather than "Included" for it (`SETTING_LIMITS`). The impact line "would lose it" now reads correctly (an org loses the watermark). | Inverting the binding would touch the stored entitlements and the override API for a label problem; the item allows either. |
| DEC-108 | WP-A11 A-43 | **Dictionaries merge three ways by entry id; a rule-set draft is refused and rebased whole; the app settles all conflicts one way.** A promotion is an additive entry, but an editor can change the same entry, so the merge is per id (`DraftMerge`), and only a real conflict refuses. Rebase is `keep: mine | theirs` plus optional per-conflict `choices`; the app offers the two whole choices (per-entry picking in the editor is left out, known limitation). The rule-set refusal is not reachable through today's API (a preset has one draft and only promotions publish past an open draft, for dictionaries only): it guards drafts the V24 backfill finds behind and later publish paths (D-27), so its scenario covers the dictionary refusal and rebase only. | The item asks for "keep mine / take theirs per entry" and "refuse rather than merge" for rule sets; the acceptance's rule-set 409 cannot be produced without writing to the database. |
| DEC-109 | WP-A11 A-44 | **Newer-version info is a read-only list beside the inputs, not inside them; the bulk move skips reviews; creation keeps the org defaults.** `presetInputs` sits on `BoqRevision` and `defaultPresets` on `Project` (not in `RevisionInputs` / `ProjectDefaults`, which are also request bodies and stored JSON). "Move working BoQs to the latest" skips a version in review or approved instead of withdrawing the review (BR-23) for everyone at once, and moves project defaults only when asked. The pickers are in project settings; the creation form keeps taking the org's defaults (one more form for the same choice; new item N-23). | The item lists pickers "at project creation and in project settings"; settings is where the frozen default can be fixed, which is the reported harm. |
| DEC-110 | WP-A11 A-45 | **One default rule set; classifications and dictionaries may be several defaults.** A project has one rule set but a list of classifications and dictionaries, and before V25 every starred one of those was a default; one per kind would have dropped some on migration ("must reproduce today's choice"). The order-dependent pick was the rule set's, which is now unique (index `presets_one_default_rule_set`). Federation and resolution presets are not offered (new projects take none). | The item says "one explicit default per preset kind" and "migration picks today's effective default"; both hold for the single-valued input. |
| DEC-111 | WP-B1 B-01 | **Hard and soft invariants.** The item says both "logs an error entry" and "the worker reports `result_invalid`", and its risk note "log-only in production". Duplicate ids or keys can never be stored (Java would refuse the rows), so they fail the run as `result_invalid` everywhere; the number and count checks are soft: a warning entry in production (the log has no `error` level, `LogEntry.level`), an exception in strict mode. The breakdown "parts sum to the element" check stays A-24's `log.quantity.parts_volume` (it needs the element's own volume, which the result does not carry); the invariant checks each item line against its elements' shares instead. | Keeps production runs going on a model that trips a soft check while every test and the strict compare fail on it. |
| DEC-112 | WP-B2 B-05 | **The local target uses the stack's own sign-in, not a test image.** The item offers "provisions accounts through the local stack's admin/setup links"; the roadmap had a test image with `SuiteSupport`. The suites now speak native sign-in (setup link by SQL, `POST /auth/set-password`, `POST /auth/sign-in`, cookie + Origin) when `BOQLET_TARGET=local`, every run makes its own people and orgs (seed slugs `studio-demo-<run>`), and the four scenarios that need `suite_clock` skip there. | Tests the product image as deployed, with no second build; the harness path is unchanged. |
| DEC-113 | WP-B2 B-08 | **"Retry only a timeout" in Playwright.** Playwright retries every failure; `e2e-java/fixtures.ts` records how each attempt ended and fails a retry at once unless the first attempt ended `timedOut` (or `passed`/`skipped`, when a serial group reruns). Vitest does it with `retry.condition` on its timeout message. Flaky passes are listed in the log and the CI job summary. | Meets "a genuine failure still fails" with the runners' own retry. |
| DEC-114 | WP-B2 B-07 | **The F08-AC4 3 s timing leaves the deploy gate.** The nightly perf spec measures it (median of 3, production build); the `model-versions` scenario keeps the uncached report's job and lines. The 4,000-line sheet budgets are regression gates above the spread of three runs here (first row 2.1–2.8 s, gated at 4 s; longest task while typing 87–141 ms, gated at 250 ms); the 2 s and 100 ms targets are B-18/B-19's, which tighten the gates when they land. | A timing on a loaded 2-CPU runner was a false red (DEC-07); a budget the code cannot yet meet would make the nightly job always red. |

### 3.5 Spec-issue findings: which doc changes and how

The item that implements the change also edits the doc in the same commit; doc-only corrections are in B-17.

| Finding | Doc(s) | Change | Item |
|---|---|---|---|
| ENG-008 | `docs/domain/business-rules.md`, `docs/architecture/rules-language.md:225` | New BR: an element feeding two item rules of the same quantity family without a claim raises `double_count` | A-20 |
| ENG-010 | `packages/types/src/measured.ts`, `rules.ts`, `rules-language.md` | Units come from the registry; state which unit `minimum` uses (the output unit) | A-28 |
| ENG-017, FM-42 | `docs/architecture/frontend.md` | "Reads as" and slot rename go through the engine rpc | B-13 |
| ENG-019, FM-112 | `docs/domain/business-rules.md` BR-09 | Edits store the engine value at edit time; a moved basis raises `stale_override` | D-36 |
| ENG-020 | `docs/product/features/F03…F04`, `docs/architecture/engine.md` | Overlaps block by default (federation setting) | A-19 |
| ENG-022 | `packages/types/src/dictionary.ts:73`, `docs/product/guides/dictionaries.md` | "RE2 syntax", not ECMAScript | A-35 |
| ENG-032 | `docs/product/features/F05-questions-and-decisions.md` | Note that rule-dependent answers apply project-wide and the dialog shows the scope | C-17 |
| PRD-002, PRD-014, FM-64 | `F16-setup-wizard.md`, `docs/product/scope-and-acceptance.md` criterion 12 | Wizard previews on the sample created at org creation; criterion 12 runnable as written | C-34, C-35 |
| PRD-005 | `docs/product/roadmap.md`, `open-questions.md` Q12 | Export adapter plan; GAEB/ÖNORM after sourcing check | D-41 |
| PRD-007 | `docs/product/overview.md` O1/O3 | "Capability built; accuracy not yet validated against a professional BoQ" | B-17 |
| PRD-011 | `docs/product/features/F19-platform-admin.md` | "Orgs on a paid plan" defined by the plan's price, not the id `free` | D-21 |
| PRD-016 | `F15-i18n-units-locale.md` | Interim "metric output only" label | C-45 |
| PRD-017 | `docs/product/overview.md` "How we know it's working" | Which measures are instrumented and where | D-23 |
| PRD-019 | `docs/product/plans-and-limits.md`, Q18/Q26 | Record the pass mechanism and minutes as fair use (input to Q18/Q26) | D-16 |
| PRD-026, CAS-029 | `F12-exports.md`, `plans-and-limits.md` | Define the watermark: header/footer on printed sheets + share-page note | C-21 |
| PRD-028 | — (P22/P56 kept) | No change; reduced motion noted in design-guidelines | C-33 |
| CAS-005 | `F06-boq-sheet.md` | Pending-edits banner and the Excel guard | C-08 |
| CAS-009 | `F10-library.md` | Example presets hidden by default | C-42 |
| CAS-028 | `F18-share-links.md` §2 | Align with P54 Q52; add the show-edits option | C-27 |
| QS-014 | `rules-language.md` presets table | Proxies not billed by default | A-16 |
| QS-020 | `rules-language.md` presets table | Reveals belong to finishes | A-12 |
| QS-021 | `docs/testing/engine-validation.md:42` | Walls validated against faces, not volume ÷ thickness | B-03 |
| QS-023 | `docs/architecture/engine.md` measure table | Outer perimeter and opening perimeter are separate fields | A-13 |
| LEAD-002 | `F02-projects.md` §2, `F10-library.md` §4, BR-07 | Pinned versions + newer badge + move-to-latest | A-44 |
| LEAD-004 | `F18-share-links.md` §1, `F09-review-approve-issue.md` | Sharing defers to approval | A-46 |
| LEAD-005, LEAD-018 | `docs/domain/permissions.md` | Library editors read where-used, decisions (for promotion) and a library-filtered audit | D-26 |
| LEAD-009 | `F09-review-approve-issue.md` §4 | "Only chosen reviewers" option | D-28 |
| LEAD-011 | `plans-and-limits.md` | `seatRoles` entitlement | D-20 |
| LEAD-020, FM-39 | `screens.md` S12d, P54 Q44 note | Changes visible to viewers | C-14 |
| UX-007, UX-048 | `docs/product/known-limitations.md`, `design-guidelines.md` | Density switch tracked until C-06 ships | C-06 |
| UX-034 | `design-guidelines.md` | Kept as spec; implemented | C-37 |
| UX-045 | `design-guidelines.md:276` | Drop the stale "Still to supply: wordmark SVG" (P56) | B-17 |
| UX-047 | `docs/development/design-system.md:45-46`, `screens.md:73` | Mark components built / not built; search missing | B-17 |
| FM-08 | `plans-and-limits.md` "Definitions" | Checked on create and on ownership transfer | D-14 |
| FM-23, FM-49, FM-57, FM-68 | F04, F13, `plans-and-limits.md`, F18 | Per DEC-68, DEC-69, DEC-66, DEC-67 | B-17 |
| FM-38 | `F09-review-approve-issue.md` §6 | Action names as built + `edits.imported` | D-25 |

---

## 4. Phased plan

Item format: **Sources** (finding ids, VER ids, FM rows; report sections to read for detail) · **Problem** (verified
facts) · **Why it matters** · **Change and approach** · **Files** · **Acceptance** · **Tests** · **Effort** (S ≤ ½ day,
M ≤ 2 days, L > 2 days) · **Depends on** · **Risk**. Items are listed in work-package order; the package each
belongs to is in its heading. Every item ends with the CLAUDE.md after-task duties (changelog row,
known-limitations, the feature's status block, decisions) — not repeated per item.

### Phase A — correctness and safety

Wrong quantities, data loss, security and crashes. Engine packages first (DEC-74); every package that moves
numbers recaptures the baseline in its last commit.

#### A-01 · Area sources include `BaseQuantities.GrossArea`; never derive an area from a contradicted volume  (WP-A1)
- **Sources:** QS-001, PRD-001, CAS-001 · verify-engine §3 "QS-001 / PRD-001 / CAS-001" · 04 §3.1
- **Problem:** `engine/ifc_boq/data/quantity_sources.json` lists `Qto_*BaseQuantities.GrossArea` and `BaseQuantities.NetArea` but not `BaseQuantities.GrossArea`, so S09's stated 146.199 m² is never read and `measure.py:360-365` derives `area = volume / thickness` from the ×1000 reported volume → 146,199.06 m² "measured"; building values poisoned (`gross_volume` 443,773 m³).
- **Why it matters:** the first BoQ a new customer sees can be ×1000 on the main slab (critical; O3).
- **Change and approach:** add the generic `BaseQuantities.{GrossArea, GrossSideArea, NetSideArea…}` names that are missing (audit the table against the `Qto_*` names it already has); in `measure.py` only derive area from volume ÷ thickness when the volume is not itself contradicted by the geometry (after A-02), otherwise prefer the geometry's top area; log which source was used.
- **Files:** `engine/ifc_boq/data/quantity_sources.json`, `engine/ifc_boq/measure.py` (area adoption ~`:330-365`), `engine/tests/test_scope_recess_building.py` or a new `engine/tests/test_reported_quantities.py`.
- **Acceptance:** S09 "Slab, Floor-Grnd-Susp…" = 146.199 m² and "Slab, Simple floor" = 80.26 m² on the default config without any answer; S03/S05 slab areas unchanged; `verify-quantities` S09-slab-area turns FIXED.
- **Tests:** unit test with a synthetic element carrying only `BaseQuantities.GrossArea`; regression on S09 (parse cache) in a slow-marked test.
- **Effort:** S · **Depends on:** — · **Risk:** another exporter whose generic GrossArea is wrong; mitigated by A-03's area cross-check.

#### A-02 · Unit-scale guard: a reported quantity 10^±3 / 10^±6 off the closed mesh is an exporter unit error  (WP-A1)
- **Sources:** QS-001, PRD-001, CAS-001 · FM-117 · DEC-31 · 02 PRD-001 detail, 03 CAS-001
- **Problem:** a reported `GrossVolume` 1,000× the closed-mesh volume is adopted; the `contradiction` question is non-blocking and recommends "the volume stated in the file" (`measure.py:522-531`); the Excel shows plain "measured".
- **Why it matters:** the recommended answer keeps the wrong number; users taught to accept suggestions price a house ×1000.
- **Change and approach:** in `measure.py`, when a reported length/area/volume vs a **closed** mesh value has a ratio within 2 % of 10^±3 or 10^±6, use the geometry, keep the question (same deterministic id) with `suggestion: "geometry"` and the geometry option recommended, add a line note "file value looks like a unit error (×1000); geometry used", and a `unit_scale` detail in the log. Applies to volume, area and length.
- **Files:** `engine/ifc_boq/measure.py` (`:300-325`, `:515-535`), `packages/types/src/measured.ts` if a new note/detail code is added (then `npm run codegen`), `apps/app/messages/en/engine.json` (new message key), `engine/ifc_boq/export_xlsx.py` (note reaches the Excel).
- **Acceptance:** S09 default: "In-situ concrete, Simple floor" 13.24 m³, slab volumes 68.71 m³, building `gross_volume` plausible; both contradiction questions recommend geometry; `verify-quantities` S09-floor-volume FIXED; no change on S03/S05.
- **Tests:** unit tests for ratios 1000, 0.001, 1e6, 999 (not a unit error), open mesh (guard not applied); contract test that question ids are unchanged.
- **Effort:** M · **Depends on:** A-01 · **Risk:** a genuinely 1000× element with a broken mesh — guard requires a closed mesh.

#### A-03 · Slab area cross-check and quantity-set sanity (NetArea > GrossArea, thickness from the thin axis)  (WP-A1)
- **Sources:** QS-003, QS-013 (Pad 2 doubling) · FM-95 (area part) · verify-engine §3 "QS-003" (critical)
- **Problem:** Revit 2021 IFC4 writes `Qto_SlabBaseQuantities.NetArea` = total surface area (top+bottom+edges); the engine adopts NetArea first with no area check: every slab area in S07 ×2.22, S08 ×2.54; pile cap 44.08 m² vs 14.44; `Width` 3.8 m taken as thickness → edge formwork 57.76 m² vs 15.20.
- **Why it matters:** silent, plausible-looking ×2 on the most common authoring tool (critical).
- **Change and approach:** (1) treat `NetArea > GrossArea` (impossible by definition) as an invalid reported area; (2) add an **area contradiction** (reported area vs geometry top area or volume ÷ thickness, same thresholds as volume/thickness, A-04) with deterministic id `contradiction:area:{class}:{type}`; (3) for slabs, when the stated `Width` exceeds the plan dimensions or disagrees with the oriented-box thin axis beyond the threshold, prefer the thin axis and raise the existing thickness contradiction with geometry recommended.
- **Files:** `engine/ifc_boq/measure.py` (`:301-339`), `engine/ifc_boq/data/quantity_sources.json` (order note), `packages/types/src/engine.ts` (question kind detail if needed) + `npm run codegen`, `apps/app/messages/en/engine.json`, `docs/architecture/engine.md` (contradiction kinds).
- **Acceptance:** S07/S08 slab-area sums within 2 % of volume ÷ thickness (S07 ≈ 1,077 m², S08 ≈ 402 m²); pile cap 14.44 m², edge formwork 15.20 m²; `verify-quantities` S08-pilecap-area and S08-pilecap-edge-formwork FIXED; S03/S05 unchanged.
- **Tests:** unit tests for NetArea > GrossArea, Width > plan extent; regression on S08 pile cap `3OQjd9jwr1COqcP44Fm6DW`.
- **Effort:** M · **Depends on:** A-01 · **Risk:** new area questions add review noise on Revit models; they are non-blocking below the block threshold.

#### A-04 · Contradictions: a block threshold, a plausibility-based recommendation, thresholds as settings  (WP-A1)
- **Sources:** QS-002 · FM-87 · DEC-31, DEC-32 · verify-engine §3 "QS-002"
- **Problem:** every `contradiction` is `blocking: False` with `reported` recommended, regardless of size (`measure.py:522-531`); thresholds are constants (`measure.py:63-64`); a ×1000 or −95 % contradiction never blocks while 61 name questions do.
- **Why it matters:** "complete" can hide a gross error; priority inversion in the review queue.
- **Change and approach:** read `contradictionWarnPct` (today's constant) and a new `contradictionBlockPct` (default 50) from the resolution settings preset (`presets/settings/resolution.json`, type in `packages/types/src`); above the block threshold the question is blocking unless A-02 already explained it as a unit error; recommendation = geometry when the mesh is closed and the ratio is outside 0.5–2×, else today's rule. Name-question blocking is unchanged (DEC-32).
- **Files:** `engine/ifc_boq/measure.py`, `presets/settings/resolution.json`, `packages/types/src/*.ts` (settings type) + `npm run codegen`, `apps/app/src/features/library/*` resolution editor fields, `docs/architecture/engine.md`, `docs/product/known-limitations.md` (FM-87 row).
- **Acceptance:** S07 landing slab thickness (−95 %) and S08 pile-cap thickness questions are blocking with geometry recommended; S05 party-wall thickness (−16 % to −10 %) stays non-blocking; thresholds editable in the Library resolution editor and honoured by a run.
- **Tests:** unit tests at 49/50/51 %; preset check accepts/refuses bad values; scenario `questions.test.ts` asserts a blocking contradiction.
- **Effort:** M · **Depends on:** A-02, A-03 · **Risk:** more runs end `needs_input`; that is the intent for > 50 % differences.

#### A-05 · Partially measured lines and lines fed by an open contradiction are flagged  (WP-A2)
- **Sources:** QS-008, QS-001 (recommendation "flag the line") · verify-engine table QS-008
- **Problem:** S09 "Wall, Wall-Ext…" 44.13 m² (1 of 3 elements without value, ~31 % short) is source `measured`, not yellow in Excel; `flaggedLines` counts only fully empty lines (`rules.py:727-733`).
- **Why it matters:** a partial total reads as complete in the sheet and the export (rule 5).
- **Change and approach:** add a line state "partial" (n of m elements measured) and "depends on an open contradiction" to the result (types first), counted in `stats.flaggedLines` (or a new `partialLines`), shown as TO CONFIRM in the sheet and yellow in Excel with "n of m elements measured".
- **Files:** `packages/types/src/engine.ts` + `npm run codegen`, `engine/ifc_boq/rules.py` (`:720-745`), `engine/ifc_boq/pipeline.py` (stats), `engine/ifc_boq/export_xlsx.py` (fill + note), `apps/app/src/features/boq-sheet/*` (source tag), `apps/app/messages/en/boqs.json`, `services/api/.../boq/RunIndex.java` if a new column is indexed.
- **Acceptance:** S09 wall line flagged "2 of 3 measured" in sheet and Excel; lines with no missing data unchanged; `test_result_matches_the_typescript_contract` green.
- **Tests:** engine unit test (one element without value in a three-element line); export test for the fill; app unit test for the tag.
- **Effort:** M · **Depends on:** A-04 · **Risk:** result-shape change touches the stack ingest; keep the field optional.

#### A-06 · Quantity-changing decisions are counted and visible on the line  (WP-A2)
- **Sources:** QS-010 · verify-engine QS-010 · 04 §5 A7
- **Problem:** answering contradictions with `geometry` moves the party wall 71.67 → 76.60 m², but `stats.decisionsApplied = 0` (`pipeline.py:344,402` counts only raised questions), the line source stays `measured`, Excel "Decisions applied" says 0 (`export_xlsx.py:363`). The result does list `answeredQuestionIds` (TF-137).
- **Why it matters:** a reviewer can't see that a number rests on a person's answer (O3).
- **Change and approach:** count every decision used (`answers.used`) in `decisionsApplied`; attach `decisions: [{questionId, answer, by, at}]` to affected element entries in the line trace (by/at come from the job input Java already sends, or Java fills them at ingest); show "per decision" in the trace and the Calculation sheet.
- **Files:** `engine/ifc_boq/pipeline.py`, `engine/ifc_boq/measure.py` (record use), `engine/ifc_boq/trace_steps.py`, `engine/ifc_boq/export_xlsx.py`, `packages/types/src/engine.ts` + codegen, `services/api/.../boq/BoqInputs.java` (decision metadata in the job input), `apps/app/src/features/boq-sheet/line-detail.tsx`.
- **Acceptance:** Duplex with the two party-wall answers: `decisionsApplied` = 2, the party-wall line trace names both decisions with author and date, Excel Inputs "Decisions applied 2".
- **Tests:** engine unit test; scenario `questions.test.ts` asserts the count after answering.
- **Effort:** M · **Depends on:** — · **Risk:** decision metadata in the engine input is a contract change; keep it optional.

#### A-07 · Plausibility warnings on what an element is and how big it is  (WP-A2)
- **Sources:** QS-013, LEAD-016 · DEC-12 · 04 QS-013, 05 LEAD-016
- **Problem:** "Slab, Pad 2" 921 m² (topography exported as slab), steel piles as 6 m thick "slabs" with edge formwork, ×1000 slabs — all `measured`, no warning; review is the only safeguard.
- **Why it matters:** a lead can't rely on "complete" meaning "plausible".
- **Change and approach:** engine warnings (kind `implausible`) for: a slab thicker than it is wide or > 1.5 m; a slab named pad/pile/cap; a line area > footprint × storeys; a storey's slab area > 3× its footprint. Thresholds in the resolution settings (A-04). Warnings show in the Log, the review screen and the Excel Questions sheet; they offer "treat as IfcPile/IfcFooting" where a reclassification rule exists, otherwise "keep".
- **Files:** `engine/ifc_boq/pipeline.py` (warnings stage), `engine/ifc_boq/measure.py` (oriented box data), `presets/settings/resolution.json`, `packages/types/src/engine.ts` + codegen, `apps/app/messages/en/engine.json`, `apps/app/src/features/versions/review-tab.tsx`.
- **Acceptance:** S07: warnings on "Pad 2" and the 600 mm diameter piles; S05 and S03 no new warnings.
- **Tests:** engine unit tests per rule; baseline diff lists only the expected warnings.
- **Effort:** M · **Depends on:** A-03, A-04 · **Risk:** false positives on unusual but real elements — warnings, not blocks.

#### A-08 · Warn on an unhosted door or window in any model  (WP-A2)
- **Sources:** QS-018 · 04 §5 A8
- **Problem:** a window without `IfcRelFillsElement` is counted, no wall is reduced, `warnings: []`; `federation_unhosted` exists only for federation (`federation.py:497-528`).
- **Why it matters:** walls overstated by the window area, unnoticed.
- **Change and approach:** reuse the federation check for single models: warning `unhosted_opening` naming the element and the nearest wall (by bounding box).
- **Files:** `engine/ifc_boq/federation.py` / `engine/ifc_boq/pipeline.py`, `apps/app/messages/en/engine.json`.
- **Acceptance:** `fixtures/ifc/Ifc2x3_Duplex_Architecture_v2.ifc` raises one warning for `1FM6kRbt1Q98O7nMvcxWi0`; S05 v1 none.
- **Tests:** engine test on the v2 fixture.
- **Effort:** S · **Depends on:** — · **Risk:** low.

#### A-09 · Wall area from the measured faces; volume ÷ thickness becomes a cross-check  (WP-A3)
- **Sources:** QS-004 · DEC-34 · verify-engine §3 "QS-004" (medium) · 04 §3.2–3.3
- **Problem:** wall area = volume ÷ layer-set thickness (`measure.py:330-336`) understates walls whose body is not a full prism: Duplex party-wall line 71.67 vs faces 78.83 m² (−9.1 %), S07 SIP/partitions −11 to −16 %, S08 CL_W1 −5.5 %. The engine already computes `sides` (faces a/b).
- **Why it matters:** masonry, partitions and every finish derived from them are understated wherever walls are notched or partial.
- **Change and approach:** wall area = mean (or chosen side) of the measured face areas net of openings when the mesh is closed; volume ÷ thickness stays as a cross-check raising the existing thickness/volume contradiction above the warn threshold; prismatic walls give identical numbers. Update `HAND_BOQ` party-wall rows in `engine/tests/test_duplex.py` from a **hand** derivation of the faces (document it in the test and in `docs/testing/engine-validation.md`), with the reason in the commit (rule 7).
- **Files:** `engine/ifc_boq/measure.py`, `engine/tests/test_duplex.py`, `docs/testing/engine-validation.md:42`, `docs/architecture/engine.md`, `docs/review/tools/verify_quantities.py` (KNOWN → expectation).
- **Acceptance:** party-wall line 78.83 m² (± rounding); all OK rows of `verify-quantities` stay OK; S05-partywall-area / S05-partywall-line turn FIXED and their KNOWN entries are removed; Duplex test green with the updated `HAND_BOQ`.
- **Tests:** engine unit test on a notched wall; Duplex test; verify-quantities.
- **Effort:** M · **Depends on:** A-04 · **Risk:** curved walls (side selection by normal); keep volume ÷ thickness when faces are not found.

#### A-10 · Formwork to footings from the measured vertical faces  (WP-A3)
- **Sources:** QS-005 · verify-engine §3 "QS-005" (high)
- **Problem:** default `formwork_footings_formula = 2 * src.length * src.height` (`presets/rules/as-modelled.json:299-322`); ring footing 3.72 vs 15.15 m² (−75 %); pads −50 %; strip ends always omitted; formwork is on by default.
- **Why it matters:** substructure formwork systematically understated.
- **Change and approach:** add a measured field "vertical faces area" (sides and ends, less faces in contact with other concrete where detectable) in `measure.py`; add the slot choice "Vertical faces from the geometry" and make it the default in `as-modelled.json`; keep the old formulas as choices.
- **Files:** `engine/ifc_boq/measure.py`, `packages/types/src/measured.ts` (new field) + codegen, `presets/rules/as-modelled.json`, `presets/rules/standard-style-example.json` (if it overrides), `apps/app/messages/en/ruleSetEditor.json` (choice label), `docs/architecture/rules-language.md`.
- **Acceptance:** S04 ring footing ≈ 15.15 m²; Duplex strip footings include ends; `verify-quantities` S04-footing-formwork FIXED.
- **Tests:** engine unit test (pad, ring, strip); Duplex test updated if `HAND_BOQ` has formwork (reason in commit).
- **Effort:** M · **Depends on:** — · **Risk:** contact-face detection is approximate; document it.

#### A-11 · Finishes follow the wall opening rule and measure their own face  (WP-A3)
- **Sources:** QS-009 · verify-engine QS-009
- **Problem:** `paint_walls_formula = SUM(src.layers.area …)` uses the wall's net centreline area and ignores the firm's opening rule: demo-tweaked keeps 1 m² openings in walls (267.16 → 274.62) but paint stays 703.19 m².
- **Why it matters:** walls and finishes in one BoQ follow two different rules.
- **Change and approach:** finish rules use the `faces` breakdown with `side` (inner/outer face), and the same opening-threshold slot as the wall by default (a separate slot the firm may change).
- **Files:** `presets/rules/as-modelled.json` (paint and lining items, `:763-781`), `engine/ifc_boq/rules.py` (faces breakdown deductions), `docs/architecture/rules-language.md`.
- **Acceptance:** S05-tweaked paint changes with the opening rule; S05-default paint equals the sum of the relevant faces net of openings.
- **Tests:** engine unit test with a 0.8 m² and a 1.5 m² opening under a 1 m² threshold.
- **Effort:** M · **Depends on:** A-09 · **Risk:** finish totals move on every model; expected and documented.

#### A-12 · Reveals belong to finishes and are counted once per face  (WP-A3)
- **Sources:** QS-020, ENG-023 · DEC-22, DEC-35
- **Problem:** slot `wall_add_reveals` adds reveals to the **wall** item (`as-modelled.json:497-505`, used `:1089,1172`); with surface `both` each face adds the full `(2h+w) × depth` with depth = full thickness, then ×2 (`rules.py:286-293,362-366`).
- **Why it matters:** overstated structure, finishes without reveals, double reveals on two-sided finishes.
- **Change and approach:** move the reveals slot to the finish items; reveal depth per face = thickness ÷ faces (or the opening's depth on that face); `standard-style-example` turns it on for finishes instead of walls.
- **Files:** `presets/rules/as-modelled.json`, `presets/rules/standard-style-example.json`, `engine/ifc_boq/rules.py`, `docs/architecture/rules-language.md` (presets table).
- **Acceptance:** S05-standard / S07-standard wall areas drop by the reveal amount; finish lines gain reveals once.
- **Tests:** engine unit test for `both` vs one face.
- **Effort:** S · **Depends on:** A-11 · **Risk:** convention-dependent; the slot stays configurable.

#### A-13 · Slab-edge formwork: outer perimeter and opening perimeter as separate measured fields  (WP-A3)
- **Sources:** QS-023
- **Problem:** template choices "Outer edge" / "Outer edge and the edges of openings", while the geometric perimeter already includes opening edges (`measure.py:395-405`); choice 2 double counts, choice 1 isn't outer only.
- **Why it matters:** formwork choices don't do what they say.
- **Change and approach:** measure `perimeter_outer` and `perimeter_openings`; relabel the slot choices by them; reported `Perimeter` (exporter-dependent) maps to "total" with a note.
- **Files:** `engine/ifc_boq/measure.py`, `packages/types/src/measured.ts` + codegen, `presets/rules/as-modelled.json:274-286`, `docs/architecture/engine.md` (measure table).
- **Acceptance:** a slab with one opening: choice 1 = outer only, choice 2 = outer + opening edges.
- **Tests:** engine unit test.
- **Effort:** S · **Depends on:** — · **Risk:** low.

#### A-14 · In-situ concrete from a slab's concrete layers, not the whole build-up  (WP-A4)
- **Sources:** CAS-017 · DEC-25 · verify-engine CAS-017
- **Problem:** `slab-concrete` takes the whole `net_volume` when the element's "main material" (thickest solid layer, `measure.py:240-242`) is concrete-like: S09's 470 mm build-up (screed, insulation, 150 mm air, block, precast) becomes in-situ concrete.
- **Why it matters:** concrete overstated many times on layered floors.
- **Change and approach:** the slab-concrete item uses a layer breakdown filtered to concrete layers (`material under concrete`), falling back to the whole element only when there is no layer set; non-concrete layers stay available to their own items.
- **Files:** `presets/rules/as-modelled.json` (slab-concrete item), possibly `engine/ifc_boq/rules.py` (layer filter on a breakdown), `presets/rules/acme-house-rules.json` if it copies the item.
- **Acceptance:** S09 after names: in-situ concrete = precast/concrete layers only; S05 single-layer slabs unchanged.
- **Tests:** engine unit test with a mixed layer set.
- **Effort:** S · **Depends on:** — (uses the layer breakdown, which is consistent on real data; only the material breakdown is wrong) · **Risk:** depends on dictionary terms for layers (names); documented.

#### A-15 · Roof area from the closed mesh when there is no layer set  (WP-A4)
- **Sources:** CAS-018
- **Problem:** S09 main roof (closed Brep, 13.57 m³, plain material) gets no area ("quantity could not be determined", flagged).
- **Why it matters:** the biggest roof item is blank with no hint.
- **Change and approach:** derive thickness from the oriented box thin axis (as slabs do) and the developed area from the up-facing faces; record source `geometry`; the flag message suggests editing the quantity when still empty.
- **Files:** `engine/ifc_boq/measure.py`, `apps/app/messages/en/engine.json`.
- **Acceptance:** S09 roof line has an area within 2 % of the up-face area; flagged count −1.
- **Tests:** engine unit test on a closed box roof.
- **Effort:** S · **Depends on:** — · **Risk:** pitched multi-face roofs; use up-face true area (as `verify-quantities` `up_true`).

#### A-16 · Proxies are not billed by default; they become unmatched questions  (WP-A4)
- **Sources:** QS-014 · DEC-36
- **Problem:** `include_proxies: true` (`as-modelled.json:961-964`) bills people, trees, glasses, appliances ("Honey Locust 8 nr", "Fine China - Plate 8 nr"); S03 "sand bedding" (a volume) counted as 1 nr.
- **Why it matters:** noise in the BoQ; real work reduced to "nr".
- **Change and approach:** default `include_proxies: false`; proxies go to coverage → `unmatched:{class}:{type}` questions (grouped by type); the unmatched answer "measure with rule X" lets a firm bill one by count/area/volume.
- **Files:** `presets/rules/as-modelled.json`, `docs/architecture/rules-language.md` (presets table), `docs/product/guides/rules.md`.
- **Acceptance:** S07 "Unclassified object …" lines gone, replaced by unmatched questions; nothing silently dropped (coverage counts them).
- **Tests:** engine test on S07 cached parse (slow) or a synthetic proxy.
- **Effort:** S · **Depends on:** — · **Risk:** firms relying on proxies flip the slot back.

#### A-17 · Steel mass from the member's cut/body length  (WP-A4)
- **Sources:** QS-012 · FM-86 (section tables → D-03)
- **Problem:** W310X60 uses `PSet_Revit_Dimensions.Length` 7.523 (analytical) instead of cut length 7.4213 → +1.4 %.
- **Why it matters:** small systematic steel overstatement.
- **Change and approach:** length sources for mass prefer `PSet_Revit_Structural.Cut Length` / body extrusion length over analytical length (data order in `quantity_sources.json`); log the source.
- **Files:** `engine/ifc_boq/data/quantity_sources.json`, `engine/ifc_boq/measure.py:93-107`.
- **Acceptance:** S05 W310X60 = 0.44528 t; `verify-quantities` S05-beam-mass FIXED; Duplex `HAND_BOQ` steel updated with reason if it moves.
- **Tests:** verify-quantities; Duplex test.
- **Effort:** S · **Depends on:** — · **Risk:** low.

#### A-18 · Same-GlobalId copies that disagree raise a `duplicate_conflict` question  (WP-A5)
- **Sources:** QS-006 · DEC-37 · verify-engine §3 "QS-006"
- **Problem:** F01: `1cCK8nA61FduUezO75i8dB` 225 mm (arc) vs 250 mm (str) kept from arc; CL_W1 24.29 vs 45.25 m² kept from arc; 24 such cases, only `log.federation.duplicate`; the score (`federation.py:160-184`) falls to model order when both copies pass ownership.
- **Why it matters:** discipline clashes a QS must report are hidden; the winner isn't predictable.
- **Change and approach:** when copies differ in class, type, material, thickness or a quantity beyond the warn threshold, raise `duplicate_conflict:{guid}` (deterministic) showing both values; default (suggestion) = the owning discipline's copy per `presets/settings/federation.json`; equal copies stay silent as today.
- **Files:** `engine/ifc_boq/federation.py`, `packages/types/src/engine.ts` (question kind) + codegen, `apps/app/messages/en/engine.json`, `apps/app/src/features/questions/*` (render both values), `docs/architecture/engine.md`.
- **Acceptance:** F01 raises questions for the materially different duplicates; default keeps the structure copy for structure-owned concrete; F02 unchanged.
- **Tests:** `engine/tests/test_federation.py` with two synthetic copies; scenario `federation.test.ts`.
- **Effort:** M · **Depends on:** — · **Risk:** question volume on messy federations; group by type.

#### A-19 · Overlap questions block by default, so "complete" can't hide a double count  (WP-A5)
- **Sources:** ENG-020 · DEC-37 · verify-engine ENG-020 (medium)
- **Problem:** `federation.py:399` `blocking: False`, `suggestion: "both"` (both copies counted until answered); status `complete` needs only no blocking questions (`pipeline.py:303,376-377`).
- **Why it matters:** "complete" can mean a discipline's slabs counted twice.
- **Change and approach:** add `overlapBlocking` (default `true`) to the federation settings type and preset; overlap questions use it; the BoQ header shows "N to check" for non-blocking federation questions (C-20 wording).
- **Files:** `engine/ifc_boq/federation.py`, `presets/settings/federation.json`, `packages/types/src/*` + codegen, `apps/app/src/features/library/*` (federation editor), `docs/product/features/F04-boq-and-runs.md`.
- **Acceptance:** a federated run with an unanswered overlap is `needs_input`; with the setting off, as today.
- **Tests:** `test_federation.py`; scenario `federation.test.ts`.
- **Effort:** S · **Depends on:** — · **Risk:** more `needs_input` on federations; intended.

#### A-20 · `double_count` warning when an element feeds two item rules of the same family without a claim  (WP-A5)
- **Sources:** ENG-008 · DEC-33 · verify-engine ENG-008
- **Problem:** every enabled rule takes every matching element; only shared `claims` detect double counts (`rules.py:494-561`); two item rules can count the same 228 elements, `complete`, 0 warnings.
- **Why it matters:** double counting is the costliest BoQ error.
- **Change and approach:** after rules, for each element in ≥ 2 **item** lines of the same quantity family (not derived/finish rules) with no shared claim, emit a non-blocking warning `double_count` listing the rules (deterministic id); new BR in `docs/domain/business-rules.md`.
- **Files:** `engine/ifc_boq/rules.py`, `engine/ifc_boq/pipeline.py`, `apps/app/messages/en/engine.json`, `docs/domain/business-rules.md`, `docs/architecture/rules-language.md:225`.
- **Acceptance:** the ENG-008 repro (two catch-all item rules) warns; no warning on any shipped preset × sample in the baseline.
- **Tests:** engine unit test; baseline shows no new warnings for shipped presets.
- **Effort:** S · **Depends on:** — · **Risk:** family definition must exclude finishes/formwork (derived).

#### A-21 · Wall codes: `IsExternal` fallback and no real code as a catch-all  (WP-A5)
- **Sources:** QS-007 · DEC-10 · verify-engine QS-007 (medium)
- **Problem:** ACME map `internal-walls` = `{"tag":"wall"}` catch-all; `external-walls` needs `UNDER(element_type,"wall.external")`; S01, S07, S09 external walls (`is_external` True) coded D.02 Internal walls; `onUnmapped` never fires.
- **Why it matters:** facade cost in partitions; shipped maps teach a bad pattern.
- **Change and approach:** in shipped maps (`acme-cost-codes`, `demo-trades`, `uniclass2015-ef` where applicable) add `OR is_external` to external walls and send the catch-all to a "to be classified" code (or `onUnmapped: ask`); add a check warning when a wall code contradicts `IsExternal`.
- **Files:** `presets/classifications/acme-cost-codes/map.json`, `presets/classifications/demo-trades/*`, `engine/ifc_boq/classify.py` (contradiction warning), `docs/product/guides/classifications.md`.
- **Acceptance:** S01/S07/S09 external walls coded external; **every quantity identical** before/after (rule 6, verified by compare-baseline: only code/group cells differ).
- **Tests:** engine classification test; compare-baseline numbers unchanged.
- **Effort:** S · **Depends on:** — · **Risk:** none on numbers; codes change in baselines (expected).

#### A-22 · Non-ASCII string literals in expressions are decoded correctly  (WP-A6)
- **Sources:** ENG-001 · verify-engine §3 "ENG-001"
- **Problem:** `expr.py:145` `bytes(v[1:-1], "utf-8").decode("unicode_escape")` turns `"béton"` into `'bÃ©ton'`; `CONTAINS(name,"béton")` false on "Béton armé"; affects rule selectors/`expr`, map `where`, dictionary `when`, line keys, templates.
- **Why it matters:** silent mis-selection for any firm writing rules in its language (international product, rule 10).
- **Change and approach:** decode only an explicit escape table (`\"`, `\\`, `\n`, `\t`, `\uXXXX`) with a regex substitution; leave other characters untouched.
- **Files:** `engine/ifc_boq/expr.py`, `engine/tests/test_expr.py`.
- **Acceptance:** the three repros from 01 §3 give the expected results; all existing expr tests pass.
- **Tests:** property-based round trip of arbitrary Unicode literals (Hypothesis; B-02 extends).
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-23 · One step-rounding helper for FLOOR, CEIL, ROUND and rule rounding  (WP-A6)
- **Sources:** ENG-005
- **Problem:** `expr.py:249-255` `fn(x/step)*step`: `FLOOR(0.3,0.1)=0.2`, `FLOOR(4.35,0.05)=4.3`, `CEIL(0.3,0.1)=0.30000000000000004`, `ROUND(0.3,0.1)` float tail; `rules.py:429-438` does it right.
- **Why it matters:** slots that floor to a module lose a whole step; two implementations disagree.
- **Change and approach:** one helper (relative epsilon + `round(..., 10)`, or `Decimal`) used by `expr.py` and `RuleEngine.round_`.
- **Files:** `engine/ifc_boq/expr.py`, `engine/ifc_boq/rules.py`, `engine/tests/test_expr.py`.
- **Acceptance:** step values 0.01, 0.05, 0.1, 0.5 give exact results; rule rounding unchanged.
- **Tests:** table test + property test (`FLOOR(k*step, step) == k*step`).
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-24 · Breakdown `material` gives each material its own gross volume; parts sum to the element  (WP-A6)
- **Sources:** ENG-004 · FM-111 (invariant part; general invariants → B-01) · verify-engine §3 "ENG-004"
- **Problem:** material parts set `net_volume` and `thickness` but inherit the element's `gross_volume` (`rules.py:458-463`): Duplex walls material gross 1,094.15 m³ vs 239.76 (×4.6). Layer breakdown is consistent on real data (the report's layer sub-claim was an artefact).
- **Why it matters:** silent ×N over-count, offered in the rule editor and as rule-set default (`item-forms.tsx:105-107`).
- **Change and approach:** `gross_volume = gross_area × t` per material group (as for layers); assert in the engine that the parts' volumes sum to the element's within tolerance (log an error line and flag if not).
- **Files:** `engine/ifc_boq/rules.py`, `engine/tests/` (new breakdown test).
- **Acceptance:** Duplex walls material gross total = 239.76 m³ ± 0.1 %.
- **Tests:** a test per breakdown kind (element, layer, material, face, child) asserting sum of parts = whole.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-25 · Per-part `missing` questions have unique ids; data-caused ingest failures are not retryable  (WP-A6)
- **Sources:** ENG-003 · FM-111 (unique-id invariant; general → B-01)
- **Problem:** `rules.py:623` `missing:{rid}:{guid}` per part → 50 duplicate ids on the Duplex with a layer breakdown + `onMissing: ask`; `run_questions` PK fails the COPY (`V7__boqs_and_runs.sql:149`); `JobDispatcher.java:151` marks it `retryable: true`.
- **Why it matters:** the BoQ can't run until the rule changes; the error invites useless retries.
- **Change and approach:** ask once per element and apply the answer per part (keeps the documented id format `missing:{rule}:{guid}`, D19), dedupe in `pipeline.py`; Java maps a constraint violation during ingest to `retryable: false` with code `result_invalid`.
- **Files:** `engine/ifc_boq/rules.py`, `engine/ifc_boq/pipeline.py:273`, `services/api/.../worker/JobDispatcher.java`, `services/api/.../boq/RunIndex.java`.
- **Acceptance:** the ENG-003 rule runs and ingests; one question per element; a forced duplicate gives `retryable: false`.
- **Tests:** engine test (Duplex, layer + ask); `worker/JobDispatcherTest`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-26 · Which name fields block is decided from the parsed expressions, not a regex over JSON  (WP-A6)
- **Sources:** ENG-009 · DEC-14, DEC-32
- **Problem:** `rules.py:104-111` `re.search(r'\bmaterial\b', json.dumps(rules))` — a label "Walls (any material)" makes every unknown material name blocking.
- **Why it matters:** needless blocking questions (custom sets).
- **Change and approach:** walk compiled expression ASTs (`compile_expr`) and selector `field`s to collect referenced variables.
- **Files:** `engine/ifc_boq/rules.py`, `engine/ifc_boq/expr.py` (AST visitor), `engine/tests/test_names.py`.
- **Acceptance:** the label repro gives `set()`; system presets give the same set as today (baseline: no blocking-flag changes, or each explained).
- **Tests:** unit tests.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-27 · Expression length and nesting caps; `RecursionError` becomes a user error  (WP-A6)
- **Sources:** ENG-013
- **Problem:** `"("*2000+"TRUE"+")"*2000` raises `RecursionError` (not caught, `expr.py:195-200`); `worker_http.py:92` maps only KeyError/TypeError/ValueError → `503 engine_unavailable`.
- **Why it matters:** a user error reads as an outage; alerts fire.
- **Change and approach:** cap length (e.g. 10,000 chars) and depth (e.g. 64) in the tokenizer/parser → `ExprError` with position; the rpc layer maps validation errors to 4xx; Java passes them through as `400 invalid_preset`.
- **Files:** `engine/ifc_boq/expr.py`, `engine/ifc_boq/worker_http.py`, `engine/ifc_boq/rpc.py`, `services/api/.../library/*` (rpc error mapping), `packages/api/openapi.yaml` only if a new error code is documented (then `npm run api:gen`).
- **Acceptance:** `POST /presets/check` with the repro → `400` with a problem location.
- **Tests:** engine unit test; Java test in `ErrorResponsesTest`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-28 · One unit registry with dimensions; unknown or wrong-dimension units are refused  (WP-A7)
- **Sources:** ENG-010 · FM-115 · verify-engine ENG-010 (also `mm` on an area ×1000)
- **Problem:** `rules.py:427` `UNIT_FACTOR.get(unit, 1)` converts `cm`, `l`, `mm2`, `in`, `g` by 1; factor table not per dimension; `Unit` allows any string (`packages/types/src/measured.ts:13-20`); `minimum` compared in SI, rounding after conversion; 4+ unit tables.
- **Why it matters:** silent 100×/1000× errors for a rule author picking `cm` or `l`.
- **Change and approach:** types first: a unit registry in `packages/types/src` (id, dimension, factor to SI, label key) exported to JSON by `npm run codegen`; the engine loads it, `presets.check` refuses unknown units and wrong dimensions, `minimum` is stated (and compared) in the output unit; the doc says so.
- **Files:** `packages/types/src/measured.ts` (or a new `units.ts`) + codegen, `engine/ifc_boq/rules.py`, `engine/ifc_boq/presets.py`, `engine/ifc_boq/names.py:23`, `docs/architecture/rules-language.md`.
- **Acceptance:** a preset with `cm` on an area, `l` on a length or `furlong` is refused by `check`; shipped presets pass unchanged; baseline numbers unchanged.
- **Tests:** engine tests for conversion per dimension and for check problems; contract test green.
- **Effort:** M · **Depends on:** — · **Risk:** user presets with odd units start failing check — message names the unit and the allowed ones.

#### A-29 · Mass quantities and property-level units are converted  (WP-A7)
- **Sources:** ENG-021
- **Problem:** `parse.py:204-205` stores `IfcQuantityWeight` unscaled (no `MASSUNIT`); `prop_value` ignores `IfcPropertySingleValue.Unit`; plane angles unconverted.
- **Why it matters:** wrong steel tonnage on gram/pound models.
- **Change and approach:** `calculate_unit_scale(f, "MASSUNIT")`; honour a property's own `Unit`; convert plane angles to the documented unit.
- **Files:** `engine/ifc_boq/parse.py:129-131,170-176,204-205`, `engine/tests/` (small IFC fixture in grams or pounds).
- **Acceptance:** fixture mass in kg correct; baseline samples unchanged (all SI).
- **Tests:** fixture test.
- **Effort:** S · **Depends on:** A-28 · **Risk:** none.

#### A-30 · Excel edits import parses numbers with the org's number format  (WP-A7)
- **Sources:** ENG-018 · FM-114
- **Problem:** `boq_import.py:45-54` replaces "," with "." → "1,234" = 1.234 and "1.234" = 1.234; org `numberFormat` unused. Only text cells.
- **Why it matters:** a pasted quantity imported 1000× too small passes as valid.
- **Change and approach:** Java passes the org's `numberFormat` in the job input; the importer parses with it and refuses ambiguous strings (both separators, or a separator that is the thousands mark with ≠ 3 digits) with a per-row message; the review step shows the parsed value.
- **Files:** `engine/ifc_boq/sheets/boq_import.py`, `engine/ifc_boq/worker.py` (job input), `services/api/.../boq/*` (import job input), `apps/app/src/features/exports/edits-import.tsx` (parsed value column).
- **Acceptance:** "1,234" → 1234 under `1,234.5` format and refused/1.234 under `1.234,5`; numeric cells unaffected.
- **Tests:** `engine/tests/test_boq_import.py` table; scenario `edits-import.test.ts`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-31 · Unnamed and duplicate property/quantity sets normalised; the CLI runs the same path as the worker  (WP-A8)
- **Sources:** ENG-011 · DEC-06 · 00-context §10 (S12, `presets/user`)
- **Problem:** `parse.py:217,219` keys sets by `d.Name`: S12's 30 unnamed `IfcElementQuantity` give key `None` → `measure.py:121` `TypeError` in-process (CLI, baseline engine S12 error); on the worker path JSON turns it into `"null"` and its quantities are silently **ignored** (verifier); same-name sets overwrite each other.
- **Why it matters:** CLI and product differ on the same file; values lost silently (rule 5).
- **Change and approach:** name unnamed sets `#<step id>`, merge or suffix duplicates (`BaseQuantities#2`), with a parse check entry `pset_renamed`; make the in-process path validate/round-trip the ParsedModel through its JSON schema so both paths are identical. Also make the CLI ignore `presets/user/` unless `IFC_BOQ_USER_PRESETS` is set (00-context §10).
- **Files:** `engine/ifc_boq/parse.py`, `engine/ifc_boq/measure.py:121`, `engine/ifc_boq/cli.py`, `engine/ifc_boq/presets.py` (user folder), `engine/tests/` (S12-like fixture).
- **Acceptance:** S12-default succeeds on the engine layer and equals the stack layer's lines; a parse check lists the renamed sets.
- **Tests:** fixture with an unnamed and two same-named sets; CLI vs worker-path equality test on S05.
- **Effort:** M · **Depends on:** — · **Risk:** the renamed sets' quantities now count where they were ignored — S12 stack lines may change (expected).

#### A-32 · Specific parse error codes for truncated files and files without a project  (WP-A8)
- **Sources:** ENG-012 · CAS-010 (engine part; UI → C-39)
- **Problem:** S13 fails `IndexError` at `parse.py:474` (`f.by_type("IfcProject")[0]`); the product says "Could not parse IFC model" (`worker.py:134-139`); the app's `corrupt_file` text exists but is never used.
- **Why it matters:** the user can't tell a truncated upload from a server fault.
- **Change and approach:** check `END-ISO-10303-21;`, an `IfcProject` and the entity count up front; return `truncated_file` / `no_project` / `not_ifc` with the parser's line number; map them in Java and the app (`models.json`, `errors.json`).
- **Files:** `engine/ifc_boq/parse.py`, `engine/ifc_boq/worker.py`, `services/api/.../model/*` (error code pass-through), `apps/app/messages/en/models.json`, `packages/api/openapi.yaml` (error code enum, if listed) + `npm run api:gen`.
- **Acceptance:** S13 → `truncated_file` with a byte/line position; S14 unchanged `not_ifc`.
- **Tests:** `engine/tests/test_worker.py` on S13-like truncation; `model/ParseJobErrorsTest`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-33 · S10 resolves "0 of 0 distinct names": find why names never reach the names stage  (WP-A8)
- **Sources:** VER-006 · DEC-73 · verify-engine §1.8
- **Problem:** the 65 MB Schependomlaan model (Dutch materials) is `complete` with 0 questions and 0 names; PRD-006 assumed it was worse than English models.
- **Why it matters:** either names are lost before the stage (a silent drop, rule 5) or the model genuinely carries none; both need to be known.
- **Change and approach:** trace S10's materials/type names through `parse.py` → `names.py`; if a parse/selection bug drops them, fix it; if they are genuinely absent (e.g. materials on types only, or IFC2x3 constructs not read), read them; otherwise document.
- **Files:** `engine/ifc_boq/parse.py`, `engine/ifc_boq/names.py`, `engine/ifc_boq/pipeline.py`.
- **Acceptance:** a written explanation in the commit and `docs/testing/engine-validation.md`; if a bug: S10 lists its distinct names and raises name questions where the dictionary has no answer.
- **Tests:** a small IFC2x3 fixture reproducing the construct.
- **Effort:** M · **Depends on:** A-31 · **Risk:** S10 may become `needs_input` (expected if names now arrive).

#### A-34 · The Excel rule-chain label shows preset names/slugs, never a version id  (WP-A8)
- **Sources:** VER-007 · verify-product PRD-012 detail
- **Problem:** BoQ!A2 "Rules: Petra Design Studio rules (version-9d493c18-… -> petra-design-studio-rules)": the chain carries a version id where the parent's slug is expected.
- **Why it matters:** internal ids in a client document; suggests the chain is built from the wrong field.
- **Change and approach:** find where the chain label is built (`export_xlsx.py` / the run input Java builds) and use each preset's name (and version number) at every level.
- **Files:** `engine/ifc_boq/export_xlsx.py`, `services/api/.../boq/BoqInputs.java` (preset chain in the job input).
- **Acceptance:** an org preset based on As modelled reads "Rules: Petra rules v3 → As modelled v1".
- **Tests:** export test with a two-level chain.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-35 · User regexes run on RE2 with caps; draft previews need edit rights  (WP-A9)
- **Sources:** ENG-006, ENG-022 · FM-113 · DEC-65 · verify-engine §3 "ENG-006" (GIL freeze)
- **Problem:** `GET/POST /model-versions/{id}/names` needs only `view` and forwards `draftDictionaries` to the rpc engine (`Models.java:308-331`), which runs `re.search` unbounded (`names.py:84-89,130`; selector `matches` `rules.py:146-147`); `presets.check` only compiles. `re` holds the GIL: one pattern freezes the whole rpc process for every tenant. Dialect documented as ECMAScript but runs Python `re`.
- **Why it matters:** any viewer can stall the shared engine (high, security).
- **Change and approach:** add `google-re2` to `engine/requirements.txt`; compile user patterns with RE2 (`names.py`, `rules.py`, `presets.py`); refuse patterns RE2 rejects or > 500 chars at check; require `editPresets` (library editor) for `draftDictionaries` in `Models.names`; document "RE2 syntax" in `packages/types/src/dictionary.ts:73` (types first) and the dictionaries guide; translate named groups as today.
- **Files:** `engine/requirements.txt`, `engine/pyproject.toml`, `engine/ifc_boq/names.py`, `engine/ifc_boq/rules.py`, `engine/ifc_boq/presets.py`, `services/api/.../model/Models.java`, `packages/types/src/dictionary.ts` + codegen, `docs/product/guides/dictionaries.md`, `docs/architecture/security.md`.
- **Acceptance:** `(.|.)*X` on a 40-char name returns in < 10 ms; a viewer's `draftDictionaries` → 403; every shipped dictionary pattern compiles under RE2 and gives the same matches on the baseline (no differences).
- **Tests:** engine timing test (bounded); Java permission test; scenario `isolation.test.ts`/`permissions.test.ts` row.
- **Effort:** M · **Depends on:** — · **Risk:** wheel availability for Python 3.10–3.13 on Windows/Linux (check `pip install google-re2`); fallback: subprocess with hard timeout.

#### A-36 · Shared secret on the engine worker's HTTP `/jobs` and `/rpc`  (WP-A9)
- **Sources:** FM-74 (secret part; scoped storage → D-50) · DEC-64
- **Problem:** worker `/jobs` and `/rpc` have no authentication (`worker_http.py`); accepted for the pilot behind the network boundary (P54 Q47).
- **Why it matters:** with ENG-006 the engine is the weakest boundary.
- **Change and approach:** `BOQLET_WORKER_TOKEN` env; Java sends `Authorization: Bearer`; the worker refuses others with 401; constant-time compare; set in `ops/local/compose.yaml`, `ops/pilot/compose.yaml`, test harness.
- **Files:** `engine/ifc_boq/worker_http.py`, `services/api/.../worker/*` (HTTP client), `services/api/src/main/resources/application.yml`, `ops/local/compose.yaml`, `ops/pilot/compose.yaml`, `docs/development/environment.md`, `docs/architecture/security.md`.
- **Acceptance:** request without the token → 401; the local stack and `npm run local:check` work; NativeWorkerTest green.
- **Tests:** engine test of the guard; `NativeWorkerTest` runs with the token.
- **Effort:** S · **Depends on:** — · **Risk:** deploy ordering on the pilot (worker and API must get the secret together) — document in `docs/operations/pilot.md`.

#### A-37 · One generic 404 for any inaccessible resource  (WP-A9)
- **Sources:** ENG-014
- **Problem:** another org's BoQ answers "The project was not found."; a random id "The BoQ was not found." (runs, presets, revisions alike) — existence oracle.
- **Why it matters:** contradicts security.md's "same answer as nonexistent"; UUIDv7 ids are time-guessable.
- **Change and approach:** resolve scope in one query or map every access failure for a resource to the resource's own `not_found` message, independent of which join failed.
- **Files:** `services/api/.../project/ProjectAccess.java`, `boq/BoqAccess.java`, `library/*` access helpers.
- **Acceptance:** `docs/review/repro/eng/oracle.mjs`-style check: identical body for foreign and random ids on BoQ, run, revision, preset.
- **Tests:** scenario `isolation.test.ts` asserts identical messages.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-38 · A real Content-Security-Policy  (WP-A9)
- **Sources:** FM-73
- **Problem:** `apps/app/next.config.ts:41` sends only `frame-ancestors 'none'`.
- **Why it matters:** no XSS mitigation layer on an app that renders user-supplied names everywhere.
- **Change and approach:** nonce-based CSP via Next middleware (read the bundled Next.js docs first, `apps/app/AGENTS.md`): `default-src 'self'`, scripts with nonce + `strict-dynamic`, `connect-src 'self'` plus the S3 endpoint for signed URLs, `img-src 'self' data: blob:`, `worker-src blob:` for three.js if needed, `frame-ancestors 'none'`; report-only first on the pilot for one deploy, then enforce.
- **Files:** `apps/app/next.config.ts`, `apps/app/middleware.ts` (new), `docs/architecture/security.md`.
- **Acceptance:** no CSP violations in the browser smoke (`apps/app/e2e-java`) and on the share page, viewer and uploads.
- **Tests:** e2e-java check that the header is present and the console has no CSP errors.
- **Effort:** M · **Depends on:** — · **Risk:** blocked signed-URL uploads or the viewer — the smoke suite must cover both.

#### A-39 · Archived BoQs can't be shared through the API; the permission hint is correct  (WP-A9)
- **Sources:** ENG-024 · verify-backend ENG-024
- **Problem:** `ShareLinks.create` (`ShareLinks.java:83-84`) never checks archived; pinned and `latest_issued` links `201` on an archived BoQ; `permissions.share` stays `true`; the UI hides it itself (`boq-header.tsx:167`).
- **Why it matters:** API and UI disagree; archived content can be published.
- **Change and approach:** `checkOpen`/archived check in `ShareLinks.create` → `409 boq_archived`; `permissions.share` false when archived; the UI reads the permission.
- **Files:** `services/api/.../boq/ShareLinks.java`, `boq/BoqAccess.java` (permissions), `apps/app/src/features/boqs/boq-header.tsx`.
- **Acceptance:** create on an archived BoQ → 409; revoking existing links still works (P54 Q42).
- **Tests:** scenario `shares.test.ts` row.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-40 · Browser multipart upload for models over 100 MiB, with per-part retry and resume  (WP-A10)
- **Sources:** ENG-002 · FM-16 · verify-backend §3 "ENG-002"
- **Problem:** above 100 MiB Java presigns parts (`ObjectStorage.java:34-35,66-88`); `apps/app/src/features/models/upload.ts:29-35` PUTs the whole file to `upload.url` (= part 1, signed for 16 MiB) → `403 SignatureDoesNotMatch`, then completes with `{}` → `400 upload_parts_invalid`. Paid plans allow 300 MB.
- **Why it matters:** every model between 100 MiB and the plan limit fails (O1).
- **Change and approach:** implement the multipart client: PUT each `parts[i]` slice, collect ETags (S3 must expose `ETag` via CORS — check `ops/local` SeaweedFS and pilot config), retry each part 3× with backoff, send `parts` on complete, keep progress per part and allow resume within the URL lifetime (re-request URLs if expired); show progress and a retry state.
- **Files:** `apps/app/src/features/models/upload.ts`, `apps/app/src/features/models/upload-button.tsx`, `apps/app/src/api/hooks/models.ts`, `ops/local/compose.yaml` / S3 CORS config, `ops/pilot/*` (CORS `ExposeHeaders: ETag`), `apps/app/messages/en/models.json`.
- **Acceptance:** a generated 101 MiB file uploads and completes on the local stack (enterprise org); an interrupted upload resumes; < 100 MiB path unchanged.
- **Tests:** Vitest unit test of the part slicer/retry (mocked fetch); e2e-java test with a 101 MiB generated file (`BOQLET_BROWSER_SMOKE`), or a scenario test replaying the sequence (`docs/review/repro/verify-backend/s02-multipart.mjs` is the template).
- **Effort:** M · **Depends on:** — · **Risk:** S3 CORS on the pilot; test against SeaweedFS and document.

#### A-41 · The sheet's Excel never silently exports a stale run; export names carry the run  (WP-A10)
- **Sources:** CAS-002, CAS-027 · DEC-38 · verify-backend §3 "CAS-002"
- **Problem:** the sheet shows `effectiveLines` (run + overrides + manual, `sheet.tsx:187`) but its Excel button exports `run.id` (`sheet.tsx:121`); an edited 129.69 → 123.45 line exports 129.69; nothing says so. Two exports share one file name (`BoqExports.java:248-250`).
- **Why it matters:** the wrong number goes out in the most common hand-off (high).
- **Change and approach:** when the revision has pending inputs, the Excel button opens a dialog "N edits and M answers are not in the last run" with **Generate and export** (default: starts a run, then exports when it succeeds) and **Export the last run**; the workbook Cover states the run time and "excludes changes after …" when stale; file name gets `_run<HHMM>` (or run number).
- **Files:** `apps/app/src/features/boq-sheet/sheet.tsx`, `apps/app/src/features/exports/exports-tab.tsx`, `apps/app/src/api/hooks/exports.ts`, `services/api/.../boq/BoqExports.java` (file name), `engine/ifc_boq/export_xlsx.py` (Cover note when Java passes `pendingInputs`), `apps/app/messages/en/boqs.json`.
- **Acceptance:** repro from `docs/review/repro/verify-backend/s15-export-edits.mjs`: "Generate and export" yields 123.45; "Export the last run" yields 129.69 with the Cover note; two exports have different names.
- **Tests:** app unit test of the dialog state; scenario `boqs.test.ts`/`line-edits.test.ts` for the name and note.
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### A-42 · Admin plan editor: the watermark feature is shown the right way round  (WP-A10)
- **Sources:** PRD-010
- **Problem:** `features/admin/plans.tsx:239-246` `checked={entry}` labelled "Excel without the watermark — Included" (`errors.json:11`) while Free has `exportWatermark: true` and `BoqExports.java:129` adds the watermark when enabled.
- **Why it matters:** an operator "removing a feature" removes the watermark from Free.
- **Change and approach:** label the key by its effect ("Watermark on exports") in the admin editor and the limit dialog, or invert the binding; one message key.
- **Files:** `apps/app/src/features/admin/plans.tsx`, `apps/app/messages/en/errors.json`, `apps/app/messages/en/admin.json`.
- **Acceptance:** Free shows "Watermark on exports: on".
- **Tests:** app unit test.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### A-43 · Publishing a stale library draft can't drop a promoted answer  (WP-A11)
- **Sources:** LEAD-001 · FM-41 (rebase part; full library depth → D-35) · verify-backend §3 "LEAD-001"
- **Problem:** a draft opened from v1; a promotion publishes v2 (`Library.publishDictionaryEntries`, `Library.java:295-322`) past the open draft; publishing the draft makes v3 without the promoted entry (`Library.java:240-262`, no base check); nothing warns. Same for the project dictionary (`Decisions.java:109-111`).
- **Why it matters:** breaks "nothing silently dropped"; undoes a governance action (high).
- **Change and approach:** store the draft's base version; on publish, if a newer version exists: for dictionaries, auto-merge additive entries from the newer versions (promotions are additive) and show what was merged; otherwise refuse `409 draft_stale` with a "rebase on latest" action (3-way: keep mine / take theirs per entry). Promotions also write into an open draft when one exists. The editor shows "a newer version was published since you started".
- **Files:** `services/api/.../library/Library.java`, `services/api/.../boq/Decisions.java`, a new Flyway migration (next free version, e.g. `V24__preset_draft_base.sql`; draft base version column), `packages/api/openapi.yaml` (`draft_stale`, rebase op) + `npm run api:gen`, `apps/app/src/features/library/*`, `apps/app/messages/en/library.json`.
- **Acceptance:** `docs/review/repro/verify-backend/s10-stale-draft.mjs` scenario: v3 contains both `lib-entry-1` and the promoted entry; a conflicting rule-set draft gets 409 and can be rebased.
- **Tests:** scenario `library-publish.test.ts` (stale dictionary draft, stale rule-set draft).
- **Effort:** M · **Depends on:** — · **Risk:** merge semantics for rule sets — refuse rather than merge.

#### A-44 · Project default presets: pickers, "newer version" badge, move to latest, archived-default warning  (WP-A11)
- **Sources:** LEAD-002 · FM-12, FM-13 · DEC-44 · verify-backend §3 "LEAD-002"
- **Problem:** project defaults are version ids stored at creation (`ProjectPresets.java:24-31`, `BoqInputs.java:33-52`); no picker in project settings (FM-12); a v2 of the firm rule set never reaches House A; BoQs show no "newer version"; no warning when a default is archived (FM-13).
- **Why it matters:** a firm-wide standard change silently splits live projects by start date (high).
- **Change and approach:** default pickers (rule set, classifications, dictionaries; version select with "latest" marker) at project creation and in project settings (`PATCH /projects/{id}` already accepts `defaults`); `newerVersionAvailable` on preset inputs of BoQs and project defaults (like models); "Use newer" per BoQ input and a bulk "Move working BoQs to the latest" in the preset's where-used; a warning badge when a default preset is archived. Pinning stays (BR-07).
- **Files:** `services/api/.../project/ProjectPresets.java`, `boq/BoqInputs.java`, `boq/BoqAccess.java`, `packages/api/openapi.yaml` (fields + bulk op) + `npm run api:gen`, `apps/app/app/(app)/[org]/projects/new/page.tsx`, `apps/app/app/(app)/[org]/projects/[projectId]/settings/page.tsx`, `apps/app/src/features/boqs/setup-tab.tsx`, `apps/app/src/features/library/*` (where used), `docs/product/features/F02-projects.md`, `F10-library.md`, `docs/domain/business-rules.md` BR-07, `apps/app/messages/en/projects.json` (fixes the PRD-024 "change them per project" promise).
- **Acceptance:** `s11-frozen.mjs` scenario: House A shows "v2 available"; moving it gives v2 to new BoQs; existing BoQs move only by explicit action; an archived default shows a warning.
- **Tests:** scenarios `projects.test.ts`, `library.test.ts`; app unit tests for the pickers.
- **Effort:** L · **Depends on:** — · **Risk:** contract change across three parts — one commit (contract-changes.md).

#### A-45 · One explicit default per preset kind; draft saves never change it  (WP-A11)
- **Sources:** LEAD-008 (default part; publish approval → D-27) · DEC-45 · verify-backend LEAD-008 (stronger)
- **Problem:** with two starred rule sets new projects get the one most recently *edited* (`ProjectPresets.java:25` `ORDER BY updated_at DESC`); saving a draft (`Library.java:236`) flips it.
- **Why it matters:** silent, order-dependent firm default.
- **Change and approach:** an explicit `org_default` per kind (radio "Default for new projects"), set by library editors, audited (`preset.default_set`); starring stays a favourite marker; migration picks today's effective default.
- **Files:** a new Flyway migration (next free version), `services/api/.../project/ProjectPresets.java`, `library/Library.java`, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/library/*`, `docs/product/features/F10-library.md`, `F02-projects.md`.
- **Acceptance:** `s16-starred.mjs` scenario: saving a draft of another starred set doesn't change new projects' defaults.
- **Tests:** scenario `library.test.ts`.
- **Effort:** M · **Depends on:** A-44 · **Risk:** migration must reproduce today's choice.

#### A-46 · With approval required, people who can't approve share only saved versions  (WP-A11)
- **Sources:** LEAD-004 · DEC-42 · verify-backend §3 "LEAD-004"
- **Problem:** with `approvalRequired` + `fourEyes`, an estimator creates a pinned link to the working draft (`201`); the public API shows `revisionStatus: "draft"` and the unreviewed 999 edit with its engine value; `share` key granted to lead/estimator/approver regardless (`ProjectAccess.java:48`).
- **Why it matters:** the firm's deliberate control is bypassed in two clicks (high).
- **Change and approach:** when the org has `approvalRequired`, `ShareLinks.create` allows `pinned` to a working revision and `latest_working`-style modes only for lead/approver; others may pin saved (issued) versions or use `latest_issued`; new org setting `shareOnlySavedVersions` applies it to everyone; the share dialog explains the restriction. F18 §1 defers to F09.
- **Files:** `services/api/.../boq/ShareLinks.java`, `project/ProjectAccess.java`, org settings (`org/*`), `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/shares/share-dialog.tsx`, `apps/app/src/features/settings/general-settings.tsx`, `docs/product/features/F18-share-links.md`, `F09-review-approve-issue.md`, `docs/domain/permissions.md`.
- **Acceptance:** `s06-approval.mjs` scenario: estimator → 403 `approval_required_for_share` on a working pin; approver allowed; saved-version pin allowed.
- **Tests:** scenario `shares.test.ts`, `permissions.test.ts` rows.
- **Effort:** M · **Depends on:** — · **Risk:** existing working links stay valid (no retroactive revoke) — document.

### Phase B — architecture, refactor and test foundations

Remove duplicated logic, make boundaries explicit, and give the numbers independent tests. Phase B packages do not
change quantities; any baseline difference is a regression unless the item says otherwise.

#### B-01 · Engine result invariants checked on every result  (WP-B1)
- **Sources:** FM-111 · ENG-003, ENG-004, ENG-008 (follow-up) · 01 §4
- **Problem:** nothing asserts unique question ids, unique line keys, parts summing to the whole, or that the result matches its schema before it leaves the engine; ENG-003 surfaced only as a Postgres PK violation.
- **Why it matters:** contract violations become opaque ingest failures or silent wrong numbers.
- **Change and approach:** an `invariants.py` run at the end of `get_boq` (unique question ids and line keys; per-element breakdown sums within tolerance; every element in ≤ 1 item line of a family unless claimed or warned — A-20; stats consistent with lines); in tests and CI it raises, in production it logs an error entry and the worker reports `result_invalid` (non-retryable).
- **Files:** `engine/ifc_boq/invariants.py` (new), `engine/ifc_boq/pipeline.py`, `engine/ifc_boq/worker.py`, `engine/tests/conftest.py` (strict mode on).
- **Acceptance:** all engine tests and the full compare-baseline engine layer run with invariants on and pass.
- **Tests:** unit tests feeding broken results.
- **Effort:** M · **Depends on:** A-24, A-25, A-20 · **Risk:** an invariant that real models violate legitimately — log-only in production.

#### B-02 · Property-based tests for the evaluator and breakdowns; an adversarial IFC corpus in the engine tests  (WP-B1)
- **Sources:** ENG-027 · 01 ENG-027
- **Problem:** none of ENG-001…011 was covered; tests prove the authors' paths.
- **Why it matters:** regressions in numbers pass CI.
- **Change and approach:** add `hypothesis` (dev dependency) with properties for `expr.py` (Unicode literal round trip, step rounding, null semantics, parse/print idempotence) and for every breakdown kind (sum of parts = whole); add S11–S14-style malformed files (small, generated or licence-clean) under `engine/tests/fixtures/adversarial/` with expected outcomes (error code, no crash).
- **Files:** `engine/requirements-dev.txt` or `engine/pyproject.toml`, `engine/tests/test_expr.py`, `engine/tests/test_breakdowns.py` (new), `engine/tests/fixtures/adversarial/`.
- **Acceptance:** properties run in < 60 s; each adversarial file has an asserted outcome.
- **Tests:** themselves.
- **Effort:** M · **Depends on:** A-22, A-23, A-24, A-31, A-32 · **Risk:** none.

#### B-03 · Independent oracles: Duplex hand values from geometry, unit assertions, tests that can fail  (WP-B1)
- **Sources:** QS-021, ENG-027 · DEC-23, DEC-34
- **Problem:** `HAND_BOQ` walls use the engine's own method (`26.861 / 0.417`, `test_duplex.py:27-28`; `engine-validation.md:42`); the Duplex test ignores `unit` (`:75-76`); `test_certification_samples.py:80-84` passes when all totals are 0; `tests/scenarios/sheet.test.ts:221-222` cannot fail; `test_diff.py:27` compares to captured engine output.
- **Why it matters:** "reproduces the hand BoQ" reads as validation but is circular for walls.
- **Change and approach:** re-derive every Duplex wall row of `HAND_BOQ` from length × height − openings by hand (documented derivation next to each row; A-09 already did the party walls); assert units; make the certification test fail on zero totals; rewrite the tautological scenario assertion; give `test_diff.py` hand-built expected diffs.
- **Files:** `engine/tests/test_duplex.py`, `engine/tests/test_certification_samples.py`, `engine/tests/test_diff.py`, `tests/scenarios/sheet.test.ts`, `docs/testing/engine-validation.md`.
- **Acceptance:** each changed test fails when the engine output is perturbed by 1 % (mutation check by hand); Duplex test green.
- **Tests:** themselves.
- **Effort:** M · **Depends on:** A-09 · **Risk:** a hand value disagreeing with the engine reveals a real defect — then it becomes a new item, not a tolerance change.

#### B-04 · `verify-quantities` and a fast compare-baseline subset as CI gates  (WP-B1)
- **Sources:** QS-021, ENG-027 · 04 Appendix
- **Problem:** the review's independent checks live only in `docs/review/tools/`; CI never runs them.
- **Why it matters:** the quantity defects Phase A fixed can come back.
- **Change and approach:** move `verify_quantities.py` into `engine/tests/independent/` (keep the review wrapper calling it), run it in the `engine` CI job on the small samples that are licence-clean to fetch in CI (S01–S05, S09 via `fetch-samples.sh` with SHA checks, cached); add a CI step running `compare-baseline --layer engine --only S01-default S02-default S03-default S04-default S05-default S09-default` against `docs/review/baseline/`. `--strict` once all KNOWN rows are FIXED.
- **Files:** `.github/workflows/ci.yml`, `engine/tests/independent/` (new), `docs/review/tools/verify-quantities`, `docs/review/tools/compare_baseline.py`, `docs/testing/README.md`.
- **Acceptance:** CI fails when a check row fails or the subset differs.
- **Tests:** CI run.
- **Effort:** M · **Depends on:** B-03, A-02, A-03, A-09, A-10, A-17 (the items that turn the KNOWN rows FIXED) · **Risk:** sample download flakiness — cache by SHA.

#### B-05 · Shared contract and scenario suites runnable against the local stack  (WP-B2)
- **Sources:** FM-80 · ENG-028 · roadmap #1
- **Problem:** the contract/scenario suites run only inside `NativeWorkerTest` (they need `SuiteSupport`, test sources only); a developer can't run them against `npm run local:up`.
- **Why it matters:** every exit check in this plan needs them quickly.
- **Change and approach:** a `tests/support` target that provisions accounts through the local stack's admin/setup links (like `docs/review/repro/make-account.mjs`) and runs `npm run test:contract` / `test:scenarios` against `http://localhost:8080`; document `BOQLET_TARGET=local`; keep the Java harness path.
- **Files:** `tests/support/*`, `tests/run.mjs`, `tests/vitest.config.ts`, `scripts/local.mjs` (a `local:suites` command), `services/api/src/test/java/com/boqlet/suite/SuiteSupport.java`, `docs/testing/README.md`, `docs/development/commands.md`.
- **Acceptance:** `npm run local:up && npm run local:suites -- --filter permissions` passes locally.
- **Tests:** themselves.
- **Effort:** M · **Depends on:** — · **Risk:** shared state between runs — each run creates its own orgs.

#### B-06 · Browser coverage restored: Library editors, viewer, notifications, admin, wizard, axe and pseudo-locale  (WP-B2)
- **Sources:** FM-81, FM-110 (gate) · UX-042 (gate part; fixes → C-56) · 06 §4
- **Problem:** `apps/app/e2e-java` has 14 specs; no axe, no `en-XA`; the wizard covers the suggested path only; P53 removed 106 mock tests.
- **Why it matters:** UI regressions and a11y gates are unguarded; Phase C changes a lot of UI.
- **Change and approach:** add e2e-java specs for each area; an axe sweep over the 40 screens of `docs/review/repro/ux/crawl.mjs` with a "known violations" allow-list (shrunk by C-56); a pseudo-locale run (`en-XA`) checking no raw keys/overflow on core screens.
- **Files:** `apps/app/e2e-java/*.spec.ts`, `apps/app/package.json` (`@axe-core/playwright` dev dep), `docs/testing/README.md`.
- **Acceptance:** `BOQLET_BROWSER_SMOKE=1` run passes; the axe gate fails on a new serious/critical violation.
- **Tests:** themselves.
- **Effort:** L · **Depends on:** B-05 · **Risk:** suite time — keep under the smoke budget or add a nightly job.
- **Split (2026-11-25):** WP-B2 did the gates (the axe sweep with its known list and the `en-XA` check, `e2e-java/sweep.spec.ts`); the area specs are B-06b in WP-B2b.

#### B-07 · UI performance gate and the F08-AC4 timing  (WP-B2)
- **Sources:** FM-36 · ENG-007 (gate part) · nfr.md TS-002/TS-006
- **Problem:** no automated UI performance budget; F08-AC4 (change-report timing) not automated; search on 3,950 lines froze the page 3.3 s.
- **Why it matters:** performance regressions on large BoQs are invisible.
- **Change and approach:** an e2e-java perf spec on a generated large BoQ (per-element rule on S08) measuring first row, search input latency (long tasks), and change-report time; budgets in `docs/architecture/nfr.md`; nightly CI job (not a deploy gate).
- **Files:** `apps/app/e2e-java/perf.spec.ts` (new), `.github/workflows/ci.yml` (nightly), `docs/architecture/nfr.md`.
- **Acceptance:** budgets recorded; the job fails when exceeded.
- **Tests:** itself.
- **Effort:** M · **Depends on:** B-05 · **Risk:** noisy timings — use medians of 3.

#### B-08 · `NativeWorkerTest` tolerant of load  (WP-B2)
- **Sources:** ENG-028 · DEC-07 · 00-context §4
- **Problem:** under load `permissions.test.ts` P9 hit its 60 s test timeout and `browserSmokeAgainstJava` its overall limit (`NativeWorkerTest.java:441`); both passed on a quiet re-run.
- **Why it matters:** false reds block deploys (every green push deploys, P51); CI runners have 2 CPUs.
- **Change and approach:** per-test timeouts scaled by an env factor (`BOQLET_TEST_TIME_FACTOR`), the overall smoke limit derived from the number of specs, and a single automatic retry of a test that failed only by timeout (reported as flaky).
- **Files:** `services/api/src/test/java/com/boqlet/api/NativeWorkerTest.java`, `tests/vitest.config.ts`, `apps/app/playwright.java.config.ts`, `docs/testing/README.md`.
- **Acceptance:** a run with `stress-ng`-style background load (or 2 CPUs) passes; a genuine failure still fails.
- **Tests:** CI.
- **Effort:** S · **Depends on:** — · **Risk:** hiding real slowness — flaky reports are listed in the CI summary.

#### B-09 · CI gates and supply-chain scanning  (WP-B3)
- **Sources:** ENG-028 · FM-116
- **Problem:** deploy doesn't need the `local` job (`ci.yml:151`); actions pinned by tag; no Dependabot, CodeQL, pip-audit, npm audit; engine tested on Python 3.12 only (docs claim 3.10–3.13); perf suite never runs.
- **Why it matters:** CI is the only gate before the only environment (P51).
- **Change and approach:** deploy `needs` every job including `local`; pin actions by SHA; `.github/dependabot.yml` (npm, pip, maven, actions); CodeQL (JS/TS, Java, Python); `pip-audit -r engine/requirements.txt` and `npm audit --omit=dev` as failing steps; engine matrix 3.10 and 3.13 (3.12 stays the deploy one); `BOQLET_API_PERF` nightly.
- **Files:** `.github/workflows/ci.yml`, `.github/dependabot.yml` (new), `.github/workflows/codeql.yml` (new), `docs/testing/README.md#ci`.
- **Acceptance:** a PR with a vulnerable prod dependency fails; matrix green.
- **Tests:** CI.
- **Effort:** M · **Depends on:** — · **Risk:** longer CI — matrix jobs in parallel.

#### B-10 · Static analysis: ruff and mypy on the engine, Error Prone or SpotBugs on Java, stricter app TypeScript  (WP-B3)
- **Sources:** ENG-028
- **Problem:** no Python linter/type checker config; no Java static analysis; `noUncheckedIndexedAccess` off in `apps/app/tsconfig.json`.
- **Why it matters:** cheap defect prevention in the code that produces numbers.
- **Change and approach:** `ruff` + `mypy` (strict on `engine/ifc_boq`, with a baseline of ignores to burn down) in `npm run test:engine`; Error Prone in `services/api/pom.xml`; turn on `noUncheckedIndexedAccess` in the app and fix the fallout.
- **Files:** `engine/pyproject.toml`, `scripts/run-engine.mjs`, `services/api/pom.xml`, `apps/app/tsconfig.json`, app sources.
- **Acceptance:** `npm run test` and `mvn verify` run the new checks green.
- **Tests:** themselves.
- **Effort:** L · **Depends on:** — · **Risk:** large mechanical diff — split per tool if needed.

#### B-11 · Exported workbooks verified in LibreOffice in CI  (WP-B3)
- **Sources:** FM-45
- **Problem:** workbooks are checked with openpyxl only (F12-AC1 partial).
- **Why it matters:** formulas, protection and print setup may not survive a real spreadsheet app.
- **Change and approach:** a CI step converting exported workbooks (Duplex run, frozen version, change report) with `soffice --headless --convert-to pdf` and recalculating formulas (`--convert-to xlsx` round trip + openpyxl check of SUBTOTAL values); keep the manual Excel check in the release checklist.
- **Files:** `.github/workflows/ci.yml`, `engine/tests/test_export_xlsx.py` (LibreOffice-marked test), `docs/testing/README.md`.
- **Acceptance:** CI converts without errors; recalculated totals equal the engine totals.
- **Tests:** itself.
- **Effort:** S · **Depends on:** — · **Risk:** LibreOffice install time — cache.

#### B-12 · One definition of a group subtotal  (WP-B4)
- **Sources:** ENG-015 · verify-backend §3 "ENG-015" (low)
- **Problem:** subtotals in `boq-sheet/model.ts:158-173`, `RunReads.java:111-127`, `export_xlsx.py:169-177,215-225`; sheet and Excel agree on quantities, but Java's grouped `/lines?groupBy` gives `0` (not null) and counts excluded units; the sheet's line count includes excluded lines, Excel's doesn't.
- **Why it matters:** latent drift; API clients see different numbers.
- **Change and approach:** define the subtotal in `docs/domain/business-rules.md` (null when no line measured; excluded lines out of units, sums and counts); fix Java (`coalesce` removal, unit count over included lines) and the sheet's count; shared test vectors (JSON) used by Vitest, JUnit and pytest.
- **Files:** `apps/app/src/features/boq-sheet/model.ts`, `services/api/.../boq/RunReads.java`, `engine/ifc_boq/export_xlsx.py`, `fixtures/subtotals.json` (new), tests in all three.
- **Acceptance:** the three implementations pass the same vectors.
- **Tests:** the shared vectors.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### B-13 · Item-text preview and slot rename go through the engine  (WP-B4)
- **Sources:** ENG-017 · FM-42
- **Problem:** `library/classification/item-text.ts:35` (`[^{}]*` vs engine `templates.py:8` `[^{}]+`, `String(q)` vs `fmt(round(v,3))`); `library/shared/doc.ts:48` renames `p.<slot>` by regex across the document, including string literals, `from` unescaped; "Reads as" needs a preview run (FM-42 partial).
- **Why it matters:** preview differs from the result; a rename can corrupt formulas (rule 4).
- **Change and approach:** rpc ops `item-text-sample` (fills a template from a sample element or placeholders, no preview run) and `expr-rename` (AST-based); Java endpoints; the client calls them and drops its copies.
- **Files:** `engine/ifc_boq/rpc.py`, `engine/ifc_boq/templates.py`, `engine/ifc_boq/expr.py`, `services/api/.../library/*`, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/library/classification/item-text.ts`, `item-text-box.tsx`, `library/shared/doc.ts`.
- **Acceptance:** "Reads as" shows engine-formatted text without a preview run; renaming slot `a` doesn't touch `"a"` inside a string literal.
- **Tests:** engine rpc tests; app unit tests.
- **Effort:** M · **Depends on:** A-22 · **Risk:** rpc latency in the editor — debounce.

#### B-14 · Reviewer eligibility comes from the API  (WP-B4)
- **Sources:** ENG-016 · DEC-27 · verify-backend ENG-016
- **Problem:** `version-dialogs.tsx:126` filters stored `lead`/`approver`; Java accepts the effective role (org owners/admins act as lead); org admins who aren't project members aren't in `/projects/{id}/members` at all.
- **Why it matters:** UI offers a different set than the server enforces.
- **Change and approach:** `GET /revisions/{id}/reviewer-candidates` (or `canReview` per member including org admins/owners) computed by `ProjectAccess`; the dialog uses it.
- **Files:** `services/api/.../project/ProjectAccess.java`, `boq/Boqs.java`, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/versions/version-dialogs.tsx`.
- **Acceptance:** an org admin listed as project estimator, and one not in the project, appear as candidates.
- **Tests:** scenario `versions-roles.test.ts`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### B-15 · One job-polling hook, one CSV writer, the app reads the unit registry  (WP-B4)
- **Sources:** ENG-030, ENG-010 (app part) · verify-backend ENG-030
- **Problem:** polling copied 4× (`api/hooks/diffs.ts:31-37`, `exports.ts:35-40`, `library.ts:172-177`, `exports/edits-import.tsx:34`) with different delays; two CSV writers (both BOM + formula-defusing, different quoting); unit tables in `edit-dialogs.tsx:55`, `library/shared/vocab.ts:108`, `messages/en/units.json`.
- **Why it matters:** fixes land in one copy only.
- **Change and approach:** `useJob(jobId)` hook; a `Csv` utility in Java used by `ExportController` and `AdminController`; the app imports the unit registry from `@ifc-boq/types` (A-28) for unit choices and labels.
- **Files:** `apps/app/src/api/hooks/*`, `apps/app/src/features/exports/edits-import.tsx`, `services/api/.../boq/ExportController.java`, `admin/AdminController.java`, `services/api/.../http/Csv.java` (new), `apps/app/src/features/boq-sheet/edit-dialogs.tsx`, `apps/app/src/features/library/shared/vocab.ts`.
- **Acceptance:** one implementation each; existing tests green.
- **Tests:** unit tests for `useJob` and `Csv`.
- **Effort:** S · **Depends on:** A-28 · **Risk:** none.

#### B-16 · Legacy OIDC/Keycloak path removed (owner to confirm)  (WP-B4)
- **Sources:** ENG-029 · DEC-62 · verify-backend ENG-029 (documented rollback path)
- **Problem:** `identity/OidcConfiguration.java`, `IdentityFilter.java`, `ProviderSessionRevocations.java`, `apps/app/src/auth/adapters/keycloak.tsx` (174 lines) and the `legacy-identity` compose profile stay as a rollback path (`docs/operations/auth-and-deploys.md:19`, `pilot.md:19,37`).
- **Why it matters:** a second auth path to secure and test; readers can't tell which is live.
- **Change and approach:** remove the code, the compose profile and the docs' rollback section, plus the provider-revocation scheduler; keep migration history. **If the owner declines** (DEC-62): keep it, add a test that boots it, and mark it "rollback only" in code and docs.
- **Files:** `services/api/.../identity/OidcConfiguration.java`, `IdentityFilter.java`, `ProviderSessionRevocations.java`, `apps/app/src/auth/adapters/keycloak.tsx`, `ops/pilot/compose.yaml:52-78`, `ops/local/compose.yaml`, `docs/operations/auth-and-deploys.md`, `docs/operations/pilot.md`, `docs/decisions.md` (record).
- **Acceptance:** build, tests and the local stack work without the OIDC path; ArchUnit green.
- **Tests:** existing auth tests.
- **Effort:** S · **Depends on:** — · **Risk:** removes a rollback path — owner confirmation is the gate.

#### B-17 · Spec corrections that need no code  (WP-B4)
- **Sources:** UX-047, UX-045 (guidelines part), PRD-007 · FM-23, FM-49, FM-57, FM-68 · DEC-66…DEC-69 · section 3.5
- **Problem:** design-system.md lists components that don't exist and screens.md claims search (UX-047); design-guidelines "Still to supply: wordmark SVG" stale since P56; overview marks O1/O3 "Built" while accuracy is unvalidated (PRD-007); F04 (FM-23), F13 (FM-49), plans-and-limits (FM-57), F18 (FM-68) disagree with the decided behaviour.
- **Why it matters:** agents build from these docs (CLAUDE.md: the code wins, fix the doc).
- **Change and approach:** edit the docs per section 3.5; mark each design-system component built / not built; delete the unused `apps/app/src/components/ui/select.tsx` or note it.
- **Files:** `docs/development/design-system.md:45-46`, `docs/product/screens.md:73`, `docs/development/design-guidelines.md:276`, `docs/product/overview.md`, `docs/product/features/F04-boq-and-runs.md`, `F13-notifications.md`, `F18-share-links.md`, `docs/product/plans-and-limits.md`.
- **Acceptance:** each listed doc says what the code does or what is decided.
- **Tests:** none (docs).
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### B-18 · The line list without traces; traces on demand; compression; a non-blocking search  (WP-B5)
- **Sources:** ENG-007 · verify-backend ENG-007
- **Problem:** `api/hooks/sheet.ts:16-31` loads every page of `/runs/{id}/lines` (20,000 per page) with `trace.{formula,params,elements,steps}` (Duplex 41 lines = 104 KB, S08 40 lines = 974 KB, 3,950 lines 3.33 MB); Java sends no `Content-Encoding`; search re-filters and re-colours the viewer synchronously (3.3 s long task).
- **Why it matters:** memory and time to first row grow with element count; a 200k-element model ≈ 50 MB of JSON.
- **Change and approach:** `/runs/{id}/lines` returns summaries (element count, ids for the viewer as a compact array or a separate `/runs/{id}/line-elements` stream) and the full trace via the existing `/lines/by-key` when a line is opened; `server.compression` for `application/json` (and check Traefik on the pilot); debounce search and use `useDeferredValue`; viewer recolour batched. Update `docs/review/tools/compare_baseline.py`'s stack fetch to request traces explicitly so the stack layer still compares them.
- **Files:** `services/api/.../boq/RunReads.java`, `packages/api/openapi.yaml` + `npm run api:gen`, `services/api/src/main/resources/application.yml`, `apps/app/src/api/hooks/sheet.ts`, `apps/app/src/features/boq-sheet/sheet.tsx`, `line-detail.tsx`, `apps/app/src/features/viewer/*`, `docs/review/tools/compare_baseline.py`.
- **Acceptance:** S08 per-element BoQ lines payload < 15 % of today; gzip on; typing in search never blocks > 100 ms (B-07 gate).
- **Tests:** contract test for the new shape; B-07 perf spec.
- **Effort:** M · **Depends on:** B-07 · **Risk:** the viewer needs element ids per line — provide them compactly.

#### B-19 · Server-side grouping and windowing above a threshold  (WP-B5)
- **Sources:** FM-29
- **Problem:** the sheet groups in the browser; Java supports `groupBy`/`level` but no client uses it.
- **Why it matters:** F06 promises server grouping above 20,000 lines.
- **Change and approach:** above a line-count threshold the sheet requests grouped levels and pages within an expanded group; the subtotal definition from B-12 is used server-side.
- **Files:** `apps/app/src/api/hooks/sheet.ts`, `apps/app/src/features/boq-sheet/*`, `services/api/.../boq/RunReads.java`.
- **Acceptance:** a 25,000-line BoQ opens with groups collapsed and the first rows < 2 s on the dev machine.
- **Tests:** scenario `sheet.test.ts` for grouped pages; B-07 perf.
- **Effort:** L · **Depends on:** B-12, B-18 · **Risk:** edits and co-editing on windowed data — keep line edits keyed by line key.

#### B-20 · No N+1 queries in BoQ and revision views  (WP-B5)
- **Sources:** ENG-031
- **Problem:** `BoqAccess.java:103-106` (view per BoQ), `:130-138` (query per model input), `:140` `runs.require`, `:153-157` `pending()` (reads every question id and rebuilds the snapshot), reviewers/comments lookups; `permissions()` calls `orgs.require` twice.
- **Why it matters:** slow lists on busy projects.
- **Change and approach:** batch-load newer versions and pending state per list; cache `pending` on the revision (invalidated by decisions/overrides/manual-item triggers).
- **Files:** `services/api/.../boq/BoqAccess.java`, `boq/Boqs.java`, a migration if a cached column is added.
- **Acceptance:** list of 50 BoQs issues a constant number of queries (test with a query counter).
- **Tests:** JUnit with a datasource proxy counter.
- **Effort:** M · **Depends on:** — · **Risk:** cache invalidation — derive from triggers.

#### B-21 · One 429 code with `Retry-After` everywhere  (WP-B5)
- **Sources:** FM-77
- **Problem:** `NativeCredentials.java:56,221` `auth_throttled` without `Retry-After`; `RateLimits.java:41-47` `rate_limited` with it.
- **Why it matters:** clients can't back off uniformly (api-conventions).
- **Change and approach:** `auth_throttled` keeps its code (contract stability) but sends `Retry-After`; document both in `docs/architecture/api-conventions.md` and the contract.
- **Files:** `services/api/.../identity/NativeCredentials.java`, `packages/api/openapi.yaml` + `npm run api:gen`, `docs/architecture/api-conventions.md`.
- **Acceptance:** throttled sign-in carries `Retry-After`.
- **Tests:** `NativeAuthTest`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### B-22 · Parse memory bounded: meshes streamed to the sidecar, `too_complex` before OOM  (WP-B6)
- **Sources:** ENG-025 · FM-82
- **Problem:** `parse.py:372` keeps every trimesh until the end; S07 (13.6 MB) peaks at 1.6 GB; pilot limits 4 GB queue / 2 GB interactive / 1.5 GB http.
- **Why it matters:** larger Revit IFC4 models can OOM-kill the worker without a clear error.
- **Change and approach:** compute per-element metrics as meshes are built, write meshes to `meshes.npz` incrementally and drop them; a memory budget check that fails the job with `too_complex` when the projected peak exceeds the worker limit; a CI memory test on S07 (cached).
- **Files:** `engine/ifc_boq/parse.py`, `engine/ifc_boq/geometry.py`, `engine/ifc_boq/worker.py`, `engine/tests/test_pilot_capacity.py`.
- **Acceptance:** S07 peak < 50 % of today; all baseline numbers unchanged within 1e-6.
- **Tests:** memory test (tracemalloc/RSS) on S07.
- **Effort:** L · **Depends on:** — · **Risk:** later stages that need meshes (federation overlaps, viewer export) must read the sidecar.

#### B-23 · Parse CPU: volume once, vectorised hull, cached property reads, parallel post-processing  (WP-B6)
- **Sources:** ENG-026 · FM-82
- **Problem:** S06 profile: `run_geometry` 83.5 s of 106.6; trimesh mass properties 13.7 s, `fix_winding` 13 s, `oriented_box` 14.8 s (pure-Python hull 5.4 s), `pset_dict` 7 s; target ≤ 5 min for medium models (measured 9 min NBU MEP).
- **Why it matters:** O1 "in minutes"; processing minutes are billed.
- **Change and approach:** compute `volume` once per mesh; replace `_hull2d.half` with `scipy.spatial.ConvexHull`/trimesh; cache property reads per type; parallelise post-processing per element with a process pool sized by `nproc`.
- **Files:** `engine/ifc_boq/parse.py:334-386`, `engine/ifc_boq/geometry.py`.
- **Acceptance:** S06 parse ≤ 60 % of today on the same machine; baseline numbers unchanged within 1e-6.
- **Tests:** `test_mesh_repair.py`, compare-baseline.
- **Effort:** M · **Depends on:** B-22 · **Risk:** process-pool memory on 2-CPU pilot — cap workers.

#### B-24 · Spatial index for the overlap check  (WP-B6)
- **Sources:** FM-90
- **Problem:** `federation.py:126,371-379` sorts boxes by min x and sweeps: quadratic for long elements along x.
- **Why it matters:** large federations slow down.
- **Change and approach:** an R-tree / grid over boxes (`rtree` or a numpy grid); same overlap results.
- **Files:** `engine/ifc_boq/federation.py`, `engine/requirements.txt` (if `rtree`).
- **Acceptance:** F01 overlap set identical; a synthetic 50k-box case ≥ 10× faster.
- **Tests:** `test_federation.py` equality test.
- **Effort:** S · **Depends on:** — · **Risk:** none.

### Phase C — UX, design and flows

For casual users and power users. Mostly app code; items that touch the engine or the contract say so. Baseline
changes are limited to the export items in WP-C5 and the sample/preset items (stack layer unaffected unless noted).

#### C-01 · Full-height BoQ workspace: sticky top bar, one-line header, grid fills the rest  (WP-C1)
- **Sources:** UX-003, UX-026, UX-027 · DEC-16 · verify-frontend §3 "UX-003" (high)
- **Problem:** at 1440×900 the grid starts at y ≈ 595 px with 9 rows visible (465 px / 13 rows after collapsing); stacked: project title, project tabs, BoQ header, status line, BoQ tabs, banner, a 4-line note with its own "Add line", five filter selects, search/toolbar; the top bar is static (`components/shell/app-shell.tsx`), the grid `h-[max(24rem,calc(100dvh-24rem))]` (`sheet.tsx:1066`) scrolls inside a scrolling page; the toolbar reflows between BoQs and widths; the bulk bar pushes the grid down (497 → 559 px).
- **Why it matters:** a spreadsheet for people who read numbers all day shows less than a printed page.
- **Change and approach:** app layout `h-dvh` with `flex-1 min-h-0` grid; sticky top bar; one-line BoQ header (name · state · counts · actions) with tabs on the same row or directly under; the note becomes a dismissible one-line InfoBar (server-side preference, P54 Q55); filters become a filter bar with chips and a popover; fixed toolbar order (Undo · Add line · Excel · Model · Columns) collapsing into "⋯" below 1280 px; remove the note's duplicate "Add line"; bulk bar replaces the filter row or floats at the grid bottom with `aria-live` count.
- **Files:** `apps/app/src/components/shell/app-shell.tsx`, `apps/app/app/(app)/[org]/projects/[projectId]/boqs/[boqId]/page.tsx`, `apps/app/src/features/boqs/boq-header.tsx`, `apps/app/src/features/boq-sheet/sheet.tsx`, `apps/app/messages/en/boqs.json`.
- **Acceptance:** ≥ 20 rows visible at 1440×900 with the note collapsed; one scroll container; toolbar identical across BoQs; no layout shift when ticking a row.
- **Tests:** e2e-java layout spec (row count, single scroll container); app unit tests for the InfoBar preference.
- **Effort:** L · **Depends on:** — · **Risk:** regressions in focus and keyboard flow — C-04 follows in the same package.

#### C-02 · An always-visible status gutter replaces the hidden Source column  (WP-C1)
- **Sources:** UX-001, UX-044 · FM-104 (sheet part) · DEC-47
- **Problem:** `sheet.tsx:273` turns `source` off when the 3D split is on (TF-107), so DERIVED/MANUAL tags vanish (flagged lines show "—"); at 1024/768 the Source column is cut off.
- **Why it matters:** status the product promises to show (design-system principle 5) is hidden by default.
- **Change and approach:** an 18 px status gutter next to the line number (icon + tag, `aria-label`, tooltip with the word) reusable on the share page (C-26); Storey hides first when narrow; below 1280 hide Item/Storey by default, keep No., Description, Qty, Unit and the gutter.
- **Files:** `apps/app/src/features/boq-sheet/sheet.tsx`, a `StatusGutter` component (with C-54 `StatusTag`), `apps/app/messages/en/boqs.json`.
- **Acceptance:** with 3D on at 1440 and at 1024, every TO CONFIRM/DERIVED/MANUAL line shows its mark; axe clean.
- **Tests:** app unit test; e2e-java at 1024 and 1440.
- **Effort:** M · **Depends on:** C-01 · **Risk:** none.

#### C-03 · Line detail as a resizable drawer over the 3D pane; descriptions keep their width  (WP-C1)
- **Sources:** UX-008, CAS-031, QS-019 · DEC-16
- **Problem:** with detail open the description shrinks to ~14 characters (256 px; 160 px with 3D on); the detail makes the page 5,984 px tall; 3D on by default squeezes descriptions to ~12–20 characters.
- **Why it matters:** the description is the QS's main column; comparing a line with its explanation is the core check (O3).
- **Change and approach:** detail is a resizable right drawer with its own scroll that overlays the 3D pane (no third column); grid keeps ≥ 55 % width; the selected row's description wraps to 2 lines; the split ratio and "3D open" are remembered per user; first visit opens with a narrow 3D pane.
- **Files:** `apps/app/src/features/boq-sheet/line-detail.tsx`, `sheet.tsx`, `apps/app/src/features/viewer/model-viewer.tsx`.
- **Acceptance:** at 1440 with 3D and detail open, description column ≥ 320 px; page height = viewport.
- **Tests:** e2e-java widths.
- **Effort:** M · **Depends on:** C-01 · **Risk:** none.

#### C-04 · Keyboard: no focus jump on load, a "Skip to the sheet" link, visible separator focus, one Tab stop per toolbar  (WP-C1)
- **Sources:** UX-002, UX-024 · DEC-50 · verify-frontend §3 "UX-002" (dev-only today)
- **Problem:** `useRefocusWhenLost` (`lib/focus.ts:16-35`) guards with a `mounted` ref that StrictMode defeats (focus lands on "Generate again" in `next dev`); the treegrid is Tab stop 38; the resize separator has no focus ring (WCAG 2.4.7).
- **Why it matters:** keyboard users cross the whole chrome every visit; an accidental Enter could start a run.
- **Change and approach:** compare the previous dependency value instead of a mount flag and refocus only after user-initiated changes; second skip link "Skip to the sheet" plus `g s`/`g q` shortcuts listed on `?`; `focus-visible:ring-2 ring-ring` on the separator; filter row as `role="toolbar"` with roving tabindex.
- **Files:** `apps/app/src/lib/focus.ts`, `apps/app/src/features/boqs/boq-header.tsx`, `apps/app/src/features/boq-sheet/sheet.tsx`, `apps/app/src/components/shell/app-shell.tsx`.
- **Acceptance:** dev and prod: focus stays on body after load; the sheet is reachable in ≤ 3 Tab stops via the skip link; separator shows a ring.
- **Tests:** jsdom test of the hook under StrictMode (template `docs/review/repro/verify-frontend/strictmode-focus.cjs`); e2e-java keyboard spec.
- **Effort:** S · **Depends on:** C-01 · **Risk:** none.

#### C-05 · While the first run is in progress the sheet shows a skeleton, not "Generate the BoQ"  (WP-C1)
- **Sources:** UX-037
- **Problem:** `RunFigures` (`boqs/[boqId]/page.tsx:148-158`) shows `sheet.empty` whenever no run has stats, even during the first run.
- **Why it matters:** contradictory message on the very first BoQ.
- **Change and approach:** skeleton grid with "Generating… lines appear when the run finishes" while a run is active.
- **Files:** `apps/app/app/(app)/[org]/projects/[projectId]/boqs/[boqId]/page.tsx`, `apps/app/messages/en/boqs.json`.
- **Acceptance:** first run shows the skeleton; later runs keep the previous sheet.
- **Tests:** app unit test.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-06 · Sortable headers, density switch, column resize and a "Wrap text" (three-line clamp) toggle  (WP-C2)
- **Sources:** UX-007, UX-048 · FM-30 · DEC-46
- **Problem:** no `aria-sort` or sort handlers; `ROW = 32` fixed (`sheet.tsx:50`) while `--row-height-compact` 28 / `--row-height-comfortable` 36 exist unused; Columns menu toggles visibility only; item texts one line (F06 three-line clamp missing; density switch untracked).
- **Why it matters:** estimators look for the biggest quantities, unclassified or edited lines.
- **Change and approach:** sort within groups (grouped order stays default) with `aria-sort`; density segmented control in the Columns menu (persisted per user); drag-to-resize with double-click auto-fit (persisted per BoQ); "Wrap text" toggle using `line-clamp-3`, the virtualiser measuring row heights.
- **Files:** `apps/app/src/features/boq-sheet/sheet.tsx`, `model.ts`, `apps/app/app/globals.css` (tokens), `apps/app/messages/en/boqs.json`, `docs/product/known-limitations.md` (remove the clamp/density rows when done).
- **Acceptance:** sort by quantity within groups; density switch changes row height; wrapped rows virtualise correctly.
- **Tests:** app unit tests for sort comparator and persistence; e2e-java.
- **Effort:** M · **Depends on:** C-01 · **Risk:** variable row heights in the virtualiser — use `measureElement`.

#### C-07 · Group the sheet by storey or by "measured as" without a classification  (WP-C2)
- **Sources:** CAS-008 · DEC-58
- **Problem:** without a classification "Group by" offers only "No grouping" (`sheet.tsx:600-607`); the Excel is one "Unclassified" section.
- **Why it matters:** a flat 42-line list is not what a casual user sends; the good-looking grouping hides behind a Demo preset.
- **Change and approach:** built-in grouping options Storey and "Measured as" (rule label) in the sheet and the Excel export's `groupBy` (engine export groups by the same keys; classification never changes numbers); wizard step 2 offers "Use simple trade sections" (C-35).
- **Files:** `apps/app/src/features/boq-sheet/sheet.tsx`, `model.ts`, `engine/ifc_boq/export_xlsx.py` (groupBy storey/rule), `packages/api/openapi.yaml` (`groupBy` values) + `npm run api:gen`.
- **Acceptance:** an unclassified BoQ groups by storey in sheet and Excel with subtotals (B-12 definition).
- **Tests:** export test; app unit test.
- **Effort:** M · **Depends on:** B-12 · **Risk:** none.

#### C-08 · Pending edits and answers: a clear "apply" state, never a mystery  (WP-C2)
- **Sources:** CAS-005 · DEC-38
- **Problem:** after an edit the header says "Inputs changed since this run… Generate again"; Save version turns dashed; new lines say "NEXT RUN"; regenerations took 6–47 s.
- **Why it matters:** spreadsheet-minded users don't expect to regenerate (root of CAS-002).
- **Change and approach:** one banner "3 edits, 1 answer not applied yet — Apply now (regenerate)" with the list on hover/expand; Save version's disabled reason visible next to it (C-52); edits already show their value in the sheet (as today). F06 documents the flow.
- **Files:** `apps/app/src/features/boqs/boq-header.tsx`, `apps/app/src/features/boq-sheet/sheet.tsx`, `apps/app/messages/en/boqs.json`, `docs/product/features/F06-boq-sheet.md`.
- **Acceptance:** after an edit the banner names what is pending; one click regenerates; Save version explains why it waits.
- **Tests:** app unit tests.
- **Effort:** S · **Depends on:** A-41 · **Risk:** none.

#### C-09 · Command palette and global search (⌘K / Ctrl+K)  (WP-C2)
- **Sources:** UX-021 · FM-31 · DEC-75
- **Problem:** no global search or command palette; screens.md lists search; tracked as FE-034.
- **Why it matters:** with many projects, BoQs and presets everything is click-through.
- **Change and approach:** shadcn Command (cmdk) on ⌘K/Ctrl+K and a top-bar search field: projects, BoQs, models, presets, settings pages; actions in context ("Generate again", "Export Excel", "Go to questions"); a Java search endpoint over names the user can see (membership-filtered).
- **Files:** `apps/app/src/components/shell/*`, `apps/app/src/components/ui/command.tsx` (new, via `npm run ui:add -w @ifc-boq/app`), `services/api/.../org/*` (search), `packages/api/openapi.yaml` + `npm run api:gen`.
- **Acceptance:** ⌘K finds a BoQ by name across projects; results respect membership (isolation test).
- **Tests:** scenario `isolation.test.ts` row for search; e2e-java.
- **Effort:** M · **Depends on:** — · **Risk:** leaking names across tenants — reuse `ProjectAccess` filters.

#### C-10 · "How it is calculated" shows each element's measured inputs and where they came from  (WP-C3)
- **Sources:** QS-011 · verify-engine QS-011
- **Problem:** line detail shows "[area] area (main) = 11" per element (`line-detail.tsx:273-285`); the measure log holds the substance ("volume 4.587 m3 from PSet_Revit_Dimensions.Volume … / 0.417 = 11 m2") but measure-stage entries carry only `guid`, so `RunReads.java:140` (by `lineKey`) never selects them.
- **Why it matters:** a QS can't see whether a number came from the file or the geometry — exactly what QS-001/003/004 needed.
- **Change and approach:** per element: each input's source (set.property or geometry), value, the geometry value when different, the decision that chose it (A-06); link the element's measure-stage log entries (select by guid).
- **Files:** `apps/app/src/features/boq-sheet/line-detail.tsx`, `services/api/.../boq/RunReads.java`, `engine/ifc_boq/measure.py` (structured provenance per input), `packages/types/src/engine.ts` + codegen.
- **Acceptance:** Duplex foundation wall detail shows "volume 4.587 m³ from PSet_Revit_Dimensions.Volume · thickness 0.417 from layer set"; the measure log entries for its elements are listed.
- **Tests:** engine test for provenance fields; app unit test.
- **Effort:** M · **Depends on:** A-06, B-18 · **Risk:** trace size — provenance is fetched with the line (by key), not in the list.

#### C-11 · Line-detail numbers rounded and with units  (WP-C3)
- **Sources:** UX-031
- **Problem:** element shares "5.250625", total "12.483345" without unit; log entries "m2" vs sheet "m²".
- **Why it matters:** the explanation looks less trustworthy than the sheet.
- **Change and approach:** format shares with the line's unit and 3 decimals; render units in log text through one `unitLabel()` (registry, A-28).
- **Files:** `apps/app/src/features/boq-sheet/line-detail.tsx`, `apps/app/src/i18n/engine-message.ts`.
- **Acceptance:** no unformatted numbers in line detail.
- **Tests:** app unit test.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-12 · Change summary counts what it hides  (WP-C3)
- **Sources:** CAS-024
- **Problem:** "Lines changed 2" lists one; the other is under the default 1 % threshold (`changes/model.ts:3,45`; `changes-tab.tsx:155`).
- **Why it matters:** looks like a bug.
- **Change and approach:** "2 changed (1 under 1 % hidden — show)".
- **Files:** `apps/app/src/features/changes/changes-tab.tsx`, `apps/app/messages/en/boqs.json`.
- **Acceptance:** counts reconcile.
- **Tests:** `changes/model.test.ts`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-13 · The review screen shows who made each edit and when  (WP-C3)
- **Sources:** LEAD-021
- **Problem:** `review-tab.tsx:102-112` renders key, value, reason only; `LineOverride.createdBy` is in `GET /boqs/{id}/overrides`.
- **Why it matters:** reviewers query the submitter about someone else's edit.
- **Change and approach:** author name and time per edit.
- **Files:** `apps/app/src/features/versions/review-tab.tsx`.
- **Acceptance:** each edit shows author and time.
- **Tests:** app unit test.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-14 · The Changes tab for everyone who can view the BoQ (refines P54 Q44 — owner to confirm)  (WP-C3)
- **Sources:** LEAD-020 · FM-39 · DEC-60
- **Problem:** `boqs/[boqId]/page.tsx:61-64` hides Changes without `seeAudit`/`editBoqs`; the API allows viewers (`POST /runs/{id}/compare` → 202).
- **Why it matters:** read-only managers most want to see what changed.
- **Change and approach:** show Changes read-only to viewers; update `screens.md` S12d and note the refinement in `docs/decisions.md`. If the owner declines: document "editors only" and close.
- **Files:** `apps/app/app/(app)/[org]/projects/[projectId]/boqs/[boqId]/page.tsx`, `docs/product/screens.md`, `docs/domain/permissions.md`.
- **Acceptance:** viewer sees the Changes tab and the report.
- **Tests:** scenario `versions-roles.test.ts`; e2e-java viewer.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-15 · Questions in plain words, with their effect  (WP-C4)
- **Sources:** CAS-013, UX-030
- **Problem:** "3 × IfcWall 'Party Wall …': the thickness stated in the file and the geometry disagree by ‑16 % to ‑10 % (e.g. 0.55 m from material layer set vs 0.493 m measured)", "PSet_Revit_Dimensions.Volume", negative percentages, "Used 171 times. — 171 elements", both SUGGESTED and RECOMMENDED, pre-selected radio counted as unanswered (P54 Q60 says a click accepts it), "Not used by the current rules" — then why ask.
- **Why it matters:** questions are the main human-in-the-loop task; users guess "recommended".
- **Change and approach:** message templates: "The file says 0.55 m thick; the geometry measures 0.49 m (−10 %). Which should we use?"; list the affected lines and the size of the change (from the engine's what-if per option where cheap, else the line names); one label "Suggested"; pset names in a Details disclosure; one count; questions with no effect move to an "FYI" group collapsed by default.
- **Files:** `apps/app/src/features/questions/questions-tab.tsx`, `apps/app/src/i18n/engine-message.ts`, `apps/app/messages/en/questions.json`, `engine.json`, `engine/ifc_boq/measure.py` (affected line keys per question).
- **Acceptance:** contradiction questions read as above; "Not used" questions are under FYI.
- **Tests:** app unit tests for message rendering; pseudo-locale run.
- **Effort:** M · **Depends on:** A-04 · **Risk:** none.

#### C-16 · Name questions can always be answered: synonyms, "Not relevant", suggestions from IFC data  (WP-C4)
- **Sources:** CAS-004, QS-022, PRD-006 (answerability part) · FM-98 · DEC-14, DEC-32 · verify-engine CAS-004 (parent terms exist; search finds nothing)
- **Problem:** term search has no synonyms ("damp", "laminat", "bitumen" → no match although `membrane`, `finish`, `air_gap` exist); blocking name questions have no "Leave it" (`questions-tab.tsx:262-265`); placeholder names ("Air", "Default") block; S07 61 blocking names; abbreviations (Ext, Int, Ptn) not recognised.
- **Why it matters:** hours of answering before "complete"; wrong guesses persist in the dictionary.
- **Change and approach:** term search over labels, synonyms and translations per locale (dictionary type gets `aliases` per term, types first); "Not relevant for this BoQ" answer mapping to an explicit `unspecified` term (non-blocking, logged, never silent); placeholder names default to `unspecified` with an FYI question; suggestions pre-filled from IFC data (IsExternal, class, material category) and the top 3 term matches as chips; seed dictionary gains common abbreviations and the missing everyday terms (damp-proof course/membrane, laminate, vinyl, bitumen, render, screed…).
- **Files:** `packages/types/src/dictionary.ts` + codegen, `presets/dictionaries/global-seed.json`, `engine/ifc_boq/names.py`, `apps/app/src/features/questions/*`, `apps/app/messages/en/questions.json`, `docs/product/guides/dictionaries.md`.
- **Acceptance:** S09 names answerable without guessing; "Air" non-blocking by default; S07 blocking name count drops (record the new number).
- **Tests:** engine names tests (aliases, abbreviations, placeholders); app unit tests.
- **Effort:** L · **Depends on:** A-26 · **Risk:** seed changes move baseline question counts (expected; list them).

#### C-17 · Answer dialog: who answered before, which BoQs it affects, and a notice when replacing a colleague's answer  (WP-C4)
- **Sources:** LEAD-007, ENG-032 · DEC-43
- **Problem:** overwriting another estimator's answer gives no warning; `dryRun` returns only reopened revisions; the "not applied" banner names nobody; decisions apply project-wide to every BoQ (as F05 specifies).
- **Why it matters:** silent tug-of-war; surprising cross-BoQ effects.
- **Change and approach:** when the existing decision is someone else's: "Erin answered aluminium on 23 Nov — replace?"; show "applies to N BoQs in this project" from the dry run; notify the BoQs' estimators (`decision.replaced`); banner names who changed what. F05 notes the scope.
- **Files:** `services/api/.../boq/Decisions.java` (dry run: previous decision, affected BoQs; notification), `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/questions/*`, `apps/app/messages/en/questions.json`, `notifications.json`, `docs/product/features/F05-questions-and-decisions.md`.
- **Acceptance:** `s13-overwrite.mjs` scenario: warning shown, previous author notified.
- **Tests:** scenario `questions.test.ts`.
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### C-18 · Decisions page in human sentences  (WP-C4)
- **Sources:** UX-028
- **Problem:** Question column `contradiction:volume:IfcWall:Party Wall…`, Answer `reported`.
- **Why it matters:** the audit trail of the firm's answers is unreadable.
- **Change and approach:** reuse the Questions tab's sentence and option labels (store the question's message code/params with the decision or re-render from the latest run); `label-caps` headers; CSV keeps ids plus a readable column.
- **Files:** `apps/app/src/features/decisions/decisions-table.tsx`, `services/api/.../boq/Decisions.java` (message params), `apps/app/messages/en/questions.json`.
- **Acceptance:** decisions read like the questions; CSV has both.
- **Tests:** app unit test.
- **Effort:** S · **Depends on:** C-15 · **Risk:** none.

#### C-19 · Questions filtered and grouped by model  (WP-C4)
- **Sources:** FM-25
- **Problem:** `questions-tab.tsx:50` filters by state and kind only.
- **Why it matters:** federated projects split questions by discipline.
- **Change and approach:** a Model chip filter and "group by model"; question → model from element GUIDs (engine adds `modelIds` per question).
- **Files:** `engine/ifc_boq/pipeline.py`, `packages/types/src/engine.ts` + codegen, `apps/app/src/features/questions/questions-tab.tsx`.
- **Acceptance:** F01 questions filter by S07/S08.
- **Tests:** app unit test; engine test.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-20 · One status line: "complete", what's left to check, and accurate badge text  (WP-C4)
- **Sources:** PRD-015, CAS-023 · DEC-24 · verify-product PRD-015 (low)
- **Problem:** "41 lines · 3 to confirm … ✓ COMPLETE" next to "QUESTIONS 2"; the tab badge counts all open questions (colour distinguishes blocking) but its sr-only text says "questions to answer" for non-blocking ones.
- **Why it matters:** users can't tell done from not done.
- **Change and approach:** status reads "Complete · 3 lines need a quantity · 2 optional questions" (or "No blocking questions" wording per BR-10); badge sr-only text distinguishes blocking from optional.
- **Files:** `apps/app/src/features/boqs/boq-header.tsx`, `apps/app/app/(app)/[org]/projects/[projectId]/boqs/[boqId]/page.tsx:108-113`, `apps/app/messages/en/boqs.json`.
- **Acceptance:** status line and badge text agree; screen reader announces blocking vs optional.
- **Tests:** app unit test.
- **Effort:** S · **Depends on:** A-19 · **Risk:** none.

#### C-21 · A print-ready workbook and a watermark that means something  (WP-C5)
- **Sources:** CAS-003 (print part; PDF → D-40), QS-016 (print part), PRD-026, CAS-029 · DEC-17
- **Problem:** no sheet has orientation, fit-to-page, print titles, print area or footer; BoQ columns ≈ 184 characters wide; the printout is 6 portrait pages with quantities on a different page; the Free watermark is one deletable cell (`export_xlsx.py:259-260`, Cover!A19).
- **Why it matters:** every send-out needs manual page setup; the watermark is no upgrade lever.
- **Change and approach:** BoQ sheet landscape, fit to 1 page wide, print titles = header row, print area = visible columns, footer "project · BoQ · version · page x of y"; Calculation/Lines similar; with `exportWatermark` the header/footer carries "Made with boqlet (Free plan)" on every printed page and the share page shows a small note (F12 / plans-and-limits define it).
- **Files:** `engine/ifc_boq/export_xlsx.py`, `engine/tests/test_export_xlsx.py`, `docs/product/features/F12-exports.md`, `docs/product/plans-and-limits.md`, `apps/app/src/features/shares/public-share.tsx`.
- **Acceptance:** openpyxl reads the page setup; LibreOffice (B-11) prints the Duplex BoQ on 2 landscape pages with repeated headers.
- **Tests:** export test for page setup; B-11 check.
- **Effort:** S · **Depends on:** — · **Risk:** Cover!A19 cell removal changes `xlsx-cells` in Free-plan exports (none in the baseline — engine layer has no plan).

#### C-22 · "Issue" and "Working" export profiles  (WP-C5)
- **Sources:** PRD-012, CAS-015 · FM-120 · DEC-40 · verify-product PRD-012 (line key already hidden)
- **Problem:** the workbook a client receives shows BoQ!A2 with the version-UUID chain (VER-007), visible Log (220–650 rows), Questions (codes like `inconsistent_winding`), Inputs (sha256, ids), Calculation; Cover has no firm or client, a raw ISO timestamp, "Locale en"; one export profile in the API (`openapi.yaml:1366-1375`).
- **Why it matters:** firms strip it by hand before every tender.
- **Change and approach:** contract first: `profile: issue | working` on the export request; `issue` = Cover (firm name, client, project, BoQ, version, readable date in the org's format) + BoQ (+ optional Calculation), no Log/Questions/Inputs, no internal ids in row 2; hidden line-key column and `_boqlet` stay (round trip); defaults per DEC-40; the Exports tab and share dialog offer both.
- **Files:** `packages/api/openapi.yaml` + `npm run api:gen`, `services/api/.../boq/BoqExports.java`, `boq/ExportController.java`, `engine/ifc_boq/export_xlsx.py`, `engine/ifc_boq/worker.py`, `apps/app/src/features/exports/exports-tab.tsx`, `apps/app/src/features/shares/share-dialog.tsx`, `apps/app/messages/en/boqs.json`.
- **Acceptance:** an issue workbook has 2–3 visible sheets and imports back through the edits import; working unchanged.
- **Tests:** export tests per profile; scenario `edits-import.test.ts` with an issue workbook.
- **Effort:** M · **Depends on:** C-21, A-34 · **Risk:** contract change — Java, app and engine in one commit.

#### C-23 · Item numbers in Ref as numbers; shipped classifications carry example item texts  (WP-C5)
- **Sources:** QS-016 (Ref/No./item texts part)
- **Problem:** Ref repeats the group code on every line ("A.01"); the item number is in J "No." as text (`export_xlsx.py:207-208` `data_type = "s"`); no shipped code list has item texts (`grep -c itemText` → 0), so descriptions read "Wall, <Revit type>, 417 mm".
- **Why it matters:** a bill needs item numbers to refer to and texts a contractor can price.
- **Change and approach:** Ref = position/item number (numeric where it is a number, text for dotted codes), group code on group rows only; add illustrative (non-licensed, own-words) item texts to `demo-trades` and `acme-cost-codes` (rule 8: no standard text).
- **Files:** `engine/ifc_boq/export_xlsx.py`, `presets/classifications/demo-trades/*`, `presets/classifications/acme-cost-codes/*`, `engine/tests/test_export_xlsx.py`, `engine/tests/test_item_texts.py`.
- **Acceptance:** S05-house BoQ has numeric positions and item texts; the Duplex test unaffected (quantities).
- **Tests:** export and item-text tests.
- **Effort:** S · **Depends on:** — · **Risk:** baseline xlsx cells and line descriptions change in configs using these classifications (expected).

#### C-24 · Split lines get distinguishing descriptions  (WP-C5)
- **Sources:** CAS-025, QS-016 (duplicate descriptions) · verify-engine CAS-025 (S05-standard 6 groups; S07 Timber Clad pair differing in hidden `is_external`)
- **Problem:** two "Edge formwork to slabs" lines (8.78 / 6.11 m²); four "Paint to plasterboard wall surfaces" in S05-standard; S07 two "Wall, Wall - Timber Clad, 202 mm" lines differing only in a hidden key.
- **Why it matters:** duplicate texts can't be priced apart; look like duplicates.
- **Change and approach:** when two lines of one rule share a description, append the distinguishing line-key parts in words (slab type, storey, side, "external"/"internal") through the item-text template; deterministic, no line-key change.
- **Files:** `engine/ifc_boq/rules.py` (description disambiguation), `engine/ifc_boq/templates.py`, `presets/rules/as-modelled.json` (label parts), `engine/tests/`.
- **Acceptance:** no two lines in any baseline run share a description within a rule.
- **Tests:** engine test; compare-baseline lists only description changes.
- **Effort:** S · **Depends on:** C-23 · **Risk:** descriptions change in the baseline (expected; line keys and quantities identical).

#### C-25 · Share page line detail: readable setting names, model names, correct element counts  (WP-C6)
- **Sources:** UX-009, UX-046, VER-001, VER-002 · DEC-28
- **Problem:** `public-share.tsx:248-256` passes `slots={{}}` (settings shown as `wall_unit`, `wall_recess_mode`) and an empty `modelNames` (elements as `01a2079c`); the formula shows raw syntax; share 3D says "Model 1" and "0 elements of this line" for a line with 3.
- **Why it matters:** clients see developer identifiers; trust in the traceable number drops.
- **Change and approach:** the public API returns slot labels and model names for the shared run (no internal ids); reuse the in-app `settingLabel()`; formula in readable form only (as-written behind a disclosure, or omitted for public); fix the element count wiring in the share viewer.
- **Files:** `apps/app/src/features/shares/public-share.tsx`, `services/api/.../boq/PublicShares.java`, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/viewer/*`.
- **Acceptance:** share line detail matches in-app labels; element list shows model names; 3D shows the right count.
- **Tests:** `public-share.test.tsx`; scenario `shares.test.ts`.
- **Effort:** M · **Depends on:** — · **Risk:** never expose internal ids — test asserts no UUIDs in the payload.

#### C-26 · Share sheet: line numbers, status marks with a legend, phone-safe cells, virtualised  (WP-C6)
- **Sources:** UX-010, CAS-016 · FM-67, FM-104 (share part) · DEC-71
- **Problem:** share page shows Description/Unit/Quantity only — flagged lines "—" without explanation, no item numbers; on a phone an edited line's quantity cell (`whitespace-nowrap` from `ui/table.tsx:85`) pushes quantities off-screen; plain table (not virtualised).
- **Why it matters:** clients can't tell unmeasured from zero or refer to a line; large BoQs slow.
- **Change and approach:** No. column and the status gutter (C-02) with a one-line legend; `whitespace-normal` on the quantity cell; virtualise above 500 lines.
- **Files:** `apps/app/src/features/shares/public-share.tsx`, `apps/app/src/components/ui/table.tsx` (cell override).
- **Acceptance:** 390 px edited share shows quantities; flagged lines say "to confirm".
- **Tests:** `public-share.test.tsx`; e2e-java at 390 and 1280.
- **Effort:** S · **Depends on:** C-02 · **Risk:** none.

#### C-27 · Share page header per the guidelines; watermark kept off the detail; "show edits" option  (WP-C6)
- **Sources:** UX-045, CAS-028 · DEC-26, DEC-41
- **Problem:** plain mono header (guidelines: wordmark, colour block, display title); the WORKING watermark runs under the line-detail text; edits always show "Edited (measured: 44.91)" (P54 Q52), no choice; F18 §2 contradicts P54 Q52.
- **Why it matters:** first impression for the client; contractors may not want to show the measured value.
- **Change and approach:** header with `Poster` + `Wordmark` + display title; watermark confined to the table at lower opacity or a "WORKING VERSION" banner; share dialog option "Show edit marks and the measured value" (default on, P54 Q52), stored on the link; F18 §2 corrected.
- **Files:** `apps/app/src/features/shares/public-share.tsx`, `share-dialog.tsx`, `services/api/.../boq/ShareLinks.java`, `PublicShares.java`, a Flyway migration (link option), `packages/api/openapi.yaml` + `npm run api:gen`, `docs/product/features/F18-share-links.md`.
- **Acceptance:** a link with the option off shows plain quantities; header matches the guidelines.
- **Tests:** scenario `shares.test.ts`; `public-share.test.tsx`.
- **Effort:** M · **Depends on:** C-25 · **Risk:** none.

#### C-28 · Setting a password signs you in; validation is inline  (WP-C7)
- **Sources:** PRD-022, CAS-019, UX-032 · DEC-20
- **Problem:** after "Set your password" the user lands on an empty sign-in (no confirmation, email not prefilled; setup links don't carry `email`, `native.tsx:165`); the 15-character rule is enforced by the browser bubble (form not `noValidate`).
- **Why it matters:** a "did it work?" moment and an unstyled, unlocalised error in the first minute.
- **Change and approach:** the set-password endpoint returns a session (respecting P22 takeover) and redirects to onboarding/invite; `noValidate` with inline "12 / 15 characters" validation; the sign-up page shows which email the link is for.
- **Files:** `services/api/.../identity/NativeAuthController.java`, `apps/app/src/auth/adapters/native.tsx`, `native-links.tsx`, `apps/app/app/(public)/sign-up/*`, `apps/app/messages/en/auth.json`, `packages/api/openapi.yaml` + `npm run api:gen`.
- **Acceptance:** sign-up → onboarding without a second sign-in; inline validation localised.
- **Tests:** `NativeAuthTest`; e2e-java `sign-up.spec.ts`.
- **Effort:** S · **Depends on:** — · **Risk:** session takeover rules (P22) must still apply.

#### C-29 · Onboarding: country and currency pickers; "web address" derived from the name  (WP-C7)
- **Sources:** CAS-007, CAS-020, PRD-023 · DEC-20
- **Problem:** free-text `maxLength={3}` currency and `maxLength={2}` country (`onboarding/page.tsx:95,98`): "Ireland" → IR (Iran), "Au" → AU; ADDRESS prefilled "000" (`orgs/slug.ts:15`) reads as a postal address.
- **Why it matters:** wrong defaults unnoticed.
- **Change and approach:** searchable pickers with names (Intl display names) for country and currency; "Web address (boqlet.com/…)" derived silently from the name, editable behind "Change".
- **Files:** `apps/app/app/(app)/onboarding/page.tsx`, `apps/app/src/features/orgs/*`, `apps/app/messages/en/orgs.json`.
- **Acceptance:** typing "Ireland" selects IE; empty name gives no "000".
- **Tests:** app unit tests.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-30 · Invite colleagues during onboarding (or don't promise it)  (WP-C7)
- **Sources:** PRD-024, CAS-021, UX-033 · FM-05 · DEC-20
- **Problem:** "You can invite colleagues next" (`orgs.json:15`) but the next screen is the wizard; FL-1 step 3 specifies the step.
- **Why it matters:** broken promise on the first screen; team plans live on invitations.
- **Change and approach:** optional "Invite colleagues" step after org creation when the plan has > 1 seat (emails + org role, skip); on 1-seat plans the sentence says "You can invite colleagues from Settings › Members when your plan allows".
- **Files:** `apps/app/app/(app)/onboarding/page.tsx`, `apps/app/src/features/orgs/*`, `apps/app/messages/en/orgs.json`.
- **Acceptance:** Team-plan org can invite in onboarding; Free copy honest.
- **Tests:** e2e-java `orgs.spec.ts`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-31 · Joining from an invitation in one step  (WP-C7)
- **Sources:** LEAD-012
- **Problem:** invitation link → "Sign in to accept" (primary) → small "Set up your invited account" link → set password → sign in again → invitation → Accept (five screens); the email doesn't name inviter, role or product (`EmailDelivery.java:120`; `invite/[token]/page.tsx:86-94`).
- **Why it matters:** new starters get stuck or reset a password they never had.
- **Change and approach:** for an address without an account the main button is "Create your account": name + password + accept in one step; email names inviter, org, role and one line about boqlet.
- **Files:** `apps/app/app/(public)/invite/[token]/page.tsx`, `apps/app/src/auth/adapters/native.tsx`, `services/api/.../org/Invitations.java`, `mail/EmailDelivery.java`, `packages/api/openapi.yaml` + `npm run api:gen`.
- **Acceptance:** invitation → member of the org in 1 screen; email content as specified.
- **Tests:** e2e-java invite flow; scenario `orgs.test.ts`.
- **Effort:** M · **Depends on:** C-28 · **Risk:** none.

#### C-32 · New members see who to ask, not "Create your first project"; an org setting for who may create projects  (WP-C7)
- **Sources:** LEAD-013 · DEC-72
- **Problem:** `[org]/page.tsx:79-95` shows the owner's empty state to anyone with no visible projects; any member can create projects.
- **Why it matters:** stray projects that count against `activeProjects`.
- **Change and approach:** member empty state "You haven't been added to a project yet — ask {admins}" (+ private sample for training); org setting `projectCreation: everyone | leads_and_admins` (default everyone); `permissions.md` updated.
- **Files:** `apps/app/app/(app)/[org]/page.tsx`, `services/api/.../project/Projects.java`, org settings, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/settings/general-settings.tsx`, `docs/domain/permissions.md`.
- **Acceptance:** an invited estimator sees the member empty state; with the setting restricted, `POST /projects` → 403 for members.
- **Tests:** scenario `projects.test.ts`, `permissions.test.ts`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-33 · The sign-in splash honours reduced motion  (WP-C7)
- **Sources:** PRD-028 · DEC-52
- **Problem:** a 5.3 s logo animation after each sign-in (`splash.tsx:10-13`); skippable by click/key; P22 single session and P56 splash are settled.
- **Why it matters:** friction and motion sensitivity.
- **Change and approach:** skip the animation (show the logo statically for ≤ 300 ms) under `prefers-reduced-motion: reduce`; nothing else changes.
- **Files:** `apps/app/src/components/shell/splash.tsx`, `splash.module.css`, `splash.test.tsx`.
- **Acceptance:** with reduced motion the splash takes ≤ 300 ms.
- **Tests:** `splash.test.tsx`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-42 · Example presets hidden from customers; "Examples" and "Advanced" in the Library  (WP-C8)
- **Sources:** PRD-009, CAS-009, UX-036 · FM-121 · DEC-15, DEC-57
- **Problem:** every fresh org lists "ACME Ltd house rules", "Demo: as modelled, two slots changed", "Demo: small custom rule set", "ACME cost codes", "Demo: trade sections", "Duplex project answers" as system presets (`V5__Seed_system_presets.java:28,71` seeds `presets/**` by glob); Federation and Resolution sit beside the core three.
- **Why it matters:** looks unfinished; invites building on fake standards.
- **Change and approach:** a Flyway migration marks these presets `example` (ids unchanged); pickers, the wizard and BoQ dialogs hide examples unless "Show examples" is ticked; the Library lists them under a collapsed "Examples"; "Duplex project answers" is attached only to the sample project; Federation/Resolution under "Advanced" (`library/kinds.tsx:5`). Engine and CLI unchanged.
- **Files:** `services/api/src/main/java/db/migration/` or `src/main/resources/db/migration/` (new migration), `services/api/.../library/Library.java`, `boq/BoqInputs.java` (still accepts them — LEAD-015 policy is D-29), `apps/app/src/features/library/*`, `apps/app/src/features/setup/*`, `docs/product/features/F10-library.md`.
- **Acceptance:** fresh-org pickers show only As modelled (rule set), Uniclass 2015 (classification map), the global seed (dictionary) and the firm's own presets; `standard-style-example`, `acme-*`, `demo-*` and `project-duplex` appear only with "Show examples".
- **Tests:** scenario `library.test.ts`; e2e-java wizard.
- **Effort:** S · **Depends on:** — · **Risk:** stack baseline unaffected (fresh org defaults unchanged).

#### C-34 · The sample Duplex exists from org creation and is offered everywhere; its decisions are honest  (WP-C8)
- **Sources:** PRD-014, QS-017 · FM-11 (gap), FM-64 (part) · DEC-39, DEC-59
- **Problem:** "Try with a sample project" only on an empty dashboard (`[org]/page.tsx:85-99`); the wizard can't use it (gate hides the dashboard); criterion 12 ("on the sample Duplex") can't run; `SampleProjects.java:68-71` seeds two `contradiction … reported` decisions in the user's name.
- **Why it matters:** the best learning asset disappears; the audit credits people with decisions they never made.
- **Change and approach:** create the sample (not counted, `EntitlementService.java:147`) when the org is created; offer "Explore the sample" in the projects list, the Library preview picker and the wizard; seeded decisions attributed to a system actor "boqlet sample", and the party-wall contradiction left open with a note.
- **Files:** `services/api/.../project/SampleProjects.java`, `org/Orgs.java`, `apps/app/app/(app)/[org]/page.tsx`, `apps/app/src/features/projects/*`, `apps/app/src/features/library/*` (preview picker), `docs/product/scope-and-acceptance.md` (criterion 12 note).
- **Acceptance:** a fresh org has the sample before the wizard; decisions show the system actor; the sample shows the party-wall question.
- **Tests:** scenario `projects.test.ts`, `setup.test.ts`.
- **Effort:** M · **Depends on:** — · **Risk:** a sample parse job per new org (usage events with zero billed minutes, P54 Q62).

#### C-35 · Wizard: one click for the suggested setup, choices only, no embedded editors  (WP-C8)
- **Sources:** PRD-002, CAS-006, UX-004, UX-035 · FM-62 · DEC-13, DEC-39 · verify-product PRD-002 (fast path 28 s)
- **Problem:** the required wizard runs before any model exists ("Pick a project…" empty), lists ACME/Demo presets, shows formula textareas with Names/fx/code buttons and "1.05 = 5 %", embeds full classification and dictionary editors, offers a face choice that changes nothing; publishing the suggested path uses Free's single company-preset slot for an As-modelled clone.
- **Why it matters:** first impression is a configuration exercise; P18 assumed value the build can't deliver.
- **Change and approach:** start screen: "Use the suggested setup and start" (publishes in one click) or "Make it ours" (the steps); preview defaults to the sample (C-34); choices only, formulas behind a closed "Advanced" disclosure; percentages as `%` inputs; steps 2–3 become summary cards ("Use simple trade sections", "Import your code list…", "Teach names later") linking to the Library; hide no-effect questions; system examples hidden (C-42). An unchanged As-modelled publish doesn't consume a company-preset slot (the org default points at the system preset).
- **Files:** `apps/app/src/features/setup/*`, `apps/app/app/(app)/[org]/setup/*`, `apps/app/messages/en/setup.json`, `services/api/.../billing/EntitlementService.java` (slot rule), `docs/product/features/F16-setup-wizard.md`.
- **Acceptance:** new org → working dashboard in one click; engaged path previews on the sample; no formula visible unless Advanced is opened.
- **Tests:** e2e-java `accounts.spec.ts` (both paths); scenario `setup.test.ts`.
- **Effort:** M · **Depends on:** C-34, C-42 · **Risk:** P18 stays — the gate remains for those who don't click.

#### C-36 · Wizard as specified: names worth asking, suggested codes, "in progress by", "start separately"  (WP-C8)
- **Sources:** FM-63, FM-64 · F16 status
- **Problem:** no "Suggest codes", names not filtered to those worth asking, no "setup in progress by {name}", no "Start separately"; v1-12 (first setup < 15 min) unverified.
- **Why it matters:** the wizard's engaged path is the 15-minute promise.
- **Change and approach:** names step lists only names that change a line on the preview model (from the run's name questions); "Suggest codes" maps the preview's lines to the chosen code list via the engine; a lock shows who is in setup; "Start separately" clones the draft. Run the v1-12 person check and record the time.
- **Files:** `apps/app/src/features/setup/*`, `engine/ifc_boq/rpc.py` (suggest codes), `services/api/.../library/*`, `docs/product/features/F16-setup-wizard.md`, `docs/product/scope-and-acceptance.md`.
- **Acceptance:** criterion 12 runs as written on the sample; timing recorded.
- **Tests:** e2e-java engaged path.
- **Effort:** L · **Depends on:** C-35 · **Risk:** scope — split "Suggest codes" into its own item if large.

#### C-37 · Wizard and sign-in in the poster language  (WP-C8)
- **Sources:** UX-034 · `docs/development/design-guidelines.md` (owner-confirmed, P41)
- **Problem:** the wizard is a plain working screen ("SCREEN 1 OF 10" + a 4-item side nav = two progress models); sign-in a bare centred form; the guidelines specify per-step shapes, "NO. 02 — HOW YOU MEASURE", a dimension-line progress and a poster beside the sign-in form. Onboarding already does it.
- **Why it matters:** expressive moments feel unfinished.
- **Change and approach:** reuse the onboarding frame (`Poster`, display title, `DimensionRule`) for the wizard header and sign-in; one progress model on one dimension line.
- **Files:** `apps/app/src/features/setup/setup-wizard.tsx`, `apps/app/app/(public)/sign-in/*`, existing `Poster`/`DimensionRule` components.
- **Acceptance:** wizard and sign-in match the guidelines' description.
- **Tests:** visual check; axe clean.
- **Effort:** S · **Depends on:** C-35 · **Risk:** none.

#### C-38 · One drop zone: drop IFC files, get models and versions; `.ifczip` accepted  (WP-C9)
- **Sources:** UX-012, PRD-025, CAS-022 · FM-17 · DEC-20
- **Problem:** an always-open "Model name / Discipline / Add model" form, then a second "Upload IFC" click; no drop zone (design-system lists one); `upload-button.tsx:60` `accept=".ifc"` and `upload.ts:7` `\.ifc$` while Java and the worker handle `.ifczip` (K5); the project overview empty state has no buttons.
- **Why it matters:** extra steps on the critical path.
- **Change and approach:** a drop zone per project ("Drop IFC files here or choose…"): each file creates a model named from the file (discipline detected, as today) and its first version; multiple files at once for federated sets; dropping onto an existing model row uploads a new version; `.ifc,.ifczip`; "Add empty model" in a secondary menu; empty-state CTA buttons.
- **Files:** `apps/app/src/features/models/upload-button.tsx`, `upload.ts`, `apps/app/src/features/models/*`, `apps/app/app/(app)/[org]/projects/[projectId]/*`, `apps/app/messages/en/models.json`, `projects.json`.
- **Acceptance:** drop two files → two models parsing; `.ifczip` uploads.
- **Tests:** app unit tests; e2e-java `main-flow.spec.ts`.
- **Effort:** M · **Depends on:** A-40 · **Risk:** none.

#### C-39 · Failed uploads have a reason and a next step; failed versions are visible and removable  (WP-C9)
- **Sources:** UX-011, CAS-010 · FM-19 (remove part; full list → D-32) · DEC-51
- **Problem:** FAILED pages show one sentence and no action; S13 says "could not be processed" (the specific `corrupt_file` text exists, A-32 provides the code); S14's longer hint isn't shown; failed versions use numbers and stay forever; the models list says "No version uploaded yet" after two failures; Needs you keeps "A parse job failed".
- **Why it matters:** users can't tell their file from the app, and can't clean up.
- **Change and approach:** error state with the specific reason and hint (codes from A-32) and actions "Upload a different file" (primary) and "Remove this version" (`DELETE /model-versions/{id}`, exists); models list row "v2 failed — file damaged"; failed versions labelled "failed attempt"; dismiss from Needs you; client-side STEP header sniff before upload.
- **Files:** `apps/app/src/features/models/*`, `apps/app/app/(app)/[org]/projects/[projectId]/models/*`, `apps/app/messages/en/models.json`, `errors.json`, `services/api/.../org/Attention.java` (dismiss).
- **Acceptance:** S13/S14 uploads show specific reasons with both actions; removing a failed version works.
- **Tests:** e2e-java `states.spec.ts`; scenario `model-lifecycle.test.ts`.
- **Effort:** M · **Depends on:** A-32 · **Risk:** none.

#### C-40 · File sizes and the size limit said plainly  (WP-C9)
- **Sources:** CAS-011, VER-004
- **Problem:** "Your plan's limit is reached: Model file size (MB), 62.06393051147461 of 50" in a toast, bell and email (`Models.java:165` unrounded MiB; `LimitAlerts.java:87`; `use-notification-text.ts:14`, `limit-dialog.tsx:59`); 65.1 MB on disk shown as 62.06 (MiB) against "50 MB"; a 74-byte file shows "SIZE 0 MB".
- **Why it matters:** looks broken; wrong idea ("limit reached" vs "file too big").
- **Change and approach:** one MB definition (decimal, as the plan table) everywhere; round to 1 decimal; message "This file is 65.1 MB; your plan allows files up to 50 MB" inline next to the upload; sizes < 0.1 MB shown in KB.
- **Files:** `services/api/.../model/Models.java`, `billing/LimitAlerts.java`, `apps/app/src/features/notifications/use-notification-text.ts`, `apps/app/src/components/errors/limit-dialog.tsx`, `apps/app/messages/en/notifications.json`, `models.json`.
- **Acceptance:** S10 on Free gives the message above; S14 shows "74 B".
- **Tests:** scenario `limits.test.ts`; app unit tests.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-41 · Model page: one plain summary, then the technical checks  (WP-C9)
- **Sources:** CAS-014, UX-040
- **Problem:** IFC class names (IfcFurnishingElement 61…), WARNING "Faces point inconsistently 57 elements", "Placeholder values 787", "Elements overlap 38 · 76 elements" (two numbers); READY and "View in 3D" each on their own row; header shows the setting "DETECT FROM THE FILE" instead of the detected discipline.
- **Why it matters:** worry without action.
- **Change and approach:** one summary line ("Usable: 3 checks may affect quantities — show") from the checks' quantity impact; plain class names (i18n map) with IFC name secondary; checks under "Technical checks"; labelled counts ("38 pairs · 76 elements"); one header row (title · READY · View in 3D · Generate a BoQ); "Structure (detected)".
- **Files:** `apps/app/src/features/models/*`, `apps/app/messages/en/models.json`, `engine/ifc_boq/` model summary (impact flag per check, if not present).
- **Acceptance:** Duplex version page shows the summary first.
- **Tests:** app unit tests.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-43 · Billing page: "Free" for free, every enforced limit, units  (WP-C10)
- **Sources:** PRD-027, UX-039, CAS-012 (display part) · DEC-21
- **Problem:** `billing-settings.tsx:84-88` shows "Price on request" for every plan including Free (no prices seeded, P57 — admin data); `LISTED` (`:20`) shows 8 of 11 entitlement keys; limit bars "{used} of {max}" without unit (`settings.json:107`); cells wrap ("No / limit").
- **Why it matters:** looks like a bug on a page about money.
- **Change and approach:** "Free" for a zero/no-price default plan; show every enforced limit (from `EntitlementCatalogue`); units on bars; `whitespace-nowrap`; one primary "Choose" on the recommended plan (C-53).
- **Files:** `apps/app/src/features/settings/billing-settings.tsx`, `apps/app/messages/en/settings.json`.
- **Acceptance:** Free card says "Free"; 11 limits listed.
- **Tests:** app unit test.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-44 · Limits shown before the wall: quota next to actions, reasons, archive in the dialog  (WP-C10)
- **Sources:** PRD-013
- **Problem:** the Free members page shows the invite form at Seats 1 of 1 (fails with 402); the project form can be filled before `402 activeProjects`; the limit dialog offers no "archive a project" or comparison; "Manage billing" calls a portal that echoes the return URL (`BillingController.java:59-69`).
- **Why it matters:** users do work, then hit a wall.
- **Change and approach:** quota next to the action ("1 of 1 projects"), disabled with the reason (C-52); limit dialog offers "Archive a project" (frees the slot, plans-and-limits) and the plan comparison; hide "Manage billing" until the provider interface reports a portal (D-15 stub says none).
- **Files:** `apps/app/src/features/settings/members-settings.tsx`, `apps/app/app/(app)/[org]/projects/new/page.tsx`, `apps/app/src/components/errors/limit-dialog.tsx`, `apps/app/src/features/settings/billing-settings.tsx`, `apps/app/src/api/hooks/billing.ts`.
- **Acceptance:** at the seat limit the invite form is disabled with the reason; the limit dialog offers archive.
- **Tests:** app unit tests; scenario `limits.test.ts`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-45 · Imperial says "output is metric for now"  (WP-C10)
- **Sources:** PRD-016 · FM-14, FM-61 (interim; output → D-09) · DEC-56
- **Problem:** imperial is offered at onboarding, project creation, settings and the rule-set editor (`onboarding/page.tsx:104-108`, `projects/new/page.tsx:90-92`, `general-settings.tsx:100-102`, `overview.tsx:66`) and does nothing (`worker.py:198-201` copies it to `meta.unitSystem`).
- **Why it matters:** the user's choice is silently ignored.
- **Change and approach:** helper text "Quantities are output in metric for now" next to every unit-system choice; F15 status updated.
- **Files:** the four files above, `apps/app/messages/en/*.json`, `docs/product/features/F15-i18n-units-locale.md`.
- **Acceptance:** every imperial option carries the note.
- **Tests:** app unit test.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-46 · A suspended org sees a read-only banner and no write buttons  (WP-C10)
- **Sources:** FM-71
- **Problem:** writes return `409 org_suspended`, but customer pages have no suspended state; buttons stay.
- **Why it matters:** users click and fail.
- **Change and approach:** the org payload's `status` drives a banner and a `useCanWrite()` hook that hides/disables write actions with the reason.
- **Files:** `apps/app/src/components/shell/app-shell.tsx`, `apps/app/src/api/hooks/me.ts`, write-action components.
- **Acceptance:** a suspended org shows the banner and no enabled write actions.
- **Tests:** e2e-java with an admin-suspended org.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-47 · Breadcrumbs and specific page titles  (WP-C11)
- **Sources:** UX-020, VER-003
- **Problem:** no breadcrumbs inside a project; titles "Verify FE · boqlet" on New project and every Library editor; model and model-version pages have the bare title "boqlet".
- **Why it matters:** hard to tell where you are; tabs indistinguishable (WCAG 2.4.2 good practice).
- **Change and approach:** Breadcrumb under the top bar on project routes ("Duplex (sample) › Models › Duplex architecture › v1"); `generateMetadata` titles per route ("v1 · Duplex architecture · Duplex (sample)", "ACME cost codes · Library", "New project").
- **Files:** `apps/app/app/(app)/[org]/**/page.tsx` / `layout.tsx` (metadata), `apps/app/src/components/ui/breadcrumb.tsx` (new), `apps/app/src/components/shell/*`.
- **Acceptance:** every route has a distinct title; project routes show breadcrumbs.
- **Tests:** e2e-java title crawl.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-48 · Account and Notifications inside the app shell  (WP-C11)
- **Sources:** UX-022 · verify-frontend UX-022 (low)
- **Problem:** `/account` and `/notifications` lack the left nav; `/notifications` has no `main` (axe `landmark-one-main`, `region` ×4).
- **Why it matters:** dead-end pages.
- **Change and approach:** render both inside the org shell (last org), with `<main>`; notification rows already link to their subject.
- **Files:** `apps/app/app/(app)/account/page.tsx`, `apps/app/app/(app)/notifications/page.tsx`, shell layout.
- **Acceptance:** both pages have the nav; axe clean.
- **Tests:** axe gate (B-06).
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-49 · Notifications and emails say what happened to what; the model-ready email is sent  (WP-C11)
- **Sources:** CAS-026, UX-023, LEAD-019, VER-005 · FM-50 · DEC-19
- **Problem:** "A job failed", "A job finished" with no file or project; emails "Processing failed. Open in boqlet: <link>" and generic subjects (`EmailDelivery.java:195-208`); a limit notice timestamped "in 2 seconds"; unread dot in brand purple; toast action grey; `model_version.ready` is sent with `category = null` so no email ever goes out (`worker/Jobs.java:360-380`, `realtime/Notifications.java:46-48`); F13 asks for it after > 2 min parses.
- **Why it matters:** with 20+ projects people can't triage without opening each.
- **Change and approach:** templates name the subject and reason ("Garage v2 (S13-truncated.ifc) could not be read: file damaged — Duplex on Elm St"); subjects carry project · BoQ · version; review emails include the submitter's message and open-question count; give `model_version.ready` a category and send the email when the parse took > 2 min; fix the future timestamp (server time skew → clamp); ink unread dot; toast action `outline`.
- **Files:** `services/api/.../mail/EmailDelivery.java`, `realtime/Notifications.java`, `worker/Jobs.java`, `apps/app/src/features/notifications/*`, `apps/app/messages/en/notifications.json`, `docs/product/features/F13-notifications.md`.
- **Acceptance:** MailHog shows specific subjects; a 3-minute parse sends a ready email; bell entries name file and project.
- **Tests:** JUnit for the category path; scenario `events.test.ts`/notifications; app unit tests.
- **Effort:** M · **Depends on:** — · **Risk:** email volume — respect category preferences.

#### C-50 · Dashboard: project cards with BoQ state; "Needs you" links named by their subject  (WP-C11)
- **Sources:** UX-018, LEAD-023, UX-038 · DEC-30
- **Problem:** card labels collide ("QUESTIONSIN REVIEW", `project-card.tsx:38-50`), "Questions" counts blocking only (0 while the BoQ has 2 open); no confirmed/working counts (F02 §5); every Needs-you control is "Open" (WCAG 2.4.9).
- **Why it matters:** the landing page contradicts the BoQ tab; a lead can't see what's done.
- **Change and approach:** label/value rows; "Questions 2 (0 blocking)"; BoQs confirmed/working and last saved label; the row title is the link ("Structure BoQ needs answers").
- **Files:** `apps/app/src/features/projects/project-card.tsx`, `apps/app/app/(app)/[org]/page.tsx`, `services/api/.../project/*` (counts), `packages/api/openapi.yaml` + `npm run api:gen` if counts are added.
- **Acceptance:** no label collision at any width; counts match the BoQ tabs.
- **Tests:** app unit tests; axe.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-51 · Project activity names its subject  (WP-C11)
- **Sources:** UX-041
- **Problem:** "Answered a question" ×2 with no subject (`projects.json:128`); timestamps wrap.
- **Why it matters:** activity can't be used to find what changed.
- **Change and approach:** include and link the subject ("Answered 'Party Wall – thickness' in Duplex quantities"), relative time with absolute tooltip, `whitespace-nowrap`.
- **Files:** `apps/app/src/features/projects/*`, `apps/app/messages/en/projects.json`, `services/api/.../audit/*` (subject in the activity payload).
- **Acceptance:** each activity row names and links its subject.
- **Tests:** app unit tests.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-52 · A Tooltip component and visible reasons for disabled actions  (WP-C12)
- **Sources:** UX-013, UX-014 · DEC-30, DEC-48
- **Problem:** 155 `title=` tooltips, no Tooltip component (`components/ui/` has 12 files); dashed disabled buttons with nothing nearby ("Create project", "Add model", "Create and generate" with a placeholder that looks filled, "Create", "Preview", "Four eyes").
- **Why it matters:** hover-only hints; users don't know what's missing.
- **Change and approach:** add the shadcn/Base UI Tooltip (hover + focus, Esc, WCAG 1.4.13) and use it for icon buttons, truncated cells and edit markers; visible helper text next to disabled primaries; inline validation (`aria-invalid` + `aria-describedby`) and required markers; placeholders that don't look like values.
- **Files:** `apps/app/src/components/ui/tooltip.tsx` (new), forms across `apps/app/src/features/*`, `docs/development/design-system.md`.
- **Acceptance:** every disabled primary has a visible reason; `title=` count < 20 (legitimate long names).
- **Tests:** axe; app unit tests on key forms.
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### C-53 · One primary per screen; one checkbox look; inputs at control height  (WP-C12)
- **Sources:** UX-015, UX-016, UX-017 · DEC-49
- **Problem:** two or three purple buttons on the empty dashboard, billing ("Choose" ×3) and Exports; 35 of 43 native checkboxes/radios unstyled (browser blue reads as the status blue); inputs `h-7 bg-input/20 md:text-xs` (28 px, grey fill reads disabled) next to 32 px buttons.
- **Why it matters:** "purple = next step" weakens; misaligned toolbars.
- **Change and approach:** hide the header button while the empty card shows; plan "Choose" `outline` except the recommended; "Export Excel" `outline`; global `accent-color: var(--foreground)` (or Checkbox/RadioGroup components); inputs `h-8 text-[13px] bg-background`.
- **Files:** `apps/app/app/(app)/[org]/page.tsx`, `apps/app/src/features/settings/billing-settings.tsx`, `apps/app/src/features/exports/exports-tab.tsx`, `apps/app/app/globals.css`, `apps/app/src/components/ui/input.tsx`.
- **Acceptance:** one primary per screen on the audited screens; uniform controls.
- **Tests:** visual check; e2e-java screenshot diff (optional).
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-54 · One `StatusTag` with one vocabulary  (WP-C12)
- **Sources:** UX-019
- **Problem:** BLOCKING uses the filled-ink tag reserved for Confirmed (`questions-tab.tsx:220`); share WORKING outlined in orange.
- **Why it matters:** one status, several looks.
- **Change and approach:** `<StatusTag kind=…>` with a single map (BLOCKING → orange fill, ink text; WORKING → ink outline; Confirmed → filled ink); used by the sheet gutter (C-02), questions, share page.
- **Files:** `apps/app/src/components/ui/status-tag.tsx` (new), call sites.
- **Acceptance:** every status tag comes from the component.
- **Tests:** app unit test of the map.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-55 · Viewer colours from the design tokens; a dark-mode viewer  (WP-C12)
- **Sources:** UX-005, UX-006
- **Problem:** `viewer/links.ts:84-90` measured green `0x9fc29a`, Tableau `PALETTE`, unmatched red `0xd9534f`; `scene-view.ts:31-40` selection blue/orange; `scene-view.ts:76` `setClearColor(0xf2f0ea)`; dark mode toolbar icons invisible (transparent outline buttons over the light canvas).
- **Why it matters:** the most-seen colour breaks the brand ("no green"); dark-mode users lose controls (WCAG 1.4.11).
- **Change and approach:** `viewerPalette()` reads CSS tokens at runtime (coverage → `--data-ink-mid`/`--data-ink-pale`/`--status-attention`/`--data-blue-pale`; selection → `--highlight`; code groups → the guidelines' 15-step data palette); clear colour from `--background`/`--card`, re-applied on theme change (`next-themes`); toolbar buttons with `text-foreground` and outline tokens.
- **Files:** `apps/app/src/features/viewer/links.ts`, `scene-view.ts`, `model-viewer.tsx`, `apps/app/app/globals.css`.
- **Acceptance:** no hard-coded colours in `features/viewer`; dark mode toolbar contrast ≥ 3:1.
- **Tests:** `links.test.ts` for the palette mapping.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-56 · Axe findings fixed and the 390 px chrome made to fit  (WP-C12)
- **Sources:** UX-042, UX-043 · FM-104, FM-110 · DEC-71
- **Problem:** serious `scrollable-region-focusable` in the dictionary editor; `landmark-unique` on 15 scans; `heading-order` (BoQ title `h2`, detail `h4`, share page); `page-has-heading-one` (dashboard); `landmark-one-main`/`region` (Notifications); `empty-table-header` ×6; at 390 px dashboard scrollWidth 454–493 (theme and avatar clipped).
- **Why it matters:** nfr.md gate "no serious/critical"; screen-reader navigation; emailed links opened on phones.
- **Change and approach:** `tabIndex={0}` + `role="region"` + `aria-label` on the scroll container; label each `aside`/`nav`; headings h1 → h2 → h3; dashboard `h1` (visually hidden); `sr-only` text in icon/checkbox headers; below 640 px hide the org name, move theme into the avatar menu, stack Needs-you rows. Shrink the B-06 allow-list to empty.
- **Files:** `apps/app/src/features/library/dictionary/*`, `apps/app/src/components/shell/*`, `apps/app/app/(app)/[org]/page.tsx`, table components, `apps/app/src/features/shares/public-share.tsx`.
- **Acceptance:** the B-06 axe sweep reports 0 serious/critical and an empty allow-list; no horizontal scroll at 390 px on dashboard/sheet/questions/library.
- **Tests:** B-06 gate.
- **Effort:** M · **Depends on:** B-06 · **Risk:** none.

#### C-57 · Long lists virtualised: Log, Decisions, Activity, Audit  (WP-C12)
- **Sources:** UX-025
- **Problem:** the Duplex Log page is 13,034 px, S08 Log 10,254 px; only the sheet uses `useVirtualizer`.
- **Why it matters:** the Log is the audit tool and should be fast.
- **Change and approach:** TanStack Virtual list with sticky header, "N of M entries" and sticky filters.
- **Files:** `apps/app/src/features/boq-sheet/log-tab.tsx`, `apps/app/src/features/decisions/decisions-table.tsx`, `apps/app/src/features/audit/*`, `apps/app/src/features/projects/*` (activity).
- **Acceptance:** Log page height = viewport; scroll smooth on S08.
- **Tests:** app unit tests.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### C-58 · One microcopy pass over Library, wizard and sheet  (WP-C12)
- **Sources:** UX-029
- **Problem:** raw slugs ("Based on: standard-style-example"), "two slots changed", "master template", sheet filter "FAMILY" (means quantity family), "Leave it", "Move to a ACME cost codes section", "Address", "Clone" vs "Make a copy".
- **Why it matters:** each small, together they make an engineer's tool (design-system principle 4).
- **Change and approach:** preset names instead of slugs; "Family" → "Measured as"; "Leave it" → "Dismiss"; one verb "Make a copy"; ICU `select` for articles; glossary tooltips for "slot", "rule set", "dictionary" (C-52 Tooltip).
- **Files:** `apps/app/messages/en/*.json`, `apps/app/src/features/library/*`, `apps/app/src/features/boq-sheet/*`.
- **Acceptance:** none of the listed strings remain.
- **Tests:** pseudo-locale run (B-06).
- **Effort:** S · **Depends on:** C-52 · **Risk:** none.

#### C-59 · Presence avatars tell people apart  (WP-C12)
- **Sources:** LEAD-022 · verify-frontend LEAD-022 (names exist in `title` and `sr-only`)
- **Problem:** Erin Estimator and Ezra Estimator both "EE".
- **Why it matters:** unclear who else is editing in a large team.
- **Change and approach:** a stable per-user colour from the data palette plus a Tooltip with the name (C-52); disambiguate initials (first name + surname letter) when they collide.
- **Files:** `apps/app/src/features/boqs/presence.tsx`.
- **Acceptance:** two "EE" users render distinguishably.
- **Tests:** app unit test.
- **Effort:** S · **Depends on:** C-52 · **Risk:** none.

### Phase D — planned-but-missing features and features the reviews found necessary

Every feature-matrix row with status missing, partial, diverges or spec questionable that no A/B/C item covers is
here (coverage table, section 7). Subscription and quota logic is built behind a payment-provider interface with a
stub (DEC-04). The pricing module comes last (DEC-03). Large items may be split by the session that takes them
(execution rule 5).

#### D-01 · Accuracy validated against professional BoQs  (WP-D1)
- **Sources:** PRD-007 · FM-83 · DEC-76 · 04 §4, 05 "Realistic time saved"
- **Problem:** the only reference is the Duplex hand BoQ (walls circular until B-03); `known-limitations.md:18` calls accuracy on real projects "the biggest open question"; O1/O3 marked "Built".
- **Why it matters:** selling the outcome before proving it; first pilots become the QA.
- **Change and approach:** a validation harness `engine/tests/reference/` that runs 2–3 reference projects (models + a QS's BoQ as answer key, obtained from pilot firms with permission; kept out of the repo if not licence-clean, fetched by SHA like the review samples) and produces a per-family accuracy table (walls, slabs, openings, formwork, steel, finishes) in `docs/testing/engine-validation.md`; differences explained per line; gate marketing claims on it (overview wording, B-17).
- **Files:** `engine/tests/reference/` (new), `docs/testing/engine-validation.md`, `docs/product/known-limitations.md`, `docs/product/overview.md`.
- **Acceptance:** at least two projects compared, each family within a stated tolerance or listed as a known gap with an item.
- **Tests:** the harness (manual/nightly, not a deploy gate).
- **Effort:** L · **Depends on:** A-09, A-10, A-14, B-03 · **Risk:** depends on obtaining reference BoQs (owner/pilot firms); until then the item is blocked, not skipped.

#### D-02 · Concrete frame items: columns and beams in m³ with formwork and a rebar estimate  (WP-D1)
- **Sources:** QS-015 · verify-engine QS-015 (m³ via "Other members measured by: Volume", one switch for timber and concrete)
- **Problem:** non-steel beams/columns go to `linear-other` by length (S08 "IfcColumn, 450 x 450mm 3.0 m"); no item gives concrete volume, formwork or rebar for frames.
- **Why it matters:** in-situ frames are a main cost item.
- **Change and approach:** `columns-concrete` / `beams-concrete` items (m³) keyed on `material under concrete`, derived formwork from vertical faces (A-10's field) and a rebar estimate slot (kg/m³), with slots in `as-modelled.json`; timber keeps the length/volume switch.
- **Files:** `presets/rules/as-modelled.json`, `presets/rules/standard-style-example.json`, `engine/ifc_boq/measure.py` (faces for members), `docs/architecture/rules-language.md`.
- **Acceptance:** S08 450×450 column = 0.6075 m³ with formwork 5.4 m²; S02 column (if concrete) in m³.
- **Tests:** engine test; verify-quantities gets an S08 column-volume check.
- **Effort:** M · **Depends on:** A-10 · **Risk:** baseline lines move from linear-other to the new items (expected).

#### D-03 · Steel section tables as data (UB/UC/IPE/HE/PFC/CHS/SHS)  (WP-D1)
- **Sources:** FM-86 · QS-012 (section part)
- **Problem:** kg/m only from metric W names (`measure.py:93-107`); "AS 200UB25.4" goes through volume × 7850.
- **Why it matters:** most non-US steel mass is approximate.
- **Change and approach:** `engine/ifc_boq/data/sections.json` (family, designation pattern, kg/m) from public, non-licensed sources (manufacturer tables, own computation from dimensions; no standard text, rule 8); a generic "kg/m in the designation" parser; dictionary terms for section families.
- **Files:** `engine/ifc_boq/data/sections.json` (new), `engine/ifc_boq/measure.py`, `docs/domain/sourcing-and-licensing.md` (source note).
- **Acceptance:** S08 UB members use 25.4 kg/m; unknown sections fall back with a note.
- **Tests:** engine table tests.
- **Effort:** M · **Depends on:** A-17 · **Risk:** licensing of tables — compute from dimensions where in doubt.

#### D-04 · More contradiction kinds (IsExternal, material) and `classification_conflict` answers that act  (WP-D1)
- **Sources:** FM-95 (rest; area part → A-03) · QS-007 (contradiction warning extended)
- **Problem:** `measure.py` asks thickness and volume (area after A-03); no IsExternal/material contradictions; `classification_conflict` answers don't act.
- **Why it matters:** would have caught QS-007-type issues.
- **Change and approach:** contradictions between IsExternal and the dictionary term (`wall.external`), between material layer names and the type name's material; `classification_conflict` answers choose the code (stored as a decision; classification only, rule 6).
- **Files:** `engine/ifc_boq/measure.py`, `engine/ifc_boq/classify.py`, `packages/types/src/engine.ts` + codegen, `apps/app/messages/en/engine.json`.
- **Acceptance:** S01/S09 external walls with an internal term raise one question; answering changes only codes.
- **Tests:** engine tests; rule-6 check (quantities identical).
- **Effort:** M · **Depends on:** A-03, A-21 · **Risk:** question noise — deterministic ids, grouped by type.

#### D-05 · Building gross volume from the envelope  (WP-D1)
- **Sources:** FM-92 · QS-001 (poisoned building values), 04 §4
- **Problem:** `building.gross_volume` = slab area × storey height (`rules-language.md:204-209`); per-100 m³ items and cost/m³ benchmarks rely on it.
- **Why it matters:** wrong benchmarks; S09 showed 443,773 m³.
- **Change and approach:** compute from the union of external elements' bounding envelope per storey (or the IfcSpace volumes when complete), with the old method as fallback and the method logged.
- **Files:** `engine/ifc_boq/measure.py` / `pipeline.py` (building values), `docs/architecture/rules-language.md`.
- **Acceptance:** Duplex gross volume within 5 % of a hand estimate; method in the log.
- **Tests:** engine test.
- **Effort:** M · **Depends on:** A-02 · **Risk:** building-derived lines move in the baseline (expected).

#### D-06 · Names at scale: per-language seeds and a bSDD lookup  (WP-D2)
- **Sources:** PRD-006, QS-022 (scale part) · FM-27 · DEC-14
- **Problem:** `global-seed.json` has 56 terms / 68 entries; S07 61 blocking names; "most needs-input results on real files are a name" (known-limitations); no decided approach for local languages (Q8).
- **Why it matters:** "minutes, not days" depends on it.
- **Change and approach:** per-language seed dictionaries (en, de, nl, fr, sr…; own words, no licensed lists) as system presets; an optional bSDD lookup (buildingSMART's public API) behind an rpc op that proposes terms with the bSDD class as evidence, user confirms; record the approach as an answer to Q8.
- **Files:** `presets/dictionaries/*.json`, `engine/ifc_boq/names.py`, `engine/ifc_boq/rpc.py`, `services/api/.../model/Models.java` (lookup endpoint), `packages/api/openapi.yaml` + `npm run api:gen`, `docs/product/open-questions.md`.
- **Acceptance:** S07 blocking names reduced by ≥ 50 % with the English seed; a Dutch model's names resolve with the nl seed.
- **Tests:** `test_names.py` with `messy_names.json`; corpus run.
- **Effort:** L · **Depends on:** C-16, A-33 · **Risk:** outbound calls to bSDD — opt-in per org, cached, no project data sent beyond the name.

#### D-07 · AI name suggestions with confirmation  (WP-D2)
- **Sources:** FM-26
- **Problem:** dictionary type has AI settings (`dictionary.ts:159-165`), nothing implemented.
- **Why it matters:** the long tail of names after seeds and bSDD.
- **Change and approach:** an optional provider-agnostic suggester (org opt-in; model provider configured by the operator) proposing a term with a confidence and a reason; never auto-applied; answers logged as user decisions; no project data beyond names.
- **Files:** `engine/ifc_boq/names.py` (suggester interface), `services/api/.../library/*`, `apps/app/src/features/questions/*`, `docs/architecture/security.md` (data sent).
- **Acceptance:** suggestions appear as chips; nothing applies without a click.
- **Tests:** suggester interface with a fake provider.
- **Effort:** M · **Depends on:** D-06 · **Risk:** data-protection review before enabling on the pilot.

#### D-08 · UI languages beyond English; emails follow the UI locale; engine log messages translatable  (WP-D2)
- **Sources:** FM-59, FM-49, FM-60 · DEC-69
- **Problem:** catalogues `en`, `en-XA` only; emails English and Serbian while the UI is English; no `log.*` keys in `messages/en/engine.json`.
- **Why it matters:** international product (P35); consistency.
- **Change and approach:** a second UI language end to end (pick by pilot demand; translations as data in `apps/app/messages/<lang>`); email language = user's UI locale; engine log entries get codes + params and `log.*` keys.
- **Files:** `apps/app/messages/*`, `services/api/.../mail/EmailDelivery.java`, `engine/ifc_boq/log.py`, `apps/app/src/i18n/engine-message.ts`, `docs/product/features/F13-notifications.md`, `F15-i18n-units-locale.md`.
- **Acceptance:** pseudo-locale shows no raw engine log text; a second locale passes the B-06 run.
- **Tests:** pseudo-locale e2e; engine log code test.
- **Effort:** L · **Depends on:** B-06 · **Risk:** translation quality — owner review.

#### D-09 · Imperial output  (WP-D2)
- **Sources:** FM-14, FM-61, PRD-016 · DEC-56
- **Problem:** the project unit system is stored and ignored (`worker.py:198-201`).
- **Why it matters:** US/part of UK/ME buyers.
- **Change and approach:** with the unit registry (A-28), output units per org/project unit system (ft, ft², ft³, yd³, lb/ton), rounding steps per unit, Excel and share page in the chosen units; engine computes in SI and converts at output only.
- **Files:** `engine/ifc_boq/rules.py`, `export_xlsx.py`, `packages/types/src/*` + codegen, `apps/app/src/features/boq-sheet/*`, `docs/product/features/F15-i18n-units-locale.md`.
- **Acceptance:** a Duplex BoQ in imperial equals the metric one converted; C-45 note removed.
- **Tests:** engine conversion tests; a scenario test.
- **Effort:** M · **Depends on:** A-28 · **Risk:** rounding differences — documented.

#### D-10 · Terms and privacy pages, acceptance at sign-up  (WP-D3)
- **Sources:** PRD-018 (legal part) · FM-04
- **Problem:** no terms or privacy route in `app/(public)`; no acceptance in sign-up.
- **Why it matters:** legal blocker the day public sign-up opens (P57 makes that a switch).
- **Change and approach:** `/terms`, `/privacy` rendering owner-supplied Markdown (placeholder until supplied); acceptance checkbox with version stored per user (`terms_version`, timestamp); re-acceptance on change; the admin "open public sign-up" switch warns while the texts are placeholders.
- **Files:** `apps/app/app/(public)/terms/page.tsx`, `privacy/page.tsx` (new), sign-up forms, `services/api/.../identity/*`, a Flyway migration, `packages/api/openapi.yaml` + `npm run api:gen`.
- **Acceptance:** sign-up refuses without acceptance; acceptance audited.
- **Tests:** `NativeAuthTest`; e2e-java `sign-up.spec.ts`.
- **Effort:** S · **Depends on:** — · **Risk:** texts are the owner's — never invent legal text.

#### D-11 · In-product help, a short guide and a support contact  (WP-D3)
- **Sources:** PRD-018 · FM-119
- **Problem:** no `mailto:` or support address, no help keys; "contact us" is plain text (`errors.json:63`).
- **Why it matters:** a stuck self-serve user has nowhere to go.
- **Change and approach:** a Help menu in the shell (guide, "How boqlet measures", support email from a platform setting), contextual help links on Questions and Billing; the guide is in-app Markdown from `docs/product/guides/` adapted for users.
- **Files:** `apps/app/src/components/shell/*`, `apps/app/app/(app)/help/*` (new), platform settings (`admin/*`), `apps/app/messages/en/shell.json`.
- **Acceptance:** support address reachable from every page; checkout error links to it.
- **Tests:** e2e-java.
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### D-12 · Bot protection measured on the server  (WP-D3)
- **Sources:** FM-03
- **Problem:** hidden field + 3 s minimum fill time measured by the client (`native-links.tsx:122` → `NativeAuthController.java:53-56`) + throttling.
- **Why it matters:** trivially bypassed once public sign-up opens.
- **Change and approach:** server-issued signed form token with issue time (fill time measured server-side); optional proof-of-work or a pluggable captcha provider interface (stub by default; P57 "upgrade later").
- **Files:** `services/api/.../identity/NativeAuthController.java`, `apps/app/src/auth/adapters/native-links.tsx`, `packages/api/openapi.yaml` + `npm run api:gen`.
- **Acceptance:** a sign-up with a forged `elapsedMs` is refused.
- **Tests:** `NativeAuthTest`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### D-13 · Sessions: the takeover prompt names the place; configurable idle expiry  (WP-D3)
- **Sources:** FM-06, FM-07
- **Problem:** `Sessions.java` selects `place` but nothing writes it; idle expiry hard-coded `interval '12 hours'` (`Sessions.java:36,102,116`).
- **Why it matters:** the P22 prompt promises "where the account is open"; orgs want shorter expiry.
- **Change and approach:** write a coarse place (browser + OS from User-Agent; no IP geolocation) at sign-in; idle expiry from a platform setting with an org override within bounds.
- **Files:** `services/api/.../identity/Sessions.java`, `NativeAuthController.java`, admin settings, org settings, `packages/api/openapi.yaml` + `npm run api:gen`.
- **Acceptance:** takeover prompt shows "Chrome on Windows"; expiry follows the setting.
- **Tests:** `AccountSecurityTest`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### D-14 · `ownedOrgsPerUser` enforced on ownership transfer  (WP-D3)
- **Sources:** FM-08 · DEC-70
- **Problem:** `checkOwnedOrgs` only on org create (`Orgs.java:63`); role change to owner (`:162-175`) doesn't check; F01 and plans-and-limits disagree.
- **Why it matters:** the limit is bypassed by transfer.
- **Change and approach:** check on promotion to owner and on transfer; `402 limit_reached`; align `plans-and-limits.md`.
- **Files:** `services/api/.../org/Orgs.java`, `docs/product/plans-and-limits.md`.
- **Acceptance:** transferring ownership to a Free user who owns an org → 402.
- **Tests:** scenario `limits.test.ts`.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### D-15 · `PaymentProvider` interface with a stub; checkout, portal and webhooks go through it  (WP-D4)
- **Sources:** FM-52, FM-76 (webhook audit part) · DEC-04 · PRD-003
- **Problem:** `BillingController.java:52-75`: checkout `409 checkout_unavailable`, portal echoes the return URL, webhook `400 unsupported_provider`; no failed-webhook audit.
- **Why it matters:** every subscription feature needs one seam; real provider integration is out of scope.
- **Change and approach:** `billing/PaymentProvider` (createCheckout, portalUrl, parseWebhook, cancel) with `StubPaymentProvider` (records intents, "manual billing" portal page, signed test webhooks for local/CI); provider chosen by config; webhook failures audited and counted for the admin health tile (D-57); no real provider code.
- **Files:** `services/api/.../billing/*` (new interface + stub), `BillingController.java`, `application.yml`, `packages/api/openapi.yaml` (if responses change) + `npm run api:gen`, `docs/architecture/backend.md`, `docs/product/features/F14-entitlements-and-billing.md`.
- **Acceptance:** with the stub, "Choose" records an intent and shows the manual-billing message with a contact; a signed stub webhook changes a subscription; an invalid one is audited.
- **Tests:** JUnit for the stub; scenario `billing.test.ts`.
- **Effort:** M · **Depends on:** — · **Risk:** none (no provider).

#### D-16 · Trials and passes from plan configuration, with an expiry job  (WP-D4)
- **Sources:** PRD-004, PRD-003, PRD-019, CAS-012 (pass part) · FM-53 · DEC-55
- **Problem:** a trial is `trial_ends_at` + status only (`AdminOrganisations.java:120-147`); plan unchanged; no scheduler expires it; no way to express a time-boxed single-project pass.
- **Why it matters:** buyers can't evaluate team features; manual trials leak.
- **Change and approach:** plan config `trialPlanId`, `trialDays` (sign-up starts the trial if set); a subscription can have `endsAt` with `fallbackPlanId`; a daily `@Scheduled` job ends trials/passes, notifies 7 and 1 days before, and applies D-17's downgrade; admin can grant a pass (plan + end date).
- **Files:** `services/api/.../billing/*`, `admin/AdminOrganisations.java`, a Flyway migration, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/admin/*`, `apps/app/src/features/settings/billing-settings.tsx`, `docs/product/plans-and-limits.md`.
- **Acceptance:** an org on a 14-day Team trial falls back to Free on day 15 with notices; a pass expires the same way.
- **Tests:** scenario `plans.test.ts` with a clock override.
- **Effort:** M · **Depends on:** D-15 · **Risk:** time zones — UTC dates.

#### D-17 · Downgrade handling: excess becomes read-only, invites blocked, users told  (WP-D4)
- **Sources:** PRD-004 · FM-54
- **Problem:** orgs already sit over their limits (Free with 2/1 seats); plans-and-limits specifies read-only excess projects and no new invites; not built.
- **Why it matters:** predictable downgrade behaviour to communicate.
- **Change and approach:** on a lower plan: oldest-active projects beyond `activeProjects` become read-only (archive-like, reversible), invites blocked while over seats, banners naming what to do; no deletion (P57).
- **Files:** `services/api/.../billing/EntitlementService.java`, `project/Projects.java`, `apps/app/src/components/shell/*` (banner), `docs/product/plans-and-limits.md`.
- **Acceptance:** downgrade of an org with 3 projects to a 1-project plan leaves 1 writable, 2 read-only, all data intact.
- **Tests:** scenario `limits.test.ts`.
- **Effort:** M · **Depends on:** D-16 · **Risk:** which projects stay writable — let the owner choose within a grace period.

#### D-18 · Plan versions (grandfathering)  (WP-D4)
- **Sources:** FM-56
- **Problem:** a plan change applies to every org at once (P57).
- **Why it matters:** price and limit changes can't respect existing customers' terms.
- **Change and approach:** plans get versions; a subscription points at a plan version; admin edits create a new version with "apply to existing orgs: now / at renewal / never" (default now, as P57 today).
- **Files:** `services/api/.../billing/*`, a Flyway migration, `apps/app/src/features/admin/plans.tsx`, `docs/product/plans-and-limits.md`, `docs/decisions.md` (refines P57).
- **Acceptance:** an org on plan v1 keeps v1 limits when v2 is published with "never".
- **Tests:** scenario `plans.test.ts`.
- **Effort:** M · **Depends on:** D-15 · **Risk:** migration of current plans to v1.

#### D-19 · An upgrade request that reaches the operator  (WP-D4)
- **Sources:** PRD-003, CAS-012 · FM-118
- **Problem:** `createCheckout` throws before writing anything; "contact us" has no link; the operator never sees the intent (unlike `limit_events`).
- **Why it matters:** upgrade intent is lost.
- **Change and approach:** "Request this plan" records an `upgrade_request` (org, plan, user, message), emails the operator address, shows in the admin org page and a list; the user sees "requested on …".
- **Files:** `services/api/.../billing/*`, `admin/*`, `mail/EmailDelivery.java`, a Flyway migration, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/settings/billing-settings.tsx`, `apps/app/src/features/admin/*`.
- **Acceptance:** a Free owner's request appears in `/admin`.
- **Tests:** scenario `billing.test.ts`.
- **Effort:** S · **Depends on:** D-15 · **Risk:** none.

#### D-20 · Seats counted by role (reviewer/viewer seats as plan data)  (WP-D5)
- **Sources:** LEAD-011 · DEC-55
- **Problem:** `EntitlementService.seats` (`:139-144`) counts every membership and pending invitation; viewers and approvers cost as estimators; Team 25 seats.
- **Why it matters:** a 20–30 estimator team needs 30–40 seats.
- **Change and approach:** new entitlement `seatRoles` (which org/project roles count; default all, as today) in `EntitlementCatalogue`; admin plan editor exposes it; billing page explains.
- **Files:** `services/api/.../billing/EntitlementCatalogue.java`, `EntitlementService.java`, `apps/app/src/features/admin/plans.tsx`, `docs/product/plans-and-limits.md`.
- **Acceptance:** a plan with `seatRoles` excluding viewers lets a viewer join beyond the seat count.
- **Tests:** scenario `limits.test.ts`.
- **Effort:** S · **Depends on:** — · **Risk:** project-role-only viewers — define "viewer seat" as an org member whose highest project role is viewer.

#### D-21 · Admin revenue and "orgs on a paid plan"  (WP-D5)
- **Sources:** PRD-011 · FM-55
- **Problem:** `AdminReports.java:73-85`: "Paying organisations" = `plan_id <> 'free' AND status = 'active'` (excludes trials, breaks if another plan is default); revenue always empty.
- **Why it matters:** operator metrics mislabelled.
- **Change and approach:** "Orgs on a priced plan" from plan price > 0 (and trials separately); revenue = sum of active subscriptions' plan prices per period (shown, not charged, P57); comped status.
- **Files:** `services/api/.../admin/AdminReports.java`, `apps/app/src/features/admin/overview.tsx`, `docs/product/features/F19-platform-admin.md`.
- **Acceptance:** tiles reflect configured prices; trials listed separately.
- **Tests:** scenario `admin.test.ts`.
- **Effort:** S · **Depends on:** D-15 · **Risk:** none.

#### D-22 · Usage over time, per member, as CSV; minutes defined as processing time  (WP-D5)
- **Sources:** LEAD-017 · FM-57 · DEC-66
- **Problem:** `UsageResponse` = month, byProject, byKind; the page passes no month (`usage-settings.tsx:15`) although the API accepts `?month=`; no per-person view or export; minutes are engine `durationMs` while plans-and-limits says wall-clock.
- **Why it matters:** leads can't see adoption or plan seats.
- **Change and approach:** 12-month history chart and month picker; per-member breakdown (runs, edits, saved versions); CSV; plans-and-limits states minutes = processing time.
- **Files:** `services/api/.../billing/*` (usage), `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/settings/usage-settings.tsx`, `docs/product/plans-and-limits.md`.
- **Acceptance:** usage page shows 12 months and per-member rows; CSV downloads.
- **Tests:** scenario `billing.test.ts`; `usage-settings.test.ts`.
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### D-23 · Pilot success measures instrumented; funnel in minutes  (WP-D5)
- **Sources:** PRD-017 · FM-84
- **Problem:** of six measures in `overview.md` three are "No"; funnel medians in hours (`AdminReports.java:121-129`, `funnel.tsx:20-21`) show "0 h".
- **Why it matters:** the pilot can't answer Q1/Q2.
- **Change and approach:** per run: % lines measured vs flagged, questions per model version, time from upload to first saved version, regeneration per revision; aggregated in the admin console (metadata only, P27); funnel in minutes.
- **Files:** `services/api/.../admin/AdminReports.java`, `apps/app/src/features/admin/funnel.tsx`, `docs/product/overview.md` ("How we know").
- **Acceptance:** each overview measure has a source or is marked as a person check.
- **Tests:** scenario `admin.test.ts`.
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### D-24 · Consistent answers across projects: conflicts shown, non-name answers promotable as proposals  (WP-D6)
- **Sources:** LEAD-003 · DEC-43
- **Problem:** two estimators answered the same S09 names differently (House A 68,713.56 m³ concrete line, House B none); `promote` accepts name answers only (`Decisions.java:141` `not_promotable`).
- **Why it matters:** the same model gives different BoQs to different people.
- **Change and approach:** when answering, show "this name was answered differently in project X"; an org report of conflicting answers (same question id, different answers); estimators can *propose* promotion of any answer; library editors accept name answers into the org dictionary and contradiction preferences into resolution settings.
- **Files:** `services/api/.../boq/Decisions.java`, `library/*`, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/questions/*`, `apps/app/src/features/library/*`.
- **Acceptance:** the House A/B repro shows the conflict in both projects and in the org report.
- **Tests:** scenario `questions.test.ts`.
- **Effort:** M · **Depends on:** A-43 · **Risk:** cross-project reads — only for users who can see both, or anonymised counts.

#### D-25 · An audit that says what changed: before/after values, answer history, `edits.imported`  (WP-D6)
- **Sources:** LEAD-006 · FM-38
- **Problem:** `decision.set {kind, questionId}`, `line.edited {lineKey}`, `preset.published {kind}`, `revision.submitted {reviewers:1}`; decisions list/CSV read `superseded_at IS NULL` only (`Decisions.java:189`); action names differ from F09 §6; no `edits.imported`.
- **Why it matters:** "who changed this quantity from what to what, and why" can't be answered.
- **Change and approach:** before/after in `decision.set/cleared`, `line.edited`, `manual_line.*`, `preset.published` (version, note); a per-question history endpoint and Decisions page drawer; CSV includes superseded rows; `edits.imported` event; F09 §6 updated to the code's names.
- **Files:** `services/api/.../audit/*`, `boq/Decisions.java`, `boq/Adjustments.java`, `library/Library.java`, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/decisions/*`, `docs/product/features/F09-review-approve-issue.md`.
- **Acceptance:** the overwrite repro shows both answers and who gave them; audit rows carry before/after.
- **Tests:** scenario `audit.test.ts`.
- **Effort:** M · **Depends on:** — · **Risk:** audit retention (P54 Q45) unchanged.

#### D-26 · Library editors see where their presets are used, can promote, and read the library audit  (WP-D6)
- **Sources:** LEAD-005, LEAD-018
- **Problem:** library editors see 0 projects; `GET /presets/{id}/usage` returns `[]` for them (`Library.java:71-85` filters by membership); 404 on decisions, so no promotion; org audit 403 (`required: admin`); CSV shows entity ids.
- **Why it matters:** the standards owner can't judge impact or do the promotion F05 assigns.
- **Change and approach:** `library_editor` gets read access to where-used (names), project decisions (for promotion) and a library-filtered audit; an org-wide "answers worth promoting" list; CSV gains entity names; `permissions.md` updated.
- **Files:** `services/api/.../library/Library.java`, `boq/Decisions.java`, `audit/*`, `org/OrgAccess*`, `docs/domain/permissions.md`, `apps/app/src/features/library/preset-usage.tsx`.
- **Acceptance:** `s12-libvis.mjs` scenario: library editor sees usage 2 and can promote.
- **Tests:** scenario `permissions.test.ts` rows.
- **Effort:** M · **Depends on:** D-24 · **Risk:** wider visibility — read-only, audited.

#### D-27 · Optional approval for library publishes  (WP-D6)
- **Sources:** LEAD-008 (governance part)
- **Problem:** one library editor publishes and defaults the firm's rule set with no review; promotions publish immediately.
- **Why it matters:** one person can change how the whole firm measures.
- **Change and approach:** org setting "Library changes need approval": publish becomes "submit for approval" reusing the review flow (reviewer ≠ author); promotions become proposals (D-24) under the setting.
- **Files:** `services/api/.../library/Library.java`, org settings, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/library/publish-dialog.tsx`.
- **Acceptance:** with the setting on, publish needs a second person.
- **Tests:** scenario `library-publish.test.ts`.
- **Effort:** M · **Depends on:** A-45, D-24 · **Risk:** none.

#### D-28 · Approval policy: only the chosen reviewers, notices to them, strict four-eyes  (WP-D7)
- **Sources:** LEAD-009 · DEC-61 · verify-backend LEAD-009
- **Problem:** an org admin not chosen approved and saved (`200`, `200`); the chosen reviewer gets `version.saved` but no notice of the approval; four-eyes checks only submitter ≠ approver.
- **Why it matters:** a firm can't require a named checker.
- **Change and approach:** org option "Only chosen reviewers may approve"; notify chosen reviewers when someone else approves; option "approver ≠ saver"; F09 §4 extended.
- **Files:** `services/api/.../boq/Boqs.java`, `project/ProjectAccess.java`, org settings, `realtime/Notifications.java`, `packages/api/openapi.yaml` + `npm run api:gen`, `docs/product/features/F09-review-approve-issue.md`.
- **Acceptance:** with the option on, the admin gets 403; notices delivered.
- **Tests:** scenario `versions-roles.test.ts`.
- **Effort:** S · **Depends on:** B-14, A-46 · **Risk:** none.

#### D-29 · Org policy of allowed presets; "differs from the project default" marks  (WP-D7)
- **Sources:** LEAD-015
- **Problem:** `BoqInputs.validate` (`BoqInputs.java:59-90`) accepts any published system or org preset; estimators can switch a BoQ to ACME/demo presets.
- **Why it matters:** BoQs drift off the firm standard by mistake.
- **Change and approach:** org setting: allowed presets per kind (`firm presets only` / list); BoQ inputs outside the project defaults get a "differs from default" badge.
- **Files:** `services/api/.../boq/BoqInputs.java`, org settings, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/boqs/setup-tab.tsx`.
- **Acceptance:** with "firm presets only", choosing a system example → 409 with a reason.
- **Tests:** scenario `boqs.test.ts`.
- **Effort:** S · **Depends on:** A-44, C-42 · **Risk:** none.

#### D-30 · A team dashboard and opt-in project-wide "Needs you"  (WP-D7)
- **Sources:** LEAD-010 · verify-product LEAD-010
- **Problem:** `org/Attention.java:24-79` restricts every branch to the user; the owner's attention was `[]` while a review waited.
- **Why it matters:** a lead of 20–30 has nowhere to see the department's state.
- **Change and approach:** `/{org}/team` for owners/admins (and leads opting in): open reviews with age, blocking questions per project, BoQs not regenerated after a new model version, recent confirmations, filters by person/project.
- **Files:** `services/api/.../org/Attention.java` (team query), `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/app/(app)/[org]/team/page.tsx` (new).
- **Acceptance:** the lead sees every open review in the org.
- **Tests:** scenario `orgs.test.ts`.
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### D-31 · Teams, bulk staffing and copying members  (WP-D7)
- **Sources:** LEAD-014 · FM-101
- **Problem:** `POST /projects/{id}/members` takes one `{userId, role}`; invitations `{email, role}` only; no groups.
- **Why it matters:** staffing and offboarding 20–30 people is manual and error-prone.
- **Change and approach:** org teams with a default project role; add a team or many people to a project; "copy members from project X"; choose projects when inviting; bulk remove on offboarding. Custom roles stay out (later).
- **Files:** `services/api/.../org/*`, `project/*`, a Flyway migration, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/app/(app)/[org]/projects/[projectId]/settings/page.tsx`, `apps/app/src/features/settings/members-settings.tsx`.
- **Acceptance:** adding a team adds all its members with the team's role.
- **Tests:** scenario `projects.test.ts`.
- **Effort:** L · **Depends on:** — · **Risk:** permission edge cases — team role is a default, project role wins.

#### D-32 · Model version list: used by, notes, compare summaries, delete  (WP-D8)
- **Sources:** FM-19 (rest; failed-version removal → C-39)
- **Problem:** the version page shows the note; no "used by", no compare, the app never calls `DELETE /model-versions/{id}` for good versions.
- **Why it matters:** housekeeping across many projects.
- **Change and approach:** version rows with used-by BoQs, note edit, select two → compare input-check summaries, delete unused versions.
- **Files:** `apps/app/src/features/models/*`, `services/api/.../model/Models.java` (used-by), `packages/api/openapi.yaml` + `npm run api:gen`.
- **Acceptance:** an unused version can be deleted; a used one shows where.
- **Tests:** scenario `model-versions.test.ts`.
- **Effort:** M · **Depends on:** C-39 · **Risk:** none.

#### D-33 · Open an earlier run read-only  (WP-D8)
- **Sources:** FM-22
- **Problem:** the sheet renders only the current run; the Versions tab lists runs without "open".
- **Why it matters:** "what did we send last Tuesday?" without saving a version every time.
- **Change and approach:** route `…/boqs/{id}/runs/{runId}` rendering the sheet read-only with a banner; row click in Versions.
- **Files:** `apps/app/app/(app)/[org]/projects/[projectId]/boqs/[boqId]/runs/[runId]/page.tsx` (new), `apps/app/src/features/versions/*`.
- **Acceptance:** an older run opens read-only with its lines (index rebuilt on demand, K6).
- **Tests:** e2e-java.
- **Effort:** S · **Depends on:** — · **Risk:** none.

#### D-34 · Scope rules per model editable  (WP-D8)
- **Sources:** FM-18
- **Problem:** the Setup tab shows "Whole model / N rules" as static text (`setup-tab.tsx:186-187`); D44 specifies include/exclude filters.
- **Why it matters:** federation needs per-model scope.
- **Change and approach:** "Edit scope" opens a selector builder (reusing the rule-set selector UI) in a drawer; stored on the BoQ input; the engine already honours scope.
- **Files:** `apps/app/src/features/boqs/setup-tab.tsx`, `apps/app/src/features/library/rule-set/*` (selector builder), `services/api/.../boq/BoqInputs.java`.
- **Acceptance:** excluding a class from one model changes the run's coverage accordingly.
- **Tests:** scenario `federation.test.ts`.
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### D-35 · Library depth: rebase on latest, unarchive, rename ids across documents, structured version diff, "keep other columns" on import  (WP-D8)
- **Sources:** FM-41 (rest; stale-draft protection → A-43)
- **Problem:** none of these exist (no rebase or unarchive-preset operation in `openapi.yaml`).
- **Why it matters:** library editors need to see what changed before publishing.
- **Change and approach:** manual rebase (A-43's machinery), unarchive op, id rename across a preset's documents through the engine AST (B-13), a structured diff view (rules/codes/entries) building on `library/json-diff.ts`, import option to keep unmapped columns.
- **Files:** `services/api/.../library/Library.java`, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/features/library/*`, `engine/ifc_boq/codelist_import.py`.
- **Acceptance:** each sub-feature usable from the Library.
- **Tests:** scenario `library.test.ts`, `codelists.test.ts`.
- **Effort:** L · **Depends on:** A-43, B-13 · **Risk:** split per sub-feature if large.

#### D-36 · Stale-edit detection: an edited line whose engine quantity moved is flagged in the sheet  (WP-D8)
- **Sources:** ENG-019 · FM-112 · verify-engine ENG-019 (change report already shows it)
- **Problem:** overrides store the current engine quantity (`overrides.py:25-28`); the change report and line detail show the engine value moving, but the sheet has no flag and the value at edit time isn't kept.
- **Why it matters:** a 512 m² override stays when the model grows to 600 m².
- **Change and approach:** store `engineQuantityAtEdit` on the override (types first); when the new engine value differs beyond a tolerance, a non-blocking `stale_override` question and an edit-marker state in the sheet; BR-09 updated.
- **Files:** `packages/types/src/*` + codegen, `engine/ifc_boq/overrides.py`, `services/api/.../boq/Adjustments.java`, a Flyway migration, `apps/app/src/features/boq-sheet/*`, `docs/domain/business-rules.md`.
- **Acceptance:** Duplex v1 edit, v2 with a changed wall → question + marker.
- **Tests:** `test_overrides.py`; scenario `line-edits.test.ts`.
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### D-37 · Measurement aids for work not in the model: lines from other lines, block import, item templates  (WP-D9)
- **Sources:** PRD-008 · FM-123 (partial) · verify-product PRD-008
- **Problem:** derived rules and manual-line formulas over `building.*` and answers exist; missing: manual-line formulas over other lines, a CSV/Excel block import outside the round trip, firm item templates; no 2D/PDF.
- **Why it matters:** design-stage tender BoQs include much non-modelled work.
- **Change and approach:** manual-line formula context gains `line("key")`/`lines(code)` (evaluated by the engine, rule 4); "Import lines" from CSV/xlsx into manual lines with a mapping step; item templates per firm (a classification's item texts + default unit/kind) offered in Add line; PDF takeoff stays out (later).
- **Files:** `engine/ifc_boq/expr.py` (functions), `engine/ifc_boq/rules.py`, `packages/types/src/rules.ts` + codegen, `engine/ifc_boq/sheets/boq_import.py`, `apps/app/src/features/boq-sheet/edit-dialogs.tsx`, `services/api/.../boq/*`.
- **Acceptance:** a manual line "10 % of line X" updates when X changes; a CSV of 20 lines imports.
- **Tests:** engine expr tests; scenario `line-edits.test.ts`.
- **Effort:** L · **Depends on:** A-30 · **Risk:** dependency cycles between lines — the engine refuses cycles.

#### D-38 · Client template / previous-BoQ import  (WP-D9)
- **Sources:** FM-47
- **Problem:** only preset templates and the edits round trip exist.
- **Why it matters:** QS-led firms work to client templates.
- **Change and approach:** import a client's BoQ workbook as a classification (codes, item texts, order) with a column-mapping step (reusing code-list import), so lines map to the client's structure.
- **Files:** `engine/ifc_boq/codelist_import.py`, `apps/app/src/features/library/classification/code-import.tsx`.
- **Acceptance:** a sample client workbook becomes a classification used by a BoQ.
- **Tests:** `test_codelist_import.py`.
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### D-39 · Setup wizard "start from your last BoQ"  (WP-D9)
- **Sources:** FM-103 · Q23
- **Problem:** after v1 per P16; not built.
- **Why it matters:** repeat project types.
- **Change and approach:** wizard option to start from a saved BoQ's presets and answers (as org drafts).
- **Files:** `apps/app/src/features/setup/*`, `services/api/.../library/*`.
- **Acceptance:** a second-project wizard can copy the first BoQ's setup.
- **Tests:** scenario `setup.test.ts`.
- **Effort:** S · **Depends on:** C-35 · **Risk:** none.

#### D-40 · Export formats I: a format adapter with CSV, PDF and a dimension sheet  (WP-D10)
- **Sources:** CAS-003 (PDF), QS-016 (CSV, dimension sheet), PRD-005 · FM-46 · DEC-53
- **Problem:** `exportRun` `format: enum [xlsx]` (`openapi.yaml:1374`); no PDF of any kind; no CSV of the BoQ; no dimension-sheet export for a second QS's check.
- **Why it matters:** casual users send PDFs; QSs check dimension sheets.
- **Change and approach:** an exporter interface in the engine (`export_<format>.py`); `csv` (BoQ lines), `pdf` (issue profile, rendered from the same layout as C-21/C-22 via a headless renderer or ReportLab), `dimsheet` (per element timesing/dims/squaring from the trace); contract enum extended.
- **Files:** `engine/ifc_boq/export_*.py`, `engine/requirements.txt`, `packages/api/openapi.yaml` + `npm run api:gen`, `services/api/.../boq/BoqExports.java`, `apps/app/src/features/exports/exports-tab.tsx`.
- **Acceptance:** Duplex PDF on landscape pages with headers; CSV opens in Excel with correct decimals per org format.
- **Tests:** export tests per format.
- **Effort:** L · **Depends on:** C-22 · **Risk:** PDF engine weight in the worker image.

#### D-41 · Export formats II: GAEB DA XML, ÖNORM A 2063, IfcCostSchedule (after a sourcing check)  (WP-D10)
- **Sources:** PRD-005 · FM-46 · DEC-53
- **Problem:** no national tender exchange formats; Q12 open.
- **Why it matters:** DE/AT public tenders can require GAEB files.
- **Change and approach:** first a sourcing check per format recorded in `docs/domain/sourcing-and-licensing.md` (schema use only; no licensed texts, tables or code lists; rule 8); then adapters on D-40's interface; IfcCostSchedule via ifcopenshell.
- **Files:** `engine/ifc_boq/export_gaeb.py`, `export_onorm.py`, `export_ifc_cost.py` (new), `docs/domain/sourcing-and-licensing.md`, `docs/product/open-questions.md` (Q12).
- **Acceptance:** a GAEB file validates against the public schema; nothing licensed in the repo.
- **Tests:** schema validation tests (schema fetched at test time if its licence forbids committing it).
- **Effort:** L · **Depends on:** D-40 · **Risk:** licensing — stop and record if a format can't be implemented without licensed material.

#### D-42 · Faces and rooms: recesses from geometry, openings placed on faces, per-face embedded intersection, 2nd-level space boundaries  (WP-D11)
- **Sources:** FM-85, FM-91, FM-93 · QS-009 (follow-up)
- **Problem:** recess only when typed (`measure.py:143-148`); openings shared in proportion across faces; space boundaries topology only (`parse.py:773-783`).
- **Why it matters:** chases, niches and which face an opening is on drive finishes and reveals.
- **Change and approach:** detect recesses as void features in the wall body; place each opening on the faces it cuts; per-face embedded intersection; read `IfcRelSpaceBoundary` 2nd-level geometry when present.
- **Files:** `engine/ifc_boq/measure.py`, `engine/ifc_boq/geometry.py`, `engine/ifc_boq/parse.py`.
- **Acceptance:** finish areas per face match a hand check on a fixture with a niche and a one-sided opening.
- **Tests:** `test_faces_rooms.py`, `test_scope_recess_building.py`.
- **Effort:** L · **Depends on:** A-09, A-11 · **Risk:** geometry robustness — fall back to today's method with a log entry.

#### D-43 · Infrastructure parts get a location; terrain and planting measured by area/volume  (WP-D11)
- **Sources:** FM-88, FM-89
- **Problem:** IfcBridgePart/IfcRoadPart lines get no location (`parse.py:56-58`); `IfcGeographicElement` counted `nr` (`families.json:38`).
- **Why it matters:** infrastructure and landscape quantities.
- **Change and approach:** facility parts as location levels; geographic elements measured by area/volume with a rule item (off by default).
- **Files:** `engine/ifc_boq/parse.py`, `engine/ifc_boq/data/families.json`, `presets/rules/as-modelled.json`.
- **Acceptance:** an IFC4.3 fixture (S04) shows locations; S07 "Pad 2" can be measured as terrain area.
- **Tests:** engine tests.
- **Effort:** M · **Depends on:** A-07 · **Risk:** none.

#### D-44 · Tool coverage: ArchiCAD quantity names verified; design options and renovation phases from more tools  (WP-D11)
- **Sources:** FM-94, FM-97
- **Problem:** ArchiCAD names in `quantity_sources.json` are guesses; design options measured but unused; phases from Revit/IFC Status only.
- **Why it matters:** IFC from any tool (overview strength).
- **Change and approach:** verify ArchiCAD (and Allplan/Tekla) names against corpus files (`fixtures/corpus`, catalogue); options: an option filter on BoQ inputs; phases from ArchiCAD renovation status and Allplan.
- **Files:** `engine/ifc_boq/data/quantity_sources.json`, `engine/ifc_boq/measure.py:66-68`, `docs/testing/ifc-corpus-catalogue.md`.
- **Acceptance:** ArchiCAD corpus files adopt reported quantities that match geometry.
- **Tests:** corpus run (`npm run corpus`).
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### D-45 · Cancellation inside long native calls  (WP-D11)
- **Sources:** FM-96
- **Problem:** `JobCancelled` checked between stages only (`worker.py:41,132,400`).
- **Why it matters:** a cancelled big parse keeps a worker busy.
- **Change and approach:** run the geometry iterator in a child process that the worker kills on cancel; partial results discarded.
- **Files:** `engine/ifc_boq/worker.py`, `engine/ifc_boq/parse.py`.
- **Acceptance:** cancelling S06 mid-geometry frees the worker within 5 s.
- **Tests:** `test_worker.py`.
- **Effort:** M · **Depends on:** B-22 · **Risk:** memory doubling — stream (B-22) first.

#### D-46 · IDS input checks per preset  (WP-D11)
- **Sources:** FM-99
- **Problem:** v1 "out"; firms want model requirements checked against their rules.
- **Why it matters:** better models, fewer questions.
- **Change and approach:** a preset may carry an IDS file; the input-check report evaluates it with ifcopenshell's IDS support and lists failures with "Show in 3D".
- **Files:** `engine/ifc_boq/` (ids check), `packages/types/src/*` + codegen, `apps/app/src/features/models/*`.
- **Acceptance:** an IDS requiring `IsExternal` on walls reports missing ones.
- **Tests:** engine test with a small IDS.
- **Effort:** M · **Depends on:** — · **Risk:** none.

#### D-47 · MFA for users and platform admins  (WP-D12)
- **Sources:** FM-10 (MFA part)
- **Problem:** no TOTP or WebAuthn (TF-048).
- **Why it matters:** platform admins see every org's metadata; enterprises require MFA.
- **Change and approach:** TOTP (and WebAuthn later) with recovery codes; mandatory for platform admins, org setting to require for members.
- **Files:** `services/api/.../identity/*`, a Flyway migration, `packages/api/openapi.yaml` + `npm run api:gen`, `apps/app/src/auth/*`, `apps/app/app/(app)/account/page.tsx`.
- **Acceptance:** admin sign-in requires a second factor.
- **Tests:** `NativeAuthTest`, `AccountSecurityTest`.
- **Effort:** M · **Depends on:** — · **Risk:** lockout — recovery path for the operator.

#### D-48 · Per-org data export and account deletion  (WP-D12)
- **Sources:** FM-75
- **Problem:** `/me` has get/patch only; no org export.
- **Why it matters:** leaver handling, exit planning, data protection.
- **Change and approach:** org export job (presets, projects, models' files, BoQs, decisions, audit) to a zip; account deletion that anonymises audit references ("deleted user").
- **Files:** `services/api/.../org/*`, `identity/*`, `maintenance/*`, `packages/api/openapi.yaml` + `npm run api:gen`.
- **Acceptance:** export downloads; a deleted user shows as "deleted user" everywhere.
- **Tests:** scenario tests.
- **Effort:** M · **Depends on:** — · **Risk:** export size — job with signed URL.

#### D-49 · Audit rows for failed permission checks  (WP-D12)
- **Sources:** FM-76 (permission part; webhooks → D-15)
- **Problem:** the 55 refused calls of the IDOR sweep left no audit trace.
- **Why it matters:** detecting probing.
- **Change and approach:** rate-limited audit of denied access (actor, route, resource type; no foreign ids leaked to the actor); admin health counter.
- **Files:** `services/api/.../project/ProjectAccess.java`, `audit/*`.
- **Acceptance:** a cross-org 404 writes one audit row per minute per actor/route.
- **Tests:** scenario `isolation.test.ts`.
- **Effort:** S · **Depends on:** A-37 · **Risk:** audit volume — sampling.

#### D-50 · Scoped storage identity for workers  (WP-D12)
- **Sources:** FM-74 (rest) · DEC-64
- **Problem:** engine workers hold the full storage key (P54 Q47 accepted for the pilot).
- **Why it matters:** a compromised worker reads every tenant's files.
- **Change and approach:** per-job presigned URLs (Java passes signed GET/PUT URLs for exactly the job's objects) instead of a storage key in the worker.
- **Files:** `services/api/.../worker/*`, `storage/ObjectStorage.java`, `engine/ifc_boq/storage.py`, `ops/pilot/compose.yaml`.
- **Acceptance:** the worker container has no storage credentials; jobs still run.
- **Tests:** `NativeWorkerTest`.
- **Effort:** M · **Depends on:** A-36 · **Risk:** URL expiry on long jobs — refresh endpoint.

#### D-51 · Enterprise SSO and SCIM  (WP-D12)
- **Sources:** FM-10 (SSO part) · overview O8 (SSO "out of v1", planned here)
- **Problem:** `OidcConfiguration.java` is one optional platform-wide issuer, not per-org SSO; no SCIM.
- **Why it matters:** departments of 25+ get asked for SSO by IT.
- **Change and approach:** per-org OIDC/SAML connections (verified domain), JIT provisioning, SCIM 2.0 users/groups mapped to teams (D-31); P22 single session still applies.
- **Files:** `services/api/.../identity/*`, `org/*`, a Flyway migration, `packages/api/openapi.yaml` + `npm run api:gen`.
- **Acceptance:** an org signs in through a test IdP; SCIM deprovisioning removes membership.
- **Tests:** JUnit with a mock IdP.
- **Effort:** L · **Depends on:** D-47, D-31, B-16 · **Risk:** large; split SSO and SCIM.

#### D-52 · Coordinate alignment between federated models  (WP-D13)
- **Sources:** FM-20 · Q11
- **Problem:** federation only warns (`federation_coordinates`).
- **Why it matters:** misaligned discipline models break overlap and duplicate checks.
- **Change and approach:** detect offsets from shared GlobalIds / grid / survey points; propose a transform as a question; apply to geometry comparisons (never to the model, D18).
- **Files:** `engine/ifc_boq/federation.py`, `packages/types/src/*` + codegen.
- **Acceptance:** a fixture with a 10 m offset is aligned after answering.
- **Tests:** `test_federation.py`.
- **Effort:** L · **Depends on:** A-18, A-19 · **Risk:** none.

#### D-53 · Pull models from CDEs (ACC, Trimble Connect)  (WP-D13)
- **Sources:** FM-100
- **Problem:** every model version needs download + upload.
- **Why it matters:** "a new version takes minutes".
- **Change and approach:** a CDE connector interface (OAuth per org) with ACC first: pick a file, import as a version, optional watch for new versions; stays an optional module-like adapter.
- **Files:** `services/api/.../model/*` (connector), `apps/app/src/features/models/*`, `docs/architecture/modules.md`.
- **Acceptance:** an ACC sandbox file imports as a version.
- **Tests:** connector contract tests with a fake CDE.
- **Effort:** L · **Depends on:** C-38 · **Risk:** vendor API terms.

#### D-54 · Viewer filter bar shared with the sheet: class, type, material, "changed since"  (WP-D13)
- **Sources:** FM-33
- **Problem:** the viewer has colour mode + storey only (`model-viewer.tsx`); design-system specifies a shared filter bar.
- **Why it matters:** sheet and 3D tell the same story only with shared filters.
- **Change and approach:** one `FilterBar` (C-01 chips) bound to both panes; filters by IFC class, type, material term, changed since a revision.
- **Files:** `apps/app/src/features/viewer/*`, `apps/app/src/features/boq-sheet/*`.
- **Acceptance:** filtering by material in 3D filters the sheet and vice versa.
- **Tests:** app unit tests; e2e-java.
- **Effort:** M · **Depends on:** C-01, C-55 · **Risk:** none.

#### D-55 · Viewer at scale: merged meshes, id-buffer picking, large "Show in 3D"  (WP-D13)
- **Sources:** FM-34
- **Problem:** per-mesh picking (`scene-view.ts`); "Show in 3D" from a question > 300 GlobalIds unsupported.
- **Why it matters:** > 200k-element models.
- **Change and approach:** merged geometry per material with an id buffer for picking; batched highlighting; large selections streamed.
- **Files:** `apps/app/src/features/viewer/scene-view.ts`, `links.ts`, `webgl.ts`.
- **Acceptance:** a 200k-element model stays interactive (B-07 budget).
- **Tests:** B-07 perf spec.
- **Effort:** L · **Depends on:** B-18 · **Risk:** none.

#### D-56 · Pilot operations: off-host backups, alert destination, error tracking, traces  (WP-D14)
- **Sources:** FM-79
- **Problem:** known-limitations "Operations": backups not installed with an off-host copy; no alert destination, error tracking or trace store.
- **Why it matters:** the only environment holds customer data (P51).
- **Change and approach:** install the backup timer with an off-host copy (encrypted), restore drill documented; alert destination (email/webhook) for `AlertMonitor`; self-hosted or provider-neutral error tracking and OpenTelemetry traces behind config.
- **Files:** `ops/pilot/*`, `docs/operations/pilot.md`, `services/api/.../maintenance/*`.
- **Acceptance:** a restore drill from the off-host copy succeeds; a forced error appears in the tracker.
- **Tests:** `BackupRestoreTest` extended; manual drill.
- **Effort:** M · **Depends on:** — · **Risk:** needs operator access to the pilot host.

#### D-57 · Admin console: ops links, webhook failures and bounces tracked, support inbox and announcements  (WP-D14)
- **Sources:** FM-70 (partial), FM-102
- **Problem:** health tiles for webhook failures and email bounces show "Not tracked" (`health.tsx:21-34`); no ops links; no support inbox or announcements (F19 "Later").
- **Why it matters:** operating a growing pilot.
- **Change and approach:** feed the two tiles (D-15 webhook failures, SMTP bounce handling in `EmailDelivery`); ops dashboard links from platform settings; support messages from D-11's form into an admin inbox; announcements shown in the app shell.
- **Files:** `services/api/.../admin/*`, `mail/EmailDelivery.java`, `apps/app/src/features/admin/health.tsx`, `apps/app/app/(admin)/admin/*`.
- **Acceptance:** tiles show numbers; a support message reaches the inbox.
- **Tests:** scenario `admin.test.ts`.
- **Effort:** M · **Depends on:** D-15, D-11 · **Risk:** none.

#### D-58 · A staging environment (overturns P51 — owner to confirm)  (WP-D14)
- **Sources:** FM-78 · DEC-63
- **Problem:** booqlet.com is the only environment and every green push deploys there (P51).
- **Why it matters:** risky changes (CSP, auth, migrations) are first exercised on the pilot.
- **Change and approach:** **do not start until the owner confirms.** Then: a second compose stack from `ops/pilot` with its own data, deploy from `main` to staging first and promote by tag.
- **Files:** `ops/pilot/*`, `.github/workflows/ci.yml`, `docs/operations/*`, `docs/decisions.md`.
- **Acceptance:** a push deploys to staging; production deploys on promotion.
- **Tests:** CI.
- **Effort:** M · **Depends on:** D-56 · **Risk:** cost and process change — owner decision.

#### D-59 · On-premise packaging  (WP-D14)
- **Sources:** FM-109 · P09
- **Problem:** cloud only ("later").
- **Why it matters:** some firms can't put models in a vendor cloud.
- **Change and approach:** a documented single-host package (compose + Helm chart) with the same images, licence/entitlement file instead of the admin console's plans, update procedure.
- **Files:** `ops/onprem/*` (new), `docs/operations/*`.
- **Acceptance:** a clean VM installs and runs `local:check`-equivalent.
- **Tests:** a CI job building the package.
- **Effort:** L · **Depends on:** D-56 · **Risk:** support burden — owner decision on offering it.

#### D-60 · Pricing module, slice 1: a firm rate library keyed by item code  (WP-D15)
- **Sources:** PRD-021, PRD-020 · FM-122 · DEC-03, DEC-54
- **Problem:** no rates in the product; the Excel Rate column is the only workaround; the design-stage cost check needs rates.
- **Why it matters:** the most frequent design-firm BoQ use is a cost plan.
- **Change and approach:** inside the optional pricing module (own API file `packages/pricing-api/openapi-pricing.yaml`, own schema, own backend module, own frontend package; P36): a firm rate list (code → rate, unit, currency, valid from), a Pricing tab showing amounts per line and section totals, rates written into the Excel Rate column; plan entitlement and platform flag; the core never imports it (ArchUnit rule).
- **Files:** `packages/pricing-api/openapi-pricing.yaml`, `services/api/.../extension/*` (extension points), a new pricing backend module, a new frontend package under `packages/`, `docs/architecture/modules.md`, `docs/product/features/F20-pricebooks-and-pricing.md`.
- **Acceptance:** with the module on, a BoQ shows priced totals; with it off (or removed), the core builds and every core test passes.
- **Tests:** module tests; ArchUnit "core never depends on pricing".
- **Effort:** L · **Depends on:** C-22, C-23 · **Risk:** creeping core dependencies — ArchUnit gate.

#### D-61 · Pricing module: pricebooks and the firm's estimate (F20)  (WP-D15)
- **Sources:** FM-72 · PRD-020
- **Problem:** contract only (P48).
- **Why it matters:** O10.
- **Change and approach:** implement F20 on slice 1's foundation: pricebooks per firm, manual matching of items to lines, estimates per BoQ version.
- **Files:** pricing module (backend, frontend), `packages/pricing-api/openapi-pricing.yaml`, `docs/product/features/F20-pricebooks-and-pricing.md`.
- **Acceptance:** F20 acceptance criteria met.
- **Tests:** module scenario tests.
- **Effort:** L · **Depends on:** D-60 · **Risk:** scope — split by F20 section.

#### D-62 · Pricing module: vendors (F17), including the admin vendors section  (WP-D16)
- **Sources:** FM-65, FM-70 (vendors part)
- **Problem:** contract only (P48).
- **Why it matters:** O10.
- **Change and approach:** vendor accounts linked by invitation (P21/P28), vendor pricebooks shared per firm; admin console vendors section.
- **Files:** pricing module, `apps/app/app/(admin)/admin/*`, `docs/product/features/F17-vendors.md`.
- **Acceptance:** F17 acceptance criteria met.
- **Tests:** module scenario tests.
- **Effort:** L · **Depends on:** D-61 · **Risk:** a third access kind — security review.

#### D-63 · Pricing module: offer requests (F11)  (WP-D16)
- **Sources:** FM-43 · PRD-020
- **Problem:** contract only (P48); no formal tendering (P34).
- **Why it matters:** O10.
- **Change and approach:** send the whole BoQ or a part to vendors; offers filled from their pricebooks; side-by-side comparison; no packages, sealed bids or award (P34).
- **Files:** pricing module, `docs/product/features/F11-offer-requests.md`.
- **Acceptance:** F11 acceptance criteria met.
- **Tests:** module scenario tests.
- **Effort:** L · **Depends on:** D-62 · **Risk:** none beyond scope.

### Deferred / out of scope

| What | Why | Rows |
|---|---|---|
| **Real billing-provider integration** (Paddle, Stripe or any provider: checkout pages, card handling, invoices, the provider's webhooks) | Out of scope of this plan (DEC-04, BE-D7, P08: manual billing for pilots; P57: prices shown, not charged). D-15 builds the `PaymentProvider` seam and a stub, so a later provider is one implementation. | FM-52 (provider part) |
| **Formal tendering, construction phase, BCF** | Non-goal (P34 no formal tendering, P32 lifecycle ends at a confirmed BoQ, P06 BCF out). | FM-107 |
| **A price database supplied by boqlet** | Non-goal (P33: prices come only from firms' or vendors' own pricebooks). | FM-108 |
| 2D/PDF takeoff tool | Not planned in this blueprint (PRD-008 "later a PDF measure tool or integration"); D-37 covers the in-product aids. Revisit after the pilot. | (part of FM-123) |
| Custom roles | FM-101 "out of v1"; D-31 builds teams, custom roles wait for demand. | (part of FM-101) |

---

## 5. Work packages

Each package is one focused session (roughly 1–3 days). Every item belongs to exactly one package. Packages are
listed in execution order: a session takes **the first package in this order whose prerequisites are done**
(PROGRESS.md). Prerequisites list only real dependencies; for engine packages that move numbers they also encode
the baseline order (DEC-74), so baseline differences stay attributable.

### 5.0 Standard checks (referenced by every package)

**Standard entry check** (run before the first item; all must pass, otherwise record the failure in PROGRESS.md
and fix it first as a separate commit, or stop if it isn't yours to fix):

```bash
git status                      # clean working tree on main
npm install                     # if package files changed since the last session
npm run test                    # typecheck, lint, app unit tests, engine tests incl. Duplex
bash docs/review/tools/fetch-samples.sh --verify   # samples present (download without --verify)
docs/review/tools/verify-quantities                # expect only the OK/KNOWN rows recorded in PROGRESS.md
docs/review/tools/compare-baseline --layer engine --parse-cache   # expect 0 differences (or only those logged)
```

**Standard exit check** (all must pass before the package is marked done):

1. `npm run test` green; `npm run build:app` green.
2. Contract changed (`packages/api/openapi.yaml`): `npm run api:gen`, `npm run api:check`, `npm run api:lint`
   green, Java and app updated in the same commit (`docs/development/contract-changes.md`).
   Engine contract changed (`packages/types/src`): `npm run codegen`; `test_result_matches_the_typescript_contract` green.
3. Java changed: `mvn -B -ntp -f services/api/pom.xml verify` with the CI variables from `docs/testing/README.md`
   (`BOQLET_NATIVE_WORKER_PYTHON`, `BOQLET_NATIVE_NODE`, `BOQLET_NATIVE_SCENARIOS=1`, `BOQLET_BROWSER_SMOKE=1`,
   `BOQLET_NATIVE_QUEUE_TEST=1`, `BOQLET_NATIVE_RESILIENCE=1`, `IFC_BOQ_PYTHON`, AWS test keys) on a quiet
   machine. A timeout-only failure is re-run once targeted (DEC-07) before it counts as red.
4. The package's acceptance criteria met (each item's **Acceptance**).
5. `docs/review/tools/compare-baseline` — **the full default run** (engine layer ~30 min, stack layer ~20 min
   with `npm run local:up` done **after** the last engine/API change, because the stack layer tests the images
   `local:up` built last) — and `docs/review/tools/verify-quantities`. Every difference is either listed under
   the package's **expected baseline changes** (record it in PROGRESS.md's baseline log with the item id) or is
   a regression to fix. Intended changes: recapture in the same commit (`docs/review/tools/compare-baseline
   --capture`, both layers when the stack is up) and update `verify_quantities.py` expectations (KNOWN → expected
   value) when a row turns FIXED.
6. CLAUDE.md after-task duties per item: `docs/changelog.md` row, `docs/product/known-limitations.md`, the
   feature's status block, `docs/decisions.md` when a decision was made.

Baseline notation: engine runs are `<sample>-<config>` (configs `default`, `house`, `standard`, `tweaked`,
`duplexproject`, `noclass`; F01 = S07+S08, F02 = S05+S06); stack runs are `stack:<run>`. "No baseline change"
means compare-baseline must report 0 differences.

### Phase A packages

#### WP-A1 · Reported quantities vs geometry (the ×1000 and ×2 slab errors)
- **Items:** A-01, A-02, A-03, A-04
- **Requires:** —
- **Touches:** `engine/ifc_boq/measure.py`, `engine/ifc_boq/data/quantity_sources.json`, `presets/settings/resolution.json`, `packages/types/src`, `apps/app/messages/en/engine.json`, Library resolution editor.
- **Entry check:** standard; plus `docs/review/tools/compare-baseline --layer engine --only S09-default S08-default --parse-cache` reproduces the baseline (S09 slab 146,199.06 m²).
- **Exit check:** standard; `verify-quantities` S09-slab-area, S09-floor-volume, S08-pilecap-area, S08-pilecap-edge-formwork are FIXED and their KNOWN entries replaced by the independent values.
- **Expected baseline changes:** S09-default/house/standard/tweaked: slab area lines ÷1000 (146,199.06 → 146.20; 80,262.86 → 80.26), "In-situ concrete, Simple floor" 13,243.37 → 13.24 m³, building values (gross_floor_area, footprint_area, gross_volume) and every line derived from them; the two S09 contradiction questions recommend `geometry` (same ids) and may become blocking only if not explained as unit errors. S07-*/S08-default/F01-*: every slab area falls to ≈ volume ÷ thickness (S07 sum ≈ 1,077 m², S08 ≈ 402 m²), edge formwork and slab-area-derived lines (hardcore, screed, finishes) follow, new `contradiction:area:*` questions, thickness contradictions above 50 % become blocking. S03, S05, S06, F02 unchanged except possible new non-blocking area questions where NetArea > GrossArea (explain each). stack:S09-default, stack:S08-default, stack:F01-default move the same way.

#### WP-A2 · Flags, decisions and plausibility
- **Items:** A-05, A-06, A-07, A-08
- **Requires:** WP-A1
- **Touches:** `engine/ifc_boq/rules.py`, `pipeline.py`, `measure.py`, `trace_steps.py`, `export_xlsx.py`, `federation.py`, `packages/types/src/engine.ts`, `services/api/.../boq/BoqInputs.java`, `RunIndex.java`, sheet and review tab.
- **Entry check:** standard.
- **Exit check:** standard (types and Java changed: codegen and `mvn verify`).
- **Expected baseline changes:** S09-*: "Wall, Wall-Ext…" becomes flagged/partial ("2 of 3 measured"), `flaggedLines` (or the new partial count) rises; other runs: any line with partially missing elements becomes flagged (list them); new fields in every result (optional fields from A-05/A-06 — the compare tool reports them as additions; recapture). S07-*/F01-*: `implausible` warnings on "Pad 2" and the 600 mm piles; S05/S03 none. `fixtures/ifc/Ifc2x3_Duplex_Architecture_v2.ifc` (not a baseline run) gets `unhosted_opening`. Excel: yellow fills on partial lines.

#### WP-A3 · Measurement defaults: walls, finishes, reveals, formwork
- **Items:** A-09, A-10, A-11, A-12, A-13
- **Requires:** WP-A2
- **Touches:** `engine/ifc_boq/measure.py`, `rules.py`, `presets/rules/as-modelled.json`, `standard-style-example.json`, `packages/types/src/measured.ts`, `engine/tests/test_duplex.py` (`HAND_BOQ`), `docs/testing/engine-validation.md`, `docs/architecture/rules-language.md`.
- **Entry check:** standard; Duplex test green before touching `HAND_BOQ`.
- **Exit check:** standard; `HAND_BOQ` changes carry hand derivations and the reason in the commit (rule 7); `verify-quantities` S05-partywall-area, S05-partywall-line, S04-footing-formwork FIXED and updated.
- **Expected baseline changes:** S05-* (all six configs), F02-default: party-wall line 71.67 → ≈ 78.83 m²; paint/lining lines change (faces, opening rule; S05-tweaked paint now differs from default); footing formwork includes ends; slab-edge formwork per the new perimeter fields. S05-standard, S03-standard, S07-standard, S09-standard: wall areas lose reveals, finish lines gain them once. S04-default: "Formwork to sides of foundations" 3.72 → ≈ 15.15 m². S07-*, S08-default, F01-*: walls with non-prismatic bodies +5 … +16 %, footing/pile-cap formwork changes. stack runs follow (S04, S05, S05-house, S07, S08, F01).

#### WP-A4 · Measurement defaults: slabs, roofs, proxies, steel
- **Items:** A-14, A-15, A-16, A-17
- **Requires:** WP-A3
- **Touches:** `presets/rules/as-modelled.json`, `acme-house-rules.json`, `engine/ifc_boq/measure.py`, `rules.py`, `data/quantity_sources.json`, `test_duplex.py`.
- **Entry check:** standard.
- **Exit check:** standard; `verify-quantities` S05-beam-mass FIXED and updated.
- **Expected baseline changes:** slab-concrete lines change wherever slabs have multi-layer sets with non-concrete layers (S07-*, S08-default, F01-*, S09-* once names resolve; S05 single-layer slabs unchanged — confirm). S09-*: roof line gets an area (flagged count −1). S07-*, S03-*, F01-*: "Unclassified object …" proxy lines disappear, `unmatched:*` questions appear (count them; coverage counts unchanged). S05-* and F02-default: W310X60 mass 0.45138 → 0.44528 t and other cut-length steel; S08-default steel lines.

#### WP-A5 · Federation, double counts and wall codes
- **Items:** A-18, A-19, A-20, A-21
- **Requires:** WP-A4
- **Touches:** `engine/ifc_boq/federation.py`, `rules.py`, `pipeline.py`, `classify.py`, `presets/settings/federation.json`, `presets/classifications/*`, `packages/types/src`, question UI, `docs/domain/business-rules.md`.
- **Entry check:** standard.
- **Exit check:** standard; for A-21 the compare-baseline report shows **only code/group/description-of-group differences and no quantity difference** (rule 6) — check it explicitly.
- **Expected baseline changes:** F01-default/house: new `duplicate_conflict:*` questions for materially different same-GlobalId copies, kept copies switch to the owning discipline (structure for concrete slabs/walls) so the affected areas/volumes change; overlap questions become blocking (blocking count up; status already needs_input). F02-default: unchanged (no overlaps/duplicates) — any change is a regression. No `double_count` warning on any shipped preset (a new one is a finding to explain). Codes: S01-default, S07-*, S09-*, F01-*, S08-default external walls move from D.02 to D.01 (ACME) / the trade equivalent; catch-all walls go to the "to be classified" code; S05 unchanged except catch-alls. stack: codes change only where a classification is used (stack default has none → stack unaffected except stack:F01-default federation questions).

#### WP-A6 · Expression language and rule-engine correctness
- **Items:** A-22, A-23, A-24, A-25, A-26, A-27
- **Requires:** —
- **Touches:** `engine/ifc_boq/expr.py`, `rules.py`, `pipeline.py`, `worker_http.py`, `rpc.py`, `services/api/.../worker/JobDispatcher.java`, `RunIndex.java`, error mapping.
- **Entry check:** standard.
- **Exit check:** standard (Java changed: `mvn verify`).
- **Expected baseline changes:** none expected (no shipped preset uses non-ASCII literals, FLOOR/CEIL steps, material breakdowns or `onMissing: ask` with parts). A-23 may remove float tails below the 1e-6 tolerance (not reported). A-26: blocking flags of name questions must be identical on all runs; any difference is explained per question or treated as a regression.

#### WP-A7 · Units and numbers
- **Items:** A-28, A-29, A-30
- **Requires:** —
- **Touches:** `packages/types/src` (unit registry), `engine/ifc_boq/rules.py`, `presets.py`, `names.py`, `parse.py`, `sheets/boq_import.py`, `worker.py`, import job input in Java, `edits-import.tsx`.
- **Entry check:** standard.
- **Exit check:** standard; every shipped preset passes `presets.check` with the registry.
- **Expected baseline changes:** none (shipped presets use registry units; samples are SI). Any numeric difference is a regression.

#### WP-A8 · Parser robustness and CLI/worker parity
- **Items:** A-31, A-32, A-33, A-34
- **Requires:** WP-A5
- **Touches:** `engine/ifc_boq/parse.py`, `measure.py`, `cli.py`, `presets.py`, `names.py`, `worker.py`, `export_xlsx.py`, Java parse-error pass-through, `apps/app/messages/en/models.json`.
- **Entry check:** standard; plus `compare-baseline --layer engine --only S12-default` (error) and `--only S12-default --parse-cache` (succeeds) reproduce DEC-06.
- **Exit check:** standard; S12-default gives the same lines on both layers.
- **Expected baseline changes:** S12-default (engine) error → result; stack:S12-default may change if the renamed unnamed sets' quantities are now adopted (list the lines). S13-default (engine) `IndexError` → structured `truncated_file`; stack:S13-default parse error code `parse_error` → `truncated_file`. S10-default: if A-33 finds a defect, distinct names and name questions appear and the status may become needs_input (record the counts); stack:S10-default the same. xlsx BoQ!A2 rule-chain text changes where an org preset chain is used (stack layer org presets only; the engine layer uses system presets — expect no change there).

#### WP-A9 · Security hardening
- **Items:** A-35, A-36, A-37, A-38, A-39
- **Requires:** —
- **Touches:** `engine/requirements.txt`, `engine/pyproject.toml`, `engine/ifc_boq/names.py`, `rules.py`, `presets.py`, `worker_http.py`, `services/api/.../model/Models.java`, `project/ProjectAccess.java`, `boq/BoqAccess.java`, `boq/ShareLinks.java`, `apps/app/next.config.ts`, `apps/app/middleware.ts`, `ops/local/compose.yaml`, `ops/pilot/compose.yaml`, `docs/architecture/security.md`.
- **Entry check:** standard; `pip install google-re2` works in `engine/.venv` (otherwise switch A-35 to the subprocess-with-timeout fallback and record it).
- **Exit check:** standard (Java changed: `mvn verify`); browser smoke shows no CSP violations; worker refuses unauthenticated calls; the pilot deploy note for `BOQLET_WORKER_TOKEN` is in `docs/operations/pilot.md` **before** pushing.
- **Expected baseline changes:** none (RE2 must give identical matches for shipped patterns). Run `npm run local:up` before the stack layer (the worker now needs the token).

#### WP-A10 · Hand-off correctness: uploads, the sheet's Excel, the watermark switch
- **Items:** A-40, A-41, A-42
- **Requires:** —
- **Touches:** `apps/app/src/features/models/upload.ts`, `upload-button.tsx`, `apps/app/src/api/hooks/*`, S3 CORS (`ops/local`, `ops/pilot`), `apps/app/src/features/boq-sheet/sheet.tsx`, `exports/exports-tab.tsx`, `services/api/.../boq/BoqExports.java`, `engine/ifc_boq/export_xlsx.py`, `features/admin/plans.tsx`.
- **Entry check:** standard; `npm run local:up`.
- **Exit check:** standard; a 101 MiB generated file uploads on the local stack through the browser; the CAS-002 repro exports the edited value via "Generate and export".
- **Expected baseline changes:** none (exports in the stack layer come from the run; the Cover note appears only with pending inputs, which the baseline never has). File names are not compared.

#### WP-A11 · Library and approval controls
- **Items:** A-43, A-44, A-45, A-46
- **Requires:** —
- **Touches:** `services/api/.../library/Library.java`, `boq/Decisions.java`, `project/ProjectPresets.java`, `boq/BoqInputs.java`, `boq/BoqAccess.java`, `boq/ShareLinks.java`, `project/ProjectAccess.java`, Flyway migrations, `packages/api/openapi.yaml`, Library UI, project creation/settings, Setup tab, share dialog, F02/F09/F10/F18, `permissions.md`.
- **Entry check:** standard; `npm run local:up`; `npm run local:suites -- --filter library` if B-05 is done (else via `mvn verify` filter).
- **Exit check:** standard (contract + Java + migrations); the four verify-backend repros (`s10-stale-draft`, `s11-frozen`, `s16-starred`, `s06-approval` in `docs/review/repro/verify-backend/`) behave as the acceptance criteria say (scenario tests encode them).
- **Expected baseline changes:** none (fresh-org defaults unchanged; the stack layer creates its BoQs from defaults).

### Phase B packages

#### WP-B1 · Engine invariants and independent oracles
- **Items:** B-01, B-02, B-03, B-04
- **Requires:** WP-A6, WP-A8
- **Touches:** `engine/ifc_boq/invariants.py`, `pipeline.py`, `worker.py`, `engine/tests/*` (Duplex, certification, diff, expr, breakdowns, adversarial), `tests/scenarios/sheet.test.ts`, `.github/workflows/ci.yml`, `docs/review/tools/*`, `docs/testing/*`.
- **Entry check:** standard; `verify-quantities` shows 0 KNOWN rows except any still open (record which).
- **Exit check:** standard; invariants on in the full compare-baseline engine run; CI runs the independent checks.
- **Expected baseline changes:** none. If B-03's independent hand values disagree with the engine, do not change the engine here — record a new item (execution rule 4).

#### WP-B2 · Shared suites and browser coverage on the local stack
- **Items:** B-05, B-06, B-07, B-08
- **Requires:** —
- **Touches:** `tests/support/*`, `tests/run.mjs`, `scripts/local.mjs`, `services/api/src/test/java/com/boqlet/suite/SuiteSupport.java`, `NativeWorkerTest.java`, `apps/app/e2e-java/*`, `apps/app/playwright.java.config.ts`, `apps/app/package.json`, `.github/workflows/ci.yml`, `docs/testing/README.md`, `docs/architecture/nfr.md`.
- **Entry check:** standard; `npm run local:up`.
- **Exit check:** standard; `npm run local:suites` passes against the local stack; the axe gate runs with its allow-list; `mvn verify` green under the load factor.
- **Expected baseline changes:** none.

#### WP-B3 · CI gates and tooling
- **Items:** B-09, B-10, B-11
- **Requires:** —
- **Touches:** `.github/workflows/*`, `.github/dependabot.yml`, `engine/pyproject.toml`, `scripts/run-engine.mjs`, `services/api/pom.xml`, `apps/app/tsconfig.json`, app sources (index-access fixes), `engine/tests/test_export_xlsx.py`.
- **Entry check:** standard.
- **Exit check:** standard; a dry CI run (push to `main` only when green) shows every new job passing; B-10 may be split per tool (execution rule 5).
- **Expected baseline changes:** none (ruff/mypy fixes must not change behaviour; compare-baseline proves it).

#### WP-B4 · One source of truth, legacy auth, spec corrections
- **Items:** B-12, B-13, B-14, B-15, B-16, B-17
- **Requires:** WP-A6, WP-A7
- **Touches:** `apps/app/src/features/boq-sheet/model.ts`, `services/api/.../boq/RunReads.java`, `engine/ifc_boq/export_xlsx.py`, `fixtures/subtotals.json`, `engine/ifc_boq/rpc.py`, `templates.py`, `expr.py`, Library item-text and doc utilities, `version-dialogs.tsx`, `ProjectAccess.java`, API hooks, `ExportController.java`, `AdminController.java`, identity (OIDC removal), `ops/*`, docs listed in B-17.
- **Entry check:** standard; owner confirmation for B-16 recorded in `docs/decisions.md` (if absent, do the "declined" variant).
- **Exit check:** standard (contract + Java).
- **Expected baseline changes:** none (B-12 changes only Java's grouped view and the sheet's count; the baseline has no excluded lines).

#### WP-B5 · Sheet payload, server-side grouping, query and API hygiene
- **Items:** B-18, B-19, B-20, B-21
- **Requires:** WP-B2, WP-B4
- **Touches:** `services/api/.../boq/RunReads.java`, `BoqAccess.java`, `Boqs.java`, `identity/NativeCredentials.java`, `application.yml`, `packages/api/openapi.yaml`, `apps/app/src/api/hooks/sheet.ts`, sheet, line detail, viewer, `docs/review/tools/compare_baseline.py` (stack fetch).
- **Entry check:** standard; `npm run local:up`.
- **Exit check:** standard; B-07 perf spec within budget.
- **Expected baseline changes:** stack layer: `lines.json.gz` shape changes (no traces in the list). Update `compare_baseline.py` to fetch traces through `/lines/by-key` (or the new include parameter) **in the same commit** so lines compare as before; after that, 0 differences. Engine layer: none.

#### WP-B6 · Parse performance
- **Items:** B-22, B-23, B-24
- **Requires:** WP-A8
- **Touches:** `engine/ifc_boq/parse.py`, `geometry.py`, `worker.py`, `federation.py`, `engine/requirements.txt`, `engine/tests/test_pilot_capacity.py`.
- **Entry check:** standard; record S06/S07 parse seconds and peak MB from a quiet run (meta.json) as the "before".
- **Exit check:** standard; peak memory and parse time targets in B-22/B-23 met on the same machine.
- **Expected baseline changes:** none within 1e-6 (numbers); `meta.json` timings/memory change but are not compared — record before/after in PROGRESS.md.

#### WP-B2b · Browser specs for the Library editors, viewer, notifications, admin and wizard (split from WP-B2)
- **Items:** B-06b, the area specs of the browser-coverage item (WP-B2 did its axe and pseudo-locale gates; the item's text is in section 4 under WP-B2)
- **Requires:** —
- **Touches:** `apps/app/e2e-java/*.spec.ts` (new: library editors, viewer with WebGL, notifications, admin console, setup wizard paths beyond the suggested one), `apps/app/e2e-java/helpers.ts`, `docs/testing/README.md`, `docs/product/known-limitations.md`.
- **Entry check:** standard; `npm run local:up`; the browser smoke green (`BOQLET_BROWSER_SMOKE=1`, `mvn verify` targeted).
- **Exit check:** standard; `BOQLET_BROWSER_SMOKE=1` run passes with the new specs (inside B-08's per-spec budget); the outcome coverage map in `docs/testing/README.md` names them.
- **Expected baseline changes:** none.

### Phase C packages

#### WP-C1 · BoQ workspace layout and keyboard
- **Items:** C-01, C-02, C-03, C-04, C-05
- **Requires:** —
- **Touches:** `apps/app/src/components/shell/app-shell.tsx`, BoQ page, `boq-header.tsx`, `boq-sheet/sheet.tsx`, `line-detail.tsx`, `viewer/model-viewer.tsx`, `lib/focus.ts`, `messages/en/boqs.json`.
- **Entry check:** standard; `npm run local:demo` for manual checks at 1440×900 and 1024.
- **Exit check:** standard; e2e-java layout/keyboard specs; ≥ 20 rows visible at 1440×900.
- **Expected baseline changes:** none (UI only).

#### WP-C2 · Sheet power features
- **Items:** C-06, C-07, C-08, C-09
- **Requires:** WP-C1, WP-B4, WP-A10
- **Touches:** sheet and model, `globals.css`, `export_xlsx.py` (groupBy), `packages/api/openapi.yaml`, BoQ header, shell (command palette), a Java search endpoint.
- **Entry check:** standard.
- **Exit check:** standard (contract + Java for C-07/C-09).
- **Expected baseline changes:** none (new groupBy values are opt-in; default exports unchanged).

#### WP-C3 · Traceability, review and change report
- **Items:** C-10, C-11, C-12, C-13, C-14
- **Requires:** WP-A2, WP-B5
- **Touches:** `line-detail.tsx`, `RunReads.java`, `engine/ifc_boq/measure.py` (provenance), `packages/types/src/engine.ts`, `changes-tab.tsx`, `review-tab.tsx`, BoQ page tabs, `screens.md`, `permissions.md`.
- **Entry check:** standard; owner answer on DEC-60 recorded (else C-14 does the "declined" variant).
- **Exit check:** standard (types changed: codegen).
- **Expected baseline changes:** every result gains per-input provenance fields in element traces (additions; recapture both layers); no numeric difference.

#### WP-C4 · Questions and decisions
- **Items:** C-15, C-16, C-17, C-18, C-19, C-20
- **Requires:** WP-A5, WP-A6
- **Touches:** questions feature, decisions table, `engine-message.ts`, `messages/en/questions.json`, `engine.json`, `packages/types/src/dictionary.ts`, `presets/dictionaries/global-seed.json`, `engine/ifc_boq/names.py`, `measure.py`, `pipeline.py`, `boq/Decisions.java`, `packages/api/openapi.yaml`, BoQ header.
- **Entry check:** standard.
- **Exit check:** standard (types, contract, Java).
- **Expected baseline changes:** C-16 seed and placeholder changes: name-question counts drop on S03-*, S07-*, S09-*, F01-* (record before/after per run); runs whose only blocking questions were placeholder names may become `complete` (list them); quantities may move where an answer-dependent term now resolves by default (e.g. S09 "Air" → `unspecified`: check the concrete line stays absent, CAS-017/A-14). C-15/C-19 add fields (affected lines, model ids) to questions (additions; recapture).

#### WP-C5 · An Excel the firm can send
- **Items:** C-21, C-22, C-23, C-24
- **Requires:** WP-A8, WP-B3
- **Touches:** `engine/ifc_boq/export_xlsx.py`, `rules.py`, `templates.py`, `worker.py`, `presets/classifications/*`, `presets/rules/as-modelled.json`, `services/api/.../boq/BoqExports.java`, `ExportController.java`, `packages/api/openapi.yaml`, exports tab, share dialog, F12, plans-and-limits.
- **Entry check:** standard.
- **Exit check:** standard (contract + Java); LibreOffice check (B-11) prints the Duplex BoQ on landscape pages.
- **Expected baseline changes:** `xlsx-cells` change in every run: Ref column becomes item/position numbers, "No." numeric (C-23), item texts appear for `demo-trades`/`acme-cost-codes` configs (S05-house, S05-standard, S07-house, S07-standard, S09-house, S03-house…), and line descriptions change where a rule produced duplicate descriptions (C-24: S05-default "Edge formwork to slabs" ×2, S05-standard six groups, S07 "Wall - Timber Clad, 202 mm" pair) — line keys and quantities identical (check). Working-profile sheets otherwise unchanged; Cover!A19 watermark cell moves to the header/footer only for watermark plans (none in the baseline).

#### WP-C6 · The public share page
- **Items:** C-25, C-26, C-27
- **Requires:** WP-C1
- **Touches:** `apps/app/src/features/shares/*`, `components/ui/table.tsx`, `services/api/.../boq/PublicShares.java`, `ShareLinks.java`, a Flyway migration, `packages/api/openapi.yaml`, viewer, F18.
- **Entry check:** standard; `npm run local:demo` and a share link on the Duplex.
- **Exit check:** standard (contract + Java); no internal ids in public payloads (test).
- **Expected baseline changes:** none (the baseline doesn't capture public shares).

#### WP-C7 · Sign-up, onboarding and invitations
- **Items:** C-28, C-29, C-30, C-31, C-32, C-33
- **Requires:** —
- **Touches:** `identity/NativeAuthController.java`, `org/Invitations.java`, `mail/EmailDelivery.java`, `project/Projects.java`, auth adapters, public sign-up and invite pages, onboarding, org dashboard, settings, splash, `permissions.md`, `packages/api/openapi.yaml`.
- **Entry check:** standard; `npm run local:up`; MailHog at http://localhost:8025.
- **Exit check:** standard (contract + Java); a fresh `npm run local:user` link reaches onboarding without a second sign-in; an invitation joins in one screen.
- **Expected baseline changes:** none (the stack tool's account creation goes through setup links; if C-28 changes the set-password response, update `compare_baseline.py`'s sign-up step in the same commit and re-run the stack layer: 0 differences).

#### WP-C8 · Setup wizard, sample project and example presets
- **Items:** C-42, C-34, C-35, C-36, C-37
- **Requires:** —
- **Touches:** `project/SampleProjects.java`, `org/Orgs.java`, `billing/EntitlementService.java`, `library/Library.java`, a Flyway migration (example flag), setup feature and route, Library feature, dashboard, F10, F16, scope-and-acceptance.
- **Entry check:** standard; `npm run local:up`.
- **Exit check:** standard (Java + migration); a new org reaches a working dashboard in one click; criterion 12 run and timed.
- **Expected baseline changes:** stack layer: a fresh org now also gets the sample project and its parse job — the tool's runs are unaffected but org setup takes longer; if the sample changes the org's model dedupe (same Duplex SHA as S05, BR-08), stack:S05-default parse may be served from the sample's parse (faster, same lines): 0 line differences expected. Engine layer: none.

#### WP-C9 · Models and uploads
- **Items:** C-38, C-39, C-40, C-41
- **Requires:** WP-A8, WP-A10
- **Touches:** models feature, upload, project models routes, `org/Attention.java`, `model/Models.java`, `billing/LimitAlerts.java`, notifications text, limit dialog, `messages/en/models.json`, `errors.json`.
- **Entry check:** standard; `npm run local:up`.
- **Exit check:** standard (Java); S13/S14 uploads show specific reasons and both actions.
- **Expected baseline changes:** none.

#### WP-C10 · Billing copy, limits, units note, suspended orgs
- **Items:** C-43, C-44, C-45, C-46
- **Requires:** —
- **Touches:** settings (billing, members), project creation, limit dialog, onboarding/project/settings/rule-set unit choices, shell, `api/hooks/me.ts`, `billing.ts`, F15.
- **Entry check:** standard.
- **Exit check:** standard.
- **Expected baseline changes:** none.

#### WP-C11 · Navigation, notifications and dashboard
- **Items:** C-47, C-48, C-49, C-50, C-51
- **Requires:** —
- **Touches:** route metadata, breadcrumb component, shell, account and notifications pages, `mail/EmailDelivery.java`, `realtime/Notifications.java`, `worker/Jobs.java`, notifications feature, project card, org dashboard, activity feed, audit payloads, F13.
- **Entry check:** standard; MailHog.
- **Exit check:** standard (Java); a > 2 min parse (or a forced one) sends the model-ready email.
- **Expected baseline changes:** none.

#### WP-C12 · Design system and accessibility
- **Items:** C-52, C-53, C-54, C-55, C-56, C-57, C-58, C-59
- **Requires:** WP-B2
- **Touches:** `components/ui/*` (tooltip, status-tag, input), `app/globals.css`, viewer palette, dictionary editor, shell, dashboard, tables, share page, Log/Decisions/Audit/Activity lists, `messages/en/*.json`, presence, design-system.md.
- **Entry check:** standard; B-06 axe gate runs.
- **Exit check:** standard; axe allow-list empty; 0 serious/critical; no horizontal scroll at 390 px on the audited screens.
- **Expected baseline changes:** none.

### Phase D packages

#### WP-D1 · Accuracy validation and measuring depth I
- **Items:** D-01, D-02, D-03, D-04, D-05
- **Requires:** WP-B1
- **Touches:** `engine/tests/reference/`, `docs/testing/engine-validation.md`, `presets/rules/*`, `engine/ifc_boq/measure.py`, `classify.py`, `pipeline.py`, `data/sections.json`, `packages/types/src`.
- **Entry check:** standard; reference BoQs available (D-01 is blocked, not skipped, without them — mark it blocked and continue with D-02…D-05).
- **Exit check:** standard; accuracy table written.
- **Expected baseline changes:** D-02: concrete columns/beams move from `linear-other` lines to new concrete-frame lines with m³, formwork and rebar (S08-default, S07-*, F01-*, S02-default if its column is concrete; S05 steel unaffected). D-03: S08 UB/UC mass lines change. D-04: new IsExternal/material contradiction questions (S01, S07, S09; counts recorded); codes only. D-05: building `gross_volume` changes in every run, and every line using it.

#### WP-D2 · Names at scale and languages
- **Items:** D-06, D-07, D-08, D-09
- **Requires:** WP-C4, WP-B2, WP-A7, WP-A8
- **Touches:** `presets/dictionaries/*`, `engine/ifc_boq/names.py`, `rpc.py`, `log.py`, `rules.py`, `export_xlsx.py`, `model/Models.java`, `mail/EmailDelivery.java`, `apps/app/messages/*`, i18n, sheet, `packages/types/src`, F13, F15.
- **Entry check:** standard.
- **Exit check:** standard (types, contract, Java); pseudo-locale and the second locale pass B-06.
- **Expected baseline changes:** D-06: name questions drop on S03/S07/S09/F01 with the extended seeds (record counts; runs may become `complete`); quantities move only where a resolved name changes a rule match (list lines). D-08: log entries gain codes (result additions). D-09: none (baseline is metric).

#### WP-D3 · Accounts: legal, help, sessions
- **Items:** D-10, D-11, D-12, D-13, D-14
- **Requires:** —
- **Touches:** public routes (terms, privacy, help), sign-up, shell, identity (`NativeAuthController.java`, `Sessions.java`), `org/Orgs.java`, admin and org settings, migrations, `packages/api/openapi.yaml`, plans-and-limits.
- **Entry check:** standard; owner-supplied terms/privacy texts (placeholders allowed; never invent legal text).
- **Exit check:** standard (contract + Java + migrations).
- **Expected baseline changes:** none (if sign-up now requires acceptance, update `compare_baseline.py`'s account step in the same commit; 0 differences after).

#### WP-D4 · Billing core behind a payment-provider interface (stub)
- **Items:** D-15, D-16, D-17, D-18, D-19
- **Requires:** —
- **Touches:** `services/api/.../billing/*`, `admin/AdminOrganisations.java`, `project/Projects.java`, `mail/EmailDelivery.java`, migrations, `packages/api/openapi.yaml`, admin plans and org pages, billing settings, shell banner, plans-and-limits, F14.
- **Entry check:** standard; `npm run local:up`.
- **Exit check:** standard (contract + Java + migrations); scenario tests with a clock override for trials and passes; **no real provider code** (DEC-04).
- **Expected baseline changes:** none (enterprise-plan orgs in the stack tool).

#### WP-D5 · Seats, revenue, usage and pilot measures
- **Items:** D-20, D-21, D-22, D-23
- **Requires:** WP-D4
- **Touches:** `billing/EntitlementCatalogue.java`, `EntitlementService.java`, `admin/AdminReports.java`, usage endpoints, admin overview and funnel, usage settings, `packages/api/openapi.yaml`, plans-and-limits, overview "How we know", F19.
- **Entry check:** standard.
- **Exit check:** standard (contract + Java).
- **Expected baseline changes:** none.

#### WP-D6 · Team governance I: answers, audit, library visibility, publish approval
- **Items:** D-24, D-25, D-26, D-27
- **Requires:** WP-A11
- **Touches:** `boq/Decisions.java`, `boq/Adjustments.java`, `library/Library.java`, `audit/*`, org access, org settings, `packages/api/openapi.yaml`, questions, decisions, Library (usage, publish dialog), `permissions.md`, F09.
- **Entry check:** standard; `npm run local:up`.
- **Exit check:** standard (contract + Java); the LEAD-003/005/006 repros pass as scenario tests.
- **Expected baseline changes:** none.

#### WP-D7 · Team governance II: approval policy, preset policy, team view, staffing
- **Items:** D-28, D-29, D-30, D-31
- **Requires:** WP-A11, WP-B4, WP-C8
- **Touches:** `boq/Boqs.java`, `project/ProjectAccess.java`, `boq/BoqInputs.java`, `org/Attention.java`, org/project membership, migrations, `realtime/Notifications.java`, `packages/api/openapi.yaml`, Setup tab, team page, project settings, members settings, F09.
- **Entry check:** standard.
- **Exit check:** standard (contract + Java + migrations).
- **Expected baseline changes:** none.

#### WP-D8 · Models, runs and library depth
- **Items:** D-32, D-33, D-34, D-35, D-36
- **Requires:** WP-C9, WP-A11, WP-B4
- **Touches:** models feature, `model/Models.java`, new run route, versions feature, Setup tab scope editor, `boq/BoqInputs.java`, `library/Library.java`, `engine/ifc_boq/codelist_import.py`, `overrides.py`, `boq/Adjustments.java`, `packages/types/src`, `packages/api/openapi.yaml`, BR-09.
- **Entry check:** standard.
- **Exit check:** standard (types, contract, Java). D-35 may be split (rule 5).
- **Expected baseline changes:** D-36 adds an optional field to overrides (no override in the baseline → none).

#### WP-D9 · Work beyond the model
- **Items:** D-37, D-38, D-39
- **Requires:** WP-A7, WP-C8
- **Touches:** `engine/ifc_boq/expr.py`, `rules.py`, `sheets/boq_import.py`, `codelist_import.py`, `packages/types/src/rules.ts`, Add-line dialog, code import, setup.
- **Entry check:** standard.
- **Exit check:** standard (types).
- **Expected baseline changes:** none (new expression functions unused by shipped presets).

#### WP-D10 · Export formats
- **Items:** D-40, D-41
- **Requires:** WP-C5
- **Touches:** `engine/ifc_boq/export_*.py`, `engine/requirements.txt`, `boq/BoqExports.java`, `packages/api/openapi.yaml`, exports tab, `docs/domain/sourcing-and-licensing.md`, Q12.
- **Entry check:** standard; for D-41 the sourcing check recorded first.
- **Exit check:** standard (contract + Java); no licensed material in the repo (rule 8).
- **Expected baseline changes:** none (xlsx unchanged; new formats are new outputs).

#### WP-D11 · Engine measuring depth II
- **Items:** D-42, D-43, D-44, D-45, D-46
- **Requires:** WP-B6, WP-D1
- **Touches:** `engine/ifc_boq/measure.py`, `geometry.py`, `parse.py`, `worker.py`, `data/families.json`, `data/quantity_sources.json`, `presets/rules/as-modelled.json`, `packages/types/src`, models feature (IDS).
- **Entry check:** standard.
- **Exit check:** standard (types); `test_duplex.py` green (update `HAND_BOQ` only with hand-derived reasons).
- **Expected baseline changes:** D-42: finish lines per face change where openings sit on one face or walls have niches (S05-*, S07-*, F01-*, F02-default; record); D-43: S04-default lines gain locations; S07 terrain line only if the rule item is enabled (off by default → none); D-44: ArchiCAD reported quantities adopted where verified (S11-default, S12-default are ArchiCAD/Solibri-optimised: list changes); D-45/D-46: none.

#### WP-D12 · Security features
- **Items:** D-47, D-48, D-49, D-50, D-51
- **Requires:** WP-A9, WP-D7, WP-B4
- **Touches:** `services/api/.../identity/*`, `org/*`, `audit/*`, `maintenance/*`, `worker/*`, `storage/ObjectStorage.java`, `engine/ifc_boq/storage.py`, migrations, `packages/api/openapi.yaml`, account page, auth adapters, `ops/pilot/compose.yaml`.
- **Entry check:** standard; `npm run local:up`.
- **Exit check:** standard (contract + Java + migrations); NativeWorkerTest green with the worker holding no storage keys. D-51 may be split (SSO, SCIM).
- **Expected baseline changes:** none (if sign-in changes for the stack tool's accounts, update `compare_baseline.py`; 0 differences after).

#### WP-D13 · Federation alignment, CDE pull, viewer depth
- **Items:** D-52, D-53, D-54, D-55
- **Requires:** WP-A5, WP-B5, WP-C1, WP-C9, WP-C12
- **Touches:** `engine/ifc_boq/federation.py`, `packages/types/src`, `model/*` (CDE connector), models feature, viewer, sheet filter bar, `docs/architecture/modules.md`.
- **Entry check:** standard.
- **Exit check:** standard (types, contract, Java); B-07 perf budget met for the viewer.
- **Expected baseline changes:** D-52: F01 may gain an alignment question if an offset is detected (S07/S08 share coordinates — expect none; explain any).

#### WP-D14 · Platform operations
- **Items:** D-56, D-57, D-58, D-59
- **Requires:** WP-D3, WP-D4
- **Touches:** `ops/pilot/*`, `ops/onprem/*`, `.github/workflows/ci.yml`, `services/api/.../admin/*`, `maintenance/*`, `mail/EmailDelivery.java`, admin health, admin routes, `docs/operations/*`.
- **Entry check:** standard; operator access for D-56; owner confirmation for D-58 (DEC-63) and an owner decision to offer D-59 — without them those items stay **blocked**.
- **Exit check:** standard (Java); restore drill documented.
- **Expected baseline changes:** none.

#### WP-D15 · Pricing module I: rate library, pricebooks and estimates
- **Items:** D-60, D-61
- **Requires:** WP-C5, WP-D14
- **Touches:** `packages/pricing-api/openapi-pricing.yaml`, `services/api/.../extension/*`, a new pricing backend module and schema, a new frontend package, `docs/architecture/modules.md`, F20.
- **Entry check:** standard; ArchUnit `CoreArchitectureTest` green.
- **Exit check:** standard (both contracts: `npm run api:lint` covers `openapi-pricing.yaml`); the core builds and passes every test with the module removed (P36). D-61 may be split by F20 section.
- **Expected baseline changes:** none (module off in the baseline).

#### WP-D16 · Pricing module II: vendors and offer requests
- **Items:** D-62, D-63
- **Requires:** WP-D15
- **Touches:** pricing module (backend, frontend, contract), admin routes, F11, F17.
- **Entry check:** standard; ArchUnit green.
- **Exit check:** standard; core passes with the module removed; security review of the vendor access kind recorded.
- **Expected baseline changes:** none.

---

## 6. Execution instructions for every follow-up session

### 6.1 The procedure

1. **Read `docs/review/BLUEPRINT.md` and `docs/review/PROGRESS.md`, and pick the next package whose
   prerequisites are done**: the first package in section 5's order whose status is `todo` and whose
   prerequisites are all `done`. Mark it `in progress` in PROGRESS.md (with the date) before starting.
2. **Run its entry check, then work through its items, committing once per item** (on `main`, CLAUDE.md;
   message `WP-xx A-nn: <title>` plus the reason when numbers change on purpose, rule 7). Each item's commit
   includes its tests, its doc changes (section 3.5) and the CLAUDE.md after-task duties.
3. **Run the exit check**: run `docs/review/tools/compare-baseline` and `docs/review/tools/verify-quantities`,
   and record each baseline difference in PROGRESS.md's "Baseline differences log" as **intended** (with the
   item id) or treat it as a **regression** and fix it. When a package intentionally changes output, update
   the baseline in the same commit as the change that causes it (`docs/review/tools/compare-baseline
   --capture`, plus the stack layer when the stack is up) and note it; update `verify_quantities.py` when a
   KNOWN row turns FIXED.
4. **Mark the package done in PROGRESS.md** with notes, decisions and anything newly discovered. **New issues
   become new items in a later package** ("New items discovered" in PROGRESS.md, with an id like `N-01` and a
   proposed package), **never silent scope changes**.
5. **If a package turns out too large**, finish a coherent subset, split the rest into a new package (e.g.
   `WP-C2b`, prerequisites = the original's), record the split in PROGRESS.md and in BLUEPRINT.md's package list (section 5)
   (append, don't renumber).

Pushing: every green push to `main` deploys to booqlet.com (P51). Push only after the exit check is green; never
push red. If a package needs an owner decision that isn't recorded (items marked "owner to confirm"), do the
documented fallback or mark the item `blocked` and continue with the rest of the package.

### 6.2 Practical notes

- **Stack**: `npm run local:up` starts the backend in Docker (Java :8080, S3 :8333, MailHog :8025, Postgres
  :55432); `npm run local:demo` adds the app on :3000 with a demo account and prints its credentials;
  `npm run local:check` is a 10 s end-to-end smoke; `npm run local:user -- <email>` makes a one-hour sign-up link,
  `npm run local:admin -- <email>` a platform admin. **The stack layer of compare-baseline tests the images
  `npm run local:up` built last: after any engine or API change run `npm run local:up` before the stack layer.**
- **Samples**: `bash docs/review/tools/fetch-samples.sh` downloads S01–S12 from pinned URLs and derives S13–S14
  (SHA-256 checked; `--verify` offline). They are git-ignored (`docs/review/.gitignore`) and never committed.
- **compare-baseline**: the engine layer takes ~30 min (mostly S06), the stack layer ~20 min. While iterating
  use `--parse-cache` (reuses JSON-round-tripped parses; note it follows the worker path, DEC-06) and `--only
  <run ids>`; the exit check is the **full default run** (`docs/review/tools/compare-baseline`, both layers).
  Exit codes: 0 no differences, 1 differences (listed and written to `docs/review/_scratch/compare/<stamp>/
  differences.txt`), 3 a layer could not run. Timings are never compared.
- **verify-quantities**: ~4 min cold, ~10 s with the parse cache. On unchanged code: 22 OK / 8 KNOWN, exit 0.
  `--strict` fails on FIXED rows (use it after updating expectations).
- **State on the unchanged code** (end of the review): compare-baseline 0 differences in 47 runs;
  verify-quantities 22 OK / 8 KNOWN, exit 0. The 8 KNOWN rows are S04-footing-formwork, S05-beam-mass,
  S05-partywall-area, S05-partywall-line, S08-pilecap-area, S08-pilecap-edge-formwork, S09-slab-area,
  S09-floor-volume; Phase A turns each FIXED (WP-A1, WP-A3, WP-A4).
- **Java suites are timing-sensitive under load** (DEC-07): run `mvn verify` on a quiet machine (no parallel
  compare-baseline or dev server compiling); re-run a timeout-only failure once, targeted
  (`-Dtest=NativeWorkerTest`, `BOQLET_SCENARIO_FILTER=…`, `BOQLET_BROWSER_SMOKE_FILTER=…`) before calling it red.
- **Headless browser**: Playwright is at the repo root; use `waitUntil: "domcontentloaded"`, never
  `networkidle` (SSE keeps the network busy); first compile in `next dev` takes 10–60 s.
- **CLAUDE.md after-task duties** (every item): a row in `docs/changelog.md`; update
  `docs/product/known-limitations.md` and the feature's status block when a limitation or gap changes; record
  decisions in `docs/decisions.md` (the DEC entries here that a package implements become P/D entries there
  when they change product behaviour). Types first (`packages/types/src` → `npm run codegen`), contract first
  (`packages/api/openapi.yaml` → `npm run api:gen`, Java and app in one commit). Keep the Duplex acceptance test
  green; update `HAND_BOQ` only with a hand derivation and the reason in the commit.
- **Read before writing Next.js code**: `apps/app/AGENTS.md` (the bundled Next.js docs).
- **Detail**: each item cites the report and verify sections; the scripts that reproduced a finding are under
  `docs/review/_scratch/<reviewer>/` (git-ignored, local to the review machine — if absent, the item's
  acceptance criteria are self-contained).

---

## 7. Coverage

Generated from the items' **Sources** lines by the review's consolidator; checked by `docs/review/tools/check-blueprint.py` (run it after editing this file). Verdict and final severity are the verifiers'.

### 7.1 Findings → items

| Finding | Title (short) | Verdict | Final severity | Items |
|---|---|---|---|---|
| ENG-001 | Every non-ASCII string literal in an expression is decoded wrongly (`"béton"` becomes `"bÃ | verified | high | A-22 |
| ENG-002 | Browser uploads above 100 MiB cannot work (FM-16) | verified | high | A-40 |
| ENG-003 | One element broken into several parts with `onMissing: "ask"` raises duplicate question id | adjusted | medium | A-25, B-01 |
| ENG-004 | Breakdown `material` gives every material group the whole element's `gross_volume` | adjusted | high | A-24, B-01 |
| ENG-005 | `FLOOR(x, step)` and `CEIL(x, step)` have floating-point errors that `ROUND` and the rule | verified | medium | A-23 |
| ENG-006 | User regexes run unbounded: any project viewer can hang the shared engine (ReDoS) | verified | high | A-35 |
| ENG-007 | The sheet downloads every line with its full element trace; the payload grows with the ele | verified | medium | B-07, B-18 |
| ENG-008 | Two rules that match the same element both count it, with no question or warning, unless t | verified | medium | A-20, B-01 |
| ENG-009 | Which questions block is decided by a regex over the rule set's JSON text, including label | adjusted | low | A-26 |
| ENG-010 | Unknown or custom units silently convert by a factor of 1; dimensions are not checked; `mi | verified | medium | A-28, B-15 |
| ENG-011 | A property set or quantity set with a null `Name` crashes the CLI, but is silently renamed | adjusted | medium | A-31 |
| ENG-012 | A truncated IFC fails with an uninformative message | verified | low | A-32 |
| ENG-013 | A deeply nested expression raises `RecursionError`, which reaches users as `503 engine_una | verified | low | A-27 |
| ENG-014 | Different 404 messages reveal whether another org's object exists | verified | low | A-37 |
| ENG-015 | Group subtotals are computed in three places, and they disagree | adjusted | low | B-12 |
| ENG-016 | The reviewer picker filters on the stored project role; Java checks the effective role | verified | low | B-14 |
| ENG-017 | The client keeps re-implementations of engine text and expression logic (item-text "Reads | verified | low | B-13 |
| ENG-018 | Importing edits from Excel reads `"1,234"` as 1.234 | verified | medium | A-30 |
| ENG-019 | A line edit is never flagged when the engine's quantity under it changes in a new model ve | adjusted | low | D-36 |
| ENG-020 | Federation overlaps (possible double counts) and unmatched elements are non-blocking; a ru | adjusted | medium | A-19 |
| ENG-021 | Mass quantities and property-level units are not converted | verified | low | A-29 |
| ENG-022 | Dictionary regexes are documented as ECMAScript but run on Python `re` | verified | low | A-35 |
| ENG-023 | `addReveals` with surface `both` counts the reveals twice | verified | low | A-12 |
| ENG-024 | Share links can be created on an archived BoQ | verified | low | A-39 |
| ENG-025 | Parse memory grows with geometry, not file size; every mesh is held until the end of the p | verified | medium | B-22 |
| ENG-026 | Parse CPU is spent largely in Python post-processing, not the kernel | verified | low | B-23 |
| ENG-027 | Test oracles are weak in several places, and none of ENG-001…011 is covered | verified | medium | B-02, B-03, B-04 |
| ENG-028 | CI and tooling gaps | verified | medium | B-05, B-08, B-09, B-10 |
| ENG-029 | Legacy OIDC/Keycloak code and deployment remain after native sign-in (P50) | adjusted | low | B-16 |
| ENG-030 | Small duplicated helpers drift: CSV escaping, job polling, unit maps | adjusted | low | B-15 |
| ENG-031 | Revision and BoQ views run N+1 queries | verified | low | B-20 |
| ENG-032 | Decisions are project-wide, so an answer given while working on one BoQ changes every BoQ | verified | low | C-17 |
| PRD-001 | First BoQ from a public Revit sample shows quantities 1000× too large, labelled "measured" | verified | critical | A-01, A-02 |
| PRD-002 | Required setup wizard gives no value on first run (no model, no sample, one-click no-op) a | adjusted | medium | C-35 |
| PRD-003 | Free is the only self-serve entry and cannot sell the product: 1 seat, no approval, no tri | verified | high | D-15, D-16, D-19 |
| PRD-004 | Trial and downgrade logic not built: a "trial" is only a date and status label; nothing re | adjusted | medium | D-16, D-17 |
| PRD-005 | Primary market is design-led DACH/CEE, but the only output is Excel: no GAEB / ÖNORM, no s | adjusted | medium | D-40, D-41 |
| PRD-006 | Names are the main blocker and the vocabulary is tiny: 56 terms, common English Revit name | adjusted | high | C-16, D-06 |
| PRD-007 | Accuracy never validated against a professional BoQ while the product claims O1/O3 "Built" | verified | high | B-17, D-01 |
| PRD-008 | No takeoff for what is not modelled (2D/PDF), so firms still need a second tool | adjusted | medium | D-37 |
| PRD-009 | Developer demo presets shown to real customers ("ACME Ltd house rules", "Demo: small custo | verified | medium | C-42 |
| PRD-010 | Admin plan editor shows the watermark feature inverted: "Excel without the watermark — Inc | verified | medium | A-42 |
| PRD-011 | "Paying organisations" counts any org not on the plan id `free`, with no payment and no pr | adjusted | low | D-21 |
| PRD-012 | The Excel handed to clients mixes internal working: line keys, rule-set version UUID chain | adjusted | medium | A-34, C-22 |
| PRD-013 | Limits UX is reactive: forms that always fail on Free, no alternatives in the limit dialog | verified | medium | C-44 |
| PRD-014 | Sample project only on an empty dashboard, only after the wizard, never as the wizard's mo | verified | medium | C-34 |
| PRD-015 | Question noise and misleading completion: "COMPLETE" with 4 unquantified lines and open co | adjusted | low | C-20 |
| PRD-016 | Imperial is offered in onboarding and project creation but does nothing | verified | medium | C-45, D-09 |
| PRD-017 | The pilot cannot answer its own questions: success measures mostly not instrumented | verified | medium | D-23 |
| PRD-018 | No in-product help, documentation, support contact, terms or privacy pages | verified | medium | D-10, D-11 |
| PRD-019 | Pricing model not fit for the market evidence in the docs: pay-per-project entry point dro | adjusted | low | D-16 |
| PRD-020 | Scope ahead of validation: pricing module, vendors, offer requests, four-eyes approval and | adjusted | low | D-60, D-61, D-63 |
| PRD-021 | No rates at all in the core: the design-stage "cost check" job is unsupported until the wh | verified | medium | D-60 |
| PRD-022 | After setting a password the user must sign in again | verified | low | C-28 |
| PRD-023 | Onboarding form: address prefilled "000", currency and country are free-text boxes; "Au" w | verified | low | C-29 |
| PRD-024 | Copy promises what isn't built: "You can invite colleagues next" and "You can change them | verified | low | C-30 |
| PRD-025 | Small first-run friction: model is created then uploaded (two steps); project overview emp | verified | low | C-38 |
| PRD-026 | Free-plan watermark is one deletable cell ("Made with boqlet" in Cover!A19) | verified | low | C-21 |
| PRD-027 | Billing page shows "Price on request" even for Free, and lists only some limits | verified | low | C-43 |
| PRD-028 | Single active session plus a 5.3 s logo splash after each sign-in add friction to a daily | verified | low | C-33 |
| CAS-001 | IFC4 sample house: ground-floor slab 146,199 m² and concrete 13,243 m³ (×1000), and the | verified | critical | A-01, A-02 |
| CAS-002 | "Excel" on the sheet silently exports the last run, not what the sheet shows: my edits w | verified | high | A-41 |
| CAS-003 | No PDF, and the Excel prints badly: 6 portrait pages, descriptions and quantities on dif | adjusted | medium | C-21, D-40 |
| CAS-004 | Blocking "What is this material?" questions with a tiny vocabulary: "Damp-proofing", "La | adjusted | medium | C-16 |
| CAS-005 | Edits and answers do nothing until "Generate again"; "Save version" is disabled meanwhil | verified | medium | C-08 |
| CAS-006 | Mandatory setup wizard before I can upload anything; jargon; its preview needs a model I | verified | medium | C-35 |
| CAS-007 | Country and currency fields silently truncate: "Ireland" became "IR" (Iran) | adjusted | low | C-29 |
| CAS-008 | Without a classification the BoQ is one flat list; "Group by" offers only "No grouping" | verified | medium | C-07 |
| CAS-009 | "Demo:" and "ACME Ltd" presets shown to a real customer | verified | medium | C-42 |
| CAS-010 | Truncated file gets a vague error; no next step after any failure; failed versions are i | adjusted | medium | A-32, C-39 |
| CAS-011 | File-size limit message: "Model file size (MB), 62.06393051147461 of 50" in a disappeari | verified | medium | C-40 |
| CAS-012 | No price anywhere: every plan, including Free, says "Price on request"; upgrading leads | verified | medium | C-43, D-16, D-19 |
| CAS-013 | Questions are written for BIM experts | verified | medium | C-15 |
| CAS-014 | Model page full of unexplained technical checks and IFC class names | verified | medium | C-41 |
| CAS-015 | Excel is an audit workbook, not something to send a client | verified | medium | C-22 |
| CAS-016 | Share page on a phone hides the quantity column | adjusted | low | C-26 |
| CAS-017 | "In-situ concrete" line counts the whole 470 mm floor build-up (screed, insulation, bloc | verified | medium | A-14 |
| CAS-018 | Main roof has no quantity and no hint how to fix it | verified | medium | A-15 |
| CAS-019 | After setting the password I'm sent to an empty sign-in page | verified | low | C-28 |
| CAS-020 | Onboarding "ADDRESS" means a web address, prefilled "000" | verified | low | C-29 |
| CAS-021 | Onboarding promises "You can invite colleagues next" but there is no invite step | verified | low | C-30 |
| CAS-022 | Two steps to upload: first "Add model" with a name and discipline, then "Upload IFC" | verified | low | C-38 |
| CAS-023 | Mixed status signals: "COMPLETE" next to "3 to confirm" and "4 questions to answer" | verified | low | C-20 |
| CAS-024 | Change summary says "Lines changed 2" but lists one | verified | low | C-12 |
| CAS-025 | Two lines with the same description "Edge formwork to slabs" and different quantities | verified | low | C-24 |
| CAS-026 | Notifications and emails say what happened but not to what | verified | low | C-49 |
| CAS-027 | Exports list shows the same file name twice; only the time differs | verified | low | A-41 |
| CAS-028 | Share page shows the client my edits and the measured value ("Edited (measured: 44.91)") | verified | low | C-27 |
| CAS-029 | The Free "watermark" is one small "Made with boqlet" line on the Cover sheet | verified | low | C-21 |
| CAS-030 | Add-line dialog: Unit and Kind selects have no accessible label | rejected | — | rejected: the Unit and Kind selects are labelled implicitly by a wrapping <label>; ARIA names present, axe clean (verify-frontend §3) |
| CAS-031 | 3D panel open by default squeezes descriptions to ~20 characters at 1440 px | verified | low | C-03 |
| CAS-032 | Some clicks in the questions list take up to ~30 s to register | rejected | — | rejected: not reproducible (335 ms on an idle stack); shared-load / dev-compile artefact (verify-frontend §3) |
| QS-001 | A reported volume 1,000× the geometry is adopted; slab area derived from it is ×1000 | verified | critical | A-01, A-02, A-05, D-05 |
| QS-002 | Quantity contradictions never block and always recommend the file's value; naming question | verified | high | A-04 |
| QS-003 | Pile caps (IfcSlab BASESLAB) take area and thickness from erroneous Revit quantity sets; t | adjusted | critical | A-03 |
| QS-004 | Wall area = volume ÷ layer-set thickness understates walls whose body is not a full prism | adjusted | medium | A-09 |
| QS-005 | Formwork to footings = 2 × longest extent × height; wrong for any non-straight footing | verified | high | A-10 |
| QS-006 | Federation silently resolves the same GlobalId with different type, thickness or area in t | verified | high | A-18 |
| QS-007 | Walls not recognised by the dictionary are coded "Internal walls", even when `IsExternal = | adjusted | medium | A-21, D-04 |
| QS-008 | A line missing some elements' values is not flagged; only a note says so | verified | medium | A-05 |
| QS-009 | Paint (layer areas) ignores the wall opening rule and is a centreline area | verified | medium | A-11, D-42 |
| QS-010 | Decisions that change quantities are invisible on the line and in the run statistics | verified | medium | A-06 |
| QS-011 | "How it is calculated" omits each element's measured inputs and their provenance | verified | medium | C-10 |
| QS-012 | Steel mass uses Revit's analytical "Length", not the member's cut length | verified | low | A-17, D-03 |
| QS-013 | No plausibility checks on what an element "is" | verified | medium | A-03, A-07 |
| QS-014 | Proxies are counted as BoQ items by default: people, trees, plates, glasses, appliances | verified | medium | A-16 |
| QS-015 | Concrete columns and beams are measured only by length; there is no concrete-frame item | adjusted | medium | D-02 |
| QS-016 | The Excel BoQ falls short of a professional bill | verified | medium | C-21, C-23, C-24, D-40 |
| QS-017 | The sample project seeds decisions in the user's name and pre-answers the party-wall contr | verified | medium | C-34 |
| QS-018 | A window without a host opening is counted with no warning; no wall is reduced | verified | low | A-08 |
| QS-019 | Descriptions are truncated to about 12 characters while the 3D viewer is open | verified | low | C-03 |
| QS-020 | "Add reveals back" adds reveals to the **wall** area | verified | low | A-12 |
| QS-021 | The Duplex acceptance test is not an independent check of the wall method | verified | medium | B-03, B-04 |
| QS-022 | Naming questions dominate the review queue | verified | medium | C-16, D-06 |
| QS-023 | Slab-edge formwork options are labelled "outer edge" while the geometric perimeter already | verified | low | A-13 |
| LEAD-001 | A promoted answer is silently dropped when a library draft opened before the promotion i | verified | high | A-43 |
| LEAD-002 | A published org rule set never reaches existing projects; projects are frozen to the pre | verified | high | A-44 |
| LEAD-003 | The same model gives different BoQs to different estimators: answers are per project, an | adjusted | medium | D-24 |
| LEAD-004 | With approval and four-eyes on, an estimator can still give a client an unreviewed worki | adjusted (category) | high | A-46 |
| LEAD-005 | The library editor can't see their presets' usage, preview on firm projects, or promote | verified | medium | D-26 |
| LEAD-006 | The audit records that something changed, not what changed | verified | medium | D-25 |
| LEAD-007 | Overwriting a colleague's answer has no warning and no notice | verified | medium | C-17 |
| LEAD-008 | No four-eyes on the firm's standards; starring silently sets defaults for every new proj | verified (stronger) | medium | A-45, D-27 |
| LEAD-009 | Choosing reviewers changes who is notified, not who may approve; org admins approve subm | adjusted | medium | D-28 |
| LEAD-010 | No team or portfolio oversight: "Needs you" is personal, and the lead sees nothing | verified | medium | D-30 |
| LEAD-011 | Cost can't be justified: prices are "on request", and read-only and approver seats cost | verified | medium | D-20 |
| LEAD-012 | Joining from an invitation takes five screens, and the main button misleads a new person | verified | medium | C-31 |
| LEAD-013 | New members land on "Start your first project" in an org whose projects they can't see | verified | medium | C-32 |
| LEAD-014 | Staffing projects is one person at a time | verified | medium | D-31 |
| LEAD-015 | Estimators can switch a BoQ to any system or demo preset; no org policy keeps work on th | verified | medium | D-29 |
| LEAD-016 | Absurd quantities raise no warning; review is the only safeguard | verified | medium | A-07 |
| LEAD-017 | Usage shows only this month, by project; nothing by person or over time | verified | low | D-22 |
| LEAD-018 | Library editors can't read the org audit; the CSV shows ids, not names | verified | low | D-26 |
| LEAD-019 | Notification emails are generic | verified | low | C-49 |
| LEAD-020 | Viewers can't see the change report | verified | low | C-14 |
| LEAD-021 | The review screen doesn't say who made each line edit | verified | low | C-13 |
| LEAD-022 | Presence avatars are initials only (two "EE"s) | adjusted | low | C-59 |
| LEAD-023 | Project cards don't show BoQ state; labels run together | verified | low | C-50 |
| UX-001 | The Source column (TO CONFIRM / DERIVED / MANUAL) is hidden by default whenever the 3D p | adjusted | medium | C-02 |
| UX-002 | Keyboard focus jumps to "Generate again" on every BoQ workspace load | adjusted | low | C-04 |
| UX-003 | The sheet gets about a third of the screen: grid starts at y≈595 px of 900 at 1440, and | verified | high | C-01 |
| UX-004 | The setup wizard shows raw formula editors and rule-engine concepts to first-time users | adjusted | medium | C-35 |
| UX-005 | 3D viewer colours break the guidelines: green for "measured", a Tableau palette (incl. g | adjusted | medium | C-55 |
| UX-006 | Dark mode: the viewer stays a light block and its toolbar icons disappear | verified | medium | C-55 |
| UX-007 | No column sorting, no density switch, no column resizing in the sheet | verified | medium | C-06 |
| UX-008 | Opening line detail squeezes the sheet to ~14 characters of description | verified | medium | C-03 |
| UX-009 | Share page shows clients raw internal setting keys and formula syntax | verified | medium | C-25 |
| UX-010 | Share page hides flags and item numbers: a client sees "—" with no explanation | verified | medium | C-26 |
| UX-011 | A failed upload is a dead end, and failed versions consume version numbers | verified | medium | C-39 |
| UX-012 | Models page: an always-open "Add model" form, a two-step add-then-upload, and no drop zo | verified | medium | C-38 |
| UX-013 | Disabled primary buttons give no reason | verified | medium | C-52 |
| UX-014 | Tooltips are `title=` attributes (155 of them); there is no Tooltip component | adjusted | low | C-52 |
| UX-015 | More than one primary (purple) button per screen | verified | low | C-53 |
| UX-016 | Checkboxes and radios come in three looks: browser blue, purple, ink | verified | low | C-53 |
| UX-017 | Inputs are 28 px with a grey fill and 12 px text; buttons are 32 px. Fields read as disa | verified | low | C-53 |
| UX-018 | Dashboard card: "QUESTIONS" and "IN REVIEW" run together ("QUESTIONSIN REVIEW"), and "Qu | verified | medium | C-50 |
| UX-019 | Status vocabulary drift: BLOCKING uses the filled-ink tag reserved for "Confirmed"; the | verified | low | C-54 |
| UX-020 | No breadcrumbs inside a project, and several page titles are generic | verified | medium | C-47 |
| UX-021 | No global search or command palette** (FM-31) | verified | medium | C-09 |
| UX-022 | /account and /notifications sit outside the app shell (no nav, no `main`) | adjusted | low | C-48 |
| UX-023 | Notifications and toasts are vague | verified | low | C-49 |
| UX-024 | Keyboard: 37 Tab stops before the sheet; the resize handle has no visible focus | verified | medium | C-04 |
| UX-025 | Long lists aren't virtualised or paged visibly: Log is 10–13k px tall | verified | low | C-57 |
| UX-026 | The sheet toolbar reflows between BoQs and widths; "Add line" appears twice | verified | low | C-01 |
| UX-027 | The bulk-selection bar pushes the grid down instead of overlaying | verified | low | C-01 |
| UX-028 | Decisions page shows internal question ids and enum values | verified | medium | C-18 |
| UX-029 | Jargon and raw identifiers across Library, wizard and sheet | verified | low | C-58 |
| UX-030 | Question text exposes IFC internals and negative percentages | verified | low | C-15 |
| UX-031 | Line-detail numbers are unrounded and unit-less in places | verified | low | C-11 |
| UX-032 | Sign-up: the 15-character rule is enforced by the native browser bubble; afterwards the | verified | low | C-28 |
| UX-033 | Onboarding promises an invite step that doesn't exist | verified | low | C-30 |
| UX-034 | Setup wizard and sign-in don't use the poster language the guidelines specify | verified | low | C-37 |
| UX-035 | Wizard offers choices that do nothing | verified | low | C-35 |
| UX-036 | Demo presets clutter every new firm's Library | verified | low | C-42 |
| UX-037 | During a run the Sheet tab says "Generate the BoQ to see its lines." | verified | low | C-05 |
| UX-038 | "Needs you" actions are all named "Open" | verified | low | C-50 |
| UX-039 | Billing copy: the Free plan is "Price on request" | verified | low | C-43 |
| UX-040 | Model version page layout and ambiguous counts | verified | low | C-41 |
| UX-041 | Project activity entries are vague and their timestamps wrap | verified | low | C-51 |
| UX-042 | axe results** (80 scans; numbers are violations × nodes) | verified | medium | B-06, C-56 |
| UX-043 | At 390 px the org chrome overflows horizontally | verified | low | C-56 |
| UX-044 | At 1024 (and 768) the sheet's Source column is cut off and the toolbar takes three rows | verified | low | C-02 |
| UX-045 | The share page header doesn't follow the guidelines' expressive spec; the watermark runs | verified | low | B-17, C-27 |
| UX-046 | The model list in Setup, the viewer and the share 3D use generic or raw names | verified | low | C-25 |
| UX-047 | spec-issue: design-system.md lists components that don't exist; screens.md claims chrome | verified | low | B-17 |
| UX-048 | spec-issue: the guidelines ask for a density switch and three-line text clamp that the d | adjusted | low | C-06 |
| VER-001 | Share line detail lists element models as raw version-id prefixes (verify-frontend) | new (verifier) | — | C-25 |
| VER-002 | Share 3D says "0 elements of this line" for a line with 3 elements (verify-frontend) | new (verifier) | — | C-25 |
| VER-003 | Model and model-version pages have the bare title "boqlet" (verify-frontend) | new (verifier) | — | C-47 |
| VER-004 | A 74-byte file shows "SIZE 0 MB" (verify-frontend) | new (verifier) | — | C-40 |
| VER-005 | model_version.ready sends no email (category null); FM-50 missing (verify-product) | new (verifier) | — | C-49 |
| VER-006 | S10 resolves "0 of 0 distinct names" (verify-engine) | new (verifier) | — | A-33 |
| VER-007 | Excel rule-chain label carries a version id where the slug is expected (verify-product) | new (verifier) | — | A-34 |

### 7.2 Feature matrix → items

Status is 00-context's, with the verifiers' corrections (FM-19, FM-70, FM-123 partial; FM-50 missing).

| FM | Feature (short) | Status | Items / disposition |
|---|---|---|---|
| FM-01 | Native email+password sign-in, one active session, takeover | built | built — no item |
| FM-02 | Public sign-up (platform setting, off by default) and self-service password res… | built | built — no item |
| FM-03 | Bot protection for public sign-up (captcha / proof of work) | partial | D-12 |
| FM-04 | Terms / privacy acceptance at sign-up; terms pages | missing | D-10 |
| FM-05 | Invite colleagues during onboarding (FL-1 step 3) | missing | C-30 |
| FM-06 | Takeover prompt names where the other session is | missing | D-13 |
| FM-07 | Configurable idle session expiry | missing | D-13 |
| FM-08 | `ownedOrgsPerUser` enforced on ownership transfer | diverges | D-14 |
| FM-09 | Orgs, invitations, roles, multi-org membership, members' last activity | built | built — no item |
| FM-10 | MFA (users and platform admins), enterprise SSO/SCIM | missing | D-47, D-51 |
| FM-11 | Projects: create, settings, members, archive, dashboard "Needs you", sample pro… | built | C-34 |
| FM-12 | Default-preset pickers at project creation and in project settings | missing | A-44 |
| FM-13 | Warning when a project's default preset is archived | missing | A-44 |
| FM-14 | Project unit system (metric/imperial) changes output | missing | C-45, D-09 |
| FM-15 | Models and versions, browser upload to signed URL, parse job with live progress… | built | built — no item |
| FM-16 | Uploads > 100 MB (multipart) with progress and resume | missing (likely broken) | A-40 |
| FM-17 | `.ifczip` upload | diverges | C-38 |
| FM-18 | Scope rules per model / BoQ editable | missing | D-34 |
| FM-19 | Version list: used by, note, compare two versions' summaries, delete | partial | C-39, D-32 |
| FM-20 | Coordinate alignment between federated models | missing | D-52 |
| FM-21 | BoQs, inputs (model versions + presets), runs as jobs, needs-input state, run h… | built | built — no item |
| FM-22 | Open an earlier run read-only | missing | D-33 |
| FM-23 | "Generate a BoQ" offered in the model-ready notification | diverges | B-17 |
| FM-24 | Questions: answer, bulk answer, dismiss; decisions page with CSV; promote to th… | built | built — no item |
| FM-25 | Questions filtered by model | missing | C-19 |
| FM-26 | AI name suggestions | missing | D-07 |
| FM-27 | Local-language names at scale (per-language seeds, bSDD, AI) | missing / spec questionable | D-06 |
| FM-28 | BoQ sheet: virtualised, grouping by code system, subtotals, filters, line detai… | built | built — no item |
| FM-29 | Server-side grouping above 20,000 lines | missing | B-19 |
| FM-30 | Three-line clamp for item texts | missing | C-06 |
| FM-31 | Global search | missing | C-09 |
| FM-32 | 3D viewer: highlight, element→lines, colour modes, section box, storey filter, … | built | built — no item |
| FM-33 | Viewer filter bar: IFC class, type, material, "changed since" | missing | D-54 |
| FM-34 | Viewer at scale: merged-mesh / id-buffer picking > 200k elements; "Show in 3D" … | missing | D-55 |
| FM-35 | Change report between runs/revisions (lines and elements) with Excel | built | built — no item |
| FM-36 | F08-AC4 timing automated | missing | B-07 |
| FM-37 | Working version, save version (locked), confirm/reopen, optional review+approva… | built | built — no item |
| FM-38 | Audit action names as specified (F09 §6); `edits.imported` event | diverges | D-25 |
| FM-39 | Changes tab for viewers | diverges | C-14 |
| FM-40 | Library: rule sets, classifications, dictionaries, resolution; drafts, versions… | built | built — no item |
| FM-41 | Library: manual "rebase on latest", unarchive, rename ids across documents, str… | missing | A-43, D-35 |
| FM-42 | Item text "Reads as" sample without a preview run | partial | B-13 |
| FM-43 | Pricing module: offer requests and offers | missing (deferred P48) | D-63 |
| FM-44 | Excel exports: run, frozen saved version, change report; edits import | built | built — no item |
| FM-45 | Workbooks verified in Excel / LibreOffice | partial | B-11 |
| FM-46 | Other export formats: GAEB, ÖNORM A 2063, CSV, IfcCostSchedule; PDF | missing | D-40, D-41 |
| FM-47 | Client template / previous-BoQ import | missing | D-38 |
| FM-48 | Notifications: in-app bell (SSE) + SMTP email, preferences per category | built | built — no item |
| FM-49 | Email language follows the UI | diverges / spec questionable | B-17, D-08 |
| FM-50 | `model_version.ready` email after > 2 min parse | missing | C-49 |
| FM-51 | Plans and entitlements configured by the platform admin; limit checks `402 limi… | built | built — no item |
| FM-52 | Billing provider adapter (interface + provider), checkout, portal, webhooks | missing (real provider out of review scope; interface + stub in scope) | D-15; deferred: billing provider (real provider integration out of scope, DEC-04) |
| FM-53 | Trial driven by plan config (`trialPlanId`/`trialDays`), expiry job drops to Fr… | missing | D-16 |
| FM-54 | Downgrade handling (excess projects read-only) | missing | D-17 |
| FM-55 | Admin revenue figures | missing | D-21 |
| FM-56 | Plan versions / grandfathering | missing | D-18 |
| FM-57 | Usage minutes = wall-clock | diverges | B-17, D-22 |
| FM-58 | i18n: every UI string via next-intl, pseudo-locale, org number/date formats, un… | built | built — no item |
| FM-59 | Languages other than English | missing | D-08 |
| FM-60 | Engine log entries / answer options / some warnings translatable | partial | D-08 |
| FM-61 | Imperial output | missing | C-45, D-09 |
| FM-62 | Setup wizard (required first run, suggested answers, preview, publish all) | built (simplified) | C-35 |
| FM-63 | Wizard as specified: "Suggest codes", names filtered to those worth asking, sam… | missing | C-36 |
| FM-64 | First setup in < 15 min by a new person (v1-12) | partial (unverified) | C-34, C-36 |
| FM-65 | Vendors (pricing module) | missing (deferred P48) | D-62 |
| FM-66 | Public share links: revoke, expiry, follow latest, noindex, line detail, 3D | built | built — no item |
| FM-67 | Public share sheet virtualised | missing | C-26 |
| FM-68 | Share rate limit as specified (60/min) | diverges | B-17 |
| FM-69 | Admin console: overview, orgs, users, plans, settings, funnel, health; metadata… | built | built — no item |
| FM-70 | Admin: vendors section, ops dashboard links, webhook failures and email bounces… | partial | D-57, D-62 |
| FM-71 | Suspended org: write buttons hidden | partial | C-46 |
| FM-72 | Pricebooks and the firm's estimate | missing (deferred P48) | D-61 |
| FM-73 | Full Content-Security-Policy | missing | A-38 |
| FM-74 | Scoped storage identity for workers; shared secret on worker HTTP/rpc | missing (accepted for pilot) | A-36, D-50 |
| FM-75 | Per-org data export; account deletion with "deleted user" audit references | missing | D-48 |
| FM-76 | Audit rows for failed permission checks and failed billing webhooks | missing | D-15, D-49 |
| FM-77 | `Retry-After` on `auth_throttled`; one 429 code | diverges | B-21 |
| FM-78 | Staging environment | missing | D-58 |
| FM-79 | Pilot ops: backups installed with off-host copy, alert destination, error track… | missing | D-56 |
| FM-80 | Shared contract/scenario suites runnable against the local stack | missing | B-05 |
| FM-81 | Browser coverage restored after P53: Library editors, viewer, notifications, ad… | missing | B-06 |
| FM-82 | Medium-model parse ≤ 5 min | missing | B-22, B-23 |
| FM-83 | Accuracy validated against a professional BoQ | missing | D-01 |
| FM-84 | Pilot success measures instrumented | partial | D-23 |
| FM-85 | Engine: recess detection from geometry | missing | D-42 |
| FM-86 | Engine: steel section table (kg/m beyond metric W shapes) | missing | A-17, D-03 |
| FM-87 | Engine: contradiction thresholds as settings | missing | A-04 |
| FM-88 | Engine: location for infrastructure parts (IfcBridgePart / IfcRoadPart) | missing | D-43 |
| FM-89 | Engine: terrain / planting measured by area/volume | missing | D-43 |
| FM-90 | Engine: spatial index for the overlap check | missing | B-24 |
| FM-91 | Engine: per-face embedded intersection | missing | D-42 |
| FM-92 | Engine: building gross volume from envelope | missing | D-05 |
| FM-93 | Engine: opening placement on faces; `IfcRelSpaceBoundary` 2nd-level geometry | missing | D-42 |
| FM-94 | Engine: ArchiCAD quantity names verified | partial | D-44 |
| FM-95 | Engine: more contradiction kinds (areas, IsExternal, materials); `classificatio… | missing | A-03, D-04 |
| FM-96 | Engine: cancellation inside long native calls | partial | D-45 |
| FM-97 | Engine: design options handled; renovation phases from more tools | partial | D-44 |
| FM-98 | Engine: placeholder material names ("Default") handled without a blocking quest… | missing | C-16 |
| FM-99 | IDS input checks per preset | missing | D-46 |
| FM-100 | Pulling models from CDEs (ACC, Trimble Connect) | missing | D-53 |
| FM-101 | Teams (groups with roles), custom roles | missing | D-31 |
| FM-102 | Admin support inbox and announcements | missing | D-57 |
| FM-103 | Setup wizard "start from your last BoQ" | missing | D-39 |
| FM-104 | Read-only views usable ≥ 768 px; mobile beyond read-only | partial | C-02, C-26, C-56 |
| FM-105 | Federation (several discipline models, ownership, same-GlobalId merge, overlaps) | built | built — no item |
| FM-106 | Revisions: answers and edits carried across model versions | built | built — no item |
| FM-107 | Formal tendering, construction phase, BCF | non-goal | non-goal: formal tendering, construction phase and BCF are excluded (P34, P32, P06) |
| FM-108 | Price database supplied by boqlet | non-goal | non-goal: boqlet supplies no price database (P33) |
| FM-109 | On-premise packaging | missing (later) | D-59 |
| FM-110 | WCAG 2.2 AA (shell, forms, sheet, share page) | partial (unverified) | B-06, C-56 |
| FM-111 | Engine result invariants (unique question ids and line keys; parts sum to the w… | missing | A-24, A-25, B-01 |
| FM-112 | Stale-edit detection on line overrides across model versions | missing | D-36 |
| FM-113 | Safe regex engine and timeouts for user patterns | missing | A-35 |
| FM-114 | Locale-aware number parsing on Excel import | missing | A-30 |
| FM-115 | Unit registry with dimensions (one source for engine and app) | missing | A-28 |
| FM-116 | Dependency and security scanning in CI | missing | B-09 |
| FM-117 | Unit-scale / magnitude sanity check that blocks, geometry recommended | missing | A-02 |
| FM-118 | Self-serve upgrade request / contact path that reaches the operator | missing | D-19 |
| FM-119 | In-product help, docs and support contact | missing | D-11 |
| FM-120 | Client "issue" export profile vs working export | missing | C-22 |
| FM-121 | System presets cleaned of ACME/Demo fixtures | diverges | C-42 |
| FM-122 | Simple firm rate library (no vendors) | missing | D-60 |
| FM-123 | Measurement aids for non-modelled work (lines from other lines, CSV block impor… | partial | D-37 |
