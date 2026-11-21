# Test findings: the campaign log

The working record of the test campaign in [`test-plan.md`](test-plan.md). Each section is filled
while the campaign runs. A session that stops half-way leaves this file up to date. The next session
reads the run log and resumes from the first stage not marked done.

**In progress, restart from Stage 0.** Prepared 2026-11-21; Stage 0 ran on `3d68ffc`. The same day
the mock API was removed (P53, `cf58e32`) and the plan was revised for Java only: stacks L (local
Docker), H (test harness, `NativeWorkerTest`) and P (pilot); lanes 1D–1F renumbered. Rows of the
old mock lanes are gone; references below to `e2e/*.spec.ts` and the mock's tests point at deleted
files and are marked so. The campaign stops at every stage end for the owner's go (`test-plan.md`, top).

## Summary

Filled in at Stage 7.

| | S1 | S2 | S3 | S4 | Total |
|---|---|---|---|---|---|
| Found | | | | | |
| Fixed and verified | | | | | |
| Owner (questions) | | | | | |
| Deferred to a task | | | | | |
| Known limitation | | | | | |

- Commit under test (start): `3d68ffc` (main, the v1.0.0 release record), plus the plan corrections (uncommitted)
- Commit after the fixes (end): ``
- CI on the end commit: 
- Pilot rollout and `verify-live.sh`: 
- Waiting for the owner: 

## Run log

One row per stage or lane, updated when it starts and ends.

