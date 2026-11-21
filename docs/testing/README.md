# Testing

How boqlet is tested: the layers, how to run each one against the real local backend, what CI runs,
the definition of done, and which product outcomes the tests cover. Checked against the code on
2026-11-21. The full test campaign (exploratory, every flow and role) is [test-plan.md](test-plan.md);
its log is [test-findings.md](test-findings.md); the engine's accuracy evidence is
[engine-validation.md](engine-validation.md).

There is **one backend, Java** (P53). Every API-level and browser test runs against a real Java API,
PostgreSQL, S3 storage (SeaweedFS), MailHog and the real Python engine worker, in one of two ways:

| Backend | Started by | Used for | Test-only routes (`SuiteSupport`)? |
|---|---|---|---|
| **Local Docker stack** (`ops/local`) | `npm run local:up` (or `npm run dev:app`) | `npm run local:check`; manual and exploratory testing; the test campaign | **No**: the product image |
| **Test harness** (`NativeWorkerTest`, Testcontainers) | `mvn -f services/api/pom.xml verify` with the variables below | Java integration tests, the shared contract and scenario suites, the browser smoke, the API performance suite | **Yes**: test clock, test users and sessions, setup links, mail settle |

The pilot (booqlet.com) is development too (P51): functional checks with synthetic accounts are allowed
there (`ops/pilot/verify-live.sh`), load and destructive tests are not.

## Layers

| Layer | Where | Runner | Size | Backend |
|---|---|---|---|---|
| Engine unit + acceptance | `engine/tests` | pytest | 18 files, 211 tests collected | none (engine only) |
| App unit | `apps/app/src/**/*.test.ts(x)`, `apps/app/scripts/*.test.mjs` | Vitest (node) | 32 files, ~190 tests | none |
| Static | the workspaces, both contracts, the schemas | tsc, ESLint (incl. no literal UI strings), Redocly, codegen drift | — | none |
| Java integration | `services/api/src/test/java` | JUnit 5 + Testcontainers + ArchUnit | `ApiFoundationTest` (8), `NativeAuthTest` (2), `NativeWorkerTest` (5), `BackupRestoreTest` (1), `AlertMonitorTest` (4), `CoreArchitectureTest` (ArchUnit) | test harness |
| Contract suite | `tests/contract` | Vitest over the generated client | 6 files; `auth.test.ts` checks all 162 operations for `401` / public | test harness |
| Scenario suite | `tests/scenarios` | Vitest over the generated client | 24 files, ~173 tests + 2 todo; named after rule ids and acceptance criteria (`BR-27 …`, `F10-AC7 …`) | test harness |
| Browser smoke | `apps/app/e2e-java` | Playwright (Chromium) | 5 specs, 13 tests | test harness (a second Java with native sign-in) |
| Performance | `tests/perf` | Vitest (API latency) + `engine_timing.py` | 2 tests + a timing script | test harness / engine |
| Local stack check | `scripts/local.mjs check` | Node | 1 end-to-end run | local Docker stack |
| Bundle budgets | `apps/app/bundle-budgets.json` | `npm run bundle:check -w @ifc-boq/app` | per route | none |

What each file covers is in its name and its test titles; the outcome map below says what matters.

## How to run each layer

All commands run from the repository root. Windows (PowerShell) and Linux both work.

**Fast checks (no backend):**

```bash
npm run test              # typecheck + lint + app unit tests + engine tests
npm run test:engine       # engine only (includes the Duplex acceptance test)
npm run api:lint && npm run api:check && npm run codegen   # contracts and schemas (then: git diff --exit-code packages/types/schema)
npm run build:app && npm run bundle:check -w @ifc-boq/app
```

**The local Docker stack, end to end:**

```bash
npm run local:up          # first time: several minutes (images build)
npm run local:check       # sign-up → org → project → Duplex upload → parse → BoQ run (41 lines)
```

**Java, the shared suites and the browser smoke (the test harness).** Needs Docker, JDK 21, Maven 3.9
(the repo has no `mvnw`), `npm install` done (the engine is installed in `engine/.venv`) and Chromium for
Playwright (`npx playwright install chromium` in `apps/app`). This is what CI's `api` job runs:

