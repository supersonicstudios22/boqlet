# Verification — backend, API and data

Verifier: backend/API/data area, 2026-11-23, on `main` at `3868013`, local Docker stack (Java API :8080,
Postgres, SeaweedFS, MailHog, HTTP engine worker). I wrote none of the six reports.

Everything was reproduced in my own throwaway org **VB A Firm** (`vb-a-firm`, enterprise) with seven
accounts (`vb-a` owner, `vb-adm` org admin, `vb-lib` library editor, `vb-est`, `vb-appr`, `vb-view`
members, all with password `verify-backend-password-2026`) and a second org **VB B Firm** (`vb-b-firm`)
for cross-tenant checks. Scripts and outputs are in `docs/review/_scratch/verify-backend/` (`s01`…`s16`,
`lib.mjs` client). Only small jobs ran on the shared worker (S05 Duplex sample runs and one diff).

## 1. Summary

31 findings checked: **24 verified, 7 adjusted, 0 rejected.**

| Original severity | Checked | Verified | Adjusted | Rejected |
|---|---|---|---|---|
| high | 6 | 4 (ENG-002, LEAD-001, LEAD-002, CAS-002) | 2 (LEAD-004 category only, stays high; PRD-004 → medium) | 0 |
| medium | 12 | 9 | 3 (ENG-015 → low; PRD-011 → low; LEAD-009 one claim corrected, stays medium) | 0 |
| low | 13 | 11 | 2 (ENG-029, ENG-030: facts corrected, stay low) | 0 |
| **total** | **31** | **24** | **7** | **0** |

**Final severities:** 5 high (ENG-002, LEAD-001, LEAD-002, LEAD-004, CAS-002), 11 medium, 15 low.

All five high findings that stay high were **reproduced through the API**:

- **ENG-002**: the app's exact upload sequence for a 101 MiB file fails twice: the whole-file PUT to
  `upload.url` gets `403 SignatureDoesNotMatch` (the URL is part 1, signed for 16 MiB), and complete with
  `{}` gets `400 upload_parts_invalid`. Paid plans allow 300 MB, so every model over 100 MiB fails.
- **LEAD-001**: a library editor's stale draft (from v1), published after a promotion (v2), produces a v3
  without the promoted entry. Nothing warns.
- **LEAD-002**: a project made before v2 of a starred rule set still gives v1 to BoQs created after v2.
- **LEAD-004**: with `approvalRequired` and `fourEyes` on, an estimator created a pinned public link to the
  working draft (`201`). The public API shows `revisionStatus: "draft"` and the unreviewed 999 edit with
  its engine value.
- **CAS-002**: after an edit, the sheet's Excel export (`POST /runs/{currentRun}/exports`) still has the
  old quantity, because the export comes from the last run.

**Most important corrections**

- **PRD-004** goes from high to **medium**. Trials and downgrades really are not built. But this is an
  invite-only pilot with no payment provider (FM-52), where an operator changes plans by hand, and the gap is
  already listed as "Not built" in `plans-and-limits.md`. No core flow breaks.
- **ENG-015** goes from medium to **low**. The sheet and the Excel export agree on subtotal *quantities*:
  both ignore excluded lines, and both show no sum when no line is measured. What is left:
  - Java's grouped `/lines?groupBy` view gives `0` and counts excluded units. No UI calls it.
  - The line count differs: the sheet counts excluded lines, while Excel leaves them out.
- **LEAD-004** stays high and becomes **qa-controls / spec-issue**. F18 says a working version can be
  shared, with a "WORKING" watermark, so the code does what F18 says. F09 says approval is "a formal check
  before something leaves the office". The two specs contradict each other.
- **LEAD-009**: the core claim holds. An org admin who wasn't chosen approved and saved (`200`, `200`).
  The claim that the chosen reviewer gets no notice is partly wrong: they get `version.saved` with
  `by: "vb-adm"`. There is still no notice of the approval itself.
- **LEAD-008** is **stronger** than reported. Just *saving a draft* (not publishing it) of the other
  starred rule set bumps `presets.updated_at` and changes the default for new projects.
- **ENG-029**: the code is not dead. It is a documented Keycloak **rollback path**
  (`docs/operations/auth-and-deploys.md:19`). `keycloak.tsx` has 174 lines, not 408.
- **ENG-030**: the BoQ CSVs *do* write a BOM (`ExportController.java:94,122`). The `ft` constants differ by
  about 1e-12, so they don't drift in practice. Only the copied polling code and the quoting style are real.
