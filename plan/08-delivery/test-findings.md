# Test findings: the campaign log

The working record of the test campaign in [`test-plan.md`](test-plan.md). Each section is filled
while the campaign runs. A session that stops half-way leaves this file up to date. The next session
reads the run log and resumes from the first stage not marked done.

**Not started.** Prepared 2026-11-21; nothing has been run yet.

## Summary

Filled in at Stage 7.

| | S1 | S2 | S3 | S4 | Total |
|---|---|---|---|---|---|
| Found | | | | | |
| Fixed and verified | | | | | |
| Owner (questions) | | | | | |
| Deferred to a task | | | | | |
| Known limitation | | | | | |

- Commit under test (start): ``
- Commit after the fixes (end): ``
- CI on the end commit: 
- Pilot rollout and `verify-live.sh`: 
- Waiting for the owner: 

## Run log

One row per stage or lane, updated when it starts and ends.

| Stage / lane | Status | Started | Ended | Stack | Result, log path | Findings |
|---|---|---|---|---|---|---|
| 0 Preflight (tools, `npm install`, latest CI) | not started | | | | | |
| 1A Static | not started | | | | | |
| 1B Unit | not started | | | | | |
| 1C Engine, CLI, corpus | not started | | | | | |
| 1D Shared suites on the mock | not started | | | | | |
| 1E Browser on the mock | not started | | | | | |
| 1F Java (`mvn verify`, suites on Java, browser smoke) | not started | | | | | |
| 1G CI parity | not started | | | | | |
| 1 Coverage audit (§C) | not started | | | | | |
| 2 R1 Contract parity | not started | | | | | |
| 2 R2 Authorisation and tenancy | not started | | | | | |
| 2 R3 State machines and rules | not started | | | | | |
| 2 R4 Frontend screens | not started | | | | | |
| 2 R5 Security | not started | | | | | |
| 2 R6 Engine, numbers, exports | not started | | | | | |
| 2 R7 Docs and plan consistency | not started | | | | | |
| 3 A Accounts, sessions, orgs | not started | | | M, J | | |
| 3 B Org settings | not started | | | M | | |
| 3 C Projects | not started | | | M, J | | |
| 3 D Models | not started | | | M, J | | |
| 3 E BoQs and runs | not started | | | M, J | | |
| 3 F Questions | not started | | | M, J | | |
| 3 G Sheet | not started | | | M | | |
| 3 H Viewer | not started | | | M | | |
| 3 I Revisions | not started | | | M | | |
| 3 J Versions, review, confirm | not started | | | M, J | | |
| 3 K Library | not started | | | M | | |
| 3 L Setup wizard | not started | | | M | | |
| 3 M Exports | not started | | | M | | |
| 3 N Notifications | not started | | | M | | |
| 3 O Plans and limits | not started | | | M | | |
| 3 P i18n | not started | | | M | | |
| 3 Q Share links | not started | | | M, J | | |
| 3 R Platform admin | not started | | | M, J | | |
| 3 S Across everything (S1 role matrix sweep, S2 UI sweep, S3–S8) | not started | | | M, J | | |
| 3 Pilot acceptance walk (§7.4) | not started | | | P | | |
| 4.1 Performance | not started | | | J | | |
| 4.2 Accessibility | not started | | | M | | |
| 4.3 Security | not started | | | J, P (passive) | | |
| 4.4 Resilience and operations | not started | | | J | | |
| 4.5 Compatibility | not started | | | M | | |
| 4.6 Pricing boundary | not started | | | — | | |
| 4.7 PoC smoke | not started | | | — | | |
| 5 Triage | not started | | | | | |
| 6 Fix and retest | not started | | | | | |
| 7 Regression, push, CI, pilot, records | not started | | | | | |

## Noted while writing the plan (check in Stage 2, R7)

These aren't findings yet. R7 confirms or drops each one and files the confirmed ones as findings.

- `CLAUDE.md`'s repo map lists `tests/perf` and `packages/pricing-ui`, and neither exists (TS-002 and
  P48 explain why; the map doesn't say so).
- There is no script or compose file for a local native Java stack outside `NativeWorkerTest`;
  manual and performance testing against Java has no documented way to start it.
- Test counts in `testing.md` (engine "194 tests"; `docs/11` says 206) differ from a plain count of
  test functions (~110, parametrised tests counted once). Check what each number counts.
- Tooling on the owner's machine: JDK 22 instead of 21; no Maven and no `mvnw`; no LibreOffice.
- The federated pair for v1 criterion 2 and the nfr.md timings is not in `fixtures/` (download per
  `docs/12`).

## C. Coverage of the acceptance criteria

Status: **pass (A)** + test · **pass (M)** + journey and evidence · **fail** + TF id · **n/a** +
reason · **owner**. "Look first in" lists likely places only. The coverage audit (Stage 1)
replaces them with the exact file and test name.

