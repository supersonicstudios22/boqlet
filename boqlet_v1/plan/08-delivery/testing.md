# Testing strategy

## Layers

| Layer | Tool | Where | What |
|---|---|---|---|
| Engine unit + acceptance | pytest | `engine/tests` | Existing suite (194 tests) incl. Duplex `HAND_BOQ`; new worker, diff, override, sheets tests (tasks-engine.md) |
| Contract | Schemathesis or a hand-written suite over the generated client | `tests/contract` | Every operation in `openapi.yaml`: status codes, schemas, error codes; runs against the **mock** (phase 1) and **Java** (phase 2, unchanged) |
| Behaviour scenarios | Vitest (TS) over the generated client | `tests/scenarios` | Domain rules through the API: state machines, permissions, limits, versions and confirmation, BR-xx. Same suite against mock and Java |
| Frontend unit | Vitest + Testing Library | `apps/app` | Components with logic: grouping, readable formulas, comparison flags display, decimal display, permission gating |
| End-to-end | Playwright | `apps/app/e2e` | Flows FL-1…FL-8 against mock + real engine (CI, the 106 browser tests) |
| Browser smoke against Java (P52) | Playwright | `apps/app/e2e-java` (`playwright.java.config.ts`) | 13 tests with native sign-in against a local Java API, worker, Postgres, MinIO and MailHog: F01 criteria, native cookie and origin rules, reset links, FL-1 to the sample BoQ, upload through a share link, live co-editing. Run by `NativeWorkerTest#browserSmokeAgainstJava` when `BOQLET_BROWSER_SMOKE=1` (CI's API job); `BOQLET_BROWSER_SMOKE_FILTER` narrows it locally |
| Backend unit/integration | JUnit 5 + Testcontainers | `services/api` | Policies, state machines, repositories, ingestion, fake worker |
| Performance | Vitest over the generated client (API; k6 was planned, the shared client was simpler and runs against both backends), Playwright (UI), engine timing script | `tests/perf`, `apps/app/e2e/*.perf.spec.ts` | NFR targets (nfr.md); see "Performance" below |
| Accessibility | axe-core in Playwright | `apps/app/e2e` | Main screens, no serious/critical violations |

## The shared suites are the handover mechanism

`tests/contract` and `tests/scenarios` are written by the frontend agent in phase 1 **against
the mock**. They describe the backend's behaviour precisely. The backend agent's Java backend is
done when the same suites pass against it unchanged (phase 2). Tests that depend on an engine
fake (`mock-api.md`) are tagged `@fake` and must pass on the real engine in phase 3. Scenario tests are named after rule ids (`BR-27 confirmed BoQ refuses writes`) and acceptance criteria (`F11-AC2`).

Each scenario seeds through the API only (no direct DB access), so it runs against both
implementations. A test-only endpoint `POST /_test/clock` (mock and Java, disabled in
production builds) moves time for deadline tests.

## Fixtures

| Fixture | Source | Used by |
|---|---|---|
| Duplex v1 | `fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc` | everything |
| Duplex v2 | EN-008 script | revisions, diff |
| Hand BoQ | `engine/tests/test_duplex.py` `HAND_BOQ`, exported to JSON for e2e | v1 criterion 1 |
| Federated pair | NBU office architecture + structure (downloaded, docs/12) | federation, nightly |
| buildingSMART samples | `fixtures/ifc/buildingsmart` | parse edge cases |
| Edited BoQ xlsx files | exported BoQs edited in Excel and LibreOffice (EN-006) | edits import |
| (Pricing module) offer and pricebook xlsx files | filled in Excel and LibreOffice (EN-P1) | module imports |
| Recorded engine outputs | results of the real worker on the fixtures | Java integration tests (fake worker) |

## CI pipeline

GitHub Actions, `.github/workflows/ci.yml` at the repository root (TS-001), triggered on pushes to
`v_1` (the build branch, P46) and `main`. Until FE-046 every
product job runs with `working-directory: boqlet_v1`. Jobs run on Ubuntu; the scripts must also
run on the owner's Windows machine (`sessions.md`).

1. Lint: contract (`api:lint`), TS (eslint), Python (ruff if adopted), Java (spotless/checkstyle).
2. Typecheck: workspaces.
3. Engine tests (`npm run test:engine`).
4. Codegen drift check: regenerate schemas/clients, fail on diff.
5. Mock + engine up → contract + scenario suites → Playwright smoke (FL-2 Duplex).
6. Java build + unit/integration (from M5) → contract + scenario suites against Java → the browser smoke against Java (P52), all in the API job's `mvn verify`.
7. Nightly: federated pair, performance, accessibility. The full Playwright suite stays on the mock; Java gets the smoke set in step 6 (P52).

## Performance (TS-002)

Measured on the local native stack, never on the pilot (P51); results go into `04-architecture/nfr.md`.
Each command appends JSON lines to `PERF_OUT=<file>` when it is set.

| What | How |
|---|---|
| Engine parse and run | `engine/.venv/Scripts/python tests/perf/engine_timing.py <file.ifc>` (`--federated A.ifc B.ifc` parses in parallel and runs one BoQ; `--repeat N`). The medium files are downloads (docs/12). |
| API latency | `npm run perf:mock -w @ifc-boq/tests` against a fresh mock; against Java, `BOQLET_API_PERF=1` runs `NativeWorkerTest#apiPerformanceAgainstJava` (`tests/perf/api.test.ts`, then 50k-line run ingestion) with the variables of CI's API job |
| UI | `npm run build -w @ifc-boq/app` with `API_PROXY_TARGET=http://localhost:4010`, `next start` on port 3000, then `E2E_PRODUCTION=1 npx playwright test --project=perf --no-deps` in `apps/app` (`e2e/*.perf.spec.ts`; `PERF_VIEWER_IFC=<file>` adds the large-model viewer test). Without `E2E_PRODUCTION` the bounds are loose regression checks under `next dev`, which CI runs after the other browser tests. |
| Bundle budgets | `npm run bundle:check -w @ifc-boq/app` after a production build; in CI's build job (`apps/app/bundle-budgets.json`, `--write` to reset them with 10 % headroom) |

## Test tasks

| ID | Milestone | Task | Acceptance |
|---|---|---|---|
| TS-001 | M0 (frontend agent) | Scaffold `tests/contract` and `tests/scenarios` (Vitest over the generated client, base URL from env), seed helpers through the API, `/_test/clock`; create `.github/workflows/ci.yml` (lint, typecheck, engine tests, contract and scenario suites against the mock) | One contract test per tag and one scenario per state machine run green against the mock |
| TS-002 | M8 (frontend agent) | Performance suite (k6 for API paths in nfr.md, engine timing on reference files, Playwright traces for sheet and viewer) | NFR table filled with measured values on staging |
| TS-003 | M8 (frontend agent) | Accessibility suite (axe in Playwright on S05, S10, S12a–c, S15c, S20, S29) | No serious/critical violations |
| TS-004 | M8 (frontend agent) | v1 acceptance run on staging (00-product/03 criteria 1–17), results recorded in `plan/README.md` | All green |

## Definition of done (every task)

- Acceptance criteria of the task met and covered by an automated test where marked (A).
- Contract and scenario suites green.
- No new hard-coded UI strings; i18n keys added.
- Audit events written for new write actions.
- Docs: `docs/11` "Done" row added (project rule); the build log's Current position updated;
  if a milestone was completed, its build-log entry written and the plan status table updated.
- Committed and pushed to `v_1` with the task id in the message; nothing red committed.

## Core without modules

Every CI run includes a **core-only** job: the app, mock, Java service and engine built and tested
with the pricing module removed (P36, BR-41). A failure there means the core started depending on
the module.
