# 00 — Shared context for the multi-perspective review

Written 2026-11-23 by the review's main session (Phase 0), on `main` at `3868013` ("P57: bundle budgets
for the new admin and reset routes"), Windows 11, 12 CPUs, 15.4 GB RAM given to Docker.
Everything here was run or read in this session; commands and outputs are in
`docs/review/_scratch/logs/` (git-ignored, local only) and summarised below.

**Reviewers:** this is the only shared input. The product docs (`docs/`) were written by AI from the
owner's input and are **not ground truth**: where a spec looks wrong, incomplete or contradictory,
record a `spec-issue` finding. Do not modify application code. Write only your own report and your
own folders.

---

## 1. What the app is (one paragraph)

**boqlet** turns IFC building models into a **Bill of Quantities**: a firm uploads discipline models,
chooses a **rule set** (how to measure), **classifications** (how to code and group, with item numbers
and item texts) and **dictionaries** (what names mean) — all three are versioned data the firm owns —
answers the **questions** the engine can't decide, edits and versions the BoQ, confirms it, exports it
to Excel and shares it by public link. Every number carries its formula, parameters and elements.
`getBoq(models, rules, classifications, dictionaries, decisions) -> BoqResult`. Released as v1.0.0
(2026-11-21), invite-only pilot at booqlet.com (the only deployed environment, P51). Product
north star: `docs/product/overview.md`; agent rules: `CLAUDE.md` (rules of the road 1–11).

## 2. Architecture map

```
Browser ── Next.js 16 app (apps/app, React 19, TanStack Query/Table/Virtual, next-intl, three.js)
   │          same origin /api/v1 → Java (Next rewrite locally: apps/app/app/api/v1/[...path], Traefik on the pilot)
   │          SSE GET /api/v1/events for live updates
   │  signed PUT/GET URLs (uploads, downloads, geometry.glb, exports)
   ▼
Object storage (S3 API; SeaweedFS) ◄──────────────── engine reads IFC, writes parsed.json, meshes.npz,
                                                      geometry.glb, result.json.gz, xlsx
Java API (services/api, Spring Boot 3.5, Java 21, JdbcTemplate, Flyway) ── SQL ──► PostgreSQL 16
   identity, org, billing, project, model, library, boq, worker, realtime, mail, audit, admin,
   maintenance, storage, extension, http, db packages (modular monolith; ArchUnit CoreArchitectureTest)
   │ jobs: HTTP dispatch (local) or Postgres queue (pilot: queue_claim/renew/finish)
   │ rpc:  POST /rpc/{op} (check, names, codelist-read/build, expr-check, template-export/import), 15 s
   ▼
Engine worker (engine/ifc_boq, Python 3.10–3.13; ifcopenshell 0.9.0 installed, trimesh, manifold3d, openpyxl)
   job kinds: parse, run, preview, diff, export_xlsx, import_boq_edits
```

| Part | Path | Size (lines) | Entry points |
|---|---|---|---|
| App (UI only, no quantity logic, BR-01) | `apps/app` | ~36.4k TS/TSX in `app/` + `src/` | routes `app/(public)`, `app/(app)/[org]/…`, `app/(admin)/admin/…`; features `src/features/*` (boq-sheet, boqs, changes, library, models, questions, setup, viewer, versions, shares, admin…); API hooks `src/api/hooks/*`; SSE `src/realtime`; messages `messages/en/*.json` |
| HTTP contract | `packages/api/openapi.yaml` | 162 operations (docs say 172 in `contract/auth.test.ts`) | generated TS client `@ifc-boq/api`; Java interfaces generated at build (openapi-generator) |
| Engine contract | `packages/types/src/*.ts` → `packages/types/schema/*.json` (`npm run codegen`) | | `test_result_matches_the_typescript_contract` |
| Backend | `services/api/src/main/java/com/boqlet/api/*` | ~14.3k Java | controllers implement generated `*Api`; 22 Flyway SQL migrations (V1–V23, V5 is a Java migration in `src/main/java/db/migration`) |
| Engine | `engine/ifc_boq` | ~8.8k Python | `parse.py` (1057), `rules.py` (954), `measure.py` (841), `federation.py` (640), `expr.py` (safe evaluator), `pipeline.py` (`get_boq`), `worker*.py`, `cli.py` |
| Presets (data) | `presets/rules` (as-modelled, acme-house-rules, demo-custom, demo-tweaked, standard-style-example), `presets/classifications` (acme-cost-codes, demo-trades, uniclass2015-ef map only), `presets/dictionaries` (global-seed, acme-company, project-duplex), `presets/settings` (federation, resolution) | | engine `presets.py`; Java seeds the system Library from them |
| Pricing module | `packages/pricing-api/openapi-pricing.yaml` | contract only | not built (P48) |
| Ops | `ops/local/compose.yaml` (local stack), `ops/pilot/*` (pilot compose, deploy, backup) | | `scripts/local.mjs` |
| Tests | `engine/tests` (pytest), `apps/app/src/**/*.test.ts(x)` (Vitest), `services/api/src/test` (JUnit + Testcontainers), `tests/contract`, `tests/scenarios`, `tests/perf` (Vitest against Java inside `NativeWorkerTest` only), `apps/app/e2e-java` (Playwright against Java) | | |

**How the three talk:** app → Java only (REST + SSE; never the engine). Java → engine by job rows
(HTTP `POST /jobs/{kind}` or the Postgres queue) and quick `POST /rpc/{op}` calls. Hand-off of big data
is by **object-storage keys**: the browser PUTs the IFC to a signed URL; the engine writes
`parsed.json`, `meshes.npz` (mesh sidecar), `geometry.glb`, `result.json.gz`, the workbook; Java
ingests the result into rows (`RunIndex`, Postgres COPY: `run_lines`, `run_line_elements`,
`run_questions`, `run_warnings`, `run_log_entries`). Live updates: DB triggers → `realtime_events` +
`pg_notify` → SSE.

**Data model and persistence:** PostgreSQL holds all queryable state (users, orgs, memberships,
projects, models, model_versions, presets, preset_versions, boqs, boq_revisions, decisions,
line_overrides, manual_items, runs + run_* index tables, run_diffs, exports, share_links, jobs,
realtime_events, notifications, email_outbox, audit_events, plans, subscriptions, usage, admin
notes); blobs in S3. Logical model: `docs/architecture/data-model.md`; tables: `docs/architecture/database.md`.
State machines: `docs/domain/state-machines.md`. Permissions (org roles owner/admin/library_editor/
member; project roles lead/estimator/approver/viewer): `docs/domain/permissions.md`, enforced in
`OrgAccess` / `ProjectAccess`.