- **PRD-011** goes from medium to **low**. It is a mislabelled operator-only metric, with no effect on
  customers.

## 2. Table

| ID | Source report | Title (short) | Original severity | Verdict | Final severity | Final category | Evidence of check | Correction / reason | Duplicates / related |
|---|---|---|---|---|---|---|---|---|---|
| ENG-002 | 01-engineering | Browser uploads > 100 MiB cannot work | high | verified | high | correctness / api-contract | `s02-multipart.mjs`: create 101 MiB version → `201`, 7 parts, `url == parts[0].url`; whole-file PUT → `403 SignatureDoesNotMatch`; `complete {}` → `400 upload_parts_invalid`; version stays `awaiting_upload`. Code `upload.ts:29-35`, `ObjectStorage.java:34-35,66-88,249-251`. Plans: professional/team `maxModelVersionMb: 300`; pilot cap 512. No test covers multipart | — | FM-16; PRD row FM-16 (02 §5), UX FM-16 (06), LEAD time table (05) |
| ENG-007 | 01-engineering | Sheet downloads every line with full trace | medium | verified | medium | performance | `s03b-linesize.mjs`: `/runs/{id}/lines` lines carry `trace.{formula,params,elements,steps}`; Duplex 41 lines = 104 KB (468 B/element); `content-encoding: null` with `Accept-Encoding: gzip, br`; no `server.compression` in `application.yml`, no compress middleware in `ops/` | Browser timings not re-measured (the engineering reviewer's measurement); payload and missing compression confirmed | FM-29 |
| ENG-014 | 01-engineering | 404 messages reveal another org's objects | low | verified | low | security | `s04-oracle.mjs` from VB B: A's BoQ/run/revision → "The project was not found."; random id → "The BoQ/run/revision was not found." | — | security.md:58 intent |
| ENG-015 | 01-engineering | Subtotals in three places disagree | medium | adjusted | low | duplication | `model.ts:158-173`, `RunReads.java:111-127`, `export_xlsx.py:169-177,215-225`; `grep` shows no app consumer of server `groupBy` groups | Sheet and Excel agree on quantity subtotals (excluded out of units and sums; null/empty when none measured). Java's grouped view differs (`coalesce(...,0)` gives 0; excluded unit counted), but only API clients see it. Sheet's line count includes excluded lines; Excel omits them | — |
| ENG-016 | 01-engineering | Reviewer picker uses stored role, Java effective role | low | verified | low | duplication | `s06-approval.mjs`: org admin `vb-adm` added as project *estimator* is listed as `estimator`; `POST /revisions/{id}/submit {reviewerIds:[vb-adm]}` → `200 in_review`. `version-dialogs.tsx:126` filters `lead`/`approver` only | Also: org admins/owners who are not project members aren't in `/projects/{id}/members` at all, so the picker can't offer them either | LEAD-009 |
| ENG-024 | 01-engineering | Share links on an archived BoQ | low | verified | low | correctness | `s08-archived-share.mjs`: archived BoQ → pinned link `201`, public page `200`; `latest_issued` `201`; rename and line edit → `409 boq_archived` (control). The BoQ's `permissions.share` is still `true` | Server-side permission hint is wrong too; the UI hides it with its own `!boq.archived` (`boq-header.tsx:167`) | — |
| ENG-028 | 01-engineering | CI and tooling gaps | medium | verified | medium | tooling | `.github/workflows/ci.yml`: deploy `needs: [api, contract, typecheck, engine, rollback]` (no `local`, commented "Not a deploy gate"); actions by tag; Python 3.12 only (pyproject says ≥3.10,<3.14); no audit/CodeQL/Dependabot (`.github/` has only `workflows`); no ruff/mypy config; no SpotBugs/Error Prone/JaCoCo in `pom.xml`; `apps/app/tsconfig.json` lacks `noUncheckedIndexedAccess` (packages have it); `NativeWorkerTest` `@EnabledIfEnvironmentVariable(BOQLET_NATIVE_WORKER_PYTHON)`; perf opt-in `BOQLET_API_PERF` | — | FM-116, FM-80/81 |
| ENG-029 | 01-engineering | Legacy OIDC/Keycloak code remains | low | adjusted | low | maintainability (not dead code) | Files exist; `OidcConfiguration` is `@ConditionalOnProperty(BOQLET_OIDC_ISSUER)`; compose `legacy-identity` profile; `auth-and-deploys.md:19`, `pilot.md:19,37` keep it **for rollback** | It is a deliberate, documented rollback path, not leftover dead code. `keycloak.tsx` is 174 lines (not 408). The concern stands as a decision to make: whether a rollback past V15+ is still realistic | — |
| ENG-030 | 01-engineering | Duplicated helpers drift | low | adjusted | low | duplication | `ExportController.java:94,122` (BOM `﻿` written), `:148-155` quote-when-needed + formula defusing; `AdminController.java:72,217-221` BOM, always-quote + same defusing; `names.py:23` 0.3048 vs `rules.py:26` 3.280839895 (1/x = 0.3048000000012) | "No BOM" is wrong: both write one. Both defuse formulas. The quoting styles differ but are both valid RFC 4180. The ft drift is about 1e-12, which never shows. The four copies of polling code are real | ENG-010 (unit registry) |
| ENG-031 | 01-engineering | N+1 queries in revision/BoQ views | low | verified | low | performance | `BoqAccess.java:103-106` (view per BoQ), `:130-138` (one query per model input), `:140` `runs.require`, `:153-157` `pending()` (reads every `question_id` + rebuilds snapshot), reviewers/user lookups, `comments()`; `permissions()` calls `orgs.require` twice | — | — |
| ENG-032 | 01-engineering | Decisions project-wide, affect every BoQ | low | verified | low | spec-issue | `BoqInputs.java:135-140` (`WHERE project_id = ?`); ids `missing:{ruleId}:{guid}` (`rules.py:623`), `unmatched:{class}:{type}` (`rules.py:906`) | Works as F05 line 11 specifies ("stored once per project and applied to every run, every BoQ"), so this is a spec question, rightly categorised. See the note on the risky recommendation | — |
| LEAD-001 | 05-team-lead | Promoted answer dropped by a stale draft | high | verified | high | library-governance | `s10-stale-draft.mjs`: v1 empty → lib draft (v1 + `lib-entry-1`) → est answers `name:space_name:Roof` → owner promotes → **v2** `answer:space_name:Roof` → lib publishes draft → **v3** has only `lib-entry-1`; decision still points at v2. Code `Library.java:240-262` (no base check), `:295-322` (publishes past an open draft) | — | LEAD-008 (promotion publishes directly), FM-41 (no "rebase on latest") |
| LEAD-002 | 05-team-lead | Org rule-set versions never reach existing projects | high | verified | high | consistency / spec-issue | `s11-frozen.mjs`: House A created with v1 starred; v2 published; new BoQ in House A → **v1**, in House B → v2; BoQ JSON has no "newer preset" flag. `ProjectPresets.java:24-31`, `BoqInputs.java:33-52` use stored version ids | F02 §2 does specify *versions* as defaults, so the pinning is by design. The defect is that nothing tells anyone and nothing moves projects on: there are no default pickers in project settings (FM-12), no "newer version" badge, and the "latest" pickers BR-07/F10 §4 imply don't exist. `PATCH /projects/{id}` with `defaults` works through the API only | FM-12, LEAD-015 |
| LEAD-004 | 05-team-lead | Approval bypassed by sharing the working version | high | adjusted (category) | high | qa-controls / spec-issue | `s06-approval.mjs`: org `approvalRequired: true, fourEyes: true`; est edits line → 999, regenerates, `POST /boqs/{id}/share-links {mode:"pinned", revisionId: working}` → **201**; public `/public/shares/{token}` → `revisionStatus: "draft"`; line `quantity 999`, `overridden.engineQuantity 64.42`. `ProjectAccess.java:48` `share` = lead/estimator/approver | The behaviour matches F18 §1–2 ("pins the working or saved version", "WORKING" watermark). It contradicts F09's stated purpose (line 13). It is both a spec conflict and a control gap. The watermark softens it, but the numbers still reach the client | CAS-028 (edit provenance on share), F18/F09 |
| LEAD-005 | 05-team-lead | Library editor can't see usage, preview, promote | medium | verified | medium | library-governance / spec-issue | `s12-libvis.mjs`: owner `/presets/{id}/usage` → 2, lib → 0; `usedByCount` 2 vs 0; lib projects → 0; lib `/projects/{id}/decisions` → `404`. `permissions.md` gives library editors promote but no project visibility | — | LEAD-018 |
| LEAD-006 | 05-team-lead | Audit records that, not what | medium | verified | medium | audit | DB `audit_events` for my org: `decision.set {kind, questionId}`, `line.edited {lineKey, lineKeys}`, `preset.published {kind}`, `revision.submitted {reviewers: 1}`, `revision.approved {}`. Decisions list/CSV read `superseded_at IS NULL` only (`Decisions.java:189`); after overwrite the CSV shows `promoted: no` | — | LEAD-007, FM-38 |
| LEAD-007 | 05-team-lead | Overwriting a colleague's answer: no warning or notice | medium | verified | medium | collaboration | `s13-overwrite.mjs`: owner overwrites est's `Roof` answer; `dryRun` returns only `reopenedRevisions: []`; write `200`; est notifications 4 → 4. Questions UI never renders `decidedBy` (only `decisions-table.tsx:131`) | — | LEAD-006 |
| LEAD-008 | 05-team-lead | No four-eyes on standards; starring sets defaults silently | medium | verified (stronger) | medium | library-governance | `s16-starred.mjs`: two starred rule sets → new project gets the newer one; **saving a draft** (no publish) of the other flips new projects to it (`ProjectPresets.java:25` `updated_at DESC`; draft save updates `presets.updated_at`, `Library.java:236`). `publish()` has no review step | Even unpublished draft edits change which starred rule set new projects get | LEAD-001, LEAD-002 |
| LEAD-009 | 05-team-lead | Reviewer choice ≠ who may approve | medium | adjusted | medium | qa-controls / spec-issue | `s07-approve-other.mjs`: est submits to `vb-appr`; `vb-adm` (org admin, not chosen) `approve` → `200 approved`, `issue` → `200 issued` | "Alex gets no notice" is partly wrong: the chosen reviewer gets `version.saved` with `by: vb-adm` (`s07b-notif.mjs`). There is still no notice when someone else approves. As F09 §4 specifies ("approver or lead"), so a spec question | ENG-016 |
| LEAD-015 | 05-team-lead | Any system/demo preset can be chosen | medium | verified | medium | consistency | `BoqInputs.java:65-90` accepts any published system or org preset; DB has 13 system presets incl. "ACME Ltd house rules", "Demo: small custom rule set", "Demo: trade sections" | Freedom per BoQ is by design (F02 §2, P19); the missing piece is an org policy | PRD-009, CAS-009, UX-036, FM-121 |
| LEAD-018 | 05-team-lead | Library editors can't read org audit; CSV shows ids | low | verified | low | audit / spec-issue | lib `GET /orgs/{org}/audit` → `403 required: admin`; CSV columns `at,actor,action,entityType,entityId,project,data` | As `permissions.md` specifies (owner/admin). Actor and project names are in the CSV; only the entity (preset/BoQ) is an id | LEAD-005 |
| LEAD-020 | 05-team-lead | Viewers can't see the change report | low | verified | low | qa-controls / spec-issue | `boqs/[boqId]/page.tsx:61-64` hides `changes` without `seeAudit`/`editBoqs`; `screens.md` S12d lists lead/estimator/approver. API does **not** block it: viewer `POST /runs/{id}/compare` → `202` (`s14-viewer-diff.mjs`) | UI-only restriction, set by screens.md | FM-39 |
| LEAD-021 | 05-team-lead | Review screen doesn't show who made each edit | low | verified | low | qa-controls | `review-tab.tsx:102-112` renders key, value, reason only; `LineOverride.createdBy` is returned by `GET /boqs/{id}/overrides` | — | — |
| PRD-004 | 02-product | Trial and downgrade not built | high | adjusted | medium | pricing-and-plans | `AdminOrganisations.java:120-147`: trial sets `trial_ends_at`/`status` only, plan unchanged; no `@Scheduled` job touches trials (the 9 schedulers listed); `plans-and-limits.md:102` already "Not built"; 5 local Free orgs have > 1 member | Real gap, but no core flow breaks. The pilot is invite-only, plans are changed by hand, and there is no payment provider (FM-52). It is already a known limitation. Medium | FM-53, FM-54, PRD-003 |
| PRD-010 | 02-product | Plan editor watermark checkbox inverted | medium | verified | medium | pricing-and-plans | `plans.tsx:239-246` `checked={entry}` labelled `limitName(key)` = `errors.json:11` "Excel without the watermark" + "Included"; Free has `exportWatermark: true`; `BoqExports.java:129` adds the watermark when the feature is *enabled* | — | — |
| PRD-011 | 02-product | "Paying organisations" counts any non-free org | medium | adjusted | low | pricing-and-plans / spec-issue | `AdminReports.java:73-80` `plan_id <> 'free' AND subscription_status = 'active'` | Also leaves out trialing orgs. It is an operator-only tile and customers never see it. Low | PRD-003 |
| PRD-026 | 02-product | Watermark is one deletable cell | low | verified | low | monetisation / spec-issue | `export_xlsx.py:259-260` writes `Cover!A19` "Made with boqlet" only; F12/plans-and-limits never define the watermark's form | — | **duplicate of CAS-029**; UX-045 |
| CAS-002 | 03-casual-user | Sheet Excel exports the last run, not the edits | high | verified | high | export | `s15-export-edits.mjs`: est edits "127mm Slab on Grade" 129.69 → 123.45 (`200`), same `currentRun`; `POST /runs/{run}/exports` → workbook BoQ row `B.02 Slab, 127mm Slab on Grade m2 129.69`, while the earlier edit that *was* regenerated (999) is present. `sheet.tsx:121,187` shows `effectiveLines(run lines + overrides + manual)` but exports `run.id` | The header warns "Inputs changed since this run", but the Excel button and the file say nothing | CAS-005, CAS-027 |
| CAS-005 | 03-casual-user | Edits do nothing until Generate again; Save disabled | medium | verified | medium | confusion / spec-issue | `Boqs.java:294-305` `ready()` refuses with `pending` (save and submit); edits are engine inputs (F06 §6, BR-07 snapshot) | By design, but confusing. It is the root cause of CAS-002 | CAS-002 |
| CAS-028 | 03-casual-user | Share page shows edits and measured value | low | verified | low | spec-issue | public line in `s06-approval.mjs`: `overridden {fields:[quantity], engineQuantity: 64.42, quantity: 999}`; F18 status: "an edited quantity shows as edited with the engine's value" (P54 Q52) | As decided in P54 Q52. F18 §2's older "No … edits history" now conflicts with it | LEAD-004 |
| CAS-029 | 03-casual-user | Free watermark is one small line | low | verified | low | spec-issue | as PRD-026 | — | **duplicate of PRD-026** |

## 3. Details

### ENG-002 (high, verified): reproduction

Script `s02-multipart.mjs` replays `apps/app/src/features/models/upload.ts` for a 101 MiB file (S01's
header padded with spaces) on the enterprise org:

```
POST /models/{id}/versions {fileName:"big.ifc", sizeBytes:105906176}
  → 201  upload.method PUT, partSizeBytes 16777216, parts 7, upload.url == parts[0].url
PUT <upload.url> (whole 101 MiB body, upload.headers)
  → 403 <Code>SignatureDoesNotMatch</Code> … /boqlet-local/orgs/…/uploads/…
POST /model-versions/{id}/complete {}
  → 400 {"code":"upload_parts_invalid","message":"Supply all uploaded parts."}
GET /model-versions/{id} → status "awaiting_upload"
```

The server side is in place (`ObjectStorage.upload` presigns parts, `seal` completes them). The client
never reads `parts` and never sends them back. Paid plans allow 300 MB (`plans` table), and the pilot caps
uploads at 512 MiB (`ops/pilot/compose.yaml:119`). So every upload between 100 and 300/512 MiB fails, with a
generic `upload_failed` error from the XHR. No test covers multipart uploads.

### LEAD-001 (high, verified): reproduction

`s10-stale-draft.mjs`:

```
v3 published | Add Kueche                | entries: lib-entry-1->space.kitchen
v2 published | Promoted project decision | entries: answer:space_name:Roof->space.bedroom
v1 published | Start                     | entries:
decision promoted to "01a207a4-d94e-…" (v2)
```

`publishDictionaryEntries` builds v2 from the *latest published* doc and leaves the open draft alone.
`publish()` publishes the draft as `max(number)+1` without checking which version the draft started from.
The promoted mapping disappears from the org dictionary that new projects pick up. Nothing warns, either
in the API or in the UI (no stale-draft check in `apps/app/src/features/library`). This breaks "nothing
silently dropped". It is common in practice, because drafts autosave and stay open for days. High stands.

### LEAD-002 (high, verified): reproduction

`s11-frozen.mjs`: "VB measuring rules" v1 published and starred → project "VB House A" created
(`defaults.ruleSetVersionId == v1`) → v2 published → "VB House B" created. New BoQs created after v2:
House A gets **v1**, House B gets v2. The BoQ response has no flag for a newer preset version (models have
`newerVersionAvailable`, presets don't). F02 §2 says defaults are versions, so the pinning is by design.
But there is no UI to change project defaults (FM-12), and nothing tells anyone. A firm-wide standards
change therefore silently splits live projects by when they started. High stands, from the team-lead view
(a serious control gap in a common case). A workaround exists for each BoQ (Setup tab version picker) and
for each project (`PATCH /projects/{id}` with `defaults`, API only).

### LEAD-004 (high, adjusted category): reproduction

`s06-approval.mjs`. Org settings → `approvalRequired: true, fourEyes: true` (`200`). Estimator:

```
POST /boqs/{boq}/overrides {lineKey:"walls | Foundation - Concrete (417mm) | True |  | m2", quantity:999, reason:"unchecked draft figure"} → 200
POST /revisions/{rev}/runs → 202, job succeeded
POST /boqs/{boq}/share-links {mode:"pinned", revisionId: rev} → 201
GET /public/shares/{token} → 200 {revisionStatus:"draft", revisionLabel:"A", …}
GET /public/shares/{token}/lines → quantity 999, overridden {engineQuantity:64.42, quantity:999}
```

F18 §1 lets a user share "the working or saved version's current run", with a "WORKING" watermark.
F09 line 13 says approval is for firms that "want a formal check before something leaves the office".
The code follows F18. The two specs conflict, and the firm's control can be bypassed. So the category is
**qa-controls / spec-issue**. Severity stays high: the firm turned on a control on purpose, and two clicks
get around it.

### CAS-002 (high, verified): reproduction

`s15-export-edits.mjs` + `s15b-dl.mjs`. Estimator edits `slabs | 127mm Slab on Grade |  | m2` from 129.69 to
123.45 (`200`). The revision keeps the same `currentRun`. Exporting that run (what the sheet's **Excel**
button does: `useExportRun(run.id)`, `sheet.tsx:121`) and reading the workbook with openpyxl gives:

```
BoQ ('B.01', 'Wall, Foundation - Concrete (417mm), 417 mm', 'm2', 999, …)   ← edited earlier and regenerated: present
BoQ ('B.02', 'Slab, 127mm Slab on Grade', 'm2', 129.69, …)                  ← edited now, not regenerated: old value
```

The sheet shows the edit right away (`effectiveLines` overlays overrides and manual items in the browser,
`sheet.tsx:187`). The file has the old value, and neither the button nor the file says so. High stands:
the wrong number goes out in the most common hand-off.

### PRD-004 (high → medium)

The facts hold. `subscription()` (`AdminOrganisations.java:120-147`) sets only `trial_ends_at` and
`status`; the plan doesn't change. None of the nine `@Scheduled` jobs (LimitAlerts, RateLimits, the
OIDC revocations poll, EmailDelivery, AlertMonitor, Maintenance ×2, SampleProjects, JobMetrics) expires a
trial. There is no downgrade handling.

I lowered it to medium for four reasons:
- No customer data or number is at risk.
- The pilot is invite-only, and an operator changes plans by hand (P57).
- There is no payment provider to convert trials anyway (FM-52, checkout answers `409`).
- `plans-and-limits.md:102` already lists it as "Not built".

It is a commercial readiness gap, not a broken core flow.

### ENG-015 (medium → low)

| Case | Sheet (`model.ts`) | Excel (`export_xlsx.py`) | Java `groupBy` (`RunReads.groups`) |
|---|---|---|---|
| All lines flagged | no sum (`measured > 0` false) | no subtotal (`any(quantity is not None)` false) | **0** |
| Excluded line with another unit | ignored for unit and sum | line not exported | **counted in `count(DISTINCT unit)` → null** |
| Line count with an excluded line | **counts it** | does not | counts it |

The two views people see (the sheet and Excel) agree on every subtotal quantity. The Java grouped view
differs, but no app code calls it (`grep groupBy` in `apps/app/src`: export grouping only). So there is
a real duplication that could drift, plus an API inconsistency and a line-count difference. I rate it low.

### ENG-029 (adjusted)

The code is there, but kept on purpose: "The original Keycloak database and image can be retained for
rollback: the `identity` service is in the compose profile `legacy-identity` … not started by default"
(`docs/operations/auth-and-deploys.md:19`; `pilot.md:19,37`). `OidcConfiguration` loads only with
`BOQLET_OIDC_ISSUER`. `keycloak.tsx` has 174 lines, not 408. The useful question for the owner is whether a
rollback across the native-auth migrations (V15 onward) is still realistic. If it isn't, delete the path.

### ENG-030 (adjusted)

- CSV: both paths write a BOM (`ExportController` lines 94 and 122, `AdminController` line 72) and defuse
  formula cells the same way. They differ only in always quoting versus quoting when needed. Both are
  valid RFC 4180, so no user sees a difference.
- Units: `0.3048` vs `1/3.280839895` differ by 1.2e-12 m. That never reaches 3-decimal output.
- The polling loops really are copied in four places, with different delays.

The finding is valid as a maintainability note, but two of its three examples show no real drift.

### LEAD-009 (adjusted)

`s07-approve-other.mjs`: submit to `vb-appr` → `vb-adm` (org admin, effective `lead`, not chosen)
`approve` → `200 approved`, `issue` → `200 issued`. The chosen reviewer's notifications then hold
`version.saved {by:"vb-adm"}` (`s07b-notif.mjs`), so they *are* told who saved it. They are not told
when someone else approves without saving. F09 §4 allows "approver or lead", and
`permissions.md` says "org owners and admins act as lead", so the behaviour is as specified. The point
is a spec question, and the category is right.

### PRD-011 (medium → low)

`AdminReports.java:74` hard-codes `plan_id <> 'free'` and needs `subscription_status = 'active'`, so
trialing orgs are left out too. It would read wrongly if the admin made another plan the default (P57).
It is a mislabelled tile on the operator's dashboard, used only by the operator. Low.

## 4. Judgement calls

- **Severity of LEAD-002 kept high** even though the pinning is by design (F02 §2). Three things
  together make it serious for a team: no UI to move projects (FM-12), no signal that a newer version
  exists, and new BoQs silently inheriting old versions. Someone weighting the per-BoQ workaround more
  heavily could rate it medium.
- **LEAD-004 kept high** although the public page carries a "WORKING" watermark. The numbers and the
  edit with its engine value still reach the client, against a control the firm turned on on purpose.
- **PRD-004 lowered to medium**: an unbuilt commercial feature in an invite-only pilot, already
  documented.
- **Verified vs adjusted**: a verdict is "adjusted" only when a fact, severity or category changed. LEAD-008
  (the problem is wider than reported) and LEAD-018 (actor and project names *are* in the CSV, the entity
  isn't) stay "verified" with notes.
- **ENG-007 browser timings** (3.3 s long task) were not re-measured. I confirmed the payload shape, the
  absence of compression and the full-trace list endpoint, which are the parts of the finding that sit in
  the backend.
- **Recommendations that look risky or need the owner:**
  - ENG-032: "scope decisions to the BoQ" goes against F05 and O5 (answers carry across BoQs and
    versions). "Put the rule-set id in question ids" would change deterministic ids (CLAUDE.md rule 9)
    and orphan stored decisions unless they are migrated. Either needs a decision, not just a fix.
  - LEAD-004: "hide the edit provenance on public pages" reverses P54 Q52. That needs the owner.
  - LEAD-002: "store 'latest of preset X' as the project default" would let a regenerate silently move
    quantities onto a new standard. A "newer version available" badge with an explicit "move to latest"
    action fits BR-07 better.
  - CAS-005: "apply manual edits immediately to the exported sheet" must still go through the engine
    (rule 4: one evaluator, the engine computes). An auto-regenerate, or a sheet Excel button that
    regenerates first, keeps that rule.
  - ENG-029: "delete it" removes the documented rollback path. Confirm with the owner first.
- **Data I changed** (my own orgs only):
  - VB A Firm: approval and four-eyes on; project members added; a line override of 999 and one of
    123.45 on "Duplex quantities"; revision A saved by `vb-adm`.
  - Library: the dictionary "VB firm names" (v1–v3), and the rule sets "VB measuring rules" (v1–v2) and
    "VB second rules", both starred.
  - Projects: "VB House A", "VB House B", "VB starred 1" and "VB starred 2".
  - "VB archive test": an archived BoQ with two share links.
  - The 101 MiB model version "VB big upload", left in `awaiting_upload`.
  - One diff job, requested as the viewer.
