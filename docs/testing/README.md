# Testing

How boqlet is tested: the layers, how to run each one against the real local backend, what CI runs,
the definition of done, and which product outcomes the tests cover. Checked against the code on
2026-11-22 (`83f73c8`, after the test campaign's Stage 6). The full test campaign (exploratory, every flow and role) is [test-plan.md](test-plan.md);
its log is [test-findings.md](test-findings.md); the engine's accuracy evidence is
[engine-validation.md](engine-validation.md).

There is **one backend, Java** (P53). Every API-level and browser test runs against a real Java API,
PostgreSQL, S3 storage (SeaweedFS), MailHog and the real Python engine worker, in one of two ways:

| Backend | Started by | Used for | Test-only routes (`SuiteSupport`)? |
|---|---|---|---|
| **Local Docker stack** (`ops/local`) | `npm run local:up` (or `npm run dev:app`) | `npm run local:check`; `npm run local:suites` (the contract and scenario suites, below); manual and exploratory testing; the test campaign | **No**: the product image (the suites replace the routes with SQL and native sign-in) |
| **Test harness** (`NativeWorkerTest`, Testcontainers) | `mvn -f services/api/pom.xml verify` with the variables below | Java integration tests, the shared contract and scenario suites, the browser smoke, the API performance suite | **Yes**: test clock, test users and sessions, setup links, mail settle |

The pilot (booqlet.com) is development too (P51): functional checks with synthetic accounts are allowed
there (`ops/pilot/verify-live.sh`), load and destructive tests are not.

## Layers

| Layer | Where | Runner | Size | Backend |
|---|---|---|---|---|
| Engine unit + acceptance | `engine/tests` | pytest | 23 files, 265 tests collected | none (engine only) |
| App unit | `apps/app/src/**/*.test.ts(x)`, `apps/app/scripts/*.test.mjs` | Vitest (node; jsdom for component tests) | 73 files, 405 tests | none |
| Static | the workspaces, both contracts, the schemas | tsc, ESLint (incl. no literal UI strings), Redocly, codegen drift | — | none |
| Java integration | `services/api/src/test/java` | JUnit 5 + Testcontainers + ArchUnit | 12 classes, 55 `@Test`s: `ApiFoundationTest`, `NativeAuthTest` (P57: public sign-up, its bot protection and throttling, the owned-org cap, self-service reset), `AccountSecurityTest` (rate limits, account audit, locale, names, preferences, headers, seats), `ErrorResponsesTest`, `NativeWorkerTest`, `BackupRestoreTest`, `AlertMonitorTest`, `http/RequestSizeFilterTest`, `http/HealthTimeoutTest`, `model/ParseJobErrorsTest`, `worker/JobDispatcherTest`, `CoreArchitectureTest` (ArchUnit); several `@Test`s run only with their `BOQLET_NATIVE_*` switch, so surefire's count depends on the environment | test harness |
| Contract suite | `tests/contract` | Vitest over the generated client | 7 files, 198 tests; `auth.test.ts` checks all 172 operations for `401` / public | test harness or local stack |
| Scenario suite | `tests/scenarios` | Vitest over the generated client | 30 files, 1,893 tests (1,889 and 2 `it.todo`, 2 skipped, after P57; most of them the role matrix of `permissions.test.ts`); named after rule ids, acceptance criteria and findings (`BR-27 …`, `F10-AC7 …`, `TF-094 …`); a cell that waits for an open finding is `it.fails` and names it (none left after Stage 6) | test harness or local stack |
| Browser smoke | `apps/app/e2e-java` | Playwright (Chromium) | 17 specs (`a11y-layout`, `accounts`, `areas`, `b7`, `batch6`, `formats`, `live`, `main-flow`, `orgs`, `perf`, `resilience`, `sessions`, `sheet-power`, `sign-up`, `states`, `sweep`, `workspace`); `workspace` (`@c1-…`, review WP-C1) checks the BoQ workspace's layout and keyboard at 1440×900; `sheet-power` (`@c2-…`, review WP-C2) the sheet's sorting, density, wrapping and column widths; `areas` (`@b2b-…`, review B-06b) covers notifications, the viewer with WebGL, the Library editors, the admin console and the wizard off its suggested path; the campaign's specs tag their tests (`@b6-…`, `@b7-…`) for `BOQLET_BROWSER_SMOKE_FILTER`; `sweep` (`@sweep`, review B-06) is the axe gate over 38 screens with its known list `axe-known.json` and the `en-XA` pseudo-locale check; `perf` (`@perf`) runs only nightly | test harness (a second Java with native sign-in) |
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
export BOQLET_BROWSER_SMOKE=1                                      # the browser smoke
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
| `BOQLET_NATIVE_RESILIENCE=1` | `jobsSurviveTheWorkerAndTheDatabaseGoingAway`: the worker killed mid-parse for 25 s, then the database restarted mid-parse; each job ends with at most 2 attempts (TF-186). About 1.5 min. CI sets it |
| `BOQLET_TEST_TIME_FACTOR` | A number from 1 to 10 (default 1; CI sets 2): every timeout of the shared suites (`tests/vitest.config.ts`), the browser suite (`playwright.java.config.ts`) and `NativeWorkerTest`'s waits is multiplied by it, and the browser suite's overall limit is 5 min + 2 min per spec file, times it (review B-08) |
| `BOQLET_BROWSER_PERF=1` | The browser suite runs its `@perf` tests (left out otherwise) on `next build` + `next start` (`.next-java-perf`) instead of `next dev`; with `BOQLET_BROWSER_SMOKE_FILTER=@perf` only them (the nightly job; budgets in [../architecture/nfr.md](../architecture/nfr.md)) |
| `BOQLET_API_PERF=1` | `apiPerformanceAgainstJava`: `tests/perf/api.test.ts` plus 50k-line ingestion; results appended to `PERF_OUT=<file>`. Nightly (`nightly.yml`), not a deploy gate |

**Load tolerance** (review B-08, DEC-07). A shared-suite or browser test that fails **only by its timeout** is
tried once more; any other failure fails at once (Vitest's `retry.condition` on its timeout message; in the
browser suite `e2e-java/fixtures.ts`, whose `test` every spec imports, fails the retry of an attempt that did not
end `timedOut`). A test that passes on its retry is listed as flaky: `[flaky] …` lines at the end of the log and,
in CI, a "Flaky … tests" section of the job summary (`tests/support/flaky-reporter.ts`,
`e2e-java/flaky-reporter.ts`). A flaky test is a finding to look at, not a pass to forget.

Inside the harness the suites get `API_URL`, `SUITE_TARGET=java`, `BOQLET_JAVA_SUITE_USERS` (six users
with open sessions, written straight into the DB) and `BOQLET_SUITE_MAILHOG`. The scenarios sign in
through the harness's test JWT decoder, not native sign-in; native sign-in is covered by
`NativeAuthTest` and the browser smoke.

**The shared suites against the local Docker stack** (review B-05). With the stack up, `npm run local:suites`
runs the contract and scenario suites against it, as the harness runs them against its own Java:

```bash
npm run local:up
npm run local:suites                                  # contract, then scenarios (≈ 15 min)
npm run local:suites -- --filter permissions          # some files (the names BOQLET_SCENARIO_FILTER takes)
npm run local:suites -- --suite contract              # one suite (contract, scenarios or perf)
```

It sets `BOQLET_TARGET=local` (and `API_URL`, `BOQLET_LOCAL_ORIGIN`, `BOQLET_SUITE_MAILHOG`); `node tests/run.mjs
<suite>` with those variables does the same. The stack runs the product image, so the suites do there what
the harness does through `SuiteSupport` with the stack's own means (`tests/support/local-stack.mjs`,
`local-provision.mjs`): every person (the six seeded people and everyone a scenario signs up) sets this run's
password from a setup link written into the database, as `npm run local:user` issues one, and signs in natively;
requests carry the session cookie and the app's Origin instead of a test bearer token, and a scenario's
`POST /sessions` from a new browser is the app's `POST /auth/sign-in` with its device label and takeover. Mail
settles by the same outbox query; sign-in limits are reset when a run reaches them. Each run makes its own people
(`olivia-<run>@example.com`) and orgs (`studio-demo-<run>`), so runs never share state; nothing is deleted
(`npm run local:reset` clears the stack). Differences from the harness, all by design:

- the stack has no test clock: the four scenarios that move time (`state-machines` clock and session expiry,
  `orgs` invitation expiry, `model-lifecycle` upload expiry) are skipped (`hasTestClock`, `support/clock.ts`);
- `contract/auth.test.ts` checks native sign-in as it is on (a wrong password is `401`, another origin `403
  invalid_origin`) instead of the harness's `404 native_auth_disabled`.

The browser smoke still runs only in the harness (it starts its own Java with native sign-in and the app).

**Engine timing:** `engine/.venv/Scripts/python tests/perf/engine_timing.py <file.ifc>` (Linux:
`engine/.venv/bin/python`); `--federated A.ifc B.ifc` parses in parallel and runs one BoQ; `--repeat N`;
it prints one JSON line per measurement (redirect them to keep them). The medium files are downloads ([the corpus catalogue](ifc-corpus-catalogue.md)).
Results go into [../architecture/nfr.md](../architecture/nfr.md). Never load-test the pilot (P51).

## CI

`.github/workflows/ci.yml`, on pushes and pull requests to `main` (and the frozen `v_1`), on Ubuntu:

| Job | Runs | Deploy gate |
|---|---|---|
| `api` | `mvn verify` with `BOQLET_NATIVE_WORKER_PYTHON`, `BOQLET_NATIVE_NODE`, `BOQLET_NATIVE_QUEUE_TEST=1`, `BOQLET_NATIVE_RESILIENCE=1`, `BOQLET_NATIVE_SCENARIOS=1`, `BOQLET_BROWSER_SMOKE=1`: every Java test, the contract and scenario suites, SSE across two API instances, a worker and a database going away mid-job, the browser smoke | yes |
| `rollback` | builds this revision's API image and the previous release's (`git describe --tags --match 'v*' HEAD^`), migrates a fresh database with the first and starts the second on it (`scripts/ci-rollback-check.sh`) | yes |
| `contract` | `api:lint`, `api:check`, `codegen` + `git diff --exit-code packages/types/schema` | yes |
| `typecheck` | `typecheck`, `lint`, `test:app`, `build:app`, `bundle:check` | yes |
| `engine` | on Python 3.10, 3.12 (the engine image's) and 3.13, in parallel (review B-09): `test:engine` (result invariants strict, review B-01); then the review's independent checks on six small public samples (S01–S05, S09, fetched SHA-checked by `docs/review/tools/fetch-samples.sh --only=…` and cached): `verify-quantities --strict` (`engine/tests/independent/verify_quantities.py`) and `compare-baseline --layer engine --only S01-default … S09-default` against `docs/review/baseline/` (review B-04) | yes |
| `workbooks` | LibreOffice Calc (headless, `libreoffice-calc-nogui`) and `pytest -m libreoffice` with `BOQLET_REQUIRE_LIBREOFFICE=1` (`engine/tests/test_export_libreoffice.py`, review B-11): a Duplex working BoQ, a saved version and the v1 → v2 change report printed to PDF and saved again with every formula recalculated; each line's amount, every subtotal and the total equal the engine's quantities times typed rates, protection and the edits import survive | yes |
| `audit` | `npm audit --omit=dev` and `pip-audit` on the engine's runtime requirements (`engine/requirements.txt` above its `# dev` line, resolved as pip would today): a known vulnerability in what ships fails the job (review B-09) | yes |
| `local` | `local:up` + `local:check` (the Docker stack) | yes (since review B-09) |
| `deploy` | On a push to `main` after every job above: images to the pilot ([../operations/auth-and-deploys.md](../operations/auth-and-deploys.md)) | — |

Every action is pinned by its commit SHA (the release in a comment). Dependabot (`.github/dependabot.yml`) opens
weekly PRs for npm, pip (`engine/`), Maven (`services/api/`) and the actions, minor and patch grouped per
ecosystem; they run CI like any PR, and merging one deploys, so the owner reviews each. CodeQL
(`.github/workflows/codeql.yml`: TypeScript, Java without a build, Python, the workflows) runs on pushes and PRs to
`main` and weekly; its findings go to the Security tab and the PR, and it is not a deploy gate.

| `nightly` (`.github/workflows/nightly.yml`, 02:17 UTC and on demand) | **API**: `NativeWorkerTest#apiPerformanceAgainstJava` (`BOQLET_API_PERF=1`, review B-09): `tests/perf/api.test.ts` (CRUD p95 ≤ 300 ms, a 500-line page p95 ≤ 500 ms, ten in flight) and 50,000-line run ingestion ≤ 10 s; the `PERF_OUT` lines go to the job summary. **UI**: the browser suite's `@perf` tests (`e2e-java/perf.spec.ts`, review B-07) against Java on a production build of the app (`BOQLET_BROWSER_PERF=1`, `BOQLET_BROWSER_SMOKE_FILTER=@perf`): the uncached change report (F08-AC4, ≤ 3 s), the first row of a 4,000-line sheet (≤ 4 s) and the longest task while typing in its search (≤ 250 ms), each the median of 3 (regression gates; B-18/B-19 tighten them to 2 s and 100 ms); the `[perf]` lines go to the job summary. The 4,000 lines are the Duplex run's lines repeated by the harness's `/_test/runs/{id}/inflate` | no |

Not in CI: engine timing, the corpus run, the review samples beyond S01–S05 and
S09 (the full compare-baseline takes about 50 minutes), other browsers.
Static analysis since review B-10: `ruff` and strict `mypy` in `test:engine` (every `engine` leg; the mypy
baseline in `engine/pyproject.toml` lists the error codes each module still has, a new module is strict),
Error Prone in every Java compile (`api`, `rollback`), `noUncheckedIndexedAccess` in the app's `tsconfig.json`
(`typecheck`). There is no separate "core only" build job; the pricing
boundary is guarded by the ArchUnit `CoreArchitectureTest`, the BR-41 lint rule, the
`MODULE_PRICING` build guard and `api:lint` of `openapi-pricing.yaml` ([../architecture/modules.md](../architecture/modules.md)).

## Fixtures

| Fixture | Source | Used by |
|---|---|---|
| Duplex v1 / v2 | `fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc`, `…_v2.ifc` | almost everything; v2 for revisions and diffs |
| Hand BoQ | `engine/tests/test_duplex.py` `HAND_BOQ` (read at run time through Python by `tests/scenarios/duplex.test.ts`); its wall rows are the file's axis length x height less openings, read independently by `engine/tests/independent/duplex_walls.py` (review B-03) | v1 criterion 1 |
| Review samples S01–S14 | Public files pinned by URL and SHA-256 in `docs/review/tools/fetch-samples.sh` (git-ignored `docs/review/_samples`); expectations in `engine/tests/independent/verify_quantities.py` and `docs/review/baseline/` | the review tools; CI's `engine` job on S01–S05, S09 (review B-04) |
| Adversarial IFC corpus | `engine/tests/fixtures/adversarial/` (hand-built by `make.py`, outcomes in `expected.json`) | `test_adversarial.py` (review B-02) |
| buildingSMART samples | `fixtures/ifc/buildingsmart` (CC BY 4.0) | parse edge cases, schemas, units |
| Federated pairs | NBU Medical Clinic architecture + structure, the reference pair of nfr.md (downloads, not in git; [the corpus catalogue](ifc-corpus-catalogue.md)) | federation, performance |
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
| **O1** IFC models → BoQ (incl. federation) | Engine: `test_duplex` (exact `HAND_BOQ`), `test_federation*`, `test_certification_samples`, `test_model_summary` (check details per element), `test_worker`, `test_worker_logging`. API: scenarios `duplex` (v1-1), `federation` (v1-2), `models` (upload, `not_ifc`, dedupe, a `not_ifc` version refused a retry, size limit), `model-lifecycle` (disciplines, scopes, minutes checked before an upload, the 24 h upload expiry, a version in use, a failed parse audited, a second Generate beside the first), `boqs`; `NativeWorkerTest` Duplex system test, queue transport, the worker and the database going away mid-job; `ParseJobErrorsTest` (parse error codes), `JobDispatcherTest` (a refused worker connection waits without using an attempt). Browser: `main-flow` (upload → parse → BoQ), `b7` (Remove model). Local: `local:check` | Uploads over 100 MB (multipart) at any level; `corrupt_file`; a successful parse retry (`it.todo`); `.ifczip`; medium-model performance outside the manual suite |
| **O2** Measure the firm's way (Library, wizard) | API: scenarios `library`, `library-publish` (publish, clone, preview, drafts as a preview's other inputs, clones rebased on publish), `codelists`, `templates`, `setup` (1 test). Unit: `features/library` (82 tests), `features/setup` (`steps.test.ts`: the wizard's logic, F16-AC8 and AC9 included; `setup-gate.test.ts`). Engine: `test_presets` (slot answers checked), `test_preset_templates`, `test_item_texts`, `test_codelist_import`. Browser: the wizard's suggested-answers path inside `accounts` (F01-AC1); `b7` (before setup, org pages lead to the wizard); `areas` (`@b2b-wizard`: a switch turned from its suggested answer, kept across a step back, published as answered; `@b2b-library`: an item text reads as the engine splits it without a preview run, a slot renamed through the engine) | Library editors and preview in a browser (F10-AC1, v1-7 also needs a person); F10-AC5 ("Opis" column → item texts); wizard F16-AC2–AC4 and the rendering of AC8, AC9; v1-12 person check |
| **O3** Trust every number (trace, viewer) | API: scenario `sheet` (line detail, "how it is calculated"); `NativeWorkerTest` (scene, geometry). Engine: `test_duplex` explanations, `test_faces_rooms`, `test_scope_recess_building`, `test_model_summary`. Unit: `viewer/links`, `boq-sheet`, `features/changes` (a changed element's lines). Browser: `states` (the viewer without WebGL lists the elements and their lines), `areas` (`@b2b-viewer`: the sample model drawn with WebGL, a model hidden and shown again), `formats` (the org's formats on the sheet, line detail and share page), `resilience` (a share line's explanation by keyboard) | Viewer in a browser with WebGL (F07-AC1–AC7); v1-4 person check |
| **O4** Nothing silently dropped (questions, decisions) | API: scenario `questions` (bulk answer, dismiss, complete, CSV), `model-lifecycle` (a run lists the questions it asked and those its decisions answered), `changes`/`versions` (answers carried over). Engine: `test_names`, `test_federation_links` (contradiction, double claim), `test_overrides` (orphan; an excluded line feeds no derived line). Unit: `features/questions` (`answer-control.test.tsx`: one click accepts a preselected suggestion). Browser: `b7` (a suggested answer accepted with one click; a viewer sees questions and decisions read-only) | `POST /decisions/{id}/promote` beyond its permission cells (F05-AC5); F05-AC4 warning on approved revisions; bulk answering in a browser; pseudo-locale rendering of engine messages (F15-AC3, unit only) |
| **O5** Keep up with design changes | API: scenarios `model-versions` (Duplex v1 → v2: answers asked nothing again, the change report equals the engine's fixture, every kind of edit survives, an orphaned edit, an uncached report < 3 s), `changes` (compare, the cached diff < 500 ms, change-report export), `versions`, `line-edits`, `boqs` (`boq.new_version_available`); `NativeWorkerTest` revised IFC. Engine: `test_diff` (Duplex revision, 40k lines < 5 s), `test_versions`. Browser: `batch6` (the new-version badge, "Use", the change report's Excel) | The changes colour mode in a browser (F07-AC6) |
| **O6** Edit, version, confirm | API: scenarios `line-edits`, `versions` (labels, `409 revision_locked`, `409 boq_confirmed`, review, comments audited, approval, four-eyes, a confirmed BoQ archived and restored), `versions-roles`, `co-editing` (presence, edits reach everyone), `state-machines`, `audit`; two-instance SSE. Browser: `live` (two-browser co-editing), `resilience` (keyboard editing, an edit kept while the API doesn't answer, the event stream reconnecting), `states` (double-click editing, the Item picker), `batch6` (events replayed after a reconnect), `b7` (the notice's collapse follows the user). Unit: `boq-sheet` (edits, positions, kept edits) | Undo, moves, manual lines and positions in a browser (F06-AC1–AC9); BR-29 "the earlier editor is told"; 20k-line performance (F06-AC11) |
| **O7** Hand it over (Excel, shares) | API: scenarios `sheet` (exports), `edits-import` (F12-AC4, text edits), `changes`, `shares` (create, public page and subresources, line detail, an edited quantity as edited, revoke, `publicLinksAllowed`, expiry and revival, follow latest); `AccountSecurityTest` (the share limit per address and token with `Retry-After`; no tokens in the access log). Engine: `test_export_xlsx` (order, nested sections, subtotals, decimals), `test_boq_import`, `test_export_libreoffice` (CI `workbooks`: LibreOffice prints the run, saved-version and change-report workbooks and recalculates them to the engine's totals, review B-11). Browser: `main-flow` (Excel download, share link opened anonymously, a share line's detail), `a11y-layout` (the share page at 360 px) | Opening workbooks in Microsoft Excel (F12-AC1); the share page's `Referrer-Policy` (`noindex` is asserted in `main-flow`) |
| **O8** Run the firm's account | API: scenarios `orgs` (invitations, seats, last owner, roles, two orgs, `org.updated` data, locale, names), `projects`, `isolation` (BR-50, BR-52), `billing` (entitlements, `402`, `checkout_unavailable`, notifications), `plans` (P57: plans the platform admin configures, the impact preview, the catalogue's keys, the default plan, one owned org on Free, platform settings), `limits` (every plan limit, `processingMinutesPerMonth` included), `permissions` (the role matrix: every row of both tables as eleven personas, approval off, on and archived), `versions-roles`, `state-machines` (takeover, 12 h expiry); `ApiFoundationTest`, `NativeAuthTest`, `AccountSecurityTest` (rate limits on sign-in, invitation mail and engine rpc calls; account and takeover audit; last active; preferences; HSTS and nosniff; HEAD on public routes; control characters in names; seats), `ErrorResponsesTest`, `RequestSizeFilterTest`. Contract: `auth` (401 on every secured op), `validation`, `me`, `billing`, `events`, `idempotency`. Unit: `__tests__/headers.test.ts` (the app's response headers). Browser: `accounts`, `orgs` (F01-AC2–AC4, AC6), `areas` (`@b2b-notifications`: the bell's count, a notification opened where it points, all marked read, the notifications page), `sessions` (F01-AC5), `formats` (F15-AC2 locale formats, input limits), `batch6` (the limit dialog), `a11y-layout` (page titles, one Tab stop, focus, 768 px), `b7` (the setup gate, a viewer read-only), `sign-up` (P57: sign-up closed and open through the email link to the first org, the self-service reset) | Signed-URL lifetimes; the pilot's proxy headers; trial end and downgrade (not built); the billing webhook; notification emails being suppressed per category; F13-AC1 toast; an axe scan (`a11y-layout` checks titles, focus and layout only) and the pseudo-locale browser check (v1-11) |
| **O9** Operate the platform | API: scenario `admin` (orgs table, plan change, trial, suspend, end session, overview, funnel, health), contract `admin` (404 for non-admins); `ApiFoundationTest` (metadata only; every admin read audited), `HealthTimeoutTest` (readiness answers DOWN within 2 s without a database), `AlertMonitorTest`, `BackupRestoreTest`. Browser: `areas` (`@b2b-admin`: a platform admin opens the console and an org and leaves a note; others get 404). | The admin plan editor, overrides, suspension and the funnel in a browser |
| O10 Pricing module | Boundary only: `CoreArchitectureTest`, the BR-41 lint rule, the `MODULE_PRICING` guard, `api:lint` | Everything else: not built (P48) |

v1 acceptance criteria and their current evidence: [../product/scope-and-acceptance.md](../product/scope-and-acceptance.md#v1-acceptance-results-2026-11-21).
The complete list of known test gaps: [../product/known-limitations.md](../product/known-limitations.md#tests).

## History

TS-001 (shared suites), TS-002 (performance), TS-003 (accessibility, its axe suite deleted with the
mock) and TS-004 (v1 acceptance) were the build's test tasks ([../archive/plan/](../archive/plan/README.md)).
Until P53 the suites also ran against the mock API, and 106 Playwright tests ran only there.