**Engine stages** (`docs/architecture/engine.md`): parse → names → measure → (federation match) →
rules (items, derived, manual) → coverage (`unmatched` questions) → names that matter
(`unknown_name` questions) → classify → decisions/summary. Measuring logic lives only in `measure.py`;
`rules.py` selects/combines/labels; formulas only in `expr.py`.

## 3. How to run it (verified in this session)

| What | Command | Result here |
|---|---|---|
| Install | `npm install` (creates `engine/.venv`) | already installed; venv Python 3.10.7, ifcopenshell 0.9.0, numpy 2.2.6, trimesh 5.1.1 |
| Backend in Docker | `npm run local:up` | ✓ 1 m 51 s (images cached); API :8080, S3 :8333, MailHog :8025, Postgres :55432 |
| App + demo account | `npm run local:demo -- --password "review-demo-password-2026"` | ✓ `next dev` on http://localhost:3000; `demo@example.test` / `review-demo-password-2026`, org "Demo Firm" (`/demo-firm`) with the Duplex sample |
| End-to-end check | `npm run local:check` | ✓ 10 s: sign-up → org → project → Duplex upload → parse → run with 41 lines |
| Engine CLI | `npm run boq -- <file.ifc> --out boq.xlsx [--rules id] [--class id…] [--dict id…] [--json r.json]` | ✓ (exit 2 when the result needs input) |
| Make a sign-up link | `npm run local:user -- <email>` (one hour; open it, set a 15+ char password) | ✓ |
| Make a platform admin | `npm run local:admin -- <email>` | ✓ |
| Read emails | http://localhost:8025 (MailHog: invitations, reset links, notifications) | ✓ |
| Headless browser | Playwright 1.65 is installed at the repo root (`node_modules/playwright`, Chromium present). Example: `docs/review/_scratch/pw-smoke.mjs` (run with `node`, from the repo root) | ✓ signs in, screenshots in `docs/review/_screenshots/00-context/`. Use `waitUntil: "domcontentloaded"`, never `networkidle` (the SSE stream keeps the network busy). First page compile in `next dev` takes 10–60 s |

**Accounts made for the review (all passwords `review-persona-password-2026`)** — one active session
per account (P22): signing in elsewhere signs the first session out, so use only your own account.

| Account | Org (slug) | Plan | Notes |
|---|---|---|---|
| `eng@review.test` | Eng Review Firm (`eng-firm`) | enterprise | platform admin too; setup done; Duplex sample project |
| `qs@review.test` | QS Review Firm (`qs-firm`) | enterprise | setup done; Duplex sample |
| `lead@review.test` | Lead Estimating Co (`lead-co`) | team (25 seats) | setup done; Duplex sample; invite teammates through the UI and read the invitation mails in MailHog |
| `ux@review.test` | UX Review Firm (`ux-firm`) | enterprise | setup done; Duplex sample |
| `pm-admin@review.test` | none | — | platform admin, for the `/admin` console |
| new accounts | — | Free (the default plan) | `npm run local:user -- <email>` prints a sign-up link: the real first-run path (onboarding → setup wizard). Free = 1 seat, 1 project, 50 MB per model version, 60 processing minutes/month, export watermark |

**Shared stack rules for reviewers:** the stack is shared by six reviewers at once. Never run
`local:down`, `local:reset`, `local:demo` or `mvn verify`, never restart containers, never change
another account's data. The local HTTP engine worker runs **one job at a time**: big uploads queue
behind each other, so in the browser prefer S01–S05, S07, S09, S11 and use the engine baseline
(below) for the slow ones (S06 ~1.5–9 min depending on load, S07/S08 ~1–2 min each, S10 ~1.5–6 min). Your own
throwaway accounts and orgs are fine.

## 4. Build, test and lint results (this session)

| Check | Command | Result | Time |
|---|---|---|---|
| Engine tests (incl. Duplex acceptance) | `npm run test:engine` | ✓ **265 passed**, 1 warning | 3 m 27 s |
| Typecheck (all workspaces) | `npm run typecheck` | ✓ | 1 m 9 s |
| Lint (incl. no-literal-UI-strings) | `npm run lint` | ✓ | 2 m 18 s |
| App unit tests | `npm run test:app` | ✓ **405 passed** (73 files) | 47 s |
| Contract lint | `npm run api:lint` | ✓ valid, **3 warnings** | 4 s |
| Generated clients up to date | `npm run api:check` | ✓ | 10 s |
| Production build | `npm run build:app` | ✓ (48 routes) | 18 s (warm cache) |
| Bundle budgets | `npm run bundle:check -w @ifc-boq/app` | ✓ 48 routes within budget (largest 359 KiB gz) | |
| Local stack end to end | `npm run local:check` | ✓ | 10 s |
| npm audit (prod deps) | `npm audit --omit=dev` | ✓ 0 vulnerabilities | |
| npm audit (all) | `npm audit` | **12 moderate** (dev tooling: glob/minimatch via ts-json-schema-generator, shadcn CLI, typescript-eslint) | |
| Python deps | `pip-audit -r engine/requirements.txt` | ✓ no known vulnerabilities | |
| Java + shared suites + browser smoke (as CI) | `mvn -B -ntp -f services/api/pom.xml verify` with `BOQLET_NATIVE_WORKER_PYTHON`, `BOQLET_NATIVE_NODE`, `BOQLET_NATIVE_SCENARIOS=1`, `BOQLET_BROWSER_SMOKE=1`, `BOQLET_NATIVE_QUEUE_TEST=1`, `BOQLET_NATIVE_RESILIENCE=1`, `IFC_BOQ_PYTHON`, AWS test keys (PowerShell form in `docs/testing/README.md`) | **✗ BUILD FAILURE: 2 of 49 JUnit tests failed, both timeouts.** All JUnit classes pass except `NativeWorkerTest`. (1) `sharedScenariosPassAgainstJava`: scenarios 1,890 passed, 2 todo, **1 failed by timeout** (`permissions.test.ts` "P9 Save version (approval off): OWN → 2xx", 60 s test timeout). (2) `browserSmokeAgainstJava` hit its overall time limit (`NativeWorkerTest.java:441`, 1,516 s). Both ran while six reviewers, two baseline captures and the local stack loaded the machine. Targeted re-run on a quieter machine (`-Dtest=NativeWorkerTest`, `BOQLET_SCENARIO_FILTER=permissions`, `BOQLET_BROWSER_SMOKE=1`; log `mvn-verify-rerun.log`): **✓ BUILD SUCCESS**, `sharedScenariosPassAgainstJava` (permissions, 1,608 tests) passed in 214 s and `browserSmokeAgainstJava` passed in 449 s. Conclusion: both failures were load-induced timeouts; the suite is timing-sensitive under load (worth a note for CI on 2-CPU runners) | 61 min + 15 min |