```bash
# bash
export BOQLET_NATIVE_WORKER_PYTHON="$PWD/engine/.venv/bin/python"   # enables NativeWorkerTest
export BOQLET_NATIVE_NODE="$(command -v node)"                     # runs the contract suite (and enables the next two)
export BOQLET_NATIVE_SCENARIOS=1                                   # the scenario suite (≈ 25 min budget)
export BOQLET_BROWSER_SMOKE=1                                      # the 13 browser tests
export IFC_BOQ_PYTHON="$BOQLET_NATIVE_WORKER_PYTHON"               # the duplex scenario reads HAND_BOQ with it
export AWS_ACCESS_KEY_ID=boqlet-test AWS_SECRET_ACCESS_KEY=boqlet-local-test-only
mvn -B -ntp -f services/api/pom.xml verify
```

```powershell
# PowerShell
$env:BOQLET_NATIVE_WORKER_PYTHON = "$PWD\engine\.venv\Scripts\python.exe"
$env:BOQLET_NATIVE_NODE = (Get-Command node).Source
$env:BOQLET_NATIVE_SCENARIOS = "1"; $env:BOQLET_BROWSER_SMOKE = "1"
$env:IFC_BOQ_PYTHON = $env:BOQLET_NATIVE_WORKER_PYTHON
$env:AWS_ACCESS_KEY_ID = "boqlet-test"; $env:AWS_SECRET_ACCESS_KEY = "boqlet-local-test-only"
mvn -B -ntp -f services/api/pom.xml verify
```

| Variable | Effect |
|---|---|
| `BOQLET_NATIVE_WORKER_PYTHON` | A Python with the engine installed. Without it `NativeWorkerTest` is skipped entirely |
| `BOQLET_NATIVE_NODE` | Node: the contract suite runs after the Duplex system test; needed by the scenarios and the smoke |
| `BOQLET_NATIVE_SCENARIOS=1` | `sharedScenariosPassAgainstJava` (`BOQLET_SCENARIO_FILTER=library,versions` runs some files) |
| `BOQLET_BROWSER_SMOKE=1` | `browserSmokeAgainstJava`: a second Java with `BOQLET_NATIVE_AUTH=true`, the app on 3100 (`NEXT_DIST_DIR=.next-java`), `npm run e2e:java`; `BOQLET_BROWSER_SMOKE_FILTER` narrows it |
| `BOQLET_NATIVE_QUEUE_TEST=1` | Jobs go through the Postgres queue with queue workers (as on the pilot) instead of HTTP dispatch. CI sets it |
| `BOQLET_API_PERF=1` | `apiPerformanceAgainstJava`: `tests/perf/api.test.ts` plus 50k-line ingestion; results appended to `PERF_OUT=<file>`. Not in CI |

Inside the harness the suites get `API_URL`, `SUITE_TARGET=java`, `BOQLET_JAVA_SUITE_USERS` (six users
with open sessions, written straight into the DB) and `BOQLET_SUITE_MAILHOG`. The scenarios sign in
through the harness's test JWT decoder, not native sign-in; native sign-in is covered by
`NativeAuthTest` and the browser smoke.

**Why not against the local Docker stack?** The suites need `SuiteSupport` (`/_test/users`,
`/_test/clock`, `/_test/mail/settle`, `/_test/setup-link`, `/_test/auth-limits/reset`), the test JWT
decoder, the `suite_clock` schema on the DB search path and DB-seeded sessions; `contract/auth.test.ts`
also expects native sign-in to be off. None of that is in the product image. Run outside the harness,
`npm run test:contract` and `npm run test:scenarios` stop at once with a message saying so
(`tests/run.mjs` checks for `BOQLET_JAVA_SUITE_USERS`). Making them run locally (a test image of the API with `SuiteSupport`) is a
todo ([../product/roadmap.md](../product/roadmap.md)). The browser smoke is the cheapest to port: it
uses only the setup-link and auth-limit routes, which `scripts/local.mjs` already replaces with SQL.

**Engine timing:** `engine/.venv/Scripts/python tests/perf/engine_timing.py <file.ifc>` (Linux:
`engine/.venv/bin/python`); `--federated A.ifc B.ifc` parses in parallel and runs one BoQ; `--repeat N`;
`PERF_OUT=<file>` appends JSON lines. The medium files are downloads ([../12-ifc-corpus-catalogue.md](ifc-corpus-catalogue.md)).
Results go into [../architecture/nfr.md](../architecture/nfr.md). Never load-test the pilot (P51).

## CI

`.github/workflows/ci.yml`, on pushes and pull requests to `main` (and the frozen `v_1`), on Ubuntu:

| Job | Runs | Deploy gate |
|---|---|---|
| `api` | `mvn verify` with `BOQLET_NATIVE_WORKER_PYTHON`, `BOQLET_NATIVE_NODE`, `BOQLET_NATIVE_QUEUE_TEST=1`, `BOQLET_NATIVE_SCENARIOS=1`, `BOQLET_BROWSER_SMOKE=1`: every Java test, the contract and scenario suites, SSE across two API instances, the browser smoke | yes |
| `contract` | `api:lint`, `api:check`, `codegen` + `git diff --exit-code packages/types/schema` | yes |
| `typecheck` | `typecheck`, `lint`, `test:app`, `build:app`, `bundle:check` | yes |
| `engine` | `test:engine` | yes |
| `local` | `local:up` + `local:check` (the Docker stack) | no |
| `deploy` | On a push to `main` after the four gates: images to the pilot ([../operations/auth-and-deploys.md](../operations/auth-and-deploys.md)) | — |

Not in CI: the performance suite, engine timing, the corpus run, other browsers, accessibility, a
nightly job, Python or Java linters. There is no separate "core only" build job; the pricing
boundary is guarded by the ArchUnit `CoreArchitectureTest`, the BR-41 lint rule, the
`MODULE_PRICING` build guard and `api:lint` of `openapi-pricing.yaml` ([../architecture/modules.md](../architecture/modules.md)).

## Fixtures

| Fixture | Source | Used by |
|---|---|---|
| Duplex v1 / v2 | `fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc`, `…_v2.ifc` | almost everything; v2 for revisions and diffs |
| Hand BoQ | `engine/tests/test_duplex.py` `HAND_BOQ` (read at run time through Python by `tests/scenarios/duplex.test.ts`) | v1 criterion 1 |
| buildingSMART samples | `fixtures/ifc/buildingsmart` (CC BY 4.0) | parse edge cases, schemas, units |
| Federated pairs | NBU architecture + structure (downloads, not in git; [../12-ifc-corpus-catalogue.md](ifc-corpus-catalogue.md)) | federation, performance |
| Workbooks to import | made by `tests/support/edit_boq_xlsx.py` from exported BoQs | edits import (F12-AC4) |

## Definition of done (every change)

- The change's acceptance criteria hold, with an automated test where the spec marks them (A).
- `npm run test` green; the affected suites green (the harness for Java or contract changes); CI green after the push.
- A fix comes with a test that failed before it, at the lowest layer that shows it.
- No new hard-coded UI strings (the lint rule); i18n keys added.
- Audit events written for new write actions (BR-51).
- Docs updated where the change touches them ([../development/workflow.md](../development/workflow.md)):
  changelog row, known limitations, the feature's status block.

## Coverage by outcome

