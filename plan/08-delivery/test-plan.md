# Test plan: the full test campaign

The plan for one complete test campaign of boqlet: backend, frontend, engine, every flow, role and
use, done by coding-agent sessions. It finds bugs, gaps and inconsistencies (in the code and in
the product), writes them down, fixes them, retests, and pushes the fixes to `main`.

**How to start it.** The owner says: *"Look at the test plan and execute it."* The agent reads this
file from the top and goes stage by stage. **It stops at the end of every stage** (0 to 7), reports
what the stage found, and waits for the owner's go before starting the next one (the owner,
2026-11-21). The findings log is
[`test-findings.md`](test-findings.md). If a session ends half-way, the next session resumes from
that log's run log; nothing is lost.

This file is the method. `testing.md` is the standing test strategy (layers, CI, definition of
done) and stays as it is. Where the two differ, `testing.md` wins for everyday tasks and this file
wins for the campaign. All paths are relative to the repository root (the product root since FE-046, P44).

---

## 1. Ground rules

| Rule | What it means here |
|---|---|
| The specs are the oracle | Expected behaviour comes from `plan/` (product, P-decisions, BR rules, feature acceptance criteria, screens, permissions, state machines) and from `docs/` for how the engine measures. Every finding cites the spec line it breaks. No spec means no "expected": write a **question** finding, don't guess (sessions.md). |
| Settled decisions stay settled | P01–P52 and BR-xx are not reopened. A test that disagrees with one is a finding about the code, or a question to the owner. |
| Pricing is out of scope | The pricing module is deferred (P48): `packages/pricing-ui` doesn't exist, and Java and the mock have no pricing code. Test only the module boundary (§9.6). v1 criteria 6 and 14, F11, F17 and F20 are **not applicable** and recorded as such. |
| Where tests run | **Local mock stack** for most UI and flow work. **Local native Java stack** for backend behaviour, load, performance, restore and anything destructive. **The pilot (booqlet.com)** is the only deployed environment and counts as development (P51, owner 2026-11-20), so functional checks may run there with synthetic accounts (`ops/pilot/verify-live.sh`). Load and destructive tests still run locally (build log, Current position). |
| Branch and pushes | Work on `main` only, no other branches and no worktrees (since the v1 release, FE-047; `v_1` was the build branch until then, P46, and is kept as it was). Every green push to `main` deploys to the pilot, so never push red. |
| Other sessions | Before Stage 0 and before every push, run `ListAgents`. If another session works in this repository, tell it what this campaign will touch (ports, files, pushes) and agree who uses ports 3000, 4010, 8788, 3100 and 8080. Never stage its files; stage by file name. |
| Parallel work | Asking to execute this plan is the owner's request for parallel subagents (asked for when this plan was written, 2026-11-21). Use them where this plan says a stage is parallel, and keep each stage under 10 agents. Read-only reviewers may run side by side. Agents that edit files must have disjoint file sets. Only the main session commits and pushes. |

---

## 2. What is under test

| Part | Where | Notes |
|---|---|---|
| Engine (Python) | `engine/ifc_boq`, `engine/tests` (115 test functions, 211 collected with parametrisation; Duplex acceptance) | Also the worker (`worker_http`, `worker_queue`), CLI (`npm run boq`), corpus runner |
| Java API | `services/api` (Spring Boot 3.5, Java 21, Maven, Flyway 15 migrations, 22 controllers) | Native sign-in (P50), queue workers, SSE, the shared suites through `NativeWorkerTest` |
| Mock API | `apps/mock-api` | The executable spec, and the e2e test double. It must behave the same as Java on every contract operation |
| Product app | `apps/app` (Next.js, 41 pages) | Auth adapters `mock` and `native`. `e2e/` (31 specs, ~113 tests with the `perf` project) runs on the mock, `e2e-java/` (13 tests) on Java |
| Contracts | `packages/api/openapi.yaml`, `packages/pricing-api/openapi-pricing.yaml`, `packages/types` | Lint, codegen drift, both implementations against them |
| Shared suites | `tests/contract` (15 tests), `tests/scenarios` (24 files, 174 tests + 2 todo), `tests/perf` (TS-002: `api.test.ts`, `engine_timing.py`) | Against the mock (`--mock`) and Java (`SUITE_TARGET=java`, through JUnit) |
| Deployment | `ops/pilot`, `.github/workflows/ci.yml` (7 jobs incl. `deploy`) | Rollout, rollback, health, smoke on the pilot |
| PoC | — | Removed by FE-046; reachable only as the tag `poc-final`. Not tested (§9.7) |

Known before the campaign starts, so not re-discovered as "new":
- `tests/perf` exists (TS-002, `7ae13e8`): `api.test.ts` (CRUD p95 and the 500-line page, run by
  `npm run perf:mock -w @ifc-boq/tests`, or on Java by `NativeWorkerTest#apiPerformanceAgainstJava`
  with `BOQLET_API_PERF=1`) and `engine_timing.py` (parse and run times). The UI targets are the
  Playwright `perf` project (`sheet.perf.spec.ts`, `ui.perf.spec.ts`). The release run's results are
  in `04-architecture/nfr.md` "Measured"; the medium-model parse (9 min, target 5) is a known miss
  (`docs/11`, phase 3).
- There is no local docker-compose for Java. The "local native stack" is either `NativeWorkerTest`'s
  Testcontainers or the manual stack in §4.3.
- `docs/11` "Known limitations" (phases 1, 2 and 3) lists accepted limits. A test that hits one of
  those is linked to it, not filed as a new bug, unless the limit is worse than described or the
  description is out of date (then it is an **inconsistency** finding).

---

## 3. The stages

```text
Stage 0  Preflight and baseline                       sequential
Stage 1  Automated suites, all of them                parallel lanes (§5)
Stage 2  Code-vs-spec review                          parallel read-only reviewers (§6)
Stage 3  Live testing: flows, roles, uses             parallel personas by stack (§7, §8)
Stage 4  Non-functional: perf, a11y, i18n, security,  parallel lanes (§9)
         resilience, compatibility
Stage 5  Triage                                       sequential (main session)
Stage 6  Fix and retest                               parallel by disjoint area, commits sequential (§11)
Stage 7  Full regression, push, verify, record        sequential (§12)
```