Not run: the CI `rollback` job (needs the previous release image), `ops/pilot/verify-live.sh` (pilot),
the API performance suite (`BOQLET_API_PERF=1`, manual by design).

## 5. Docs inventory

~26k lines of Markdown. **Current docs** (written by AI, kept "current" by the build agents):

| Area | Files | What it holds |
|---|---|---|
| Entry | `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/README.md` | rules of the road, docs map |
| Product | `docs/product/overview.md` (outcomes O1–O10, principles, intended vs built), `personas.md`, `flows.md` (FL-1…FL-12), `screens.md`, `scope-and-acceptance.md` (v1 scope, 17 acceptance criteria + results), `plans-and-limits.md`, `roadmap.md`, `known-limitations.md`, `open-questions.md` (Q1–Q44), `features/F01…F20` (each with a dated status block), `guides/rules.md`, `guides/classifications.md`, `guides/dictionaries.md` | |
| Domain | `docs/domain/primer.md`, `glossary.md`, `business-rules.md` (BR-01…BR-57, 45 rows), `permissions.md`, `state-machines.md`, `measurement-standards.md`, `sourcing-and-licensing.md` | |
| Architecture | `overview.md`, `engine.md`, `rules-language.md`, `dictionaries-and-classification.md`, `contracts.md`, `engine-worker.md`, `backend.md`, `database.md`, `data-model.md`, `api-conventions.md`, `frontend.md`, `storage-jobs-realtime.md`, `security.md`, `nfr.md`, `modules.md`, `deployment.md` | |
| Development | `local-setup.md`, `commands.md`, `environment.md`, `workflow.md`, `design-guidelines.md`, `design-system.md`, `contract-changes.md` | |
| Testing | `docs/testing/README.md` (layers, CI, outcome coverage), `test-plan.md`, `test-findings.md` (2,430 lines: the TF-xxx campaign log), `engine-validation.md`, `ifc-corpus-catalogue.md` (309 files from 30 tools) | |
| Operations | `docs/operations/pilot.md`, `auth-and-deploys.md` | |
| Decisions | `docs/decisions.md` (P01–P57, D01–D70, BE-D…; ~112 rows) | |
| Changelog | `docs/changelog.md` | |
| **Original / AI-expanded instructions (archive)** | `docs/archive/reference/conversation/part1…part4` (the original owner ↔ AI conversation, ~3.2k lines), `docs/archive/reference/knowledge-base-2026-10-03.md`, `docs/archive/reference/files/*.xlsx/.docx` (owner's reference spreadsheets and gap analyses), `docs/archive/plan/*` (build plan, tasks-engine/backend/frontend, milestones, sessions, mock API), `docs/archive/build-log.md`, `docs/archive/platform-design-2026-10.md`, `architecture-2026-10.md`, `overview-2026-10.md`, `limitations-history.md`, `docs/archive/reference/prototype-2026-10/*.py` (the proof of concept) | |

## 6. Feature matrix

Status values: **built** / **partial** / **missing** / **diverges** (from spec) / **spec questionable**;
**non-goal** marks things the docs explicitly exclude (kept so the coverage table can explain them).
"Planned in" points at the spec; evidence is the spec's status block (checked against the code on
2026-11-21/22 by the build agents) plus spot checks done in this session (marked ✔ here). Reviewers:
re-check what you touch; the matrix is a starting point, not a verdict.