The product outcomes are defined in [../product/overview.md](../product/overview.md#what-users-must-be-able-to-achieve).
"API" = contract or scenario suites and Java integration tests (all on the test harness); "Browser" =
`apps/app/e2e-java`; "Engine" = pytest; "Unit" = the app's Vitest.

| Outcome | Covered by | Not covered |
|---|---|---|
| **O1** IFC models → BoQ (incl. federation) | Engine: `test_duplex` (exact `HAND_BOQ`), `test_federation*`, `test_certification_samples`, `test_worker`. API: scenarios `duplex` (v1-1), `federation` (v1-2), `models` (upload, `not_ifc`, dedupe, retry, size limit), `boqs`; `NativeWorkerTest` Duplex system test; queue transport. Browser: `main-flow` (upload → parse → BoQ). Local: `local:check` | Uploads over 100 MB (multipart) at any level; `corrupt_file`; `awaiting_upload` 24 h expiry and parse retry (`it.todo`); `.ifczip`; medium-model performance outside the manual suite |
| **O2** Measure the firm's way (Library, wizard) | API: scenarios `library`, `library-publish` (publish, clone, preview), `codelists`, `templates`, `setup` (1 test). Unit: `features/library` (82 tests), `features/setup`. Engine: `test_presets`, `test_preset_templates`, `test_item_texts`, `test_codelist_import`. Browser: the wizard's suggested-answers path inside `accounts` (F01-AC1) | Library editors and preview in a browser (F10-AC1, v1-7 also needs a person); F10-AC5 ("Opis" column → item texts); `libraryOrgPresets` limit; wizard F16-AC2–AC4, AC8, AC9; v1-12 person check |
| **O3** Trust every number (trace, viewer) | API: scenario `sheet` (line detail, "how it is calculated"); `NativeWorkerTest` (scene, geometry). Engine: `test_duplex` explanations, `test_faces_rooms`, `test_scope_recess_building`. Unit: `viewer/links`, `boq-sheet` | Viewer in a browser (F07-AC1–AC7), the WebGL fallback; v1-4 person check |
| **O4** Nothing silently dropped (questions, decisions) | API: scenario `questions` (bulk answer, dismiss, complete, CSV), `changes`/`versions` (answers carried over). Engine: `test_names`, `test_federation_links` (contradiction, double claim), `test_overrides` (orphan). Unit: `features/questions` | `POST /decisions/{id}/promote` (F05-AC5); F05-AC4 warning on approved revisions; questions UI in a browser; pseudo-locale rendering of engine messages (F15-AC3, unit only) |
| **O5** Keep up with design changes | API: scenarios `changes` (compare, change-report export), `versions`, `line-edits` (edits survive a new model version); `NativeWorkerTest` revised IFC. Engine: `test_diff` (Duplex revision, 40k lines < 5 s) | Change report and changes colour mode in a browser (F07-AC6); F08-AC4 timings; "new version available" notification |
| **O6** Edit, version, confirm | API: scenarios `line-edits`, `versions` (labels, `409 revision_locked`, `409 boq_confirmed`, review, approval, four-eyes), `co-editing` (presence, edits reach everyone), `state-machines`, `audit`; two-instance SSE. Browser: `live` (two-browser co-editing). Unit: `boq-sheet` (edits, positions) | Sheet editing in a browser (F06-AC1–AC9: undo, moves, manual lines, positions); BR-29 "the earlier editor is told"; `invalid_transition` responses; `PATCH /manual-items/{id}`; 20k-line performance (F06-AC11) |
| **O7** Hand it over (Excel, shares) | API: scenarios `sheet` (exports), `edits-import` (F12-AC4), `changes`, `shares` (create, public page and subresources, revoke, `publicLinksAllowed`, expiry, follow latest). Engine: workbook tests (openpyxl). Browser: `main-flow` (Excel download, share link opened anonymously) | Opening workbooks in Excel or LibreOffice (F12-AC1); share page headers (`noindex`, `Referrer-Policy`, rate limit); the `shareLinks` plan gate |
| **O8** Run the firm's account | API: scenarios `orgs` (invitations, seats, last owner, roles, two orgs), `projects`, `isolation` (BR-50, BR-52), `billing` (entitlements, `402`, `checkout_unavailable`, notifications), `state-machines` (takeover, 12 h expiry); `ApiFoundationTest`, `NativeAuthTest`. Contract: `auth` (401 on every secured op), `validation`, `me`, `billing`, `events`. Browser: `accounts`, `orgs` (F01-AC2–AC4, AC6), `sessions` (F01-AC5) | A role-matrix sweep over every permission row; the org `admin` role as an actor beyond settings; rate limits; signed-URL lifetimes; security headers; `processingMinutesPerMonth`; trial end and downgrade (not built); the billing webhook; notification emails being suppressed per category; F13-AC1 toast; F15-AC2 locale formats; accessibility (axe suite deleted with the mock) and the pseudo-locale browser check (v1-11) |
| **O9** Operate the platform | API: scenario `admin` (orgs table, plan change, trial, suspend, end session, overview, funnel, health), contract `admin` (404 for non-admins); `ApiFoundationTest` (metadata only) | Admin console in a browser |
| O10 Pricing module | Boundary only: `CoreArchitectureTest`, the BR-41 lint rule, the `MODULE_PRICING` guard, `api:lint` | Everything else: not built (P48) |

v1 acceptance criteria and their current evidence: [../product/scope-and-acceptance.md](../product/scope-and-acceptance.md#v1-acceptance-results-2026-11-21).
The complete list of known test gaps: [../product/known-limitations.md](../product/known-limitations.md#tests).

## History

TS-001 (shared suites), TS-002 (performance), TS-003 (accessibility, its axe suite deleted with the
mock) and TS-004 (v1 acceptance) were the build's test tasks ([../archive/plan/](../archive/plan/README.md)).
Until P53 the suites also ran against the mock API, and 106 Playwright tests ran only there.