| Stage / lane | Status | Started | Ended | Stack | Result, log path | Findings |
|---|---|---|---|---|---|---|
| 0 Preflight (tools, `npm install`, latest CI) | done | 2026-11-21 | 2026-11-21 | local | Windows 11 Pro 10.0.26300; Node 22.23.4, npm 10.9.9; Python 3.10.7 (venv, `ifc_boq` editable from `engine/`); Docker 29.8.2 (15.4 GB, 12 CPUs); JDK 22 locally, Maven + JDK 21 through the `maven:3.9-eclipse-temurin-21` image; Playwright Chromium + Firefox + WebKit; Excel present; LibreOffice missing; no SSH host for the pilot; `gh` logged in. `npm install` clean (12 moderate `npm audit` items, for §9.3). CI on `main`: `3d68ffc` run 44926299190 and `8977990` run 44924953402, all 7 jobs green, but both `deploy` jobs skipped the rollout (TF-001). Last `v_1` runs: `4b9a07c` e2e red (F06-AC10 co-editing failed, `sheet.perf` flaky), `7d4f790`-era run red (`ModuleNotFoundError: pytest` in the Java job's scenarios); later runs green on the same trees (for lane 1G). Other session `ifc-boq-1f`: read-only, no ports, no pushes. | TF-001 |
| 1A Static | not started | | | | | |
| 1B Unit | not started | | | | | |
| 1C Engine, CLI, corpus | not started | | | | | |
| 1D Java and the shared suites (H: `mvn verify`, contract, scenarios, browser smoke) | not started | | | H | | |
| 1E Local stack (`local:up`, `local:check`) | not started | | | L | | |
| 1F CI parity | not started | | | | | |
| 1 Coverage audit (§C) | not started | | | | | |
| 2 R1 Contract parity | not started | | | | | |
| 2 R2 Authorisation and tenancy | not started | | | | | |
| 2 R3 State machines and rules | not started | | | | | |
| 2 R4 Frontend screens | not started | | | | | |
| 2 R5 Security | not started | | | | | |
| 2 R6 Engine, numbers, exports | not started | | | | | |
| 2 R7 Docs consistency | not started | | | | | |
| 3 A Accounts, sessions, orgs | not started | | | L | | |
| 3 B Org settings | not started | | | L | | |
| 3 C Projects | not started | | | L | | |
| 3 D Models | not started | | | L | | |
| 3 E BoQs and runs | not started | | | L | | |
| 3 F Questions | not started | | | L | | |
| 3 G Sheet | not started | | | L | | |
| 3 H Viewer | not started | | | L | | |
| 3 I Revisions | not started | | | L | | |
| 3 J Versions, review, confirm | not started | | | L | | |
| 3 K Library | not started | | | L | | |
| 3 L Setup wizard | not started | | | L | | |
| 3 M Exports | not started | | | L | | |
| 3 N Notifications | not started | | | L | | |
| 3 O Plans and limits | not started | | | L | | |
| 3 P i18n | not started | | | L | | |
| 3 Q Share links | not started | | | L | | |
| 3 R Platform admin | not started | | | L | | |
| 3 S Across everything (S1 role matrix sweep, S2 UI sweep, S3–S8) | not started | | | L | | |
| 3 Pilot acceptance walk (§7.4) | not started | | | P | | |
| 4.1 Performance | not started | | | L | | |
| 4.2 Accessibility | not started | | | L | | |
| 4.3 Security | not started | | | L, P (passive) | | |
| 4.4 Resilience and operations | not started | | | L | | |
| 4.5 Compatibility | not started | | | L | | |
| 4.6 Pricing boundary | not started | | | — | | |
| 4.7 PoC smoke | n/a | | | — | Removed by FE-046 (tag `poc-final`); only the leftover-references check in §9.7 | |
| 5 Triage | not started | | | | | |
| 6 Fix and retest | not started | | | | | |
| 7 Regression, push, CI, pilot, records | not started | | | | | |

## Noted while writing the plan (check in Stage 2, R7)

These aren't findings yet. R7 confirms or drops each one. Resolved by the docs reorganisation of
2026-11-21 (struck): R7 checks that the fix holds.

- ~~`CLAUDE.md`'s repo map lists `packages/pricing-ui`, which doesn't exist.~~ Removed from CLAUDE.md and the architecture docs.
- ~~There is no script or compose file for a local native Java stack.~~ `ops/local` and `scripts/local.mjs` (P53).
- ~~Test counts in `testing.md` differ from pytest's count.~~ `docs/testing/README.md` now gives 211 collected (115 functions) and the real suite sizes.
- ~~`services/api/README.md` still describes Keycloak sign-in as current.~~ It describes native sign-in first; Keycloak only as the rollback.
- ~~The plan tells sessions to commit to `v_1`.~~ `docs/development/workflow.md`: work on `main`.
- ~~The build log says `8977990` "deployed to booqlet.com".~~ TF-001 (fixed and verified).
- Tooling on the owner's machine: JDK 22 instead of 21; no Maven and no `mvnw`; no LibreOffice;
  Playwright Chromium only; Excel present; no SSH host entry for the pilot.
- The federated pair for v1 criterion 2 and the nfr.md timings is not in `fixtures/` (download per
  `docs/testing/ifc-corpus-catalogue.md`).
- New (P53): the shared suites can't run against the local stack; the root `test:contract` /
  `test:scenarios` scripts failed there in setup (now they stop with a clear message) (`docs/product/known-limitations.md`, Tests).

## C. Coverage of the acceptance criteria

Status: **pass (A)** + test · **pass (M)** + journey and evidence · **fail** + TF id · **n/a** +
reason · **owner**. "Look first in" lists likely places only. The coverage audit (Stage 1)
replaces them with the exact file and test name.

### v1 criteria (`docs/product/scope-and-acceptance.md`)

| # | Criterion | Journeys | Look first in | Status |
|---|---|---|---|---|
| v1-1 | Duplex reproduction through the full stack (A) | 1C, 1F, E2 | `engine/tests/test_duplex.py`, `e2e/duplex.spec.ts` (deleted, P53), `NativeWorkerTest` | |
| v1-2 | Federation, no double counts, overlaps as questions (A) | H4, §9.1 | `engine/tests/test_federation*.py` | |
| v1-3 | Revision: exact change report, answers carried (A) | I1–I3, F7 | `e2e/versions-flow.spec.ts` (deleted, P53), scenarios `versions`, `changes` | |
| v1-4 | Traceability in ≤ 2 clicks (M) | G2 | — | |
| v1-5 | Versions locked, confirmed BoQ refuses writes, approval (A) | J2–J4 | scenarios `versions`, `state-machines` | |
| v1-6 | Pricing module | — | — | n/a (P48) |
| v1-7 | Library: create, change, preview, publish (M) | K1–K3 | `e2e/library-editors.spec.ts` (deleted, P53) | |
| v1-8 | Isolation (A) | S1, 1F | scenarios `isolation`, contract `admin`, `NativeWorkerTest.verifyTenantIsolation` | |
| v1-9 | Limits: `402 limit_reached` and the UI (A) | O1 | scenarios `billing`, `e2e/billing.spec.ts` (deleted, P53) | |
| v1-10 | Performance: nfr.md targets (A) | §9.1 | `e2e/*.perf.spec.ts`, `tests/perf/api.test.ts`, `tests/perf/engine_timing.py`, `NativeWorkerTest#apiPerformanceAgainstJava` | |
| v1-11 | i18n pseudo-locale (A) | P1 | `e2e/pseudo-locale.spec.ts` (deleted, P53) | |
| v1-12 | First setup in < 15 min by a new person (M) | L10 | `e2e/setup.spec.ts` (deleted, P53) (flow only) | owner |
| v1-13 | Editing: live co-editing; edits survive versions; Excel round trip (A) | G3, G9, M4 | `e2e/co-editing.spec.ts` (deleted, P53), `e2e-java/live.spec.ts`, scenarios `line-edits`, `edits-import` | |
| v1-14 | Vendors | — | — | n/a (P48) |
| v1-15 | Share link: no account, minimal, revoke < 1 s (A) | Q1, Q2 | scenarios `shares`, `e2e/shares.spec.ts` (deleted, P53) | |
| v1-16 | Single session takeover (A) | A6 | `e2e/sessions.spec.ts` (deleted, P53), `e2e-java/sessions.spec.ts`, scenarios `state-machines` | |
| v1-17 | Admin console numbers match, no content (A) | R2, R5 | scenarios `admin`, contract `admin`, `ApiFoundationTest` | |

### Feature acceptance criteria (`01-features/F*.md`, by position)

| Id | Criterion (short) | Journey | Look first in | Status |
|---|---|---|---|---|
| F01-AC1 | Sign up → org → dashboard < 1 min | A1 | `e2e/auth.spec.ts` (deleted, P53), `e2e-java/accounts.spec.ts` | |
| F01-AC2 | Invitation refused for another email | A3 | scenarios `orgs` | |
| F01-AC3 | Seat limit `402 seats` + upgrade prompt | A4 | scenarios `orgs`, `billing` | |
| F01-AC4 | Last owner can't leave or be demoted | A5 | scenarios `orgs` | |
| F01-AC5 | Takeover, `401 session_replaced` in 5 s, cancel | A6 | `e2e/sessions.spec.ts` (deleted, P53) | |
| F01-AC6 | Org switch uses the new org | A7 | `e2e/orgs.spec.ts` (deleted, P53), `e2e-java/orgs.spec.ts` | |
| F01-AC7 | Audit events for every account action | A10 | scenarios `audit` | |
| F02-AC1 | `activeProjects` 402; archiving frees the slot | C2 | scenarios `projects` | |
| F02-AC2 | No project role → not listed, `404` | C3 | scenarios `projects`, `isolation` | |
| F02-AC3 | Project members are org members only | C1 | scenarios `projects` | |
| F02-AC4 | Archived: `409 project_archived`, banner | C4 | scenarios `projects`, `e2e/projects.spec.ts` (deleted, P53) | |
| F02-AC5 | "Needs you" shows a review in 5 s | C5 | `e2e/shell.spec.ts` (deleted, P53)? | |
| F03-AC1 | Upload progress → stages → report, no reload | D1 | `e2e/models.spec.ts` (deleted, P53) | |
| F03-AC2 | Live state after leaving; notification | D1 | `e2e/models.spec.ts` (deleted, P53), `e2e/notifications.spec.ts` (deleted, P53) | |
| F03-AC3 | Non-IFC → `not_ifc`, no retry | D2 | scenarios `models` | |
| F03-AC4 | Identical content parses once | D3 | scenarios `models` | |
| F03-AC5 | Check rows open the viewer with their elements | D5 | `e2e/viewer.spec.ts` (deleted, P53)? | |
| F03-AC6 | Over `maxModelVersionMb` refused in client and server | D4 | scenarios `models`, `billing` | |
| F04-AC1 | New BoQ preselects both latest versions + defaults | E1 | scenarios `boqs`, `e2e/boqs.spec.ts` (deleted, P53) | |
| F04-AC2 | Duplex run < 10 s end to end, no reload | E2 | `e2e/duplex.spec.ts` (deleted, P53) | |
| F04-AC3 | Blocking questions → `needs_input`, header link | E3 | scenarios `boqs`, `questions` | |
| F04-AC4 | Inputs changed → Save disabled | E4 | mock test `inputs-changed` (deleted, P53), `e2e/boqs.spec.ts` (deleted, P53) | |
| F04-AC5 | Classification never changes quantities (BR-02) | E5 | scenarios `boqs`, engine tests | |
| F05-AC1 | All blocking answered → `complete` | F1 | scenarios `questions` | |
| F05-AC2 | New version with same names asks nothing | F7 | `e2e/new-versions.spec.ts` (deleted, P53) | |
| F05-AC3 | Bulk 10 names = one request + one regenerate | F3 | `e2e/questions.spec.ts` (deleted, P53) | |
| F05-AC4 | Decision used by approved revision warns → draft | F5 | scenarios `questions`, `versions` | |
| F05-AC5 | Promote → org dictionary version → not asked again | F6 | scenarios `questions`, `library` | |
| F06-AC1 | Group by switch instant, no request | G1 | `e2e/sheet.spec.ts` (deleted, P53) | |
| F06-AC2 | Detail: formula, parameters, shares sum | G2 | `e2e/sheet.spec.ts` (deleted, P53), scenarios `sheet` | |
| F06-AC3 | Every edit type survives regeneration + new version + Excel | G3 | scenarios `line-edits`, `e2e/exports.spec.ts` (deleted, P53) | |
| F06-AC4 | Unit change without quantity refused; Ctrl+Z | G4 | `e2e/line-edits.spec.ts` (deleted, P53) | |
| F06-AC5 | "How it is calculated" adds up, links Settings | G2 | `e2e/sheet.spec.ts` (deleted, P53), scenarios `sheet` | |
| F06-AC6 | Manual line under "9 Preliminaries" stays | G5 | `e2e/line-edits.spec.ts` (deleted, P53) | |
| F06-AC7 | Item texts vs line texts by Group by | G6 | `e2e/sheet.spec.ts` (deleted, P53)? | |
| F06-AC8 | "Not in the models" notice, remembered collapse | G7 | `e2e/sheet.spec.ts` (deleted, P53)? | |
| F06-AC9 | Positions renumber; frozen in saved | G8 | mock test `positions` (deleted, P53), scenarios `versions` | |
| F06-AC10 | Co-editing < 1 s; later edit wins, earlier told | G9 | `e2e/co-editing.spec.ts` (deleted, P53), `e2e-java/live.spec.ts` | |
| F06-AC11 | 20k lines smooth | G10 | `e2e/sheet.perf.spec.ts` (deleted, P53) | |
| F07-AC1 | Line → exactly its elements | H1 | `e2e/viewer.spec.ts` (deleted, P53), `e2e/sheet-model.spec.ts` (deleted, P53) | |
| F07-AC2 | Element → its lines with shares | H2 | `e2e/viewer.spec.ts` (deleted, P53) | |
| F07-AC3 | Coverage colour, count = unmatched | H3 | `e2e/viewer.spec.ts` (deleted, P53) | |
| F07-AC4 | Two models, toggleable | H4 | ? | |
| F07-AC5 | Shared filters, box select | H5 | `e2e/sheet-model.spec.ts` (deleted, P53) | |
| F07-AC6 | Changes colour mode v1 → v2 | H6 | `e2e/changes.spec.ts` (deleted, P53) | |
| F07-AC7 | Duplex viewer < 3 s warm | H7 | `e2e/ui.perf.spec.ts` (deleted, P53) | |
| F08-AC1 | Change report lists exactly affected lines and elements | I1 | scenarios `changes`, `e2e/changes.spec.ts` (deleted, P53) | |
| F08-AC2 | No answered question asked again | I2 | `e2e/versions-flow.spec.ts` (deleted, P53) | |
| F08-AC3 | Earlier edits still applied and listed | I3 | scenarios `changes` | |
| F08-AC4 | Report < 3 s, cached < 500 ms | I4 | ? | |
| F09-AC1 | Save version: labelled snapshot, work goes on | J1 | scenarios `versions`, `e2e/versions.spec.ts` (deleted, P53) | |
| F09-AC2 | Saved version byte-identical | J2 | scenarios `versions` | |
| F09-AC3 | Submit → Approve → Save; four-eyes `403` | J3 | scenarios `versions` | |
| F09-AC4 | Confirmed `409 boq_confirmed` incl. owner; reopen audited | J4 | scenarios `versions`, `state-machines` | |
| F09-AC5 | Every transition audited, shown in activity | J5 | scenarios `audit`, `e2e/audit.spec.ts` (deleted, P53) | |
| F10-AC1 | Patch, three settings, preview on Duplex | K1 | `e2e/library-editors.spec.ts` (deleted, P53) | |
| F10-AC2 | No publish with problems; n+1; old read-only | K2 | scenarios `library-publish` | |
| F10-AC3 | Saved BoQ keeps preset v1 numbers | K3 | scenarios `library-publish` | |
| F10-AC4 | 3-level code list import, duplicates | K4 | scenarios `codelists`, engine `test_codelist_import.py` | |
| F10-AC5 | "Opis" column → item texts, "Reads as" | K5 | none known (build log) | |
| F10-AC6 | Member sees, picks, no edits; `403` | K6 | scenarios `library`, `e2e/library.spec.ts` (deleted, P53) | |
| F10-AC7 | "Based on it" vs "Independent copy" | K7 | scenarios `library-publish`, `e2e/library-editors.spec.ts` (deleted, P53) | |
| F10-AC8 | Rule set Excel round trip, errors with sheet/row/column | K8 | scenarios `templates` | |
| F12-AC1 | Excel opens in Excel and LibreOffice; totals match | M1 | openpyxl only (`docs/product/known-limitations.md`) | |
| F12-AC2 | Description = item texts; "Lines" sheet both | M2 | engine tests, scenarios `edits-import`? | |
| F12-AC3 | WORKING watermark; saved frozen | M3 | scenarios `versions`, mock test `exports` (deleted, P53) | |
| F12-AC4 | Edited Excel imports as exactly the edits | M4 | scenarios `edits-import`, `e2e/exports.spec.ts` (deleted, P53) | |
| F13-AC1 | Run in another tab → toast + update < 2 s | N1 | `e2e/notifications.spec.ts` (deleted, P53) | |
| F13-AC2 | Vendor offer request by bell and email | — | — | n/a (P48) |
| F13-AC3 | Email off for a category, bell stays (core categories) | N3 | scenarios `billing`? `e2e/notifications.spec.ts` (deleted, P53) | |
| F14-AC1 | Every limit enforced with `402` + name | O1 | scenarios `billing` | |
| F14-AC2 | Provider swap needs no frontend change | O (code review) | — | |
| F14-AC3 | Bad webhook signature rejected and audited | O5 | ? | |
| F14-AC4 | Usage minutes = sum of job durations | B4 | scenarios `billing` | |
| F15-AC1 | Pseudo-locale, no untranslated strings | P1 | `e2e/pseudo-locale.spec.ts` (deleted, P53) | |
| F15-AC2 | User locale formats; BoQ keeps project locale | P2 | ? | |
| F15-AC3 | Engine questions from message keys | F8 | `e2e/questions.spec.ts` (deleted, P53) | |
| F16-AC1 | New person < 15 min on the sample Duplex (M) | L10 | — | owner |
| F16-AC2 | Each answer changes the preview < 3 s | L3 | `e2e/setup.spec.ts` (deleted, P53) | |
| F16-AC3 | After "Publish all", BoQ uses the presets; Excel texts | L4 | `e2e/setup.spec.ts` (deleted, P53), scenarios `setup` | |
| F16-AC4 | Leave at step 2, resume next day | L5 | scenarios `setup` | |
| F16-AC5 | Free org finishes without `libraryOrgPresets` | L6 | scenarios `setup` | |
| F16-AC6 | Gate before dashboard; suggested answers < 3 min | L1 | `e2e/setup.spec.ts` (deleted, P53) | |
| F16-AC7 | `setup` slots drive the screens, no frontend change | L8 | engine tests? | |
| F16-AC8 | 14-switch checklist, details, six screens | L2 | `e2e/setup.spec.ts` (deleted, P53) | |
| F16-AC9 | Reinforcement needs kg/m³ for three element kinds | L7 | `e2e/setup.spec.ts` (deleted, P53)? | |
| F18-AC1 | Link opens with no account, only what's included | Q1 | `e2e/shares.spec.ts` (deleted, P53), `e2e-java/main-flow.spec.ts` | |
| F18-AC2 | Revoke `404` < 1 s; `publicLinksAllowed` off | Q2 | scenarios `shares` | |
| F18-AC3 | "Follow latest saved" moves A → B | Q3 | scenarios `shares` | |
| F18-AC4 | Public endpoints never leak names, decisions, prices | Q4 | scenarios `shares` | |
| F19-AC1 | Non-admin `/admin/*` → `404` | R1 | contract `admin` | |
| F19-AC2 | Admin numbers = org usage page | R2 | scenarios `admin` | |
| F19-AC3 | "Hit a limit" with time | R3 | scenarios `admin` | |
| F19-AC4 | Plan change with reason, at once, in org audit | R4 | scenarios `admin`, `e2e/admin.spec.ts` (deleted, P53) | |
| F19-AC5 | No project content in `/admin/*` | R5 | scenarios `admin`, `ApiFoundationTest` | |
| F11, F17, F20 | Pricing module, every criterion | — | — | n/a (P48) |

## P. Performance (nfr.md), measured

Measured on the local native stack (never on the pilot). Fill in the machine and the commit.

| Target | Limit | Measured | Commit, tool | Pass |
|---|---|---|---|---|
| Duplex parse (first upload) | ≤ 30 s | | | |
| Duplex run (cached parse) | ≤ 5 s | | | |
| Duplex end to end (F04-AC2) | < 10 s | | | |
| Federated medium pair, both parses | ≤ 3 min | | | |
| Federated medium pair, run | ≤ 60 s | | | |
| CRUD API p95 | ≤ 300 ms | | | |
| Lines page (500 lines) p95 | ≤ 500 ms | | | |
| First contentful paint (shell, warm) | ≤ 1.5 s | | | |
| Sheet 20k lines, Group by switch | ≤ 300 ms | | | |
| Viewer: Duplex interactive (warm) | ≤ 3 s | | | |
| Picking | ≤ 100 ms | | | |
| Live update (job finished → UI) | ≤ 2 s | | | |
| Live edit seen by another user | ≤ 1 s | | | |
| Change report (Duplex) / cached diff | < 3 s / < 500 ms | | | |
| Queue wait p95, interactive runs | ≤ 10 s | | | |

## F. Findings

Newest at the bottom. Format (copy the block):

```markdown
### TF-000 · S? · type · area · status
- **Found by:** stage · lane/reviewer/journey · stack (M, J, P) · commit
- **Spec:** the id or line it breaks (F06-AC10, BR-29, permissions.md "Confirm a BoQ", screens.md S12)
- **Steps:** 1. … 2. …
- **Expected:** … (quote or paraphrase the spec)
- **Actual:** …
- **Evidence:** log excerpt, screenshot or trace path, request and response
- **Route:** fix now · deferred (task) · owner (Qnn) · known limitation (docs/product/known-limitations.md line) · duplicate (TF-x)
- **Fix:** commit `abc1234`, test that proves it (file and test name)
- **Retest:** verified 2026-11-21: CI run 44938492464 (`6cc0594`), job "Deploy Boqlet pilot", 19:18:19Z `Boqlet 6cc059436dc4… deployed.` The next push (`cf58e32`, run 44940268922) is green too. date, stack, result
```

Severity: S1 blocker · S2 major · S3 minor · S4 trivial. Type: bug · gap · inconsistency ·
test-gap · question. Status: open · fixing · fixed · verified · duplicate · known limitation ·
deferred · owner · won't fix. Full definitions in `test-plan.md` §10.

### TF-001 · S2 · bug · ops · verified
- **Found by:** Stage 0 · baseline (latest CI on `main`) · P · `3d68ffc`
- **Spec:** `CLAUDE.md` "Every green push [to `main`] deploys"; `docs/operations/auth-and-deploys.md` (automatic rollout); sessions.md "Every green push to `main` deploys"
- **Steps:** 1. Push to `main`. 2. Read the `deploy` job's log in `ci.yml`.
- **Expected:** the verified revision is rolled out to booqlet.com.
- **Actual:** the job runs on `main` (`if: github.ref == 'refs/heads/main'`), but its "superseded" guard compares `GITHUB_SHA` with the head of **`v_1`** (`gh api …/git/ref/heads/v_1`). `v_1` is frozen at `4b9a07c`, so every `main` push prints "Skipped superseded revision" and exits 0: the job is green and nothing deploys. Both `main` pushes since FE-047 (`8977990`, `3d68ffc`) were skipped. The pilot still runs `af92da4` (the last `v_1` deploy, "Narudzbe and Boqlet API routing passed"); its application code matches `main`, only `ci.yml` and docs differ. The build log's "deployed to booqlet.com" at `8977990` is therefore wrong.
- **Evidence:** run 44926299190, job "Deploy Boqlet pilot", 16:58:39Z `Skipped superseded revision 3d68ffccf89d0eb38aebc40a8d112b2aa6456b6a`; run 44924953402, 16:43:44Z `Skipped superseded revision 897799012713…`; `.github/workflows/ci.yml` line 189.
- **Route:** fix now (one line: `heads/main`), plus the build log correction. Not a blocker for Stages 1–4 (the pilot's code matches `main`), but Stage 7 can't finish without it. Fixed before triage on the owner's word (2026-11-21).
- **Fix:** `ci.yml` compares with `heads/main`; build log Current position and `docs/product/known-limitations.md` Done corrected. Test: the CI run of the fix commit itself (a workflow has no lower layer); its `deploy` log must show a rollout.
- **Retest:**