| ID | Feature | Planned in | Status | Evidence |
|---|---|---|---|---|
| FM-01 | Native email+password sign-in, one active session, takeover | F01 §10, P22, P50 | built | `identity/Sessions.java`, `NativeAuthController`; ✔ takeover prompt seen in the browser (`_screenshots/00-context/after-sign-in.png`) |
| FM-02 | Public sign-up (platform setting, off by default) and self-service password reset | F01, P57 | built | `NativeAuthController`, `apps/app/src/auth/adapters/native-links.tsx` |
| FM-03 | Bot protection for public sign-up (captcha / proof of work) | P57, BE-D12 | partial | hidden field, 3 s min fill time (client-measured), throttling only (known-limitations "Accounts") |
| FM-04 | Terms / privacy acceptance at sign-up; terms pages | F01, Q19 | missing | known-limitations "Accounts" |
| FM-05 | Invite colleagues during onboarding (FL-1 step 3) | flows.md FL-1 | missing | `apps/app/app/(app)/onboarding/page.tsx` creates the org only (F01 status) |
| FM-06 | Takeover prompt names where the other session is | F01 §10 | missing | ✔ `Sessions.java` selects `place`; nothing writes it (F01 status) |
| FM-07 | Configurable idle session expiry | F01, Q27 | missing | ✔ `Sessions.java:36` hard-codes `interval '12 hours'` |
| FM-08 | `ownedOrgsPerUser` enforced on ownership transfer | F01, P57 | diverges | checked on org create only (F01 status) |
| FM-09 | Orgs, invitations, roles, multi-org membership, members' last activity | F01 | built | `org/Orgs.java`, `Invitations.java` |
| FM-10 | MFA (users and platform admins), enterprise SSO/SCIM | F19, security.md; SSO "out of v1" | missing | known-limitations "Security" (TF-048) |
| FM-11 | Projects: create, settings, members, archive, dashboard "Needs you", sample project | F02 | built | `project/*`, `apps/app/app/(app)/[org]/projects` |
| FM-12 | Default-preset pickers at project creation and in project settings | F02 | missing | F02 status |
| FM-13 | Warning when a project's default preset is archived | F02 | missing | F02 status ("not found in the code") |
| FM-14 | Project unit system (metric/imperial) changes output | F02, F15 §7 | missing | stored, no effect (EN-imperial deferred) |
| FM-15 | Models and versions, browser upload to signed URL, parse job with live progress, input-check report with "Show in 3D" | F03 | built | `model/Models.java`, `apps/app/src/features/models` |
| FM-16 | Uploads > 100 MB (multipart) with progress and resume | F03, O1 | missing (likely broken) | ✔ `apps/app/src/features/models/upload.ts:33` PUTs the whole file to `created.upload.url` and never reads `parts` |
| FM-17 | `.ifczip` upload | F03 | diverges | ✔ `upload-button.tsx:60` `accept=".ifc"`; Java accepts `.ifczip` |
| FM-18 | Scope rules per model / BoQ editable | F03, D44 | missing | UI shows "Whole model / N rules" only (`boqs/setup-tab.tsx`) |
| FM-19 | Version list: used by, note, compare two versions' summaries, delete | F03 | missing | F03 status; `DELETE /model-versions/{id}` exists, the app never calls it |
| FM-20 | Coordinate alignment between federated models | v1 scope "out", Q11 | missing | federation warns only (`federation_coordinates`) |
| FM-21 | BoQs, inputs (model versions + presets), runs as jobs, needs-input state, run history, compare runs | F04 | built | `boq/Runs.java`, `RunJob`, `RunIndex` |
| FM-22 | Open an earlier run read-only | F04 §5 (FE-048) | missing | deferred (TF-095) |
| FM-23 | "Generate a BoQ" offered in the model-ready notification | F04 | diverges | offered on the model version page instead (F04 status, not re-verified) |
| FM-24 | Questions: answer, bulk answer, dismiss; decisions page with CSV; promote to the org dictionary; carried across runs and versions | F05 | built | `boq/Decisions.java`, `src/features/questions` |
| FM-25 | Questions filtered by model | F05 | missing | `questions-tab.tsx` filters by kind and answered state only |
| FM-26 | AI name suggestions | dictionary type settings, v1 "out" | missing | `packages/types/src/dictionary.ts` settings, nothing implemented |
| FM-27 | Local-language names at scale (per-language seeds, bSDD, AI) | Q8, known-limitations | missing / spec questionable | "most needs-input results on real files are a name"; no decided approach |
| FM-28 | BoQ sheet: virtualised, grouping by code system, subtotals, filters, line detail, "How it is calculated", every edit kind, manual lines, undo, positions, live co-editing, keyboard editing | F06, P20, P25, P31 | built | `src/features/boq-sheet` |
| FM-29 | Server-side grouping above 20,000 lines | F06 | missing | `src/api/hooks/sheet.ts` loads every line (20k per request) and groups in the browser; Java supports `groupBy`/`level` |
| FM-30 | Three-line clamp for item texts | F06 | missing | rows are one line |
| FM-31 | Global search | FE-034 | missing | deferred (TF-016) |
| FM-32 | 3D viewer: highlight, element→lines, colour modes, section box, storey filter, isolate/hide, box select | F07 | built | `src/features/viewer` |
| FM-33 | Viewer filter bar: IFC class, type, material, "changed since" | F07 | missing | F07 status |
| FM-34 | Viewer at scale: merged-mesh / id-buffer picking > 200k elements; "Show in 3D" from a question > 300 GlobalIds | F07 | missing | F07 status |
| FM-35 | Change report between runs/revisions (lines and elements) with Excel | F08 | built | engine `diff.py`, `src/features/changes`, `boq/Diffs` |
| FM-36 | F08-AC4 timing automated | F08 | missing | F08 status |
| FM-37 | Working version, save version (locked), confirm/reopen, optional review+approval (four-eyes), project and org audit | F09, P29 | built | `boq/Boqs.java`, `src/features/versions` |
| FM-38 | Audit action names as specified (F09 §6); `edits.imported` event | F09 §6 | diverges | names differ (`model_version.created`, `run.completed`…); no `edits.imported` |
| FM-39 | Changes tab for viewers | F09 | diverges | hidden from viewers without `seeAudit`/`editBoqs` (`boqs/[boqId]/page.tsx`) |
| FM-40 | Library: rule sets, classifications, dictionaries, resolution; drafts, versions, publish, preview, where used, code-list import, Excel templates | F10 | built | `src/features/library`, `library/*` |
| FM-41 | Library: manual "rebase on latest", unarchive, rename ids across documents, structured version diff, "keep other columns" on import | F10 | missing | F10 status |
| FM-42 | Item text "Reads as" sample without a preview run | F10 | partial | needs a preview run (F10 status) |
| FM-43 | Pricing module: offer requests and offers | F11, P32–P36 | missing (deferred P48) | contract only |
| FM-44 | Excel exports: run, frozen saved version, change report; edits import | F12 | built | engine `export_xlsx.py`, `sheets/boq_import.py`, `boq/BoqExports` |
| FM-45 | Workbooks verified in Excel / LibreOffice | F12-AC1 | partial | openpyxl only |
| FM-46 | Other export formats: GAEB, ÖNORM A 2063, CSV, IfcCostSchedule; PDF | v1 "out", Q12 | missing | Excel only (known-limitations "Export"); no PDF of any kind |
| FM-47 | Client template / previous-BoQ import | v1 "out", F16 "Later" | missing | known-limitations "Item library" |
| FM-48 | Notifications: in-app bell (SSE) + SMTP email, preferences per category | F13 | built | `realtime/*`, `mail/EmailDelivery.java` |
| FM-49 | Email language follows the UI | F13, Q41 | diverges / spec questionable | emails English and Serbian, UI English only |
| FM-50 | `model_version.ready` email after > 2 min parse | F13 | partial (unverified) | F13 status |
| FM-51 | Plans and entitlements configured by the platform admin; limit checks `402 limit_reached`; usage events and page | F14, P57 | built | `billing/*`, `tests/scenarios/limits.test.ts` |
| FM-52 | Billing provider adapter (interface + provider), checkout, portal, webhooks | F14, BE-D7 | missing (real provider out of review scope; interface + stub in scope) | `BillingController`: checkout `409 checkout_unavailable`, webhook `400 unsupported_provider` |
| FM-53 | Trial driven by plan config (`trialPlanId`/`trialDays`), expiry job drops to Free | plans-and-limits | missing | admins set `trialEndsAt` by hand |
| FM-54 | Downgrade handling (excess projects read-only) | plans-and-limits | missing | F14 status |
| FM-55 | Admin revenue figures | F19 | missing | always empty (`AdminReports.java`) |
| FM-56 | Plan versions / grandfathering | (implied by billing) | missing | P57: a plan change reaches every org at once |
| FM-57 | Usage minutes = wall-clock | plans-and-limits | diverges | engine `durationMs` on the queue transport (TF-009) |
| FM-58 | i18n: every UI string via next-intl, pseudo-locale, org number/date formats, units, currency | F15 | built | `apps/app/messages`, lint rule |
| FM-59 | Languages other than English | F15, P07 | missing | infrastructure only |
| FM-60 | Engine log entries / answer options / some warnings translatable | F15 §4 | partial | `apps/app/src/i18n/engine-message.ts`; no `log.*` keys in the catalogue |
| FM-61 | Imperial output | F15 §7 | missing | deferred (EN-imperial / TF-050) |
| FM-62 | Setup wizard (required first run, suggested answers, preview, publish all) | F16 | built (simplified) | `apps/app/app/(app)/[org]/setup`, `src/features/setup` |
| FM-63 | Wizard as specified: "Suggest codes", names filtered to those worth asking, sample Duplex as the wizard model, "setup in progress by {name}", "Start separately" | F16 | missing | F16 status |
| FM-64 | First setup in < 15 min by a new person (v1-12) | F16-AC1 | partial (unverified) | person check open |
| FM-65 | Vendors (pricing module) | F17 | missing (deferred P48) | contract only |
| FM-66 | Public share links: revoke, expiry, follow latest, noindex, line detail, 3D | F18 | built | `boq/ShareController`, `PublicShares`, `app/(public)/s/[token]` |
| FM-67 | Public share sheet virtualised | F18 | missing | plain grouped table |
| FM-68 | Share rate limit as specified (60/min) | F18 | diverges | 300/min default (`BOQLET_PUBLIC_SHARE_REQUESTS_PER_MINUTE`) |
| FM-69 | Admin console: overview, orgs, users, plans, settings, funnel, health; metadata only; audited reads | F19 | built | `apps/app/app/(admin)/admin`, `admin/*` |
| FM-70 | Admin: vendors section, ops dashboard links, webhook failures and email bounces in health | F19 | missing | F19 status |
| FM-71 | Suspended org: write buttons hidden | F19 | partial | writes return `409 org_suspended`, buttons stay |
| FM-72 | Pricebooks and the firm's estimate | F20 | missing (deferred P48) | contract only |
| FM-73 | Full Content-Security-Policy | security.md | missing | ✔ `apps/app/next.config.ts:41` sends only `frame-ancestors 'none'` |
| FM-74 | Scoped storage identity for workers; shared secret on worker HTTP/rpc | security.md, P54 Q47 | missing (accepted for pilot) | TF-045 |
| FM-75 | Per-org data export; account deletion with "deleted user" audit references | security.md | missing | TF-048 |
| FM-76 | Audit rows for failed permission checks and failed billing webhooks | security.md | missing | TF-048 |
| FM-77 | `Retry-After` on `auth_throttled`; one 429 code | api-conventions | diverges | TF-047 |
| FM-78 | Staging environment | P51, BE-032 | missing | |
| FM-79 | Pilot ops: backups installed with off-host copy, alert destination, error tracking, trace store | operations/pilot.md | missing | known-limitations "Operations" |
| FM-80 | Shared contract/scenario suites runnable against the local stack | testing README, roadmap #1 | missing | need `SuiteSupport` (test sources only) |
| FM-81 | Browser coverage restored after P53: Library editors, viewer, notifications, admin, wizard, axe (TS-003), pseudo-locale (v1-11), UI perf (TS-002/006) | roadmap #1, nfr.md quality gates | missing | known-limitations "Tests" |
| FM-82 | Medium-model parse ≤ 5 min | nfr.md | missing | measured 9 min (NBU MEP 207 MB); this session: S06 Duplex MEP 18 MB parsed in 90–530 s depending on machine load (§8, §10) |
| FM-83 | Accuracy validated against a professional BoQ | known-limitations, Q36 | missing | Duplex hand BoQ + buildingSMART only |
| FM-84 | Pilot success measures instrumented | overview "How we know" | partial | admin funnel only |
| FM-85 | Engine: recess detection from geometry | known-limitations "Deductions" | missing | |
| FM-86 | Engine: steel section table (kg/m beyond metric W shapes) | known-limitations "Steel" | missing | |
| FM-87 | Engine: contradiction thresholds as settings | known-limitations | missing | ✔ `measure.py:63-64` constants |
| FM-88 | Engine: location for infrastructure parts (IfcBridgePart / IfcRoadPart) | known-limitations | missing | |
| FM-89 | Engine: terrain / planting measured by area/volume | known-limitations | missing | IfcGeographicElement counted `nr` |
| FM-90 | Engine: spatial index for the overlap check | known-limitations, roadmap #5 | missing | 1-D sweep along x |
| FM-91 | Engine: per-face embedded intersection | known-limitations "Embedded area" | missing | |
| FM-92 | Engine: building gross volume from envelope | known-limitations "Building values" | missing | slab area × storey height |
| FM-93 | Engine: opening placement on faces; `IfcRelSpaceBoundary` 2nd-level geometry | known-limitations "Faces and rooms" | missing | openings shared in proportion |
| FM-94 | Engine: ArchiCAD quantity names verified | known-limitations | partial | `quantity_sources.json` guesses |
| FM-95 | Engine: more contradiction kinds (areas, IsExternal, materials); `classification_conflict` answers act | known-limitations "Questions" | missing | |
| FM-96 | Engine: cancellation inside long native calls | known-limitations, EN-009 | partial | checked between stages |
| FM-97 | Engine: design options handled; renovation phases from more tools | v1 "out", known-limitations | partial | field measured, unused; Revit phasing / IFC Status only |
| FM-98 | Engine: placeholder material names ("Default") handled without a blocking question | known-limitations | missing | |
| FM-99 | IDS input checks per preset | v1 "out" | missing | |
| FM-100 | Pulling models from CDEs (ACC, Trimble Connect) | v1 "out" | missing | |
| FM-101 | Teams (groups with roles), custom roles | v1 "out" | missing | |
| FM-102 | Admin support inbox and announcements | F19 "Later" | missing | |
| FM-103 | Setup wizard "start from your last BoQ" | F16 "Later", Q23 | missing | |
| FM-104 | Read-only views usable ≥ 768 px; mobile beyond read-only | nfr.md "Browser support"; v1 "out" | partial | to check (UX) |
| FM-105 | Federation (several discipline models, ownership, same-GlobalId merge, overlaps) | F03/F04, O1 | built | `engine/ifc_boq/federation.py`, scenario `federation` |
| FM-106 | Revisions: answers and edits carried across model versions | F05, F06, O5 | built | scenarios `line-edits`, `questions` |
| FM-107 | Formal tendering, construction phase, BCF | — | non-goal | P34, P32, P06 |
| FM-108 | Price database supplied by boqlet | — | non-goal | P33 |
| FM-109 | On-premise packaging | v1 "out" | missing (later) | P09 cloud only |
| FM-110 | WCAG 2.2 AA (shell, forms, sheet, share page) | nfr.md "Accessibility" | partial (unverified) | axe gate not automated since P53; NVDA pass open |