Stages 1–4 only find things. Nobody fixes anything before Stage 5, except a blocker that stops the
remaining tests (for example, the stack won't start). Fix that at once, with a test, as finding
TF-001, TF-002 and so on.

Each stage ends by updating the run log in `test-findings.md`: done or not, how long it took, and
which findings it added.

---

## 4. Stage 0: preflight and baseline

### 4.1 Tooling

| Tool | Need | State on the owner's machine (2026-11-21) |
|---|---|---|
| Node 22, npm | everything | 22.23 present |
| Python 3.10–3.13, `engine/.venv` | engine, worker | venv present |
| Docker | Java tests (Testcontainers), local native stack | 29.8 present |
| JDK 21 | Java build | **JDK 22 found.** Install JDK 21 (the CI version), or check that the build passes on 22 and note it |
| Maven 3.9 | Java build | **Not on PATH**, and the repo has no `mvnw`. Install it, or run Maven in Docker (`maven:3.9-eclipse-temurin-21`) |
| Playwright Chromium, Firefox, WebKit | e2e, compatibility | **Chromium only.** `npx playwright install firefox webkit` for §9.5 |
| LibreOffice | opening the exported workbooks (F12-AC1, `docs/11`) | **Not installed.** Install it for Stage 4, or record F12-AC1 as "openpyxl only, LibreOffice pending" |
| Excel | F12-AC1 | **Present** (`Office16\EXCEL.EXE`): open the workbooks with it in Stage 3, M1 |
| `gh` | latest CI runs, `gh run watch` | Logged in |
| Federated pair (NBU office architecture and structure) | v1 criterion 2, nfr.md | Not in `fixtures/` (only `catalogue.json` in `fixtures/corpus`). Download per `docs/12`, outside git |
| SSH to the pilot | `verify-live.sh`, `issue-setup-link.sh` (both run **on the host**: they `docker exec` into the pilot's database) | **No host entry in `~/.ssh/config`.** Ask the owner. Without it, pilot checks are limited to public sign-in with accounts the owner gives |

### 4.2 Baseline (sequential)

1. `git switch main && git pull`, then `git status`. Follow sessions.md "Starting a session" for
   anything unclean.
2. `ListAgents`, and coordinate with any other session (§1).
3. `npm install` (also sets up the engine venv).
4. Write in the run log: the commit under test, the date, the OS, the tool versions, and the
   latest CI run on `main` with its result (`gh run list --branch main -L 5`). Read the `deploy`
   job's log too: a green job that printed "Skipped superseded revision" did not deploy.
5. The baseline is the latest CI run plus Stage 1. Anything red before the campaign changes
   anything is filed as a finding with "found in: baseline".

### 4.3 The three stacks

| Stack | Start | Users | Used by |
|---|---|---|---|
| **Mock** (M) | `npm run dev:app` (worker 8788, mock 4010, app 3000). `npm run mock:reset` for a clean seed | Seeded: `olivia` (owner of Studio Demo, team plan, and of Small Firm, free plan), `ivana` (library_editor), `marko`, `ana`, `victor` (members; estimator, approver and viewer on the seeded project), `pat` (platform admin), all `@example.com`. Sign in at `/sign-in` (lists `/_dev/users`). Test-only: `/_dev/clock`, `/_test/clock`, `/_dev/outbox`, `/_dev/checkout`, `/_dev/emit`, `/_dev/reset` | Stages 3, 4 |
| **Native Java** (J) | No compose exists. Copy the setup in `services/api/src/test/java/.../NativeWorkerTest.java`: Postgres 16, SeaweedFS (S3), MailHog containers; `mvn -f services/api/pom.xml package -DskipTests`; `java -jar services/api/target/boqlet-api.jar` with `BOQLET_JDBC_URL`, `BOQLET_DB_USER`, `BOQLET_DB_PASSWORD`, `BOQLET_NATIVE_AUTH=true`, `BOQLET_SECURE_COOKIE=false`, `BOQLET_APP_URL`, `BOQLET_S3_*`, `BOQLET_SMTP_*`, `BOQLET_INVITATION_SECRET`, `BOQLET_ENGINE_HTTP_URL`; the engine worker; the app with `NEXT_PUBLIC_AUTH_ADAPTER=native`, `API_PROXY_TARGET=http://127.0.0.1:8080` and `NEXT_DIST_DIR=.next-java` on port 3100. Put the start script in the session's scratchpad, not in the repo. **A missing local stack script is itself finding TF-xxx (test-gap)**: propose adding it, but add it only in Stage 6 | First owner by setup link (`/_test/setup-link` in the test build, or the operator recovery in `docs/19`). Platform admin: `users.platform_role='admin'` set in the DB (`docs/19`) | Stages 3 (backend parity), 4 (perf, resilience, security) |
| **Pilot** (P) | https://booqlet.com, deployed from `main` | Synthetic `pilot-smoke-*@example.invalid` accounts through `ops/pilot/verify-live.sh` and `issue-setup-link.sh`; cleaned up afterwards | Stage 3 (acceptance walk, J-series smoke), Stage 7 |

Ports that clash: `npm run e2e:app` reuses 3000, 4010 and 8788 when they are already up, unless `CI`
is set. Never run it while another lane or session uses the dev stack on those ports. The
`*:mock` suites start their own mock and worker on free ports and are safe beside anything.

---

## 5. Stage 1: the automated suites (parallel lanes)

Run the lanes as parallel background jobs or subagents. Each lane writes its result, its duration
and its log path in the run log. **Every failure is a finding**, even when it looks flaky: re-run
it once, and record "flaky" with both outcomes if the result changes.

| Lane | Commands | Ports, resources | Runs beside |
|---|---|---|---|
| **1A Static** | `npm run typecheck`; `npm run lint`; `npm run api:lint`; `npm run api:check`; `npm run codegen` then `git diff --exit-code packages/types/schema`; `npm run build:app`; `npm run bundle:check -w @ifc-boq/app` | none | all |
| **1B Unit** | `npm run test:app`; `npm run test:mock` (its Duplex test needs the worker on 8788: run it in 1D) | none | all |
| **1C Engine** | `npm run test:engine`; `npm run boq -- fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc --out <scratch>/duplex.xlsx`; `npm run corpus -- fixtures/ifc/buildingsmart` (and the downloaded federated pair) | CPU | all |
| **1D Shared suites on the mock** | `npm run test:contract:mock`; `npm run test:scenarios:mock` | free ports (own mock and worker) | all |
| **1E Browser on the mock** | `npm run e2e:app` (chromium plus the `perf` project; 2 workers) | **3000, 4010, 8788, exclusive** | 1A–1D, not 1F's app |
| **1F Java** | `mvn -f services/api/pom.xml verify` with `BOQLET_NATIVE_WORKER_PYTHON=<venv python>`, `BOQLET_NATIVE_NODE=<node>`, `BOQLET_NATIVE_QUEUE_TEST=1`, `BOQLET_NATIVE_SCENARIOS=1`, `BOQLET_BROWSER_SMOKE=1`, and the S3 test keys as in `ci.yml`. This runs the unit, ArchUnit and integration tests, the contract and scenario suites against Java, isolation, SSE across two instances and the 13-test browser smoke (port 3100) | Docker, ~4 GB, 5–25 min on Windows | 1A–1D. Run it beside 1E only with ≥ 16 GB free memory, otherwise after 1E |
| **1G CI parity** | Read the latest `ci.yml` runs on `main` (and the last ones on `v_1`, for flaky tests): every job green? Does anything run locally but not in CI, or the reverse (for example the Firefox and WebKit projects, the core-only build in testing.md "Core without modules")? | none | all |

Lane 1F on Windows: the queue worker has hung one parse once (`docs/11`, phase 2). If it hangs,
record it with the log, kill it, and re-run the scenarios once with `BOQLET_SCENARIO_FILTER`.

After the lanes, the **coverage audit** (one subagent, read-only) fills the coverage matrix in
`test-findings.md` §C: for every v1 criterion and every feature acceptance criterion (§8), the
automated test that proves it (file and test name), or "manual", or "none". Every "none" on a
criterion marked (A) is a **test-gap** finding.

---

## 6. Stage 2: code-vs-spec review (parallel, read-only)

Seven reviewer subagents run side by side. Each gets its brief below, the specs it names, and the
finding format (`test-findings.md` §F). Each returns findings only: no edits. Tell them what the
known limitations are (`docs/11`), so they don't refile them.

| Reviewer | Scope | Specs (the oracle) | Look for |
|---|---|---|---|
| **R1 Contract parity** | `packages/api/openapi.yaml` ↔ Java controllers and generated interfaces ↔ mock routes ↔ the app's API calls | `05-api/conventions.md`, `05-api/contract-changes.md` (C01–C06) | Operations missing in Java or the mock; status and error codes that differ (`404` vs `403`, `409` codes, `402` body shape); unknown fields accepted at nested levels (a known mock limit, Java must reject them); pagination, idempotency keys, ETags, sorting; operations the app never calls (dead endpoints) and calls with no operation |
| **R2 Authorisation and tenancy** | Java policy code, repository queries, the mock's checks, the app's gating from `permissions` | `03-domain/permissions.md` (both role tables, the permission keys, errors), BR-50, BR-56, BR-57, `04-architecture/security.md` "Authorisation" | Every row in both role tables enforced on the server; archived projects return `false` for every write key; `404` for no access and for other orgs; four-eyes; the last owner; admin queries never select content columns; signed URLs issued only after the checks, with the 5 min / 1 h lifetimes |
| **R3 State machines and business rules** | Java services, mock, engine | `03-domain/state-machines.md`, `03-domain/business-rules.md` | Every transition allowed, every other one `409 invalid_transition` naming the current state; BR-20…BR-29 (locked versions, one working version, save preconditions, label sequence, positions, per-line concurrency); BR-60…BR-62 (limits before the action, never blocking reads, a usage event for every job); the 24 h `awaiting_upload` expiry, job retries < 3, the 12 h session expiry |
| **R4 Frontend screens** | `apps/app/app/**`, `apps/app/src/**` | `02-flows/screens.md` (S01–S37 minus pricing), `06-frontend/architecture.md`, `06-frontend/design-guidelines.md`, F15 | Every screen in the inventory exists at its route, and no route lacks a screen; each data screen has loading (skeletons), empty (says the next action), error (message and retry, `404` page) and read-only states; actions hidden by `permissions`; no literal UI strings (F15); colours used only for their meaning (P43: no green, orange "to confirm", yellow "manual"); global chrome (org switcher, search, bell, user menu, project sub-nav) |
| **R5 Security** | Java auth and HTTP layer, the app's headers, the worker's input handling, `ops/pilot` | `04-architecture/security.md`, P50, `docs/19` | Argon2id; cookie `HttpOnly`, `Secure`, `SameSite`; exact-origin check on state-changing requests; rate limits (auth, invitations 20/h, rpc 60/min, share tokens 60/min); CSP, HSTS, `noindex` and `Referrer-Policy: no-referrer` on share pages; the upload's `ISO-10303-21;` header check and size cap; `.xlsm` refused, openpyxl read-only and data-only; share tokens stored hashed; audit of failed permission checks on sensitive actions; secrets kept out of the repo and the images; the worker's network and DB credentials |
| **R6 Engine, numbers and exports** | `engine/ifc_boq`, the ingestion in Java and the mock, the export workbooks | BR-01…BR-12, `docs/05`, `docs/06`, F12, F06 §12 | No computing outside the engine (BR-01: grep the app, the mock and Java for quantity maths); classification and item texts never change a number (BR-02, BR-11); question ids deterministic (BR-04); edits kept, orphans become questions (BR-09); the "not in the models" note in the sheet, the save dialog and the Excel (BR-12); watermarks; frozen exports byte-identical (BR-25) |
| **R7 Docs and plan consistency** | `CLAUDE.md`, `plan/README.md`, `plan/08-delivery/*`, `plan/10-build-log.md`, `docs/11`, `docs/18`, `docs/19`, `06-frontend/mock-api.md` | the code and the repo as they are | Statements that are no longer true (for example `tests/perf` listed in CLAUDE.md but missing; test counts in `testing.md` vs the real ones; commands that don't exist); limitations in `docs/11` that are fixed by now, or worse than described; tasks marked done whose acceptance isn't met; contradictions between two specs (each one is a **question** finding for the owner) |

---

## 7. Stage 3: live testing of every flow, role and use

### 7.1 Personas

One account per persona. On the mock, use the seed and add what is missing through the UI
(inviting is part of the test). On Java and the pilot, create them through invitations and setup
links.

| Id | Persona | Mock account | Purpose |
|---|---|---|---|
| P-NEW | Visitor signing up | new, through `/sign-up` | FL-1 from nothing |
| P-OWN | Org owner | `olivia` (Studio Demo) | everything an owner may do |
| P-ADM | Org admin | invite one (the seed has none) | owner rights minus billing, delete, make-owner |
| P-LIB | Library editor | `ivana` | Library, wizard, promote |
| P-MEM | Member, no project role | invite one | sees no project; `404` on direct links |
| P-LEAD | Project lead (creator) | the creator of a new project | project settings, members, confirm, reopen |
| P-EST | Estimator | `marko` on the project | models, BoQs, questions, edits, save |
| P-APR | Approver | `ana` on the project | approve, request changes, confirm with approval on |
| P-VIEW | Viewer | `victor` on the project | read only, everywhere |
| P-2ORG | Member of two orgs | `olivia` (Studio Demo and Small Firm) | org switch, data never crosses |
| P-FREE | Free-plan owner | `olivia` in Small Firm | every limit |
| P-INV | Invitee | an email invited by P-OWN, plus a second email that must fail | F01-AC2 |
| P-X | Member of another org | a user of a second org | isolation |
| P-PUB | Public-link visitor | no account, private browser window | F18 |
| P-PADM | Platform admin | `pat` | F19, metadata only |
| P-ANON | Unauthenticated API caller | `curl` with no cookie or token | `401` everywhere outside `/public` and auth |

### 7.2 How to drive it

- **Browser work:** write Playwright scripts in the session's scratchpad, one per journey group,
  with screenshots on every step and a trace on failure, against the mock (3000) or the Java app
  (3100). Use one browser context per persona, and two contexts for co-editing and takeover.
  An interactive browser tool (Claude in Chrome, the built-in browser) may be used for
  exploratory passes.
- **API work:** the generated client from `packages/api`, or `curl`, with each persona's session.
- **A journey that passes and has no automated test** becomes a **test-gap** finding with the
  script attached. Stage 6 turns it into a test in `e2e/`, `tests/scenarios` or `e2e-java/` (P52:
  Java browser tests only for what the shared suites can't reach).
- **Run in parallel:** journey groups A–S below are independent when each uses its own org (or its
  own project in the seed org). Run up to 5 persona agents at once on the mock: each signs up its
  own org, so the seed isn't shared. Give each agent its own app port, or share one app and keep
  the orgs apart. Group R (admin) reads totals, so it runs last.
- **Both stacks:** every group runs on the mock. Groups A, C, D, E, F, J, Q, R and S also run on
  native Java, because those parts differ by backend (auth, storage, queue, SSE). The pilot gets
  the acceptance walk in §7.4.

### 7.3 The journeys

Each line is one journey. Expected results come from the cited spec. "AC" means the feature's
acceptance criterion by position (`F01-AC5` is the fifth in F01). Check every journey for:
the UI state (loading, empty, error, read-only), audit events written (BR-51), notifications
(F13), and the browser console (no errors, no failed requests other than the expected one).

**A. Accounts, sessions, orgs (F01; S01–S04, S31; FL-1)**
- A1 P-NEW signs up, creates an org (currency, units, country), meets the wizard gate (P18), and is on the dashboard in under a minute without the wizard's long path (F01-AC1, F16-AC6).
- A2 Native sign-in on Java: wrong password, unknown email, locked by rate limit, password setup link (valid, used twice, expired after 1 h), reset link (P50, `docs/19`).
- A3 P-INV accepts an invitation with the right email; a different email is refused (F01-AC2); an expired or revoked invitation; accepting while signed in as someone else.
- A4 Seat limit: P-FREE invites past `seats` and gets `402 limit_reached` with `limit: "seats"`, and the UI's upgrade prompt (F01-AC3, FL-8).
- A5 Last owner can't leave or be demoted (F01-AC4); making someone owner (owner only); an admin can't do it.
- A6 Takeover: sign in on a second browser, get the takeover question, continue, and the first browser gets `401 session_replaced` and the signed-out message within 5 s; cancel leaves the first session alive (F01-AC5, v1-16). The same with three browsers. Session expiry after 12 h idle (test clock). A platform admin ends a session (F19).
- A7 P-2ORG switches org: every request after the switch uses the new org, no stale data, deep links into the other org (F01-AC6).
- A8 Account page: edit profile, notification preferences, leave an org (S04).
- A9 Sign out from every place; back button after sign-out; two tabs signing out together (`src/auth/leaving.ts`).
- A10 Audit events for every action above (F01-AC7).
- A11 Origin check (Java): a state-changing request from a foreign `Origin` is refused; a GET isn't.

**B. Org settings (S21–S25, F14)**
- B1 Rename, formats (currency, units, number and date formats), `approvalRequired`, `fourEyes`, `publicLinksAllowed`, by owner and admin; refused for library_editor and member (`403`), hidden in the UI.
- B2 Members: invite, change role, remove, resend, revoke an invitation; invitations rate limit (20/h).
- B3 Billing page as owner (manual billing): plans, entitlements; checkout answers `409 checkout_unavailable` with a reason the UI shows (C06); non-owners don't see it.
- B4 Usage page: this month against limits; processing minutes equal the sum of job durations (F14-AC4).
- B5 Audit page: filters, CSV, retention by plan (`auditLogRetentionDays`).
- B6 Share-links page: every share link of the org, revoke.
- B7 Delete org (owner only): it disappears at once for every member; data removal within 30 days (BR-52; a known mock limit, check Java).

**C. Projects (F02; S05–S07, S17, S18)**
- C1 Create a project with defaults from the starred presets; the project's settings page; members (org members only, an outside email is refused with the share-link hint, F02-AC3).
- C2 `activeProjects` limit: `402` on the second project of a free org; archiving one frees the slot (F02-AC1).
- C3 P-MEM doesn't see the project in lists, gets `404` on direct access (F02-AC2), also through search.
- C4 Archive: every write `409 project_archived`, a read-only banner, every permission key `false`; restore (F02-AC4).
- C5 Dashboard "Needs you" shows a review request within 5 s of submission (F02-AC5) and each other kind (docs/11 lists them).
- C6 Sample project (FL-1 step 5): created with model, BoQ and answered questions; doesn't count as an active project, its processing doesn't count as usage.
- C7 Project activity page (lead, approver only): filters.

**D. Models and versions (F03; S08–S10)**
- D1 Upload the Duplex: progress, processing stages, report, no reload (F03-AC1). Leave during processing and come back: the live state, and a notification when ready (F03-AC2).
- D2 Upload a non-IFC file: `not_ifc`, a readable message, no retry (F03-AC3). Also: an empty file, a truncated IFC (`corrupt_file`), a renamed `.txt`, an IFC4 file from `fixtures/ifc/buildingsmart`, a unicode file name, a file with spaces.
- D3 The same content twice in the org: one parse job, two versions (F03-AC4); across two projects of the org; across two orgs (must parse again, no sharing).
- D4 Over `maxModelVersionMb`: refused before the upload in the browser, and at version creation on the server (F03-AC5's sibling, AC6).
- D5 Every check row on the version report opens the viewer with exactly its elements highlighted (F03-AC5).
- D6 Retry a failed version; delete a version no run uses (soft delete) and one a run uses (refused).
- D7 Several discipline models, scope and discipline settings per model (a known limit: scope editing; record what the UI offers).
- D8 Abandoned upload: `awaiting_upload` becomes `failed` after 24 h (test clock).
- D9 Upload through a share link (in the Java browser smoke), and an upload interrupted half-way (multipart and resume are known limits: check that the failure is clean).

**E. BoQs and runs (F04; S11, S12, S12f)**
- E1 New BoQ in a project with two ready models: both latest versions and the project defaults preselected (F04-AC1). Other presets per BoQ (P19).
- E2 Generate the Duplex (cached parse): under 10 s end to end, the sheet without a reload (F04-AC2).
- E3 A run with blocking questions lands in `needs_input`, and the header links to the questions (F04-AC3).
- E4 Change any input: "Inputs changed since this run", Save version disabled until regenerated (F04-AC4).
- E5 Two runs with different classifications have identical quantities per line key (F04-AC5, BR-02).
- E6 Cancel a queued and a running run; a failed run (a forced engine error) shows a clear message, and the revision keeps its last finished run.
- E7 Run history: open an old run, compare two runs (F08).
- E8 `maxModelsPerBoq` limit.

**F. Questions and decisions (F05; S12b, S13; FL-7)**
- F1 Answer every blocking question of a `needs_input` run and regenerate: `complete` (F05-AC1).
- F2 Every question kind the engine raises on the Duplex and the buildingSMART samples: names, unmatched, overlap, double claim, orphan override, missing values; each answer type.
- F3 Bulk-answer 10 unknown names: one request, one regenerate (F05-AC3); "also add to project dictionary" on by default.
- F4 Dismiss; un-dismiss; change and clear a decision on the decisions page; CSV export (S13).
- F5 Changing a decision used by an `approved` revision warns first, lists the revisions, and moves them to `draft` on confirm (F05-AC4, BR-23).
- F6 Promote a name answer: a new org dictionary version, and a new project using it isn't asked again (F05-AC5). Only library editors, admins and owners see "Promote".
- F7 A new model version with the same names asks nothing again (F05-AC2, v1-3).
- F8 Engine messages render from codes (F15-AC3); no fallback text on the Duplex.

**G. The sheet (F06; S12a; FL-9)**
- G1 Group by: switch between two classifications, instant, no request, every line still visible (F06-AC1). Subtotals per group.
- G2 Line detail: formula, parameters, element shares summing to the quantity (F06-AC2); "How it is calculated" in plain words, the steps add up, rule-set values link to their Settings question (F06-AC5). Two clicks or fewer from a line to its elements in 3D and to its formula (v1-4, M).
- G3 Each edit type (quantity with reason, text, unit, move to another section, reorder, exclude with reason) survives regeneration and a new model version, and shows in the Excel (F06-AC3, v1-13).
- G4 A unit change without a quantity is refused with the reason; Ctrl+Z undoes the last edit; undo depth 20 (F06-AC4).
- G5 A manual line under "9 Preliminaries" stays there after regeneration, with that group's code (F06-AC6).
- G6 Item texts: filled texts with a classification that has them; the rule set's texts with one that doesn't; both in the detail; a blank with no value stays visible and raises a warning (F06-AC7, BR-11).
- G7 The "not in the models" notice and counts by source on every draft sheet; collapsing it is remembered per user (F06-AC8, BR-12).
- G8 Position numbers renumber at once after a move or exclusion, and stay unchanged in a saved version (F06-AC9, BR-28).
- G9 Co-editing in two browsers: an edit shows in the other within 1 s; the same line in both: the later wins and the earlier editor is told (F06-AC10, BR-29, v1-13). Presence.
- G10 20,000 lines scroll smoothly; Group by switch ≤ 300 ms (F06-AC11; the `perf` project).
- G11 Filters, search, flagged lines never hidden by default (BR-03), warnings at the top (BR-32 for models that don't overlap).
- G12 Box-select elements in the model, "n lines", bulk move (FL-9 step 5).

**H. Viewer (F07; S12c)**
- H1 A Duplex line highlights exactly its trace elements; roof lines the roof slab parts (F07-AC1).
- H2 Click an element: every line it contributes to, with its share (F07-AC2).
- H3 Coverage mode: unmatched elements in a distinct colour, count equal to the `unmatched` occurrences (F07-AC3); not colour alone (nfr.md accessibility).
- H4 A two-model run shows both models, each toggleable (F07-AC4).
- H5 Shared filters: storey and code group narrow both sheet and model; box select lists lines with the bulk actions (F07-AC5).
- H6 Changes colour mode: Duplex v1 → v2 added and changed, click shows lines before and after (F07-AC6).
- H7 Interactive within 3 s warm (F07-AC7); a WebGL2-less browser gets the fallback message; the non-3D element list and keyboard shortcuts.

**I. Revisions and changes (F08; S12d; FL-3)**
- I1 Save version A; swap in `fixtures/ifc/Ifc2x3_Duplex_Architecture_v2.ifc`; the change report lists exactly the affected lines and elements (F08-AC1, v1-3).
- I2 The working version regenerates without asking any question already answered (F08-AC2).
- I3 Line edits made before A still apply and are listed when their lines changed (F08-AC3); an edit whose line disappears becomes `orphan_override` (BR-9).
- I4 The change report opens in under 3 s, cached diff under 500 ms (F08-AC4); its Excel export.
- I5 "New version available" on BoQs using v1, and its notification (FL-3 step 2).

**J. Versions, review, confirm (F09; S12h)**
- J1 Approval off: Save version gives a labelled snapshot (A, B, … then AA), work goes on in a new working version (F09-AC1, BR-26). The save dialog has the "not in the models" tick (BR-12).
- J2 A saved version stays byte-identical (sheet, position numbers, Excel) while the working version changes (F09-AC2, BR-25). Every write to it, by every role including owner, gets `409 revision_locked` (v1-5).
- J3 Approval on: Submit → Approve → Save; request changes needs a comment; any edit during review withdraws it; four-eyes on: the submitter can't approve (`403`, `reason: "four_eyes"`), even as lead (F09-AC3, BR-24).
- J4 Confirm: every write `409 boq_confirmed`, owner included; saved versions, exports and share links keep working; reopen with a reason gives a working version, audited (F09-AC4, BR-27).
- J5 Every transition writes an audit event with actor and time, shown in project activity (F09-AC5).
- J6 Saving needs a finished run on the current inputs (BR-22); open blocking questions are allowed and counted on the version.
- J7 `approvalWorkflow` is off on the free plan: the toggles are unavailable there.

**K. Library (F10; S16, S19, S20; FL-6)**
- K1 P-LIB copies "As modelled" as a patch, changes three settings, previews on the Duplex, sees changed lines next to the editor (F10-AC1, v1-7).
- K2 Publishing with problems is impossible; publishing makes version n+1; older versions are read-only (F10-AC2).
- K3 A BoQ version saved on preset v1 still shows v1 numbers after v2 is published (F10-AC3, BR-7).
- K4 Import an xlsx code list with 3 levels: the hierarchy, duplicates reported (F10-AC4).
- K5 Import an xlsx with an "Opis" column: item texts filled, `{thickness}` "Reads as" with the preview's value, carried into lines (F10-AC5; known: no test yet).
- K6 P-MEM sees and picks org presets but no edit actions; the API gives `403` on edits (F10-AC6).
- K7 Clone "Based on it" stores only changed answers and follows a later system version; "Independent copy" doesn't (F10-AC7).
- K8 Rule set to Excel, three answers changed, uploaded: exactly three changes for review; a wrong answer reported with sheet, row and column (F10-AC8).
- K9 Classifications and dictionaries: create, edit, publish, archive, star; project-layer presets (S16) for lead and estimator only.
- K10 `libraryOrgPresets` limit on the free plan.

**L. Setup wizard (F16; S30)**
- L1 "Use the suggested answers" on every step finishes in under three minutes; the dashboard is unreachable before (F16-AC6).
- L2 From "As modelled": the 14-switch checklist, a detail screen only for switches on, the six measuring screens (F16-AC8).
- L3 Every answer changes the preview within 3 s on the Duplex, changed lines highlighted (F16-AC2).
- L4 After "Publish all", a new project's BoQ uses the three presets with no further choices, and its Excel shows item numbers and filled texts (F16-AC3).
- L5 Leave at step 2, come back the next day (test clock): step 2 with step 1's answers (F16-AC4).
- L6 A free org finishes without hitting `libraryOrgPresets` (F16-AC5).
- L7 Reinforcement on can't be finished without kg per m³ for slabs, walls and footings (F16-AC9).
- L8 Changing `setup` slots in the system rule set changes the screens with no frontend change (F16-AC7: an engine fixture test).
- L9 Members see "not finished yet"; a second admin during setup (known limit).
- L10 The person test (F16-AC1, v1-12): **the owner's to do**. The campaign prepares a one-page script for it and records "waiting for the owner".

**M. Exports (F12; S12g)**
- M1 The Duplex run's Excel opens in LibreOffice (headless `soffice --convert-to pdf` without a repair prompt, then a visual look) and in Excel if available; totals match the sheet (F12-AC1).
- M2 Item texts in the Description column; the "Lines" sheet holds both texts (F12-AC2).
- M3 The working version's export has the WORKING watermark; a saved version's doesn't, and is frozen (F12-AC3, BR-25); the free plan's watermark (`exportWatermark`).
- M4 Edit the Excel (one quantity, one move, one deleted row, one added row) and import it: exactly one edit, one move, one proposed exclusion, one proposed manual line (F12-AC4, v1-13). Also an Excel edited in LibreOffice; a `.xlsm` (refused); a 25 MB file (refused); a file from another BoQ (refused clearly).
- M5 Change report Excel.

**N. Notifications (F13; S26)**
- N1 A run finishing in another tab shows a toast and updates the open BoQ within 2 s (F13-AC1).
- N2 Every core kind arrives in the bell and, where F13 says so, by email (MailHog on Java, `/_dev/outbox` on the mock); deep links work; mark read.
- N3 Turning email off for a category stops those emails and keeps the bell (the core version of F13-AC3).

**O. Plans and limits (F14; FL-8)**
- O1 Every limit in `00-product/05-plans-and-limits.md` enforced at its actions with `402` and the limit name (F14-AC1): `seats`, `activeProjects`, `maxModelVersionMb`, `maxModelsPerBoq`, `processingMinutesPerMonth`, `libraryOrgPresets`, and the features `approvalWorkflow`, `exportWatermark`, `shareLinks`.
- O2 Limits never block reading, exporting or answering questions (BR-61).
- O3 Downgrade: excess projects read-only until archived; excess members keep access, no new invites.
- O4 Trial: start, extension by admin (FL-12 step 3), the end drops to Free (test clock).
- O5 A webhook with a bad signature is rejected and audited (F14-AC3; check what exists with manual billing).

**P. i18n, units, locale (F15)**
- P1 The pseudo-locale build shows no untranslated strings on the shell, sheet, questions, Library and share page (F15-AC1, v1-11; `e2e/pseudo-locale.spec.ts`), and the screens it doesn't cover.
- P2 The user's locale changes UI number and date formats; BoQ values keep the project's locale (F15-AC2).
- P3 Units, currency and decimal display per org; very large and very small quantities; negative and zero quantities.

**Q. Share links (F18; S35; FL-11)**
- Q1 A link on the Duplex BoQ opens in a private window with no account: sheet, explanation, 3D, nothing not included (F18-AC1, v1-15).
- Q2 Revoke: `404` within a second; `publicLinksAllowed` off does the same for every link of the org; on again restores the ones not expired (F18-AC2).
- Q3 "Follow latest saved": version A, then B as soon as B is saved (F18-AC3).
- Q4 No public endpoint returns member names, decisions, questions, vendor data or prices (F18-AC4); `noindex`, `Referrer-Policy`, rate limit 60/min; expiry.
- Q5 Who may create and revoke links (permissions table, `share`, `revokeShares`).

**R. Platform admin (F19; S36; FL-12)**
- R1 A non-admin on any `/admin/*` gets `404` (F19-AC1).
- R2 Seats, active projects and processing minutes equal the org's own usage page (F19-AC2, v1-17).
- R3 An org that hit `activeProjects` appears under "hit a limit" with the time (F19-AC3).
- R4 A plan change needs a reason, applies at once, and shows in the org's audit log (F19-AC4); trial extension; overrides; suspend; end a user's session.
- R5 No `/admin/*` response contains project names, file names, line descriptions or prices (F19-AC5, BR-57); every admin view is audited.
- R6 The admin can't reach org endpoints or project content by that role.

**S. Across everything**
- S1 **Role matrix sweep (API):** for every row in both role tables of `permissions.md`, call the action as each of P-OWN, P-ADM, P-LIB, P-MEM, P-LEAD, P-EST, P-APR, P-VIEW, P-X, P-ANON and P-PADM; the expected status is ✓ → 2xx, ✗ → `403` (`404` when the resource isn't visible to them), P-X → `404`, P-ANON → `401`, P-PADM → `404`. Write it as one data-driven scenario test (`tests/scenarios/permissions-matrix.test.ts`) in Stage 6 if `isolation.test.ts` doesn't already cover the row.
- S2 **Role matrix sweep (UI):** each persona opens every screen it may reach and every one it may not: hidden actions, read-only states, `404` pages.
- S3 Deep links, refresh on every route, back and forward, two tabs on the same BoQ, an expired session mid-edit (the edit isn't lost silently).
- S4 Network failure and slow API (Playwright throttling, a stopped API): error states with retry, no white screens; `global-error.tsx`, `not-found.tsx`.
- S5 Long and odd inputs: 255-character names, unicode, RTL text, emoji, HTML or script in names (escaped everywhere, including Excel and share pages), leading and trailing spaces, duplicate names.
- S6 Idempotency: double-click every create button; a retried POST with the same key.
- S7 Search (projects, BoQs) respects access.
- S8 Dark theme and light theme on every screen; colour only where it means something (P43).

### 7.4 The pilot acceptance walk (P)

On booqlet.com, with synthetic accounts, in a verification window:
1. `ops/pilot/verify-live.sh` (password setup, sign-in, signed upload, parse, GLB, sample BoQ).
2. By hand or by script against the pilot: A1, A6, D1, E2, F1, G3, J1, J4, M1, Q1, Q2, R1.
3. Clean up the synthetic accounts and data as `verify-live.sh` does. Never touch other accounts.

---

## 8. Coverage of the acceptance criteria

The complete list the campaign must close. Each criterion ends with a status in
`test-findings.md` §C: **pass (A)** with the test, **pass (M)** with the journey and evidence,
**fail** with the finding, **n/a** with the reason, or **owner** (needs a person).

| Source | Criteria | Journeys |
|---|---|---|
| v1 (`00-product/03`) | 1 Duplex reproduction · 2 Federation · 3 Revision · 4 Traceability (M) · 5 Versions · 6 Pricing (n/a, P48) · 7 Library (M) · 8 Isolation · 9 Limits · 10 Performance · 11 i18n · 12 First setup (M, owner) · 13 Editing · 14 Vendors (n/a, P48) · 15 Share link · 16 Single session · 17 Admin console | 1: lane 1C, 1F, E2 · 2: §9.1 with the federated pair, H4 · 3: I1–I3 · 4: G2 · 5: J2–J4 · 7: K1–K3 · 8: S1, lane 1F · 9: O1 · 10: §9.1 · 11: P1 · 12: L10 · 13: G3, G9, M4 · 15: Q1–Q2 · 16: A6 · 17: R2, R5 |
| F01 | AC1–AC7 | A1–A10 |
| F02 | AC1–AC5 | C1–C5 |
| F03 | AC1–AC6 | D1–D5 |
| F04 | AC1–AC5 | E1–E5 |
| F05 | AC1–AC5 | F1, F3, F5–F7 |
| F06 | AC1–AC11 | G1–G10 |
| F07 | AC1–AC7 | H1–H7 |
| F08 | AC1–AC4 | I1–I4 |
| F09 | AC1–AC5 | J1–J5 |
| F10 | AC1–AC8 | K1–K8 |
| F12 | AC1–AC4 | M1–M4 |
| F13 | AC1; AC2–AC3 only for core kinds (AC2 is the pricing module's) | N1–N3 |
| F14 | AC1–AC4 | O1, O5, B4 (AC2: a code review that the adapter swap needs no frontend change) |
| F15 | AC1–AC3 | P1, P2, F8 |
| F16 | AC1–AC9 | L1–L10 |
| F18 | AC1–AC4 | Q1–Q4 |
| F19 | AC1–AC5 | R1–R5 |
| F11, F17, F20 | all | n/a (P48); only the boundary in §9.6 |
| BR-01…BR-62 | every rule | R3 and R6 reviews, plus the journeys that cite them |
| State machines | every transition and every refused one | R3 review, plus scenario `state-machines` |
| Screens S01–S37 (minus pricing) | every screen, every state | R4 review, plus S2 |

---

## 9. Stage 4: non-functional (parallel lanes)

### 9.1 Performance (TS-002, nfr.md), local native stack only

TS-002 has landed (`tests/perf`, §2): run `api.test.ts` against Java (`BOQLET_API_PERF=1` in lane 1F,
or the manual stack in §4.3 with `API_URL`) and `engine_timing.py`, and compare with
`04-architecture/nfr.md` "Measured". The medium-model parse is a known miss, not a new finding.
- Parse and run times: Duplex (≤ 30 s parse, ≤ 5 s run), the federated pair (≤ 3 min parsing both
  in parallel, ≤ 60 s run), a medium corpus file if there is one.
- API: p95 of the CRUD paths ≤ 300 ms and the lines page (500 lines) ≤ 500 ms, with a small load
  (for example 20 virtual users with k6 or autocannon, run from the scratchpad).
- UI: the Playwright `perf` project with `E2E_PRODUCTION=1` and `PERF_OUT=<file>`: first paint
  ≤ 1.5 s, the 20k-line sheet, viewer to interactive ≤ 3 s, picking ≤ 100 ms, live update ≤ 2 s,
  live edit ≤ 1 s.
- Record every measured value next to its target in `test-findings.md` §P. A miss is a finding
  (S2 when the target is in a v1 criterion, S3 otherwise).

### 9.2 Accessibility (TS-003 done; extend it)

- `e2e/a11y.spec.ts` in lane 1E (axe, WCAG 2.2 AA).
- By hand: the keyboard alone through FL-1, FL-2 and FL-11 (focus visible, no traps, order makes
  sense, dialogs return focus); the sheet's grid keys; zoom 200 %; a screen-reader spot check
  (NVDA on Windows) of the sign-in, the sheet and the share page. This pass hasn't been done yet
  (`docs/11`, phase 3).

### 9.3 Security (on the local Java stack; read-only probes on the pilot)

- The isolation sweep (S1) and the admin metadata check (R5).
- Auth: brute force rate limit, session fixation (the cookie changes at sign-in), cookie flags,
  sign-out invalidates on the server, takeover publishes `session.revoked`.
- CSRF: state-changing requests with no `Origin`, a wrong `Origin`, and a `null` one.
- Input: IFC with a wrong header, a zip bomb-like IFC, an xlsx with formulas or external links or
  macros, path traversal in file names, oversized JSON, unknown fields at every level, SQL and
  script strings in every text field.
- Headers on the app, the API and the share page: CSP, HSTS, `X-Content-Type-Options`, frame
  options, `noindex`, `Referrer-Policy`.
- Signed URLs: lifetime (5 min GET, 1 h PUT), scope to one key, refused after it expires.
- Dependency audit: `npm audit --omit=dev`, `pip-audit` in the engine venv, the Maven dependency
  check if available. A high or critical finding with a fix available is an S2 finding.
- Secrets: `git grep` for keys and passwords; the images' environment (`ops/pilot/*.Dockerfile`).
- On the pilot, only passive checks: headers, TLS (`check-public-edge.py`), the `404` behaviour.

### 9.4 Resilience and operations (local native stack)

- Kill the worker during a parse and during a run: the job re-queues by heartbeat and finishes; no
  job is lost; attempts < 3 (M6).
- Restart the API during an SSE stream: the client reconnects and catches up.
- Two API instances: live updates reach clients of both (`NativeWorkerTest` covers it; check by
  hand once).
- Migrations: apply them to the previous release's schema with data in it, and roll the app back
  one image: the old app still works with the new schema (`docs/19`, automatic rollback).
- Backup and restore of Postgres and storage on the local stack; RPO and RTO noted (nfr.md).
- Health and readiness endpoints; request ids in logs and error bodies.

### 9.5 Compatibility

- Playwright on Chromium, Firefox and WebKit for the journeys of FL-1, FL-2 and FL-11 (not the
  full suite); Edge if installed.
- Widths: 1280 px and up (full app), 768 px (saved version, share page, read-only), below 768 px
  (nothing breaks so badly that the share page can't be read).
- WebGL2 off: the viewer's fallback message.

### 9.6 The pricing module boundary (P36, BR-41)

- ArchUnit `CoreArchitectureTest` in lane 1F; the BR-41 lint rule in lane 1A.
- The app builds and runs with no module (`apps/app/src/modules.ts` registers nothing);
  `MODULE_PRICING=1` fails in `next.config` as designed.
- `openapi-pricing.yaml` lints; the core contract never references it.
- No pricing screen, nav entry or string leaks into the core UI.

### 9.7 The PoC

Removed by FE-046 (the tag `poc-final` keeps it). Nothing to run. Check only that nothing in the repo
still points at it (`dev:poc`, `build:poc`, `apps/web`, `engine/ifc_boq/api.py`); the Vercel demo is
the owner's item (build log, "Waiting for the owner").

---

## 10. Recording findings

Every finding goes into `test-findings.md` §F at the moment it is found, in the format there.

| Field | Values |
|---|---|
| Id | `TF-001`, `TF-002`, … in the order found, never reused |
| Severity | **S1 blocker**: wrong quantity, data loss or leak, isolation or security breach, a v1 criterion fails, a main flow can't finish. **S2 major**: a feature acceptance criterion fails, or a role can do what it mustn't or can't do what it may, and a workaround exists. **S3 minor**: an edge case, an inconsistent state, a missing UI state, a wrong error code, a docs mismatch that misleads. **S4 trivial**: copy, cosmetics, layout |
| Type | **bug** (behaviour breaks a spec) · **gap** (a spec'd thing that is missing) · **inconsistency** (spec vs spec, spec vs code, mock vs Java, docs vs code) · **test-gap** (works, but no test proves an (A) criterion) · **question** (the spec is silent or contradicts itself: the owner decides) |
| Area | engine, java, mock, app, contract, suites, ops, docs |
| Found by | the stage and the lane, reviewer or journey (for example `S3 · G9 · mock`) |
| Spec | the line it breaks (`F06-AC10`, `BR-29`, `permissions.md` row "Confirm a BoQ") |
| Steps, expected, actual | short and reproducible; evidence: a log excerpt, screenshot path, trace, request and response |
| Status | open → fixing → fixed (commit) → verified (retest) · or: duplicate of TF-x · known limitation (`docs/11` line) · deferred (to a named task) · owner (question in `09-open-questions.md` as Qnn) · won't fix (the owner's word only) |

---

## 11. Stages 5 and 6: triage, fix, retest

### 11.1 Triage (main session, sequential)

1. Merge duplicates and link known limitations.
2. Sort by severity, then by area.
3. Decide each finding's route:

| Route | When | What happens |
|---|---|---|
| **Fix now** | bugs, inconsistencies and test-gaps of any severity, inside the rules | Stage 6 |
| **Deferred** | the fix is a whole planned task (TS-002, FE-045, BE-025, FE-046 and the like), or the pricing module | Record it with the task id. Don't build the task in this campaign |
| **Owner** | product behaviour a spec doesn't define; anything that would change a P-decision or BR rule; contract changes that change behaviour; anything needing an account, a secret or money | Add it to `09-open-questions.md` ("Blocks: TF-xxx") and ask in the session; go on with the rest |
| **Stop** | a destructive or irreversible step (sessions.md "When to stop") | Ask first |

### 11.2 Fixing (parallel by area, commits sequential)

- **Group the fixes by area and file set**: engine; Java; mock; app (by screen); contract (with mock,
  Java and app in one commit, per `05-api/contract-changes.md`); suites and tests; docs.
- Up to three fix agents work at once, each on its own area with **disjoint files**, in the same
  working tree on `main`. Before giving out the work, check that no two agents edit the same file.
  Agents don't commit.
- **Every fix comes with a test** that fails before the fix and passes after, at the lowest layer
  that can show it (engine pytest, JUnit, scenario, Vitest, Playwright).
- Follow the rules of the road in `CLAUDE.md`: types first (`npm run codegen`), contract first
  (`npm run api:gen`), no maths outside the engine, keep the Duplex test green (a changed
  `HAND_BOQ` number needs its reason in the commit), deterministic question ids.
- **The main session commits**, one commit per finding (or per small group in one area), staged
  by file name: `TF-012: <what was fixed>` plus the attribution lines. Never commit red: before
  each commit, typecheck plus the affected suites pass.
- Mark each finding `fixed` with its commit.

### 11.3 Retest

- For each fixed finding: re-run its journey or the failing test on every stack where it failed.
  Mark it `verified`, or reopen it with what's still wrong.
- After each area's batch, re-run that area's lanes from Stage 1 (for example a Java fix: lane 1F;
  an app fix: 1A, 1B and the affected `e2e` specs).

---

## 12. Stage 7: full regression, push, verify, record

1. Re-run all of Stage 1 (lanes 1A–1F) on the final tree. Everything green, or every red item
   explained by a finding with the status `owner` or `deferred`.
2. `ListAgents`; coordinate. `git pull --rebase` on `main`. If anything came in, re-run the lanes
   it touches.
3. Push to `main` (pushes may come in batches during Stage 6, each one green).
4. Watch CI (`gh run watch`): all seven jobs green, including `deploy`, and the `deploy` log shows a
   rollout, not "Skipped superseded revision". A red job is a finding to fix before anything else.
5. After the rollout: `ops/pilot/verify-live.sh` in a verification window, and the pilot walk
   in §7.4 for the fixed findings that touch the deployed app.
6. Record:
   - `test-findings.md`: every finding with its final status, the coverage table §C complete,
     the performance table §P, and the summary at the top.
   - `docs/11-roadmap-and-open-questions.md`: a "Done" row per fix batch with the commit hashes,
     and "Known limitations" updated: new limits added, fixed ones struck (the owner's standing
     rule).
   - `plan/10-build-log.md`: an entry "Test campaign" (template in the build log) and Current
     position.
   - `plan/09-open-questions.md`: every owner question.
7. Report to the owner: counts by severity and status, what was fixed, what waits for them (owner
   questions, the person test L10, Excel by hand), what was deferred and to which task, and the CI
   and pilot results.

---

## 13. Effort and order of work

Rough sizes, so the owner knows what "execute" costs. The campaign will likely take several
sessions; the run log carries it over.

| Stage | Wall clock (rough) | Agents at once |
|---|---|---|
| 0 Preflight | 15–30 min (more if Maven, JDK 21 or LibreOffice must be installed) | 1 |
| 1 Automated | 30–60 min (lane 1F dominates) | 6–7 lanes |
| 2 Review | 30–60 min | 7 |
| 3 Live | 2–4 h | ≤ 5 personas |
| 4 Non-functional | 1–3 h | ≤ 5 |
| 5 Triage | 30 min | 1 |
| 6 Fix and retest | depends on the findings | ≤ 3 |
| 7 Regression and push | 1–2 h with CI | 1 |

If time is short, keep this order: Stage 0 → 1 → 2 (R2, R3, R5 first) → 3 (groups S1, A, J, Q, R, G
first: security, sessions, locked versions, sharing, admin, editing) → 5 → 6 for S1 and S2 → 7.
Then the rest.