### v1 criteria (`00-product/03-v1-scope.md`)

| # | Criterion | Journeys | Look first in | Status |
|---|---|---|---|---|
| v1-1 | Duplex reproduction through the full stack (A) | 1C, 1F, E2 | `engine/tests/test_duplex.py`, `e2e/duplex.spec.ts`, `NativeWorkerTest` | |
| v1-2 | Federation, no double counts, overlaps as questions (A) | H4, §9.1 | `engine/tests/test_federation*.py` | |
| v1-3 | Revision: exact change report, answers carried (A) | I1–I3, F7 | `e2e/versions-flow.spec.ts`, scenarios `versions`, `changes` | |
| v1-4 | Traceability in ≤ 2 clicks (M) | G2 | — | |
| v1-5 | Versions locked, confirmed BoQ refuses writes, approval (A) | J2–J4 | scenarios `versions`, `state-machines` | |
| v1-6 | Pricing module | — | — | n/a (P48) |
| v1-7 | Library: create, change, preview, publish (M) | K1–K3 | `e2e/library-editors.spec.ts` | |
| v1-8 | Isolation (A) | S1, 1F | scenarios `isolation`, contract `admin`, `NativeWorkerTest.verifyTenantIsolation` | |
| v1-9 | Limits: `402 limit_reached` and the UI (A) | O1 | scenarios `billing`, `e2e/billing.spec.ts` | |
| v1-10 | Performance: nfr.md targets (A) | §9.1 | `e2e/*.perf.spec.ts`; `tests/perf` missing (TS-002) | |
| v1-11 | i18n pseudo-locale (A) | P1 | `e2e/pseudo-locale.spec.ts` | |
| v1-12 | First setup in < 15 min by a new person (M) | L10 | `e2e/setup.spec.ts` (flow only) | owner |
| v1-13 | Editing: live co-editing; edits survive versions; Excel round trip (A) | G3, G9, M4 | `e2e/co-editing.spec.ts`, `e2e-java/live.spec.ts`, scenarios `line-edits`, `edits-import` | |
| v1-14 | Vendors | — | — | n/a (P48) |
| v1-15 | Share link: no account, minimal, revoke < 1 s (A) | Q1, Q2 | scenarios `shares`, `e2e/shares.spec.ts` | |
| v1-16 | Single session takeover (A) | A6 | `e2e/sessions.spec.ts`, `e2e-java/sessions.spec.ts`, scenarios `state-machines` | |
| v1-17 | Admin console numbers match, no content (A) | R2, R5 | scenarios `admin`, contract `admin`, `ApiFoundationTest` | |

### Feature acceptance criteria (`01-features/F*.md`, by position)