### 6a. Rows added by the reviewers (Phase 1), canonical numbering

Two reviewers proposed new rows independently and both numbered them from FM-111. The canonical ids
below are the ones the verification files and the blueprint use; the reports keep their own numbers.

| ID | Feature | Proposed by (report's own id) | Status | Source finding |
|---|---|---|---|---|
| FM-111 | Engine result invariants (unique question ids and line keys; parts sum to the whole; no element in two item lines without a claim) | 01-engineering (FM-111) | missing | ENG-003, ENG-004, ENG-008 |
| FM-112 | Stale-edit detection on line overrides across model versions | 01-engineering (FM-112) | missing | ENG-019 |
| FM-113 | Safe regex engine and timeouts for user patterns | 01-engineering (FM-113) | missing | ENG-006 |
| FM-114 | Locale-aware number parsing on Excel import | 01-engineering (FM-114) | missing | ENG-018 |
| FM-115 | Unit registry with dimensions (one source for engine and app) | 01-engineering (FM-115) | missing | ENG-010 |
| FM-116 | Dependency and security scanning in CI | 01-engineering (FM-116) | missing | ENG-028 |
| FM-117 | Unit-scale / magnitude sanity check that blocks, geometry recommended | 02-product (FM-111) | missing | PRD-001 |
| FM-118 | Self-serve upgrade request / contact path that reaches the operator | 02-product (FM-112) | missing | PRD-003 |
| FM-119 | In-product help, docs and support contact | 02-product (FM-113) | missing | PRD-018 |
| FM-120 | Client "issue" export profile vs working export | 02-product (FM-114) | missing | PRD-012 |
| FM-121 | System presets cleaned of ACME/Demo fixtures | 02-product (FM-115) | diverges | PRD-009 |
| FM-122 | Simple firm rate library (no vendors) | 02-product (FM-116) | missing | PRD-021 |
| FM-123 | Measurement aids for non-modelled work (lines from other lines, CSV block import, item templates; later PDF) | 02-product (FM-117) | missing | PRD-008 |

## 7. Sample files (`docs/review/_samples/`, re-download: `bash docs/review/tools/fetch-samples.sh`)

All URLs are pinned to a git commit; `fetch-samples.sh` checks the SHA-256 of each and exits non-zero
on any mismatch. Samples are git-ignored; their licences are their sources' (buildingSMART files
CC BY 4.0; youshengCode/IfcSampleFiles and IfcOpenShell/files carry their repositories' terms; the
Schependomlaan archive states none). They are never committed.

| ID | File | Source | Schema | Size | SHA-256 | Contents / why |
|---|---|---|---|---|---|---|
| S01 | wall-with-opening-and-window | buildingSMART/Sample-Test-Files `5030f65`, IFC4 ISO Reference View | IFC4 | 12 KB | `db648954…cf27` | tiny: one wall, one opening, one window (hand-written) |
| S02 | column-straight-rectangle-tessellation | same | IFC4 | 4.6 KB | see script | tiny: one tessellated column (Constructivity) |
| S03 | Simple-Scene Building-Architecture | same, IFC 2x3 TC1 | IFC2X3 | 92 KB | see script | SketchUp 2026 house (architecture) |
| S04 | Simple-Scene Building-Structural | same, IFC 4.3 ADD2 | IFC4X3_ADD2 | 185 KB | see script | SketchUp 2026 house (structure), IFC4.3 |
| S05 | Ifc2x3_Duplex_Architecture | youshengCode/IfcSampleFiles `7e69279` | IFC2X3 | 2.4 MB | `b347a2c8…06ed` | Revit Architecture 2011, NIBS Duplex — **identical to `fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc`** (hand-made BoQ exists) |
| S06 | Ifc2x3_Duplex_MEP | same | IFC2X3 | 17.9 MB | see script | Revit MEP 2011, Duplex MEP (ducts, pipes, terminals) |
| S07 | Ifc4_Revit_ARC | same | IFC4 | 13.6 MB | see script | Revit 2021 (exporter 21.0.0.383) architecture |
| S08 | Ifc4_Revit_STR | same | IFC4 | 11.3 MB | see script | Revit 2021 structure — federates with S07 |
| S09 | Ifc4_SampleHouse | same | IFC4 | 2.3 MB | see script | IFC4 sample house |
| S10 | IFC Schependomlaan incl planningsdata | openBIMstandards/Archive-DataSetSchependomlaan `e6971d8` | IFC2X3 | **65.1 MB** | see script | large real Dutch residential project (federated, 4D planning data); Dutch material names |
| S11 | 1948--wall--wrong-geometry | IfcOpenShell/files `79f40be` | IFC2X3 | 540 KB | see script | ArchiCAD 24 GER; edge case: wall without proper geometry |
| S12 | 478--walls--missing-subtractions--augmented | same | IFC2X3 | 593 KB | see script | edge case: walls with opening subtractions that fail (Solibri-optimised) |
| S13 | truncated Duplex | derived: first 1,000,000 bytes of S05 | IFC2X3 header | 1.0 MB | see script | malformed: cut mid-file |
| S14 | not-an-ifc | derived: two lines of plain text | — | 74 B | see script | malformed: not STEP at all |

## 8. Baseline (`docs/review/baseline/`)

Captured with `docs/review/tools/compare-baseline --capture` on 2026-11-23 from `3868013`. Two layers:

- **`baseline/engine/<run>/`** — the engine in-process (as the CLI and worker call it), presets from
  `presets/` (user presets folder emptied). Per run: `result.json.gz` (the full **BoqResult**, the richest
  machine-readable form: lines with traces and codes, questions = the review queue, warnings, checks,
  log, models, building, stats; volatile values scrubbed, the rule-set document itself dropped),
  `lines.json` (flat, readable), `questions.json`, `boq.xlsx` (the Excel export) and
  `xlsx-cells.json.gz` (its cells, for diffing), `meta.json` (sample SHA-256, presets, outcome, counts,
  parse/run seconds, peak memory, Python and ifcopenshell versions), `traceback.txt` for errors.
- **`baseline/stack/<run>/`** — the full product through the Java API on the local Docker stack:
  a fresh account and org on the enterprise plan, a project per run, upload to S3, parse job, a BoQ with
  the org's defaults (a fresh org's defaults are *As modelled* + the global dictionary and **no
  classification**; `house` patches in other system presets), run job, then `run.json.gz` (run
  metadata), `lines.json.gz` (all pages of `/runs/{id}/lines`), `questions.json.gz`, `warnings.json.gz`,
  `log.json.gz`, `stack-result.json.gz` (the stored BoqResult), `model-summary-*.json.gz` (input-check
  report), `export.xlsx` + `xlsx-cells.json.gz`, `meta.json`; `parse-*.json` when a parse fails.

Configurations (`CONFIGS` in `compare_baseline.py`): `default` = As modelled + global-seed + ACME cost
codes (the CLI default); `house` = acme-house-rules + global-seed + acme-company + ACME cost codes +
demo trades; `standard` = standard-style-example + demo-trades; `tweaked` = demo-tweaked + demo-trades;
`duplexproject` = house rules + the Duplex project dictionary; `noclass` = no classification.
F01 = S07 + S08 federated (architecture + structure); F02 = S05 + S06 (architecture + MEP).