| Id | Criterion (short) | Journey | Look first in | Status |
|---|---|---|---|---|
| F01-AC1 | Sign up → org → dashboard < 1 min | A1 | `e2e/auth.spec.ts`, `e2e-java/accounts.spec.ts` | |
| F01-AC2 | Invitation refused for another email | A3 | scenarios `orgs` | |
| F01-AC3 | Seat limit `402 seats` + upgrade prompt | A4 | scenarios `orgs`, `billing` | |
| F01-AC4 | Last owner can't leave or be demoted | A5 | scenarios `orgs` | |
| F01-AC5 | Takeover, `401 session_replaced` in 5 s, cancel | A6 | `e2e/sessions.spec.ts` | |
| F01-AC6 | Org switch uses the new org | A7 | `e2e/orgs.spec.ts`, `e2e-java/orgs.spec.ts` | |
| F01-AC7 | Audit events for every account action | A10 | scenarios `audit` | |
| F02-AC1 | `activeProjects` 402; archiving frees the slot | C2 | scenarios `projects` | |
| F02-AC2 | No project role → not listed, `404` | C3 | scenarios `projects`, `isolation` | |
| F02-AC3 | Project members are org members only | C1 | scenarios `projects` | |
| F02-AC4 | Archived: `409 project_archived`, banner | C4 | scenarios `projects`, `e2e/projects.spec.ts` | |
| F02-AC5 | "Needs you" shows a review in 5 s | C5 | `e2e/shell.spec.ts`? | |
| F03-AC1 | Upload progress → stages → report, no reload | D1 | `e2e/models.spec.ts` | |
| F03-AC2 | Live state after leaving; notification | D1 | `e2e/models.spec.ts`, `e2e/notifications.spec.ts` | |
| F03-AC3 | Non-IFC → `not_ifc`, no retry | D2 | scenarios `models` | |
| F03-AC4 | Identical content parses once | D3 | scenarios `models` | |
| F03-AC5 | Check rows open the viewer with their elements | D5 | `e2e/viewer.spec.ts`? | |
| F03-AC6 | Over `maxModelVersionMb` refused in client and server | D4 | scenarios `models`, `billing` | |
| F04-AC1 | New BoQ preselects both latest versions + defaults | E1 | scenarios `boqs`, `e2e/boqs.spec.ts` | |
| F04-AC2 | Duplex run < 10 s end to end, no reload | E2 | `e2e/duplex.spec.ts` | |
| F04-AC3 | Blocking questions → `needs_input`, header link | E3 | scenarios `boqs`, `questions` | |
| F04-AC4 | Inputs changed → Save disabled | E4 | mock test `inputs-changed`, `e2e/boqs.spec.ts` | |
| F04-AC5 | Classification never changes quantities (BR-02) | E5 | scenarios `boqs`, engine tests | |
| F05-AC1 | All blocking answered → `complete` | F1 | scenarios `questions` | |
| F05-AC2 | New version with same names asks nothing | F7 | `e2e/new-versions.spec.ts` | |
| F05-AC3 | Bulk 10 names = one request + one regenerate | F3 | `e2e/questions.spec.ts` | |
| F05-AC4 | Decision used by approved revision warns → draft | F5 | scenarios `questions`, `versions` | |
| F05-AC5 | Promote → org dictionary version → not asked again | F6 | scenarios `questions`, `library` | |
| F06-AC1 | Group by switch instant, no request | G1 | `e2e/sheet.spec.ts` | |
| F06-AC2 | Detail: formula, parameters, shares sum | G2 | `e2e/sheet.spec.ts`, scenarios `sheet` | |
| F06-AC3 | Every edit type survives regeneration + new version + Excel | G3 | scenarios `line-edits`, `e2e/exports.spec.ts` | |
| F06-AC4 | Unit change without quantity refused; Ctrl+Z | G4 | `e2e/line-edits.spec.ts` | |
| F06-AC5 | "How it is calculated" adds up, links Settings | G2 | `e2e/sheet.spec.ts`, scenarios `sheet` | |
| F06-AC6 | Manual line under "9 Preliminaries" stays | G5 | `e2e/line-edits.spec.ts` | |
| F06-AC7 | Item texts vs line texts by Group by | G6 | `e2e/sheet.spec.ts`? | |
| F06-AC8 | "Not in the models" notice, remembered collapse | G7 | `e2e/sheet.spec.ts`? | |
| F06-AC9 | Positions renumber; frozen in saved | G8 | mock test `positions`, scenarios `versions` | |
| F06-AC10 | Co-editing < 1 s; later edit wins, earlier told | G9 | `e2e/co-editing.spec.ts`, `e2e-java/live.spec.ts` | |
| F06-AC11 | 20k lines smooth | G10 | `e2e/sheet.perf.spec.ts` | |
| F07-AC1 | Line → exactly its elements | H1 | `e2e/viewer.spec.ts`, `e2e/sheet-model.spec.ts` | |
| F07-AC2 | Element → its lines with shares | H2 | `e2e/viewer.spec.ts` | |
| F07-AC3 | Coverage colour, count = unmatched | H3 | `e2e/viewer.spec.ts` | |
| F07-AC4 | Two models, toggleable | H4 | ? | |
| F07-AC5 | Shared filters, box select | H5 | `e2e/sheet-model.spec.ts` | |
| F07-AC6 | Changes colour mode v1 → v2 | H6 | `e2e/changes.spec.ts` | |
| F07-AC7 | Duplex viewer < 3 s warm | H7 | `e2e/ui.perf.spec.ts` | |
| F08-AC1 | Change report lists exactly affected lines and elements | I1 | scenarios `changes`, `e2e/changes.spec.ts` | |
| F08-AC2 | No answered question asked again | I2 | `e2e/versions-flow.spec.ts` | |
| F08-AC3 | Earlier edits still applied and listed | I3 | scenarios `changes` | |
| F08-AC4 | Report < 3 s, cached < 500 ms | I4 | ? | |
| F09-AC1 | Save version: labelled snapshot, work goes on | J1 | scenarios `versions`, `e2e/versions.spec.ts` | |
| F09-AC2 | Saved version byte-identical | J2 | scenarios `versions` | |
| F09-AC3 | Submit → Approve → Save; four-eyes `403` | J3 | scenarios `versions` | |
| F09-AC4 | Confirmed `409 boq_confirmed` incl. owner; reopen audited | J4 | scenarios `versions`, `state-machines` | |
| F09-AC5 | Every transition audited, shown in activity | J5 | scenarios `audit`, `e2e/audit.spec.ts` | |
| F10-AC1 | Patch, three settings, preview on Duplex | K1 | `e2e/library-editors.spec.ts` | |
| F10-AC2 | No publish with problems; n+1; old read-only | K2 | scenarios `library-publish` | |
| F10-AC3 | Saved BoQ keeps preset v1 numbers | K3 | scenarios `library-publish` | |
| F10-AC4 | 3-level code list import, duplicates | K4 | scenarios `codelists`, engine `test_codelist_import.py` | |
| F10-AC5 | "Opis" column → item texts, "Reads as" | K5 | none known (build log) | |
| F10-AC6 | Member sees, picks, no edits; `403` | K6 | scenarios `library`, `e2e/library.spec.ts` | |
| F10-AC7 | "Based on it" vs "Independent copy" | K7 | scenarios `library-publish`, `e2e/library-editors.spec.ts` | |
| F10-AC8 | Rule set Excel round trip, errors with sheet/row/column | K8 | scenarios `templates` | |
| F12-AC1 | Excel opens in Excel and LibreOffice; totals match | M1 | openpyxl only (`docs/11`) | |
| F12-AC2 | Description = item texts; "Lines" sheet both | M2 | engine tests, scenarios `edits-import`? | |
| F12-AC3 | WORKING watermark; saved frozen | M3 | scenarios `versions`, mock test `exports` | |
| F12-AC4 | Edited Excel imports as exactly the edits | M4 | scenarios `edits-import`, `e2e/exports.spec.ts` | |
| F13-AC1 | Run in another tab → toast + update < 2 s | N1 | `e2e/notifications.spec.ts` | |
| F13-AC2 | Vendor offer request by bell and email | — | — | n/a (P48) |
| F13-AC3 | Email off for a category, bell stays (core categories) | N3 | scenarios `billing`? `e2e/notifications.spec.ts` | |
| F14-AC1 | Every limit enforced with `402` + name | O1 | scenarios `billing` | |
| F14-AC2 | Provider swap needs no frontend change | O (code review) | — | |
| F14-AC3 | Bad webhook signature rejected and audited | O5 | ? | |
| F14-AC4 | Usage minutes = sum of job durations | B4 | scenarios `billing` | |
| F15-AC1 | Pseudo-locale, no untranslated strings | P1 | `e2e/pseudo-locale.spec.ts` | |
| F15-AC2 | User locale formats; BoQ keeps project locale | P2 | ? | |
| F15-AC3 | Engine questions from message keys | F8 | `e2e/questions.spec.ts` | |
| F16-AC1 | New person < 15 min on the sample Duplex (M) | L10 | — | owner |
| F16-AC2 | Each answer changes the preview < 3 s | L3 | `e2e/setup.spec.ts` | |
| F16-AC3 | After "Publish all", BoQ uses the presets; Excel texts | L4 | `e2e/setup.spec.ts`, scenarios `setup` | |
| F16-AC4 | Leave at step 2, resume next day | L5 | scenarios `setup` | |
| F16-AC5 | Free org finishes without `libraryOrgPresets` | L6 | scenarios `setup` | |
| F16-AC6 | Gate before dashboard; suggested answers < 3 min | L1 | `e2e/setup.spec.ts` | |
| F16-AC7 | `setup` slots drive the screens, no frontend change | L8 | engine tests? | |
| F16-AC8 | 14-switch checklist, details, six screens | L2 | `e2e/setup.spec.ts` | |
| F16-AC9 | Reinforcement needs kg/m³ for three element kinds | L7 | `e2e/setup.spec.ts`? | |
| F18-AC1 | Link opens with no account, only what's included | Q1 | `e2e/shares.spec.ts`, `e2e-java/main-flow.spec.ts` | |
| F18-AC2 | Revoke `404` < 1 s; `publicLinksAllowed` off | Q2 | scenarios `shares` | |
| F18-AC3 | "Follow latest saved" moves A → B | Q3 | scenarios `shares` | |
| F18-AC4 | Public endpoints never leak names, decisions, prices | Q4 | scenarios `shares` | |
| F19-AC1 | Non-admin `/admin/*` → `404` | R1 | contract `admin` | |
| F19-AC2 | Admin numbers = org usage page | R2 | scenarios `admin` | |
| F19-AC3 | "Hit a limit" with time | R3 | scenarios `admin` | |
| F19-AC4 | Plan change with reason, at once, in org audit | R4 | scenarios `admin`, `e2e/admin.spec.ts` | |
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
- **Route:** fix now · deferred (task) · owner (Qnn) · known limitation (docs/11 line) · duplicate (TF-x)
- **Fix:** commit `abc1234`, test that proves it (file and test name)
- **Retest:** date, stack, result
```

Severity: S1 blocker · S2 major · S3 minor · S4 trivial. Type: bug · gap · inconsistency ·
test-gap · question. Status: open · fixing · fixed · verified · duplicate · known limitation ·
deferred · owner · won't fix. Full definitions in `test-plan.md` §10.

_No findings yet._