Summary (parse seconds are this machine, 12 cores, with other work running; peak memory is the
child process's peak working set):

| Run | Config | Outcome | Status / error | Lines | Flagged | Elements | Measured | Unmatched | Questions (blocking) | Warnings | Parse s | Run s | Peak MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F01-default | default | result | needs_input | 99 | 3 | 4581 | 4332 | 3 | 70 (62) | 11 | {'S07': 85.6, 'S08': 75.18} | 4.96 | 1563.7 |
| F01-house | house | result | needs_input | 144 | 4 | 4581 | 4364 | 3 | 70 (62) | 13 | {'S07': 113.91, 'S08': 154.77} | 20.88 | 1556.2 |
| F02-default | default | result | complete | 57 | 3 | 1207 | 1076 | 0 | 5 (0) | 0 | {'S05': 10.3, 'S06': 90.21} | 12.25 | 589.0 |
| S01-default | default | result | needs_input | 5 | 3 | 2 | 2 | 0 | 2 (2) | 0 | {'S01': 0.1} | 0.02 | 91.5 |
| S02-default | default | result | complete | 4 | 3 | 1 | 1 | 0 | 0 (0) | 0 | {'S02': 0.04} | 0.01 | 89.8 |
| S03-default | default | result | needs_input | 13 | 3 | 16 | 8 | 0 | 9 (9) | 0 | {'S03': 0.21} | 0.04 | 95.7 |
| S03-house | house | result | needs_input | 16 | 4 | 16 | 9 | 0 | 9 (9) | 0 | {'S03': 0.99} | 0.07 | 95.9 |
| S03-standard | standard | result | needs_input | 14 | 3 | 16 | 8 | 0 | 9 (9) | 0 | {'S03': 0.43} | 0.09 | 96.0 |
| S03-tweaked | tweaked | result | needs_input | 13 | 3 | 16 | 8 | 0 | 9 (9) | 0 | {'S03': 0.34} | 0.11 | 95.8 |
| S04-default | default | result | needs_input | 12 | 3 | 17 | 14 | 0 | 6 (6) | 0 | {'S04': 0.37} | 0.04 | 101.8 |
| S05-default | default | result | complete | 41 | 3 | 239 | 150 | 0 | 4 (0) | 0 | {'S05': 4.41} | 0.16 | 162.8 |
| S05-duplexproject | duplexproject | result | complete | 67 | 4 | 239 | 211 | 0 | 4 (0) | 0 | {'S05': 6.41} | 0.31 | 163.9 |
| S05-house | house | result | complete | 67 | 4 | 239 | 211 | 0 | 4 (0) | 0 | {'S05': 5.8} | 0.21 | 162.9 |
| S05-noclass | noclass | result | complete | 41 | 3 | 239 | 150 | 0 | 4 (0) | 0 | {'S05': 5.77} | 0.33 | 162.9 |
| S05-standard | standard | result | complete | 55 | 3 | 239 | 150 | 0 | 4 (0) | 0 | {'S05': 5.07} | 0.42 | 162.9 |
| S05-tweaked | tweaked | result | complete | 41 | 3 | 239 | 150 | 0 | 4 (0) | 0 | {'S05': 9.7} | 0.36 | 165.5 |
| S06-default | default | result | complete | 19 | 3 | 968 | 926 | 0 | 3 (0) | 0 | {'S06': 528.06} | 0.38 | 555.4 |
| S07-default | default | result | needs_input | 73 | 3 | 454 | 222 | 3 | 67 (61) | 8 | {'S07': 64.9} | 0.23 | 1597.6 |
| S07-house | house | result | needs_input | 115 | 4 | 454 | 254 | 3 | 67 (61) | 8 | {'S07': 94.71} | 0.95 | 1586.9 |
| S07-standard | standard | result | needs_input | 102 | 3 | 454 | 222 | 3 | 67 (61) | 0 | {'S07': 87.19} | 0.6 | 1588.9 |
| S07-tweaked | tweaked | result | needs_input | 73 | 3 | 454 | 222 | 3 | 67 (61) | 0 | {'S07': 74.7} | 0.43 | 1600.6 |
| S08-default | default | result | needs_input | 40 | 3 | 4151 | 4131 | 0 | 7 (4) | 0 | {'S08': 40.36} | 1.14 | 769.6 |
| S09-default | default | result | needs_input | 15 | 4 | 64 | 20 | 0 | 12 (9) | 0 | {'S09': 4.06} | 0.07 | 193.6 |
| S09-house | house | result | needs_input | 26 | 5 | 64 | 34 | 0 | 12 (9) | 0 | {'S09': 5.37} | 0.17 | 193.4 |
| S09-standard | standard | result | needs_input | 17 | 4 | 64 | 20 | 0 | 12 (9) | 0 | {'S09': 4.92} | 0.14 | 193.2 |
| S09-tweaked | tweaked | result | needs_input | 15 | 4 | 64 | 20 | 0 | 12 (9) | 0 | {'S09': 4.78} | 0.11 | 193.3 |
| S10-default | default | result | complete | 15 | 3 | 3505 | 3505 | 0 | 0 (0) | 0 | {'S10': 66.54} | 2.97 | 796.5 |
| S11-default | default | result | needs_input | 7 | 3 | 7 | 4 | 0 | 2 (2) | 0 | {'S11': 1.83} | 0.05 | 108.8 |
| S12-default | default | error | TypeError: expected string or bytes-like object |  |  |  |  |  |  () |  |  |  | 142.8 |
| S13-default | default | error | IndexError: tuple index out of range |  |  |  |  |  |  () |  |  |  | 94.0 |
| S14-default | default | error | Error: Unable to parse IFC SPF header |  |  |  |  |  |  () |  |  |  | 70.4 |

| Run | Config | Outcome | Status / error | Lines | Models | Parse s | Run s |
|---|---|---|---|---|---|---|---|
| F01-default | default | result | needs_input | 99 | [{'discipline': 'architecture'}, {'discipline': 'structure'}] | {'S07': 1.2, 'S08': 0.6} | 38.0 |
| S01-default | default | result | needs_input | 5 | [{'discipline': 'architecture'}] | {'S01': 1.7} | 1.7 |
| S02-default | default | result | complete | 4 | [{'discipline': 'structure'}] | {'S02': 1.6} | 1.6 |
| S03-default | default | result | needs_input | 13 | [{'discipline': 'architecture'}] | {'S03': 1.6} | 1.6 |
| S04-default | default | result | complete | 12 | [{'discipline': 'structure'}] | {'S04': 1.6} | 1.7 |
| S05-default | default | result | complete | 41 | [{'discipline': 'architecture'}] | {'S05': 4.8} | 1.7 |
| S05-house | house | result | complete | 67 | [{'discipline': 'architecture'}] | {'S05': 0.8} | 6.2 |
| S06-default | default | result | complete | 19 | [{'discipline': 'mep'}] | {'S06': 69.3} | 6.5 |
| S07-default | default | result | needs_input | 73 | [{'discipline': 'architecture'}] | {'S07': 76.9} | 5.1 |
| S08-default | default | result | needs_input | 40 | [{'discipline': 'architecture'}] | {'S08': 117.0} | 19.5 |
| S09-default | default | result | needs_input | 15 | [{'discipline': 'architecture'}] | {'S09': 24.1} | 2.1 |
| S10-default | default | result | complete | 15 | [{'discipline': 'architecture'}] | {'S10': 257.8} | 28.7 |
| S11-default | default | result | needs_input | 7 | [{'discipline': 'architecture'}] | {'S11': 6.9} | 2.0 |
| S12-default | default | result | complete | 5 | [{'discipline': 'architecture'}] | {'S12': 53.9} | 4.1 |
| S13-default | default | parse_failed | parse_failed |  |  |  |  |
| S14-default | default | parse_failed | parse_failed |  |  |  |  |

The engine layer took 32 min to capture and the stack layer 19 min (both with other work running).
S12 is an `error` on the engine layer (CLI path) and `complete` on the stack layer (worker path), see §10.



## 9. Tools for later sessions (`docs/review/tools/`)

| Tool | What it does |
|---|---|
| `fetch-samples.sh` | Downloads S01–S12 from pinned URLs, derives S13–S14, verifies every SHA-256 (`--verify` offline, `--force` re-download) |
| `compare-baseline` (+ `compare_baseline.py`) | Re-runs the samples through the engine (in-process, exactly as the CLI/worker) and/or the full stack (Java API on the local Docker stack), normalises volatile values, and diffs against `docs/review/baseline/` line by line: lines keyed by line key, questions by id, every number within tolerance (`--rel-tol`, `--abs-tol`, default 1e-6), exports cell by cell. `--layer engine|stack|all`, `--only <run ids>`, `--capture` to rewrite the baseline. Exit 0 = no differences, 1 = differences (listed, and written to `_scratch/compare/<stamp>/differences.txt`), 3 = a layer could not run |
| `verify-quantities` (+ `verify_quantities.py`) | Written by the QS reviewer (Phase 1): independent recomputation of 30 element/line quantities on S01–S05, S08, S09 (own mesh arithmetic on IfcOpenShell tessellation + hand arithmetic from raw STEP values, never the engine or Qto sets) compared with the app's lines. `--baseline` reads the baseline instead of running the engine; `--strict` also fails when a KNOWN difference disappears (FIXED). Today: 22 OK, 8 KNOWN (documented defects QS-001/003/004/005/012), exit 0 |

| `check-blueprint.py` | Mechanical coverage check of `BLUEPRINT.md` / `PROGRESS.md` (every finding and FM row covered, every item in exactly one package, package prerequisites acyclic). Run after editing the blueprint |
| `../repro/` | Repro scripts the blueprint cites as acceptance checks or test templates (copied from the git-ignored `_scratch/`; see `docs/review/repro/README.md`), incl. `make-account.mjs` for local accounts |

**Stack-layer caveat:** the stack layer runs whatever images `npm run local:up` built last. After a change to
`engine/` or `services/api/`, run `npm run local:up` (it rebuilds) before `compare-baseline --layer stack`,
or the comparison tests the old code. Each compare run makes a fresh org, so the per-org parse dedup (BR-08)
never hides a parse change.

**Final check of the tools (2026-11-23, unchanged code, end of the review):** `fetch-samples.sh --verify`
✓ 14/14; `compare-baseline` (both layers, no cache) **0 differences** in 47 runs (engine 31, stack 16;
19 min); `verify-quantities` (current engine) 22 OK, 8 KNOWN, exit 0.

## 10. Observations made while setting up (facts, not yet findings)

These were seen in Phase 0; the reviewers decide what they mean.

- S12 (IfcOpenShell edge file) **crashes the engine** in `measure.py:121` (`find_reported`:
  `TypeError: expected string or bytes-like object`, `matches(set_name)` with a null property-set name),
  full traceback `docs/review/baseline/engine/S12-default/traceback.txt`.
- S13 (truncated) fails in `parse.py:474` with `IndexError: tuple index out of range`
  (`f.by_type("IfcProject")[0]`); S14 (not STEP) fails with ifcopenshell's `Unable to parse IFC SPF header`.
- S01: the 300 mm wall of the ISO sample is reported as 5.000 m² by "As modelled" (verify).
- S06 (18 MB Revit MEP) takes ~530 s through the engine on this machine; S10 (65 MB) ~87 s.
- `presets/user/dictionaries/` holds two git-ignored `mock-*.json` files from the old dev build; the
  engine loads user presets from there unless `IFC_BOQ_USER_PRESETS` points elsewhere (the baseline
  tool points it at an empty folder).
- The Free plan caps a model version at 50 MB: S10 (65 MB) cannot be uploaded on Free.
- Migration numbering skips V5 in SQL (`V5` is a Java migration under `src/main/java/db/migration`).
- **Parse times vary a lot with machine load:** S06 took ~528 s in the first engine capture (while
  typecheck, lint, unit tests and the Docker build ran in parallel) but ~90 s in the F02 run of the same
  capture and ~93 s through the Docker engine (Linux, Python 3.12.16, ifcopenshell 0.9.0.post1,
  `nproc` = 1). Treat baseline timings as indicative only; compare-baseline never compares them.
  (An earlier version of this note blamed the platform; the F02 timing disproves that.)
- In the stack layer, F01's two uploads parse in ~1 s: the same files were already uploaded in the
  org, and a version is deduplicated by SHA-256 (BR-08).
- A fresh org's default BoQ inputs (stack layer) have **no classification** (rule set + global
  dictionary only), while the CLI default adds ACME cost codes; S04 is `complete` through the stack
  and `needs_input` through the CLI default.
- **CLI path vs worker path differ on S12:** the CLI/in-process path crashes (`measure.py:121`), but
  when the same ParsedModel goes through a JSON round trip (as the worker's `parsed.json` does) the run
  succeeds (`needs_input`, 5 lines). Reproduce: `docs/review/tools/compare-baseline --layer engine
  --only S12-default --parse-cache` twice (the second run uses the cached, JSON-round-tripped parse).
