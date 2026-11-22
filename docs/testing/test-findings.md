# Test findings: the campaign log

The working record of the test campaign in [`test-plan.md`](test-plan.md). Each section is filled
while the campaign runs. A session that stops half-way leaves this file up to date. The next session
reads the run log and resumes from the first stage not marked done.

**In progress: Stage 6 (fix and retest). Stages 0–5 done (TF-001…TF-188); every S1 is fixed and deployed (TF-011 `fc78b12`; TF-039, TF-174, TF-085 in `1be66cb`, CI 44980195142); batches B1–B6 in progress, then Stage 7.**
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

- Commit under test (start): `8d22de6` (main; the first Stage 0 ran on `3d68ffc`)
- Commit after the fixes (end): ``
- CI on the end commit: 
- Pilot rollout and `verify-live.sh`: 
- Waiting for the owner: 

## Run log

One row per stage or lane, updated when it starts and ends.

| Stage / lane | Status | Started | Ended | Stack | Result, log path | Findings |
|---|---|---|---|---|---|---|
| 0 Preflight (tools, `npm install`, latest CI) | done | 2026-11-21 | 2026-11-21 | local | Windows 11 Pro 10.0.26300; Node 22.23.4, npm 10.9.9; Python 3.10.7 (venv, `ifc_boq` editable from `engine/`); Docker 29.8.2 (15.4 GB, 12 CPUs); JDK 22 locally, Maven + JDK 21 through the `maven:3.9-eclipse-temurin-21` image; Playwright Chromium + Firefox + WebKit; Excel present; LibreOffice missing; no SSH host for the pilot; `gh` logged in. `npm install` clean (12 moderate `npm audit` items, for §9.3). CI on `main`: `3d68ffc` run 44926299190 and `8977990` run 44924953402, all 7 jobs green, but both `deploy` jobs skipped the rollout (TF-001). Last `v_1` runs: `4b9a07c` e2e red (F06-AC10 co-editing failed, `sheet.perf` flaky), `7d4f790`-era run red (`ModuleNotFoundError: pytest` in the Java job's scenarios); later runs green on the same trees (for lane 1G). Other session `ifc-boq-1f`: read-only, no ports, no pushes. | TF-001 |
| 0 Preflight, rerun after P53 | done | 2026-11-21 | 2026-11-21 | local | Commit under test **`8d22de6`** (main, clean, up to date with origin). Windows 11 Pro 10.0.26300; Node 22.23.4, npm 10.9.9; Python 3.10.7 (`engine/.venv`); Docker 29.8.2 (15.4 GB, 12 CPUs; images `boqlet-local-api`, `boqlet-local-engine`, `maven:3.9-eclipse-temurin-21` cached); **JDK 22** (Oracle) with **Maven 3.10.1** installed by scoop (`~/scoop/apps/maven/current/bin/mvn.cmd`, not on the bash PATH): `test-compile` of `services/api` passes on 22 in 18 s (CI uses 21 / 3.9); Playwright Chromium, Firefox, WebKit; Excel present; **LibreOffice missing**; **no SSH host for the pilot**; `gh` logged in. `npm install` clean (12 moderate `npm audit` items, for §9.3); on Windows it rewrites `package-lock.json` metadata for `@tailwindcss/oxide-wasm32-wasi`'s bundled `@emnapi/*` (`extraneous` → `dev`/`optional`), restored, not a finding. Federated pair downloaded outside git: NBU Office Building (`NBU_OfficeBuilding_Arch-1.ifc` 4.1 MB, `_Eng-CON.ifc` 11.1 MB) into the session scratchpad `corpus-nbu-office/`. CI on `main`: `8d22de6` run 44943515472 all 6 jobs green, `deploy` rolled out (20:13:30Z `Boqlet 8d22de6b3f3a… deployed.`); `cf58e32` run 44940268922 green and deployed. `ListAgents`: no other session. | — |
| 1A Static | done, green | 2026-11-21 | 2026-11-21 | local | `8d22de6`. `typecheck` 33 s, `lint` 48 s, `api:lint` 3 s (valid, 3 warnings: empty `anyOf` branch in `run-request.schema.json` `Value<unknown>`; unused components `BoqLineEdited` and `PreviewResult` in `openapi.yaml`, for R1), `api:check` 4 s, `codegen` + `git diff --exit-code packages/types/schema` 15 s (no drift), `build:app` 45 s, `bundle:check` 1 s (43 routes within budget, largest 348 KiB gzipped). Run in one chain with 1B (the pseudo-locale and `next typegen` write into `apps/app`). Logs: session scratchpad `lanes/logs/1A-*.log` | — |
| 1B Unit | done, green | 2026-11-21 | 2026-11-21 | local | `test:app` 14 s: 32 files, **213** tests passed (README says ~190: TF-002) | TF-002 |
| 1C Engine, CLI, corpus | done, green | 2026-11-21 | 2026-11-21 | local | `test:engine` 176 s: 211 passed, 1 warning. `npm run boq` on the Duplex 6 s: complete, 41 lines, 3 flagged, 150 of 239 elements measured, 0 unmatched, 175 ms engine time; Excel written. `corpus fixtures/ifc/buildingsmart` 15 s: 12 files, 0 failures. `corpus` on the NBU Office pair 38 s: Arch-1 needs_input 784 measured, Eng-CON complete 494 measured, 0 failures. Every count equals `ifc-corpus-catalogue.md`. Python 3.10 locally (CI: 3.12) | — |
| 1D Java and the shared suites (H: `mvn verify`, contract, scenarios, browser smoke) | done, green | 2026-11-21 | 2026-11-21 | H | `mvn verify` on JDK 22 + Maven 3.10.1 with CI's variables (`BOQLET_NATIVE_QUEUE_TEST=1`, scenarios, browser smoke) **558 s**: 18 tests, 0 failures, 1 skipped (`apiPerformanceAgainstJava`, needs `BOQLET_API_PERF`; §9.1). `ApiFoundationTest` 6, `BackupRestoreTest` 1, `AlertMonitorTest` 4, `NativeAuthTest` 1, `NativeWorkerTest` 5 (1 skipped), `CoreArchitectureTest` 1 (README says 8 and 2: TF-002). Contract suite 6 files, 181 passed; scenarios 24 files, 173 passed + 2 todo; browser smoke 13 passed (1.9 min). No hang, no flake. `queue-worker-ifc.log` ends with two `BrokenPipeError` tracebacks: a parse job picked up at 21:24:43, after the scenarios ended, lost its pipe when the harness stopped the worker (shutdown, not a failure; worker kill is checked in §9.4). Logs: `services/api/target/{shared-java-*,browser-smoke,queue-worker-*}.log`; `shared-java-perf.log` there is stale (14:32, an earlier session) | TF-002 |
| 1E Local stack (`local:up`, `local:check`) | done, green | 2026-11-21 | 2026-11-21 | L | `local:up` 136 s (images cached); `local:check` 11 s: sign-up, upload to SeaweedFS, parse ready, BoQ complete with 41 lines. Ran beside 1D with no port or memory trouble. The stack is left up for Stage 3 | — |
| 1F CI parity | done | 2026-11-21 | 2026-11-21 | — | Every run on `main` since the merge is green (`8977990`, `3d68ffc`, `6cc0594`, `cf58e32`, `8d22de6`), all 6 jobs. The last red runs were on `v_1` and are closed: `4b9a07c` and `5c9bd6f` failed in the mock's Playwright job (deleted, P53); `e7cb9a2` and `a48496c` failed `sharedScenariosPassAgainstJava` (`ModuleNotFoundError: pytest`, then a match assertion), green on later commits. Runs locally but not in CI: the performance suite (`BOQLET_API_PERF`), `engine_timing.py`, the corpus runner, Firefox and WebKit, accessibility, Python 3.10/3.13 (CI 3.12), Windows (CI Ubuntu), JDK 22 (CI 21). In CI but not in `npm run test`: `api:lint`, `api:check`, codegen drift, `build:app`, `bundle:check`, the harness. `local` is not a deploy gate (as `docs/testing/README.md` says). All as documented; the performance gap is TF-006 | TF-006 |
| 1 Coverage audit (§C) | done | 2026-11-21 | 2026-11-21 | — | One read-only agent, tests read against every criterion (§C filled). v1: 7 pass (A), 5 partial, 3 manual or owner, 2 n/a. Features: 38 pass (A), 42 partial, 11 none, 3 manual or owner, 1 n/a (+ pricing). Test gaps on (A) criteria: TF-004…TF-010; doc mismatches: TF-003. Partial and none on unmarked criteria are left to Stage 3's journeys | TF-003…TF-010 |
| 2 R1 Contract parity | done | 2026-11-21 | 2026-11-21 | code | 162 operations all handled in Java (155 via generated interfaces, 7 by hand); 9 never called by the app; the 3 `api:lint` warnings judged harmless (`BoqLineEdited` documents the SSE payload, `PreviewResult` the signed preview document, `Value<unknown>` is `unknown | ParamRef`). 1 S2, 7 S3, 3 S4 | TF-071…TF-081 |
| 2 R2 Authorisation and tenancy | done | 2026-11-21 | 2026-11-21 | code + L | 30 role-table rows and 7 cross-cutting rules: roles enforced as spec'd in all 30 rows, no IDOR, SSE and notifications filtered, signed URLs 5 min / 1 h after the checks. S1 TF-011 (encoded `/admin/` bypass) confirmed live on L and hotfixed (`fc78b12`). Untested rows listed for Stage 6 | TF-011…TF-015 |
| 2 R3 State machines and rules | done | 2026-11-21 | 2026-11-21 | code | 9 machines, BR-20…29, 51, 60…62, the timers: locking, labels, four-eyes, retries, heartbeat re-queue, session expiry hold. 1 S2 (TF-029 review stuck after an unrelated decision), 6 S3, 3 S4; untested transitions listed for Stage 6 | TF-029…TF-038 |
| 2 R4 Frontend screens | done | 2026-11-21 | 2026-11-21 | code | 28 non-pricing screens vs 41 pages: every screen has its route; 7 routes have no S-id. Read-only states, permission gating, chrome and boundaries mostly right; no inline retry anywhere, one skeleton. 1 S2 (TF-021 org number and date formats never applied in the UI), 7 S3, 5 S4 | TF-016…TF-028 |
| 2 R5 Security | done | 2026-11-21 | 2026-11-21 | code | Argon2id, single-use hashed setup links, cookie flags, no fixation, exact origin check, hashed share tokens, upload checks, openpyxl modes, parameterised SQL, no secrets, the queue role all compliant. 1 S2 (TF-039 xlsx bomb in rpc, unconfirmed), 7 S3, 2 S4 | TF-039…TF-048 |
| 2 R6 Engine, numbers, exports | done | 2026-11-21 | 2026-11-21 | code + engine runs | One evaluator, BR-01 (only display sums outside the engine), BR-02, BR-04, BR-11, BR-25, watermarks, import safety hold. 2 S2 (TF-049 reorders never reach the Excel, TF-050 the imperial setting does nothing), 7 S3, 3 S4 | TF-049…TF-060 |
| 2 R7 Docs consistency | done | 2026-11-21 | 2026-11-21 | code | 78 docs, 279 links (0 broken), every npm script and env var real, counts confirmed; the struck "noted while writing the plan" items hold; known limitations still true. 2 S3, 8 S4 (2 of them Java/ops noticed on the way) | TF-061…TF-070 |
| 3 A Accounts, sessions, orgs | done | 2026-11-21 | 2026-11-21 | L | A1–A11: 11 run, 8 pass, 3 fail (A6 takeover question and audit, A9 wrong sign-out reason, A10). Sign-ins via curl inside the API container (shared per-address throttle). DB timestamps moved on own rows for expiry journeys. session scratchpad `stage3/out/s3a-accounts`/report.txt or findings.txt | TF-113…TF-124 (with B) |
| 3 B Org settings | done | 2026-11-21 | 2026-11-21 | L | B1–B7: 7 run, 6 pass, 1 fail (B2: no invitation rate limit, TF-043). session scratchpad `stage3/out/s3a-accounts`/report.txt or findings.txt | TF-113…TF-124 (with A) |
| 3 C Projects | done | 2026-11-21 | 2026-11-21 | L | C1, C2, C4–C7 run (C3 in the matrix sweep): C7 fails (activity filter names). session scratchpad `stage3/out/s3b-projects`/report.txt or findings.txt | TF-125…TF-132 (with D, O) |
| 3 D Models | done | 2026-11-21 | 2026-11-21 | L | D1–D9: D5 fails (no check row opens the viewer, S2), D6 (TF-032, TF-020), D8 (TF-031, sweep seen live). session scratchpad `stage3/out/s3b-projects`/report.txt or findings.txt | TF-125…TF-132 |
| 3 E BoQs and runs | done | 2026-11-21 | 2026-11-21 | L | E1–E8: 7 pass, E7 fails (no way to open an old run); click-to-lines 1.1–1.5 s. session scratchpad `stage3/out/s3a-versions`/report.txt or findings.txt | TF-093…TF-101 (with I, J) |
| 3 F Questions | done | 2026-11-21 | 2026-11-21 | L | F1–F8 run; F answers carried to v2 (TF-004 behaviour correct). session scratchpad `stage3/out/s3b-library`/report.txt or findings.txt | TF-133…TF-144 (with K, L) |
| 3 G Sheet | done | 2026-11-21 | 2026-11-21 | L | G1–G12 except G10 (Stage 4): G3 partial (TF-049 Excel order; picker, double-click, re-sort on text edit), G11 partial. session scratchpad `stage3/out/s3a-sheet`/report.txt or findings.txt | TF-102…TF-112 (with H) |
| 3 H Viewer | done | 2026-11-21 | 2026-11-21 | L | H1–H7: H6 fails (no before/after on a changed element, S2), H7 no WebGL fallback. session scratchpad `stage3/out/s3a-sheet`/report.txt or findings.txt | TF-102…TF-112 |
| 3 I Revisions | done | 2026-11-21 | 2026-11-21 | L | I1–I5: I3 fails (change report hides an edited line, S2); I1 matches the engine fixture exactly through the stack. session scratchpad `stage3/out/s3a-versions`/report.txt or findings.txt | TF-093…TF-101 |
| 3 J Versions, review, confirm | done | 2026-11-21 | 2026-11-21 | L | J1–J7: J4 fails (archive/restore of a confirmed BoQ), J7 (free-plan toggles); labels A…Z, AA verified; saved Excel byte-identical. session scratchpad `stage3/out/s3a-versions`/report.txt or findings.txt | TF-093…TF-101 |
| 3 K Library | done | 2026-11-21 | 2026-11-21 | L | K1–K10: K5 fails (item-text sample shows raw `{thickness}`), K7 open question. session scratchpad `stage3/out/s3b-library`/report.txt or findings.txt | TF-133…TF-144 |
| 3 L Setup wizard | done | 2026-11-21 | 2026-11-21 | L | L1–L9 run (L8 read: an engine test), L3 fails (previews fail in steps 2–3; 2.8–3.7 s per answer); L10 person-test script written (`person-test-script.txt`), waits for the owner. session scratchpad `stage3/out/s3b-library`/report.txt or findings.txt | TF-133…TF-144 |
| 3 M Exports | done | 2026-11-21 | 2026-11-21 | L | M1–M5: M1 openpyxl only (LibreOffice skipped by the owner; Excel by hand pending), M4 fails on `.xlsm` and 25 MB (TF-041, TF-071). session scratchpad `stage3/out/s3a-shares`/report.txt or findings.txt | TF-085…TF-089 (with Q) |
| 3 N Notifications | done | 2026-11-21 | 2026-11-21 | L | N1–N3: pass (N2 with the raw-key notifications of TF-097). session scratchpad `stage3/out/s3b-ux`/report.txt or findings.txt | TF-145…TF-152 (with P, S) |
| 3 O Plans and limits | done | 2026-11-21 | 2026-11-21 | L | O1–O5: every limit answers 402 with its name; O3 downgrade, O4 trial end, O5 webhook are known limitations (not built). session scratchpad `stage3/out/s3b-projects`/report.txt or findings.txt | TF-125…TF-132 |
| 3 P i18n | done | 2026-11-21 | 2026-11-21 | L | P1–P3 fail: raw audit action codes in en-XA and English, formats (TF-021), 0.000123 shown three ways. session scratchpad `stage3/out/s3b-ux`/report.txt or findings.txt | TF-145…TF-152 |
| 3 Q Share links | done | 2026-11-21 | 2026-11-21 | L | Q1 fails (S1 TF-085: a line click crashes the share page), Q2–Q5 pass (revoke 404 in 14 ms). session scratchpad `stage3/out/s3a-shares`/report.txt or findings.txt | TF-085…TF-089 |
| 3 R Platform admin | done | 2026-11-21 | 2026-11-21 | L | R1–R6 pass their criteria; R4 and S36 states have defects (trial date shifts a day, unmeasured health counters shown as 0). session scratchpad `stage3/out/s3b-admin`/report.txt or findings.txt | TF-153…TF-157 |
| 3 S Across everything (S1 role matrix sweep, S2 UI sweep, S3–S8) | done | 2026-11-21 | 2026-11-21 | L | S1 matrix: 1,507 calls, every row matches for 11 personas apart from TF-012/013/014/015/030/081 (`matrix.mjs` ready to port). S2–S8 (s3b-ux): S3 edit lost on session expiry, S4, S6 (double-click makes 2 share links and 2 exports: TF-073), S8 contrast fail. session scratchpad `stage3/out/s3a-matrix`/report.txt or findings.txt | TF-090…TF-092, TF-145…TF-152 |
| 3 Pilot acceptance walk (§7.4) | partly (passive) | 2026-11-21 | 2026-11-21 | P | Passive only, on the owner's word (no SSH, no pilot accounts): `check-public-edge.py` passed, TLS valid to 2027-02-14, headers (confirms TF-046), TF-011 404s. The account-based walk (A1, A6, D1, E2, F1, G3, J1, J4, M1, Q1, Q2, R1) ran in full on L on the deployed build `fc78b12` instead. Session scratchpad `stage3/out/s3c-pilot/notes.md` | TF-083, TF-084 |
| 4.1 Performance | done | 2026-11-22 | 2026-11-22 | L, H | Alone on the machine. All §P targets pass except: lines page p95 on a 20,500-line run with 20 users 2,868 ms (TF-179) and queue wait behind one parse 5.4 s (one engine slot, TF-180). Engine Duplex 3.0 / 0.7 s; federated pair 15.7 / 5.8 s; CRUD p95 ≤ 133 ms; 20k sheet switch ≤ 47 ms, 0 frames > 50 ms. TF-065 confirmed. Session scratchpad `stage4/out/s4-perf/` | TF-179…TF-181 |
| 4.2 Accessibility | done | 2026-11-21 | 2026-11-21 | L | 95 axe scans (39 screens × light/dark + 17 states), 79 clean; 1 critical (`label`), serious: color-contrast 10 scans, target-size 4, label-content-name-mismatch 2. FL-1 by keyboard passes; FL-2/FL-11 keyboard gaps. NVDA spot check pending (owner). Session scratchpad `stage4/out/s4-a11y/` | TF-158…TF-170 |
| 4.3 Security | done | 2026-11-21 | 2026-11-21 | L | Passed: sign-in limits, fixation, sign-out replay, takeover event, CSRF on 15 Origin spellings, signed URLs (refused at +310 s, key swap, body size), no secrets in repo or images, stored script strings inert. New: unbounded names → API out of memory (TF-174). Dependency audit: prod npm 0, engine requirements 0, 12 moderate dev-only npm items, a stale local venv (`opentelemetry-api` CVE), Maven check not run. xlsx bomb left to 4.4. Session scratchpad `stage4/out/s4-security/`, `stage4/dependency-audit.txt` | TF-174…TF-178 |
| 4.4 Resilience and operations | done | 2026-11-22 | 2026-11-22 | L | Alone on the machine; destructive on L only. Worker kill mid-job: re-queued, succeeded on attempt 2 (22.6 s); graceful restart fine; engine down 60 s → job failed after 3 attempts at 44 s. API restart during SSE: the page never reconnects, an edit made meanwhile is lost. DB restart 0.7 s: requests survive, the running parse re-queued after 55 s. No migrations since v1.0.0 (a newer fake migration row didn't stop the image). Backup 15 s, restore ~1.5 min + storage 70 s, data identical (backups not scheduled: known). Request ids in JSON logs, not in error bodies. TF-039 and TF-174 confirmed (OOM kills). Stack left healthy, `local:check` passed. Session scratchpad `stage4/out/s4-resilience/` | TF-182… |
| 4.5 Compatibility | done | 2026-11-21 | 2026-11-21 | L | Chromium 158, Firefox 159, WebKit 27.2, Edge 158: FL-1 and FL-2 pass in all, FL-11 fails in all (TF-085); same counts and layout everywhere; WebGL-off has no fallback in any (TF-106); 768 px and phone widths. Session scratchpad `stage4/out/s4-compat/` | TF-171…TF-173 |
| 4.6 Pricing boundary | done | 2026-11-21 | 2026-11-21 | L | Pass: ArchUnit, BR-41 lint, `openapi-pricing.yaml` lint, `MODULE_PRICING=1` refused by `next.config`, `modules.ts` registers nothing, no pricing string or nav in the core. Session scratchpad `stage4/pricing-boundary.txt` | — |
| 4.7 PoC smoke | n/a | | | — | Removed by FE-046 (tag `poc-final`); only the leftover-references check in §9.7 | |
| 5 Triage | done | 2026-11-22 | 2026-11-22 | — | 186 findings routed (section "Triage"): 134 fix now in six batches (3 S1, 16 S2, 74 S3, 41 S4), 20 owner questions (Q42–Q61 in `docs/product/open-questions.md`), 22 deferred (TS-005, TS-006, FE-034, EN-imperial, FE-048), 8 duplicates, 1 refuted, 2 verified. TF-039 and TF-174 raised to S1. §C has the live result of every criterion | — |
| 6 Fix and retest | in progress | 2026-11-22 | — | `1be66cb` (S1s, deployed) | B1: the three S1s fixed, verified and deployed first (`d5e0d8b`, `5e69e2c`, `1be66cb`, gate on a clean clone: npm test, engine 217, JUnit, contract 184, scenarios, browser smoke 13/13); the other B1 findings and parts of B4/B6 committed locally (`4d65638`…`7bd2ae4`), statuses in §F. New: TF-187 (parallel workbook reads), TF-188 (smoke flake) | — |
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

## Triage (Stage 5, 2026-11-22)

186 findings (TF-001…TF-186). After triage: **2 verified** (TF-001, TF-011), **1 refuted** (TF-069), **8 duplicates**
(TF-126 and TF-138 → TF-097, TF-148 → TF-118, TF-155 → TF-115, TF-150 → TF-162, TF-129 → TF-098, TF-145 → TF-127,
TF-132 → TF-005), **20 owner questions** (Q42–Q61, one of them part of TF-012), **22 deferred** to named tasks
(TS-005 browser coverage, TS-006 performance in CI, FE-034 global search, EN-imperial, FE-048 old runs), and the rest
**fix now** in six batches, worked in this order in Stage 6. Severities raised: TF-039 and TF-174 to S1 (any signed-in
user can crash a shared component for every org, confirmed live). Known limitations re-checked: none of the open
findings is already listed as a known limitation except where its Route says so (TF-065 corrects the wording of one).

| Batch | Scope | Findings |
|---|---|---|
| B1 | S1/S2 and what hits the deployed pilot now | TF-085, TF-174, TF-039, TF-071, TF-182, TF-183, TF-029, TF-049, TF-093, TF-102, TF-125, TF-133, TF-134, TF-135, TF-136, TF-158, TF-159, TF-179, TF-021 |
| B2 | Java correctness, security, audit (S3/S4) | TF-012, TF-040, TF-041, TF-042, TF-043, TF-044, TF-046, TF-074, TF-075, TF-076, TF-032, TF-033, TF-031, TF-034, TF-094, TF-097, TF-113, TF-114, TF-115, TF-116, TF-118, TF-119, TF-121, TF-137, TF-175, TF-176, TF-184, TF-185, TF-083, TF-087, TF-091, TF-030, TF-013, TF-015, TF-128, TF-153, TF-154 |
| B3 | app UX, states, a11y, i18n (S3/S4) | TF-017, TF-018, TF-019, TF-020, TF-022, TF-023, TF-024, TF-025, TF-026, TF-073, TF-077, TF-098, TF-103, TF-104, TF-106, TF-107, TF-110, TF-117, TF-120, TF-127, TF-146, TF-147, TF-149, TF-160, TF-161, TF-162, TF-163, TF-164, TF-165, TF-166, TF-167, TF-168, TF-169, TF-171, TF-172 |
| B4 | engine and exports (S3/S4) | TF-051, TF-052, TF-053, TF-054, TF-055, TF-058, TF-059, TF-060, TF-105, TF-108, TF-177, TF-037, TF-036 |
| B5 | docs, ops, contract wording | TF-002, TF-003, TF-027, TF-047, TF-048, TF-061, TF-062, TF-063, TF-064, TF-065, TF-066, TF-067, TF-068, TF-070, TF-072, TF-079, TF-082, TF-084, TF-141, TF-181 |
| B6 | API-level test gaps (scenarios, JUnit, engine tests) | TF-004, TF-005, TF-008, TF-009, TF-010, TF-078, TF-092, TF-100, TF-101, TF-186 |
| B7 | owner answers (P54, 2026-11-22, added in Stage 6: the first option of Q42–Q62) | TF-012 (c, d), TF-014, TF-028, TF-035, TF-036 (Q62), TF-038, TF-045, TF-056, TF-057, TF-080, TF-081, TF-086, TF-090, TF-096, TF-109, TF-122, TF-139, TF-140, TF-156, TF-173, TF-180 |

Within a batch: S1 first, then S2, then by area so fix agents get disjoint files. Each fix comes with a test that fails
before it (test-plan §11.2); a test gap is fixed by writing the test. The deferred browser-coverage task (TS-005) takes
the passing journeys' scripts from the session scratchpad (`stage3/out/*`, `stage4/out/*`) as its starting point.

## Untested permission rows and transitions (Stage 2 R2, R3; for Stage 6)

**Permission rows with no automated test (R2)** — for a data-driven `tests/scenarios/permissions-matrix.test.ts` (test-plan S1):
- Org: admin can't delete org / see billing / PATCH someone to owner (only "admins can't invite owners" tested); library_editor and member creating projects; library_editor finishing setup (allowed); promote a decision (no role test); admin reading the org audit (allowed).
- Project: non-lead (estimator, approver, viewer) refused on edit settings, archive, manage members; answering questions as approver or viewer; editing lines, manual lines, Excel import as approver or viewer; save (approval off) as approver or viewer; submit as approver or viewer; request changes and save-approved as estimator; approver confirming with approval on (only `not_saved` asserted); reopen as non-lead; project audit as estimator (refused) and approver (allowed); org owners and admins acting as lead on a project they're not a member of.
- Archived: only `PATCH /projects/{id}` tested; no other write endpoint, no full `permissions` key set (TF-012).
- Platform admin: canonical paths only (TF-011).
- SSE: no test that a project event is withheld from an org member with no project role.

**Transitions and rules with no automated test (R3):**
- ModelVersion: `awaiting_upload → failed` 24 h and `failed → queued` retry are `it.todo` (`state-machines.test.ts:24-25`); parse cancelled while queued; delete rules (used / unused); `invalid_transition` on retry or delete.
- Job: only queued → cancelled (`boqs.test.ts:195`); not `running → cancelled`, automatic retry (attempts < 3), lost-heartbeat re-queue, cancelling a finished job (409).
- Run: `running → failed`, `running → cancelled`, "currentRunId stays on a failure".
- BoqRevision: `approved → draft` through a decision (`questions.test.ts:96` asserts only `reopenedRevisions: []`) and through an input change; `in_review → draft` through an input change (BR-23 only with a line edit); the cross-BoQ decision case (TF-029); BR-20 only by the lead (TF-010); approval switched off during review.
- BR-26 Z → AA rollover; BR-28 frozen positions (known, F06-AC9); BR-29 "earlier editor told" (known).
- BR-51: no audit test for submit, approve, request changes, confirm, job cancel.
- BR-61: reading, exporting, answering once `processingMinutesPerMonth` is exhausted (TF-005).
- BR-62: usage events of failed or cancelled jobs, previews, retried jobs (TF-009, TF-036).
- ShareLink: "suspended → active only if not expired"; reviving an expired link by PATCH (TF-038).
- Error bodies: `invalid_transition` naming the current state (TF-030; `known-limitations.md:120`).

## Stage 3–4 live confirmations and refutations of earlier findings

One line per agent observation, as reported (agent in brackets). Triage (Stage 5) turns them into statuses.

- TF-033 confirms: excluded line missing from public /lines (41 vs 42 for members), detail 404; member Excel has it on "Excluded lines". (s3a-shares)
- TF-040 confirms + wider: name =HYPERLINK(...) accepted (201); Inputs!B8 data type f; also Lines sheet headers H1:J1 ("=HYPERLINK(...) code", invalid formulas), also in the public share Excel; Library template clean. (s3a-shares)
- TF-041 confirms: .xlsm accepted by code-list read 200, template import 200, edits import 202. (s3a-shares)
- TF-042 confirms: docker logs hold raw share tokens (GET /api/v1/public/shares/<token>/lines) and raw invitation tokens. (s3a-shares)
- TF-046 confirms (L): /sign-in, /{org}, /invite/x no nosniff, no frame protection, X-Powered-By; /invite/x no no-referrer/noindex; /s/* fine; API sends nosniff + X-Frame-Options DENY. (s3a-shares)
- TF-049 confirms: sheet E.01.1 (Skylight moved to top) … E.01.7, manual at E.01.3; Excel writes .2 .4 .5 .6 .7 .1 .3. (s3a-shares)
- TF-051 partial: confirms description-only row dropped + next row loses group (codes {}); confirms second import same row → id xlsx-15 → 409 duplicate_id, whole batch fails; REFUTES bad Ref fails batch: Z.99 accepted (200), line shows "Z.99 To be classified". (s3a-shares)
- TF-054 partial: only Amount =SUM(F…) subtotals, no quantity subtotal; numeric sort not showable with this code list. (s3a-shares)
- TF-055 confirms: 0.4 item manual line number format "0". (s3a-shares)
- TF-058 confirms: A4 "Review work not in the models. This bill includes 4 manual line(s)." (s3a-shares)
- TF-071 confirms: 25 MB edits import / code-list read → 401 unauthenticated; via app proxy ECONNABORTED; session stays valid. (s3a-shares)
- TF-038 confirms create half: expiresAt in the past → 201 status expired. (s3a-shares)
- TF-047 confirms: share 429 without Retry-After. (s3a-shares)
- TF-026 confirms: org Share links page blank for an estimator (API 403). (s3a-shares)
- TF-029 confirms: decision on BoQ "Other" (name:layer_material:Plasterboard, no project dictionary) -> reopenedRevisions [] (also dryRun); Main approved with pendingChanges [decisions]; approver save 409 not_ready {pendingChanges:[decisions], reason: pending}; regenerate 409 revision_in_review; only way out withdraw/regenerate/resubmit/approve. (s3a-versions)
- TF-030 confirms: no details on invalid_transition for approve on draft, submit in review, confirm on confirmed, reopen on working, cancel finished job; viewer withdraw -> 409 invalid_transition not 403. (s3a-versions)
- TF-032 confirms: DELETE used version 204; regenerate 400 invalid_inputs "A selected model version is unavailable in this project."; old runs readable. (s3a-versions)
- TF-034 confirms: no audit for job cancel (queued/running), failed run (only run.created), truncated IFC parse_error (only created/queued). (s3a-versions)
- TF-057 confirms: frozen export failed after 3 attempts; version issued, exportIds -> storage_key NULL; download 404; POST /runs/{frozen}/exports returns the same failed job; Versions tab still offers Excel. (s3a-versions)
- TF-052 confirms both: move to D.03 then classification v2 without D.03 -> falls back to D.02 (source map), no overridden/note/warning/question; reorder-only edit on a vanished line -> no orphan_override (the qty edit on another vanished line does raise one). (s3a-versions)
- TF-056 confirms: formwork-walls m2 153.8 baseline, 153.8 after excluding foundation wall, 24.97 after editing it to 0. (s3a-versions)
- TF-004 gap confirmed, behaviour correct: after v1 -> v2 none of 4 answered questions re-asked, no new open; diff = engine fixture (5 lines, 3 elements). (s3a-versions)
- TF-008 gap confirmed, behaviour correct: 4 edits applied on the v2 run; change report doesn't list them (N1). (s3a-versions)
- TF-037 confirms, runs too: failed run shows untranslated engine_error "Engine job failed"; catalogue has only engine_unavailable, run_error. (s3a-versions)
- TF-017 confirms: sheet "Loading lines..." text (aria-busy p), no skeleton; lines 503 -> "Something went wrong. Try again." with no retry button. shots/tf018-sheet-error.png. (s3a-sheet)
- TF-018 confirms: models/BoQs delayed 4 s -> "No models yet." / "No BoQs yet." while loading; models 500 -> "No models yet.", no error. shots/tf018-overview-*.png. (s3a-sheet)
- TF-021 confirms: org decimal "," thousands "." date dd.MM.yyyy -> sheet subtotal "1,188.88", detail "683.16 m2", Versions "Nov 21, 2026"; default thousands-space not applied either ("1,218.93"); Excel Cover JSON. (s3a-sheet)
- TF-022 confirms: edited cell ::after border-top rgb(232,89,12) (--status-attention = --orange) triangle; presence avatar orange with paper text rgb(242,237,227); orange inset editing marker. Changes tag not measured. (s3a-sheet)
- TF-023 confirms: Item code editor aria-label "item"; storeys joined ", " (not decisive in English). (s3a-sheet)
- TF-049 confirms: drag party wall -> D.02.2; Excel keeps engine order, No. D.02.1, .3, .4, .5, .2; sheet/API/regeneration keep the reorder. (s3a-sheet)
- TF-052 confirms + worse: window moved to trades "07", classification version without 07 published, generated: engine put it back in 04 via map, no overridden/warning/question/log; the override still exists; the sheet shows it in an untitled group "07" (07.1) while the detail says "engine: 04": sheet and Excel/engine disagree. tf052.json, shots/tf052-casement.png. (s3a-sheet)
- TF-065 not decided: one request /runs/{id}/lines?limit=20000, client grouping; 41 lines never exercise the cursor loop. (s3a-sheet)
- TF-016 confirms: no search in the top bar on /{org}. (s3a-accounts)
- TF-024 neither: live behaviour correct (owner "Upgrade", Free admin "Ask your owner"); code issue not observable live. (s3a-accounts)
- TF-026 confirms: /settings/shares renders only the nav for library_editor and member; billing/usage/audit say "Only ... owners/admins". (s3a-accounts)
- TF-035 confirms: a Free event moved to now-31d stayed listed until the hourly pruneAudit deleted the row at 22:02:54 UTC. (s3a-accounts)
- TF-042 confirms: API log contains GET /api/v1/invitations/<43-char token> 200; 209 lines match invitations/. (s3a-accounts)
- TF-043 confirms: 25 resends in 10 s all 200, 25 member.invitation_resent events, 26 outbox rows (5 sent, 21 cancelled); 5 mails only because each resend cancels the queued one. (s3a-accounts)
- TF-044 confirms: set-password, 3 sign-ins, failed sign-in, reset, sign-out wrote no audit_events rows. (s3a-accounts)
- TF-047 confirms: per-email lockout 429 auth_throttled without Retry-After or RateLimit-*. (s3a-accounts)
- TF-069 REFUTES: set-password refuses 14, 129, 200, 257 chars with the 15-128 message; 15 and 128 accepted; 100 emoji (200 UTF-16 units) accepted; code-point limit matches the message. (s3a-accounts)
- TF-071 confirms: signed in, GET /notifications?limit=5000 -> 401 unauthenticated "Sign in to continue."; limit=abc -> 400; session stays valid. (s3a-accounts)
- TF-072 confirms: 402 body {"code":"limit_reached","details":{"current":2,"limit":"seats","max":2}}. (s3a-accounts)
- TF-031 · confirms · D8: two versions of my own org had `created_at` moved back 25 h with L.sql (21:44Z). Late `complete` on the uploaded one → 200 `queued`, parsed to `ready` (accepted). The hourly sweep ran at 22:02:44Z: the never-uploaded one got `deleted_at` set, `status` still `awaiting_upload`, `error` null, `GET` → 404, gone from the list, no audit event (only `model_version.created`). OUT/c1-d8setup.log, OUT/d8-check.log. (s3b-projects)
- TF-032 · confirms · D6: Tower BoQ run on Architecture v1 (`usedBy` lists it); `DELETE /model-versions/{v1}` → 204; `GET` → 404; regenerate → `400 invalid_inputs` "A selected model version is unavailable in this project." (the old run's lines still read 200). OUT/d6.log. (s3b-projects)
- TF-036 · confirms (a), (b); (c) not observed · (a) a parse cancelled while queued (`POST /jobs/{id}/cancel` right after complete): job `cancelled`, `started_at` null, no usage_events row. (b) sample project: parse and run jobs `metered = false`, no usage rows, usage 0 min. A failed parse (truncated file) does write a usage row (`parse|59|failed`). (c) needs a retryable worker failure: not produced. OUT/d9-api.log, OUT/b-free.log. (s3b-projects)
- TF-037 · confirms · cancelling a queued parse sets the version `failed` with `error.code = "cancelled"` ("The parse was cancelled.") — a queued → failed transition the diagram lacks. Also: a truncated IFC (first 300 kB of the Duplex) fails as `parse_error` "Could not parse IFC model" (retryable false), never `corrupt_file` as F03 §4 and the test plan expect; the UI says "The model could not be processed." OUT/d9-api.log, OUT/d-api.log. (s3b-projects)
- TF-076 · confirms · free org with 60.11 min used (one usage_events row inserted for my own org with L.sql, removed afterwards): `POST /models/{m}/versions` → 201, the 2.38 MB PUT to storage → 200, then `complete` → `402 processingMinutesPerMonth` and the version stays `awaiting_upload`. Run → 402, preset preview → 402. OUT/o1.log. (s3b-projects)
- TF-074 · confirms · `POST /projects/{p}/models {"scope":{"exlude":[{"ifcClass":"IfcFurnishingElement"}]}}` → 201, stored as given; `PATCH /models/{id}` with the same typo → 200. The BoQ setup tab then shows the model as "1 scope rule" (the typo counted as a rule). OUT/d-api2.log, OUT/d7-ui.log, OUT/shots/d7-03-setup-tab.png. (s3b-projects)
- TF-018 · confirms · as estimator, Tower overview with `/projects/*/models` and `/boqs` held pending (page.route): "No models yet." / "No BoQs yet."; with both answering 500: the same text, no error shown. OUT/b-projects-tf018.log, OUT/shots/tf018-01-pending.png, tf018-02-error.png. (s3b-projects)
- TF-020 · confirms · viewer on the failed (parse_error) version page sees "Try again"; clicking → `403` and the toast "You don't have permission to do this." The estimator also sees "Try again" on this non-retryable error, and the API answers `409 invalid_transition` ("Only a failed version with a retryable error can be retried."). OUT/b-models-d2.log, OUT/d6.log, OUT/shots/tf020-viewer-retry.png, tf020-viewer-after-click.png. (s3b-projects)
- TF-025 · confirms · a new project's overview: "No models yet." / "No BoQs yet." (no next action named); the models page's empty state is fine. OUT/b-free.log, OUT/shots/c2-02-first-project-overview.png. (s3b-projects)
- TF-005 · confirms · live on L every limit answers 402 `limit_reached` with its name: seats (2nd invite on free; a pending invitation counts), activeProjects (create and unarchive), maxModelVersionMb (50 MiB + 1 byte; exactly 50 MiB accepted), maxModelsPerBoq (create and PATCH inputs), processingMinutesPerMonth (complete, run, preview), libraryOrgPresets (2nd org rule set; per kind), approvalWorkflow (approvalRequired, fourEyes settings), shareLinks (with a `shareLinks:false` override set in my org's subscriptions row by L.sql, then removed); exportWatermark applied ("Made with boqlet" row). Still without automated tests: libraryOrgPresets, processingMinutesPerMonth, shareLinks (plus the items in my O test-gap finding). limit_events rows written for each. OUT/o1.log. (s3b-projects)
- TF-012 · confirms (a) · on the archived Annex project, the lead's `POST /boqs/{b}/archive` → 200 (BoQ archived) while every other write tried (18: project, members, models, versions, BoQ, inputs, run, decision, override, manual item, share link, project preset, issue, confirm) answered `409 project_archived`; lead's `permissions.archive` stays true. OUT/c4b.log, OUT/c4.log. (s3b-projects)
- TF-014 · confirms · library editor libA (viewer on project "Duplex One") previews her draft rule set on its Duplex: POST /presets/{id}/preview -> 403 {"code":"forbidden","message":"Your project role does not allow this."}; the picker offers that project and the panel says "You don't have permission to do this."; the same preview on a project where she is estimator -> 202. OUT\k1.json, shots\k1-01-preview-p1-viewer.png (s3b-library)
- TF-019 · confirms · wizard in progress, GET /presets/{id} answered 500 via page.route: /{org}/setup and /{org} stay aria-busy with an empty main for 15 s+, no message, no retry (the dashboard is gated by it). OUT\tf019.json, shots\tf019-wizard-blocked.png (s3b-library)
- TF-023 · confirms · pseudo-locale en-XA (cookie boqlet-locale): /library/rule_set/new shows "[ÑÓŢÉŠ ~~] ([ÓÞŢÍÓÑÁĻ ~~])" and "[ƁÁŠÉÐ ÓÑ ~~] ([ÓÞŢÍÓÑÁĻ ~~])"; the New BoQ dialog "[ÐÉŠÇŔÍÞŢÍÓÑ ~~~] ([ÓÞŢÍÓÑÁĻ ~~])": the space and parentheses are literal. OUT\tf023.json, shots\tf023-new-rule-set.png, tf023-new-boq.png (s3b-library)
- TF-029 · confirms · approval on; BoQ "Questions" approved; an estimator answers a question of another BoQ: dryRun and write both say reopenedRevisions [], the approved revision then has pendingChanges ["decisions"], issue -> 409 not_ready {"pendingChanges":["decisions"],"reason":"pending"}, generate -> 409 revision_in_review; only withdraw (POST /revisions/{id}/reopen) gets out. OUT\tf029.json, f5b.json (s3b-library)
- TF-041 · confirms · POST /codelists/read with the same workbook named codes.xlsm (macro-enabled content type) -> 200, sheets read; the import picker accepts ".xlsx,.xlsm,.csv,.tsv,.txt" (code-import.tsx:158). OUT\tf041.json (s3b-library)
- TF-052 · confirms · P2 line "walls | Interior - Partition (92mm Stud)…" moved to 01.01.02 (source decision); classification v2 without 01.01.02 selected; regenerate: the line silently back on 01.01.01 (source map), overridden null, notes [], no question, no warning. OUT\tf052.json (also seen by s3a-versions, orphan.json part B) (s3b-library)
- TF-053 · confirms · two architecture models (Duplex + GUID-shifted copy): overlap ids "overlap:architecture/Duplex_copy_A.ifc|architecture/Ifc2x3_Duplex_Architecture.ifc:IfcWall"; walls answered; new version of the copy uploaded as Duplex_copy_A_rev3.ifc: the ids become "…/Duplex_copy_A_rev3.ifc|…" and all 13 overlap questions (walls included) are open again. Note: a byte-identical re-upload under a new name keeps the old name (the parse is reused), so the bug needs changed content to show. OUT\tf053.json (s3b-library)
- TF-077 · confirms · the publish dialog with the server's real bodies injected (page.route): no_draft, change_note_required and preset_archived all show "Something went wrong. Try again."; for the two 409s a toast also says "Someone else changed this in the meantime. The latest version is shown now." (misleading for preset_archived). Live API returns them as described: change_note_required 400, preset_archived 409. In normal use the UI mostly avoids them (empty note disables Publish; realtime closes the dialog / disables the editor after an external publish or archive). OUT\tf077.json, tf077b.json, k2.json, shots\tf077-*.png (s3b-library)
- TF-039 · not run (as instructed: Stage 4 owns it) (s3b-library)
- TF-007 · confirms · no rendered pseudo-locale test exists; p1.mjs is a working candidate (cookie boqlet-locale=en-XA, scans innerText + placeholder/aria-label/title/alt/option for text outside [ … ~] markers, filters known data; 47 screens/states incl. public pages) - p1-results.json, p1-untranslated.txt (s3b-ux)
- TF-017 · confirms · page.route 500/abort on data calls: dashboard, projects, library, notifications, members show only "Something went wrong. Try again." / "The server could not be reached…" with no Retry button; /account silently drops the email-preference list; the share page shows "This link is no longer available" for 500, network failure and 429 rate_limited; under a 4 s delay only the dashboard has a skeleton, project pages show an empty aria-busy box, projects/notifications/share page show nothing (share page body empty) - s4.mjs, s4.log, s4-results.json, shots/s4-data500-*.png, s4-slow-*.png, s4-share429-share.png (s3b-ux)
- TF-018 · confirms · overview with /projects/{p}/models and /boqs answering 500, and with them delayed 5 s: "No models yet." and "No BoQs yet.", no error - tf018.mjs, tf018-results.json, shots/tf018-fail.png, tf018-slow.png (s3b-ux)
- TF-019 · confirms (with a different symptom for /me) · GET /projects/{p} 500 → overview, models, boqs, sheet, decisions stay an empty aria-busy box forever (9 s+); /me 500 → every org page and /account show the sign-in form (not the 404 page the review predicted, but still no error/retry, and a signed-in user is told to sign in) - s4-results.json (project500, me500), shots/s4-project500-*.png, shots/s4-me500-dashboard.png (s3b-ux)
- TF-021 · confirms · default org (thousands U+202F) and org numberFormat {",","."} + dateFormat dd.MM.yyyy and project locale de-DE all render the sheet as "123,456,789.123" and dates as "Nov 21, 2026, 10:59 PM" (sheet, versions tab, model version page, projects list, share page); only en/en-XA ship, so the UI-locale half of F15-AC2 can't be shown (en-XA formats like en) - p23.mjs, p23-results.json, shots/p23-*.png (s3b-ux)
- TF-022 · confirms (partly) · orange presence avatar with paper initials: axe color-contrast 3.06:1 (#f2ede3 on #e8590c) on the sheet in dark theme; no small orange text found on 33 screens × 2 themes by computed style (the Changes tab had no "changed" rows in this run, so that tag wasn't seen); the unread bell badge is orange too - s8.mjs, s8-results.json, shots/s8-dark-boq-sheet.png (s3b-ux)
- TF-025 · confirms · a new project's overview says "No models yet." / "No BoQs yet." with no next action - shots/s5-project 255.png, tf018 shots (s3b-ux)
- TF-026 · confirms (shares half) · /{org}/settings/shares renders nothing below the tabs for library_editor, member, lead, estimator, approver, viewer while usage/billing/audit show a "not allowed" note - s2-summary.txt, shots/s2-EST-settings-shares.png; the public-page render-error half was not triggered live (s3b-ux)
- TF-028 · confirms · viewer sees Questions, Log and Setup tabs (read-only) and Decisions/Library/Settings in the project nav; Changes is hidden - s2-summary.txt (VIEW), shots/s2-VIEW-boq-questions.png (s3b-ux)
- TF-073 · confirms · the app sends no Idempotency-Key on any create (all POSTs `key=null`); a human-speed double click (60 ms and 150 ms) on "Create share link" creates 2 links and on the sheet's "Excel" creates 2 exports (exports rows 22:32:21/22, 22:32:36/37); Generate, Save version and Invite send 2 POSTs but the server's state checks leave 1 run, 1 saved version, 1 invitation and 1 email; a 0 ms synthetic dblclick also creates 2 projects and 2 BoQs (60/150 ms do not). The server side works: the same UUID key replays the first answer (1 run/share/export/invite, 1 email) - s6.mjs, s6.log, s6b.mjs, s6b-results.json (s3b-ux)
- TF-077 · confirms · real 409 public_links_off on Create share link shows "Something went wrong. Try again."; no_run, run_not_ready (409) and rate_limited (429) replayed on the sheet's Excel button show the same generic text, and the 409s also toast "Someone else changed this in the meantime…" (the generic 409 handler already reported by s3a-accounts N5) - tf077.mjs, tf077-results.json, shots/tf077-*.png (s3b-ux)
- TF-023 · not checked · the New BoQ dialog and code-cell editor were not opened in the pseudo-locale run (composed labels would still carry pseudo markers, so the scan can't see them) (s3b-ux)
- TF-081 · confirms · native mode, no cookie: every /admin/* operation (13 + /pricing/admin/vendors) answers 404 (r1-api.json; /pricing/admin/vendors answers 401 instead, inconsistent with /admin/*). Admin with an expired session (sessions.last_seen_at moved 13 h back on my own admin's row): GET /me and /sessions/current -> 401 session_expired, GET /admin/overview and /admin/orgs -> 404 not_found (tf081.json). In the browser: a fresh load of /admin/orgs goes to sign-in (the AuthGate asks /sessions/current first), but with the console open the next admin query (typing in search) answers 404 and the console renders "404 Not found. This page doesn't exist, or you don't have access to it." inside the admin shell instead of a sign-in prompt; only a full navigation then reaches sign-in (tf081-midsession.json, shots/tf081-midsession.png). Side note: in the browser an anonymous visitor on /admin, /admin/orgs, … is redirected to /sign-in?returnTo=%2Fadmin… while /admin/vendors and /admin/nope answer a 404 document, so the console's routes are discoverable without signing in (b1-screens.json r1). (s3b-admin)
- TF-011 · confirms (fix holds) · as an org owner GET /%61dmin/overview, /%61dmin/orgs, /ad%6din/users and POST /%61dmin/orgs/{id}/notes -> 404; as the platform admin the same spellings -> 200; /%2561dmin/orgs -> 401 for both (firewall, the known 401-on-rejected-path behaviour); org state unchanged after the probes (active|free|{}|0 notes) (r1-api.json). (s3b-admin)
- TF-017 · confirms · admin orgs CSV with the request answered 500: no toast, no alert, nothing on the page (shots/a-orgs-csv-error.png, b1-screens.json "tf017_csvErrorVisible"). Also in the console: orgs list and org detail errors show only "Something went wrong. Try again." with no Retry button (shots/a-orgs-error.png, a-detail-error.png); overview while loading is an empty aria-busy div, no skeleton (shots/a-overview-loading.png). (s3b-admin)
- TF-022 · confirms · org detail with a seats override: the "OVERRIDE" label is 11px, weight 500, color rgb(232,89,12) (--orange) as text on the paper background, about 3.3-3.6:1 (below 4.5:1 for small text) (b1-screens.json "tf022", shots/a-detail-A.png). (s3b-admin)
- TF-035 · confirms (code + my orgs' data) · Maintenance.pruneAudit (Maintenance.java:80-90, hourly, BOQLET_RETENTION_POLL_MS) deletes audit_events older than the plan's auditLogRetentionDays for every event with an org_id, the platform admin's mirrored actions included (org.plan_changed, org.trial_changed, org.entitlements_overridden, org.suspended/reactivated). My Free org holds 21 events, 4 by the platform admin, all due after 30 days. Extra consequence: the admin console's "Plan changes" history is read from those audit rows (AdminOrganisations.detail planHistory query), so on a 30-day plan the plan history and its reasons vanish from the console too. admin.* events (org_id null) and limit_events are not pruned. Not waited for live. (s3b-admin)
- TF-077 · confirms · override dialog with value -3: the client accepts it (parseOverrideValue allows negatives), the API answers 400 invalid_body "Invalid entitlement override for seats.", the UI shows only "Something went wrong. Try again." and the dialog stays open (b2-actions.json, shots/b2-override-refused.png). (s3b-admin)
- TF-022 · confirms · live, axe color-contrast (serious): presence avatars = paper initials on orange 3.06:1 (11 px), light and dark, when a second person (org admin s4-a11y-second-…) has the same BoQ open (OUT/states.txt, OUT/states-axe.json, OUT/shots/states-light-presence.png); Changes tab "Changed" tags = orange text on paper 3.06:1, 6 nodes, light (OUT/states2.txt, OUT/states2-axe.json, OUT/shots/states2-light-changes.png). In dark the "Changed" tag passes (5.1) but "Added"/"Removed" fail: filed as new (raw --blue/--red not themed). Notification badge uses ink on orange (5.1) and passes. (s4-a11y)
- TF-023 · confirms · live: the sheet's Item (code) cell editor is `<input role="combobox" aria-label="item" data-testid="cell-editor">`; aria tree: `combobox "item" [expanded]` (BoQ grouped by ACME cost codes; OUT/states2.txt, OUT/shots/tf023-code-editor.png, script OUT/codeeditor.mjs). (s4-a11y)
- TF-017 · confirms · live with the API delayed 4 s / answering 503 (page.route): while loading, S12a and S05 have one empty `<div aria-busy="true">` (S05 also one skeleton), projects list, S08 models, S26 notifications and S19 Library show nothing and announce nothing (no role=status); on error each shows `role="alert"` "Something went wrong. Try again." with no Retry button (OUT/loading.txt, OUT/shots/tf017-*.png, script OUT/loading.mjs). (s4-a11y)
- TF-040 · confirms (internal export) / refutes (public share part) · rule-set preset named `=HYPERLINK("https://example.invalid/s4","S4 formula") v2`, published and used, generate, export: Inputs!B5 data_type `f` (a live formula); everywhere else user text is written as strings (BoQ!B7, Lines!D2, Calculation!A5 type `s`). The public share's Excel (`/public/shares/{token}/export`) has sheets Cover, BoQ, Calculation, Lines, Log only: Inputs is deleted for shares (`export_xlsx.py:307-309`), so share viewers don't get the formula. Model file name `=1+1.ifc` is accepted by createModelVersion (`HYPERLINK(...)` names are refused by the file-name check). OUT/inject2.mjs, OUT/xlscan-tf040.log, export-formula-inputs.xlsx, export-share.xlsx. (s4-security)
- TF-041 · confirms · code list with a `xl/vbaProject.bin` part (macro-enabled content type), named `.xlsm` and `.xlsx`: `POST /codelists/read` 200 (rows returned), `POST /presets/{id}/template-import` 200, `POST /revisions/{id}/edits-import` 202 -> job succeeded; also a workbook with an external link (`externalLink1.xml`, target `file:///\\attacker.invalid\share\ext.xlsx`) accepted by all three; no macro runs, no link is followed (cached value only). OUT/mkxlsx.py, xl-run.mjs, xlsx.log. (s4-security)
- TF-042 · confirms · own share token in the access log: `GET /api/v1/public/shares/i0L26NC3…6x4/export 302 274 ms`; 618 lines with 40+-character invitation or share tokens in the last hour of `docker logs boqlet-local-api-1`. (s4-security)
- TF-045 · confirms · throwaway `curlimages/curl:8.11.1` on `boqlet-local_default`, no credentials: `GET http://engine:8788/health` 200; `POST /rpc/codelist-read {"fileKey":"orgs/<own org A>/exports/<id>/attempt-1/export.xlsx"}` 200 with the BoQ's rows (any key is readable by anyone on the backend network). Also: FastAPI `/docs` (Swagger UI, loads from cdn.jsdelivr.net) and `/openapi.json` are served by the worker; an unknown key answers 500 (not the intended 404). OUT/tf045.log. (s4-security)
- TF-046 · confirms (adds API detail) · L, `curl -D -`: app pages `/`, `/sign-in`, `/invite/abc`, `/{org}/projects`: no CSP, no nosniff, no frame options, `X-Powered-By: Next.js`; `/invite/abc` no Referrer-Policy and no noindex; `/s/abc` and `/sign-up` only the no-referrer (+ noindex for /s). The API (direct and through the app proxy) does send `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 0`, `Cache-Control: no-store` on every answer (Spring Security defaults): the "unconfirmed" part of TF-046 is confirmed; HSTS not testable over http. No CORS headers for a foreign Origin (preflight 401, no ACAO). `/actuator/prometheus` 404 on L. OUT/headers.log, csrf.log. (s4-security)
- TF-047 · confirms · per-email: attempts 2-12 wrong -> 401, 13th with the right password -> `429 auth_throttled`, no `Retry-After` (also for the upper-case and space-padded spellings of the email); per-source from a fresh container address: attempts 1-45 -> 401, 46-47 -> 429. OUT/auth.log, persource.log. (s4-security)
- TF-071 · confirms (new triggers) · signed in with a valid session: a name containing NUL -> `401 unauthenticated "Sign in to continue."` (PSQLException 0x00, unhandled); the 50k-decision request that hit OutOfMemoryError -> `401`; firewall-rejected paths `/api/v1/webhooks/billing/../../me` and `…/%2e%2e/%2e%2e/auth/sign-in` (curl --path-as-is) -> `401 "Sign in to continue."` instead of 400. OUT/bigjson.log, csrf.log. (s4-security)
- TF-074 · confirms · `POST /projects/{id}/models {"scope":{"exlude":[…]}}` -> 201 stored as given; `PATCH /revisions/{id} {"inputs":{"models":[{…,"scope":{"exlude":[…]}}]}}` -> 200 (while an unknown field next to `scope` -> 400 unknown_field). OUT/unknown.log. (s4-security)
- TF-075 · confirms · `POST /boqs/{id}/manual-items {"item":{…,"kind":"bogus","colour":1}}` -> 201; generate -> job failed `invalid_input "manual-item: invalid at 'kind': 'bogus' is not one of [...]"`; after removing the item generate succeeds. An unknown field alone (`colour` with a valid kind) is also stored (201). OUT/unknown.log, tf075.mjs. (s4-security)
- TF-065 · confirms · 20,500-line run: the sheet requests /runs/{id}/lines?limit=20000 (5.2 MB gzip, 2.7–3.2 s) then ?limit=20000&cursor=20000 (0.8 s) and shows data-lines=20500: every line is loaded, not capped at 20,000 (ui-d.mjs, measure.log 23:17:24) (s4-perf)
- TF-039 · confirms · live with the pilot's engine limits applied to the local engine (`docker update --memory 1536m --memory-swap 1536m --cpus 1 --restart unless-stopped`, reverted by recreating the container): a 9.1 MB xlsx whose sharedStrings.xml expands to 2.5 GiB (OUT/mkbomb.py), as an ordinary org owner: `POST /codelists/read` -> 503 engine_unavailable after 15.2 s (Java's rpc timeout) while the engine kept going at 100 % CPU, memory +40 MB/s, until it hit 1.5 GiB and was OOM-killed at +38 s (`docker events`: oom, die, start; RestartCount 1); `POST /presets/{own dictionary}/template-import` the same (OOM at +37 s, RestartCount 2). No 400 before decompressing. Other RPCs (a tiny csv to /codelists/read every 2-3 s) kept answering 200 during the 38 s (one shared CPU) and were down ~3 s per kill; with restart: unless-stopped it comes back by itself (without it, as in ops/local, it would stay down). Any in-flight HTTP-transport job dies with it. OUT/bomb.mjs, bomb-codelist.log, bomb-template.log, bomb-template-stats.log (s4-resilience)
- TF-174 · confirms · one attempt: `PATCH /me` with an 8 MiB name -> 200; `POST /projects/{id}/decisions?dryRun=true` with 50,000 decisions -> 401 unauthenticated after 69 s, API heap from 0.5 to 4.25 GiB, `java.lang.OutOfMemoryError: Java heap space` in the log at 23:55:10; liveness and readiness stayed UP throughout (nothing would restart it); recovered by itself (memory back to 450 MiB), name restored. OUT/tf174.mjs, tf174.log (s4-resilience)
- TF-071 · confirms · runtime case: with the database stopped, `PATCH /projects/{id}` answered `401 unauthenticated` (a signed-in user is told to sign in because of a server-side failure); the OOM above also ends as 401. OUT/db-stop.log (`s4res-db-stop-4`), tf174.log (s4-resilience)
- TF-017 · confirms · after a failed edit with the API stopped, the BoQ page is replaced by "Something went wrong. Try again." with no Retry button and doesn't recover after the API is back (8 s+), until a reload. OUT/shots/edit-down-2.png, edit-down.log (s4-resilience)

## C. Coverage of the acceptance criteria

Status: **pass (A)** + test · **pass (M)** + journey and evidence · **fail** + TF id · **n/a** +
reason · **owner**. Filled by the Stage 1 coverage audit (2026-11-21, `8d22de6`; tests read, not run by the
auditor; the lanes ran them). Prefixes: `sc/` tests/scenarios, `ct/` tests/contract, `ej/` apps/app/e2e-java, `et/`
engine/tests, `unit/` apps/app/src, NWT `NativeWorkerTest`, AFT `ApiFoundationTest`. Coverage statuses until the
live stages: **pass (A)**, **partial** (what is missing is named), **none**, **manual**, **owner**, **n/a**. Stage 3
turns partial, none and manual into pass (M) or fail with the journey's evidence.

### v1 criteria (`docs/product/scope-and-acceptance.md`)

| # | Criterion | Journeys | Automated evidence (Stage 1 audit) | Status |
|---|---|---|---|---|
| v1-1 | Duplex reproduction through the full stack (A) | 1C, 1F, E2 | sc/duplex "gives every hand-made line with its quantity and unit, and every count"; et/test_duplex `test_matches_hand_boq`, `test_counts`; et/test_worker `test_worker_duplex_http` | pass (A) · **live:** pass (M) E2 (click to lines 1.0 s) |
| v1-2 | Federation, no double counts, overlaps as questions (A) | H4, §9.1 | et/test_federation `test_overlap_question_and_answer`, `test_a_retagged_copy_adds_nothing`; sc/federation "gives one BoQ from both models with no element measured twice by one rule" (overlap question proven at engine level only) | pass (A) · **live:** pass (M) H4 (two models, toggleable) |
| v1-3 | Revision: exact change report, answers carried (A) | I1–I3, F7 | et/test_diff `test_duplex_revision_matches_known_changes` (engine only); NWT `verifyRevisedIfc` checks 3 diff elements, no lines; answers carried over after a swap untested | partial, TF-004 · **live:** pass (M) I1–I2 (exact fixture match, nothing re-asked) |
| v1-4 | Traceability in ≤ 2 clicks (M) | G2 | data only: sc/sheet "F06-AC2 every line's detail…", "F07-AC2 an element lists every line it feeds…"; the two clicks need a person (G2) | manual · **live:** pass (M) G2 (1 click in split view, 2 via Show in 3D) |
| v1-5 | Versions locked, confirmed BoQ refuses writes, approval (A) | J2–J4 | sc/versions "BR-20: a saved version refuses writes with 409 revision_locked, for every role" (tries only the lead), "working → confirmed…", "BR-24 four-eyes…"; NWT `verifyBoq` | pass (A), TF-010 · **live:** pass (M) J2–J4 (revision_locked for every role, boq_confirmed as owner) |
| v1-6 | Pricing module | — | — | n/a (P48) |
| v1-7 | Library: create, change, preview, publish (M) | K1–K3 | pieces: sc/library-publish "F10-AC1 / v1 criterion 7: three settings changed…", "BR-07: …"; no browser editor flow (K1–K3) | manual · **live:** pass (M) K1–K3 |
| v1-8 | Isolation (A) | S1, 1F | sc/isolation "answers 404 on the org, its projects, BoQs, models, library, audit, usage and attention"; NWT `verifyTenantIsolation`; sc/boqs, sc/models viewer rows | pass (A) · **live:** pass (M) S1 matrix (1,507 calls; isolation holds; TF-012/013 are role details) |
| v1-9 | Limits: `402 limit_reached` and the UI (A) | O1 | 402 + name: sc/orgs F01-AC3, sc/projects F02-AC1, sc/models F03-AC6, sc/boqs "maxModelsPerBoq"; UI: ej/orgs "F01-AC3 … limit dialog (402 seats)"; upgrade link not asserted; libraryOrgPresets, processingMinutesPerMonth, shareLinks untested | partial, TF-005 · **live:** pass (M) O1 (every limit 402 + name); UI shows raw keys TF-098 |
| v1-10 | Performance: nfr.md targets (A) | §9.1 | tests/perf/api.test.ts (CRUD p95, 500-line page) only with BOQLET_API_PERF, not in CI; engine_timing.py asserts nothing; et/test_diff 40k lines < 5 s; sc/boqs "F04-AC2 … < 10 s"; no UI perf | partial, TF-006 · **live:** fail TF-179, TF-180 (§P: lines page under load, queue wait behind a parse); the rest of §P passes |
| v1-11 | i18n pseudo-locale (A) | P1 | static only: unit/__tests__/no-literal-strings.test.ts, apps/app/scripts/pseudo-locale.test.mjs; no rendered pseudo-locale screen | partial, TF-007 · **live:** fail TF-145 (raw codes in en-XA) |
| v1-12 | First setup in < 15 min by a new person (M) | L10 | flow fragment: ej/accounts "F01-AC1: a new person signs up …" | owner · **live:** owner (script: session scratchpad `stage3/out/s3b-library/person-test-script.txt`) |
| v1-13 | Editing: live co-editing; edits survive versions; Excel round trip (A) | G3, G9, M4 | sc/co-editing "an edit is announced within a second…", ej/live "F06-AC10…"; sc/line-edits "regenerating applies them", "a new model version keeps them" (identical bytes); sc/edits-import "one quantity changed, one row moved, one deleted, one added…" | partial, TF-008 · **live:** fail TF-049 (reorders not in the Excel); co-editing and survival pass (G3, G9, M4) |
| v1-14 | Vendors | — | — | n/a (P48) |
| v1-15 | Share link: no account, minimal, revoke < 1 s (A) | Q1, Q2 | sc/shares "opens with no account…", "BR-56: no public response…", "revoking makes every public endpoint 404 at once"; ej/main-flow; NWT `verifySharing` (the 1 s not timed) | pass (A) · **live:** fail TF-085 (a line click crashes the share page) |
| v1-16 | Single session takeover (A) | A6 | ej/sessions "F01-AC5: a second browser is asked first…"; sc/state-machines "a second sign-in answers 409 session_active until takeover…"; AFT `inviteOnlyLoginAndSessionTakeover`; NativeAuthTest | pass (A) · **live:** fail TF-113 (no device, time or Cancel in the question); sign-out within 5 s passes |
| v1-17 | Admin console numbers match, no content (A) | R2, R5 | sc/admin "shows the same seats, active projects and processing minutes as each org's usage page", "no admin response contains project names…"; AFT `platformAdminSeesAccountMetadataAndCannotAccessTenantContent` | pass (A) · **live:** pass (M) R2, R5 |

### Feature acceptance criteria (`01-features/F*.md`, by position)

| Id | Criterion (short) | Journey | Automated evidence (Stage 1 audit) | Status |
|---|---|---|---|---|
| F01-AC1 | Sign up → org → dashboard < 1 min | A1 | ej/accounts "F01-AC1: a new person signs up … in under a minute"; sc/orgs "F01-AC1 a new user creates an org…" | pass (A) · **live:** pass (M) A1 7.3 s |
| F01-AC2 | Invitation refused for another email | A3 | sc/orgs "F01-AC2 an invited user with a different email cannot accept"; ej/orgs "F01-AC2" | pass (A) · **live:** pass (M) A3 |
| F01-AC3 | Seat limit `402 seats` + upgrade prompt | A4 | sc/orgs "F01-AC3 inviting beyond the seat limit answers 402…"; ej/orgs "F01-AC3 … limit dialog (402 seats)" | pass (A) · **live:** pass (M) A4 |
| F01-AC4 | Last owner can't leave or be demoted | A5 | sc/orgs "F01-AC4 the last owner can't leave or be demoted"; ej/orgs "F01-AC4" | pass (A) · **live:** pass (M) A5 |
| F01-AC5 | Takeover, `401 session_replaced` in 5 s, cancel | A6 | ej/sessions "F01-AC5: … continuing signs the first out within 5 s"; sc/state-machines | pass (A) · **live:** fail TF-113 |
| F01-AC6 | Org switch uses the new org | A7 | ej/orgs "F01-AC6: a person in two orgs switches…"; sc/orgs "F01-AC6" | pass (A) · **live:** pass (M) A7 (TF-116 deep link) |
| F01-AC7 | Audit events for every account action | A10 | sc/orgs "F01-AC7 every action writes an audit event" | pass (A) · **live:** pass (M) A10 for the spec'd list (TF-044, TF-114 gaps) |
| F02-AC1 | `activeProjects` 402; archiving frees the slot | C2 | sc/projects "F02-AC1 creating beyond activeProjects answers 402; archiving one frees the slot…"; AFT `organisationRolesAndInviteSeatReservation` | pass (A) · **live:** pass (M) C2 |
| F02-AC2 | No project role → not listed, `404` | C3 | sc/projects "F02-AC2 a member without a project role doesn't see the project and gets 404" | pass (A) · **live:** pass (M) C3 |
| F02-AC3 | Project members are org members only | C1 | sc/projects "F02-AC3 project members are org members only" (by userId, 409 not_org_member); outside email with the share-link hint untested | partial · **live:** pass (M) C1 |
| F02-AC4 | Archived: `409 project_archived`, banner | C4 | sc/projects "F02-AC4 an archived project rejects writes with 409 project_archived…"; AFT; the banner untested | partial · **live:** pass (M) C4 (TF-012) |
| F02-AC5 | "Needs you" shows a review in 5 s | C5 | sc/versions "draft → in_review…" (review_requested in GET /attention); the 5 s live update untested | partial · **live:** pass (M) C5 |
| F03-AC1 | Upload progress → stages → report, no reload | D1 | sc/models "F03-AC1 awaiting_upload → queued → processing → ready…"; ej/main-flow (version page, report); progress and stages in the UI untested | partial · **live:** pass (M) D1 |
| F03-AC2 | Live state after leaving; notification | D1 | unit/realtime/invalidation.test.ts "refetches the model version … when a parse finishes"; leave-and-return and the notification untested | partial · **live:** pass (M) D1 |
| F03-AC3 | Non-IFC → `not_ifc`, no retry | D2 | sc/models "F03-AC3 a non-IFC file fails with not_ifc, no job, and can't be retried" | pass (A) · **live:** pass (M) D2 |
| F03-AC4 | Identical content parses once | D3 | sc/models "F03-AC4 identical content in the org is parsed once (two versions, one job)" | pass (A) · **live:** pass (M) D3 |
| F03-AC5 | Check rows open the viewer with their elements | D5 | no viewer test | none · **live:** fail TF-125 |
| F03-AC6 | Over `maxModelVersionMb` refused in client and server | D4 | sc/models "F03-AC6 … refused when the version is created" (server only); client refusal untested | partial · **live:** pass (M) D4 |
| F04-AC1 | New BoQ preselects both latest versions + defaults | E1 | sc/boqs "F04-AC1 a new BoQ preselects every model's latest ready version and the project defaults"; ej/main-flow | pass (A) · **live:** pass (M) E1 |
| F04-AC2 | Duplex run < 10 s end to end, no reload | E2 | sc/boqs "F04-AC2 … (cached parse, < 10 s)" (API); ej/main-flow no reload but allows 180 s; no end-to-end timing | partial · **live:** pass (M) E2 1.0–1.5 s |
| F04-AC3 | Blocking questions → `needs_input`, header link | E3 | sc/boqs "F04-AC3 a run with blocking questions lands in needs_input…"; the header link untested | partial · **live:** pass (M) E3 |
| F04-AC4 | Inputs changed → Save disabled | E4 | sc/boqs "F04-AC4 changing an input shows pending changes…"; sc/versions "BR-22"; unit/features/boqs/run-state.test.ts; the notice not rendered | partial · **live:** pass (M) E4 |
| F04-AC5 | Classification never changes quantities (BR-02) | E5 | sc/boqs "F04-AC5 BR-02 two runs with different classifications have identical quantities per line key"; et/test_item_texts | pass (A) · **live:** pass (M) E5 |
| F05-AC1 | All blocking answered → `complete` | F1 | sc/questions "answering every blocking question and regenerating gives a complete run (F05 AC1)" | pass (A) · **live:** pass (M) F1 |
| F05-AC2 | New version with same names asks nothing | F7 | no test looks at the questions after a new version with the same names | none, TF-004 · **live:** pass (M) I2, F7 |
| F05-AC3 | Bulk 10 names = one request + one regenerate | F3 | sc/questions "bulk-answers 10 names in one request…" (API); the UI's one request + one regenerate untested | partial · **live:** pass (M) F3 |
| F05-AC4 | Decision used by approved revision warns → draft | F5 | only `reopenedRevisions: []` asserted (no approved revision) | none · **live:** pass (M) F5 |
| F05-AC5 | Promote → org dictionary version → not asked again | F6 | `POST /decisions/{id}/promote` untested | none · **live:** pass (M) F6 |
| F06-AC1 | Group by switch instant, no request | G1 | unit/features/boq-sheet/model.test.ts "nests groups by code path…"; switching and "no request" untested | partial · **live:** pass (M) G1 15–47 ms, no request |
| F06-AC2 | Detail: formula, parameters, shares sum | G2 | sc/sheet "F06-AC2 every line's detail has its formula and parameters, and element shares that add up…" (API data; panel not rendered) | pass (A) · **live:** pass (M) G2 |
| F06-AC3 | Every edit type survives regeneration + new version + Excel | G3 | sc/line-edits "regenerating applies them", "a new model version keeps them" (identical bytes); Excel: exclusion + reason only, et/test_overrides `test_codes_exclusion_orphans_and_xlsx` | partial, TF-008 · **live:** fail TF-049 |
| F06-AC4 | Unit change without quantity refused; Ctrl+Z | G4 | sc/line-edits "a new unit without a new quantity is 409 unit_needs_quantity"; et/test_overrides `test_unit_requires_quantity`; unit/…/edits.test.ts; UI reason and Ctrl+Z untested | partial · **live:** pass (M) G4 |
| F06-AC5 | "How it is calculated" adds up, links Settings | G2 | sc/sheet "F06-AC5 every line's steps add up…", "the brick wall line has start, deduct…"; rule-set-editor.test.tsx opens ?question=…; the link from the sheet untested | partial · **live:** pass (M) G2 |
| F06-AC6 | Manual line under "9 Preliminaries" stays | G5 | sc/line-edits "regenerating applies them" (manual line keeps code A.01 and place) | pass (A) · **live:** pass (M) G5 |
| F06-AC7 | Item texts vs line texts by Group by | G6 | et/test_item_texts; Description switch by Group by and the detail with both untested | partial · **live:** pass (M) G6 |
| F06-AC8 | "Not in the models" notice, remembered collapse | G7 | unit/…/model.test.ts "counts the BoQ's lines by source…"; the notice and remembered collapse untested | partial · **live:** pass (M) G7 (TF-109 per browser: owner Q55) |
| F06-AC9 | Positions renumber; frozen in saved | G8 | unit/…/positions.test.ts "renumbers at once after a move and after an exclusion"; frozen positions in a saved version untested | partial · **live:** pass (M) G8 |
| F06-AC10 | Co-editing < 1 s; later edit wins, earlier told | G9 | sc/co-editing "… on the same line the later edit wins"; ej/live "F06-AC10" (5 s, not 1 s); "the earlier editor is told" untested | partial · **live:** pass (M) G9 41–55 ms, earlier editor told |
| F06-AC11 | 20k lines smooth | G10 | the perf spec was deleted with the mock | none, TF-006 · **live:** pass (M) §P 20,500 lines: switch ≤ 47 ms, 0 frames > 50 ms |
| F07-AC1 | Line → exactly its elements | H1 | unit/features/viewer/links.test.ts "a line's elements are its trace's…", "an aggregate is drawn by its parts"; no browser | partial · **live:** pass (M) H1 |
| F07-AC2 | Element → its lines with shares | H2 | sc/sheet "F07-AC2 an element lists every line it feeds, with its share"; links.test; the click untested | partial · **live:** pass (M) H2 |
| F07-AC3 | Coverage colour, count = unmatched | H3 | sc/sheet "F07-AC3 coverage: unmatched elements match the unmatched questions' occurrences"; links.test; rendered colour untested | partial · **live:** pass (M) H3 |
| F07-AC4 | Two models, toggleable | H4 | links.test "model colours each model, in input order"; two-model view and toggling untested | partial · **live:** pass (M) H4 |
| F07-AC5 | Shared filters, box select | H5 | model.test "filters by top-level code group…", "filters by source, storey and text…"; box select and bulk actions untested | partial · **live:** pass (M) H5, G12 |
| F07-AC6 | Changes colour mode v1 → v2 | H6 | links.test "changes (F08 §4): added blue, changed orange…"; et/test_diff; click for before/after untested | partial · **live:** fail TF-102 |
| F07-AC7 | Duplex viewer < 3 s warm | H7 | UI perf deleted with the mock | none · **live:** pass (M) §P 41 ms / 790 ms; no WebGL fallback TF-106 |
| F08-AC1 | Change report lists exactly affected lines and elements | I1 | et/test_diff `test_duplex_revision_matches_known_changes` (against et/fixtures/duplex_v1_v2_diff.json); NWT `verifyRevisedIfc` | pass (A) · **live:** pass (M) I1 |
| F08-AC2 | No answered question asked again | I2 | no re-run after a model swap checks for re-asked questions | none, TF-004 · **live:** pass (M) I2 |
| F08-AC3 | Earlier edits still applied and listed | I3 | sc/line-edits "a new model version keeps them" (identical bytes); sc/changes "a line edit shows as one changed line with its cause"; edits listed after a swap untested | partial, TF-008 · **live:** fail TF-093 |
| F08-AC4 | Report < 3 s, cached < 500 ms | I4 | sc/changes "the second compare answers the cached diff (200), quickly (F08-AC4)"; first open < 3 s not asserted | partial · **live:** pass (M) I4, §P 1.04 s / 479 ms |
| F09-AC1 | Save version: labelled snapshot, work goes on | J1 | sc/versions "draft → issued: frozen run, open questions counted, the next working version… (BR-21)" | pass (A) · **live:** pass (M) J1 |
| F09-AC2 | Saved version byte-identical | J2 | sc/versions "BR-25: exporting a saved version's run answers the file frozen with it…" (same export id); sheet and positions not compared, no byte check | partial · **live:** pass (M) J2 (same SHA-256) |
| F09-AC3 | Submit → Approve → Save; four-eyes `403` | J3 | sc/versions "draft → in_review…", "BR-24 four-eyes…" (code four_eyes; 403 status not asserted), "in_review → approved → issued…" | pass (A) · **live:** pass (M) J3 |
| F09-AC4 | Confirmed `409 boq_confirmed` incl. owner; reopen audited | J4 | sc/versions "working → confirmed with nothing new…", "confirmed → working on reopen by the lead, with a reason (audited)" | pass (A) · **live:** pass (M) J4 except archive/restore (TF-096, owner Q54) |
| F09-AC5 | Every transition audited, shown in activity | J5 | only `boq.reopened` and `version.saved` asserted; submit, approve, request changes, confirm audit events not | partial · **live:** pass (M) J5 |
| F10-AC1 | Patch, three settings, preview on Duplex | K1 | sc/library-publish "F10-AC1 / v1 criterion 7…"; NWT `verifyLibrary`; "next to the editor" untested | partial · **live:** pass (M) K1 |
| F10-AC2 | No publish with problems; n+1; old read-only | K2 | sc/library-publish "needs a change note and a draft without problems; makes version n+1…" | pass (A) · **live:** pass (M) K2 |
| F10-AC3 | Saved BoQ keeps preset v1 numbers | K3 | sc/library-publish "BR-07: a BoQ pinned to version 1 keeps it…" (input only; no saved version, no numbers) | partial · **live:** pass (M) K3 |
| F10-AC4 | 3-level code list import, duplicates | K4 | sc/codelists "F10-AC4 importing an xlsx code list with 3 levels…"; et/test_codelist_import | pass (A) · **live:** pass (M) K4 |
| F10-AC5 | "Opis" column → item texts, "Reads as" | K5 | pieces: sc/codelists F10-AC4 (Description with `{thickness}`), et/test_item_texts, unit/…/item-text.test.ts; no "Opis" header, no import → publish → sheet/Excel path | partial · **live:** fail TF-136 |
| F10-AC6 | Member sees, picks, no edits; `403` | K6 | sc/library "members view and pick org presets but every edit is 403 (F10-AC6)"; unit/lib/permissions.test.ts | pass (A) · **live:** pass (M) K6 |
| F10-AC7 | "Based on it" vs "Independent copy" | K7 | sc/library-publish "'Based on it' stores only changes and follows the original's next version; an independent copy doesn't" | pass (A) · **live:** owner TF-140 (Q58) |
| F10-AC8 | Rule set Excel round trip, errors with sheet/row/column | K8 | sc/templates "F10-AC8: three answers changed in Excel come back as exactly three changes…"; et/test_preset_templates | pass (A) · **live:** pass (M) K8 |
| F12-AC1 | Excel opens in Excel and LibreOffice; totals match | M1 | openpyxl only; totals against the sheet not asserted; LibreOffice skipped by the owner (2026-11-21) | manual · **live:** pass (M) M1 with openpyxl (LibreOffice skipped by the owner, Excel by hand pending; TF-054 no quantity subtotal) |
| F12-AC2 | Description = item texts; "Lines" sheet both | M2 | et/test_item_texts `test_item_text_uses_rule_expressions_without_changing_quantities` | pass (A) · **live:** pass (M) M2 |
| F12-AC3 | WORKING watermark; saved frozen | M3 | et/test_worker `verify_edit_round_trip` (WORKING in BoQ!A1); sc/versions (kind only), BR-25; "a saved export has no watermark" untested | partial · **live:** pass (M) M3 |
| F12-AC4 | Edited Excel imports as exactly the edits | M4 | sc/edits-import "one quantity changed, one row moved, one deleted, one added: exactly one edit of each kind"; et/test_worker | pass (A) · **live:** pass (M) M4 core (TF-041, TF-071 for .xlsm and 25 MB) |
| F13-AC1 | Run in another tab → toast + update < 2 s | N1 | NWT `verifyRealtime` (job.finished on SSE); invalidation.test; toast and 2 s untested | partial · **live:** pass (M) N1 177–509 ms |
| F13-AC2 | Vendor offer request by bell and email | — | — | n/a (P48) |
| F13-AC3 | Email off for a category, bell stays (core categories) | N3 | sc/sheet "email preferences per category…" (saves only); email stopping untested | partial · **live:** pass (M) N3 |
| F14-AC1 | Every limit enforced with `402` + name | O1 | seats, activeProjects, maxModelVersionMb, maxModelsPerBoq, approvalWorkflow covered; libraryOrgPresets, processingMinutesPerMonth, shareLinks untested | partial, TF-005 · **live:** pass (M) O1 (raw keys TF-098) |
| F14-AC2 | Provider swap needs no frontend change | O (code review) | code review (manual provider only) | manual |
| F14-AC3 | Bad webhook signature rejected and audited | O5 | webhook not built (`400 unsupported_provider`) | none · **live:** known limitation (no webhook, manual billing) |
| F14-AC4 | Usage minutes = sum of job durations | B4 | AFT `organisationRolesAndInviteSeatReservation`: one synthetic 90 s usage → 1.5 min; no sum over real jobs | partial, TF-009 · **live:** pass (M) B4 on the API (UI rounding TF-120) |
| F15-AC1 | Pseudo-locale, no untranslated strings | P1 | as v1-11 | partial, TF-007 · **live:** fail TF-145 |
| F15-AC2 | User locale formats; BoQ keeps project locale | P2 | — | none · **live:** fail TF-021 |
| F15-AC3 | Engine questions from message keys | F8 | unit/i18n/engine-message.test.ts "renders every catalogue entry…", "writes the Duplex's questions in full" (example params, not a real run) | partial · **live:** pass (M) F8 |
| F16-AC1 | New person < 15 min on the sample Duplex (M) | L10 | — | owner · **live:** owner (script ready) |
| F16-AC2 | Each answer changes the preview < 3 s | L3 | — | none · **live:** fail TF-133, TF-134 |
| F16-AC3 | After "Publish all", BoQ uses the presets; Excel texts | L4 | sc/setup covers progress only | none · **live:** pass (M) L4 |
| F16-AC4 | Leave at step 2, resume next day | L5 | sc/setup "a new org has none (204); the owner saves steps and drafts…"; next day and step-1 answers not checked | partial · **live:** pass (M) L5 (timestamps moved in the DB) |
| F16-AC5 | Free org finishes without `libraryOrgPresets` | L6 | ej/accounts "F01-AC1" finishes on Free but skips items and names; the three-preset path untested | partial · **live:** pass (M) L6 |
| F16-AC6 | Gate before dashboard; suggested answers < 3 min | L1 | ej/accounts "F01-AC1" lands in /setup, < 60 s; dashboard block untested; two steps skipped | partial · **live:** pass (M) L1 (gate scope: owner Q57) |
| F16-AC7 | `setup` slots drive the screens, no frontend change | L8 | unit/features/setup/steps.test.ts "a new item-switching yes/no question shows up with no frontend change"; et/test_presets `test_setup_markers_use_the_shipped_rule_data` | pass (A) · **live:** pass (A) |
| F16-AC8 | 14-switch checklist, details, six screens | L2 | steps.test "1a: the checklist has the 14 switches…", "1b … 1c: the six measuring screens" (logic, not rendered) | pass (A) · **live:** pass (M) L2 |
| F16-AC9 | Reinforcement needs kg/m³ for three element kinds | L7 | steps.test "reinforcement estimates can't be left at 0 kg per m³" (logic) | pass (A) · **live:** pass (M) L7 |
| F18-AC1 | Link opens with no account, only what's included | Q1 | sc/shares "opens with no account: the sheet, the line detail, the 3D view…" (API); ej/main-flow shows lines only | partial · **live:** fail TF-085, TF-158 |
| F18-AC2 | Revoke `404` < 1 s; `publicLinksAllowed` off | Q2 | sc/shares "revoking makes every public endpoint 404 at once", "publicLinksAllowed off suspends every link…" | pass (A) · **live:** pass (M) Q2 (404 in 14 ms) |
| F18-AC3 | "Follow latest saved" moves A → B | Q3 | sc/shares "shows nothing until a version is saved, then A, then B, with the same link" | pass (A) · **live:** pass (M) Q3 |
| F18-AC4 | Public endpoints never leak names, decisions, prices | Q4 | sc/shares "BR-56: no public response carries member names…" + the Excel; geometry blob not scanned | pass (A) · **live:** pass (M) Q4 |
| F19-AC1 | Non-admin `/admin/*` → `404` | R1 | ct/admin "answers 404 to an org owner and to a member on every admin operation"; AFT | pass (A) · **live:** pass (M) R1 |
| F19-AC2 | Admin numbers = org usage page | R2 | sc/admin "shows the same seats, active projects and processing minutes as each org's usage page" | pass (A) · **live:** pass (M) R2 |
| F19-AC3 | "Hit a limit" with time | R3 | sc/admin "an org that hit activeProjects is under 'hit a limit', with the time of the hit" | pass (A) · **live:** pass (M) R3 |
| F19-AC4 | Plan change with reason, at once, in org audit | R4 | sc/admin "changing the plan needs a reason, takes effect at once and shows in the org's audit log" | pass (A) · **live:** pass (M) R4 (TF-153 trial date) |
| F19-AC5 | No project content in `/admin/*` | R5 | sc/admin "no admin response contains project names…"; AFT `platformAdminSeesAccountMetadataAndCannotAccessTenantContent` | pass (A) · **live:** pass (M) R5 |
| F11, F17, F20 | Pricing module, every criterion | — | — | n/a (P48) |

## P. Performance (nfr.md), measured

Measured on the local native stack (never on the pilot). Fill in the machine and the commit.

Machine: Windows 11 Pro, 12 CPUs, Docker 15.4 GB; local stack (engine HTTP transport, concurrency 1) and the harness; only agent on the machine. Raw values and scripts: session scratchpad `stage4/out/s4-perf/` (`perf.txt`, `measure.log`). The 20,500-line run was made by copying one Duplex run's rows in SQL (own org). autocannon@7's latencies contradicted the API's access log and weren't used (fetch-based load script instead). The federated row used the NBU office pair, below nfr.md's medium class and not the pair nfr.md measured (TF-181). Added row: 50k-line ingestion (harness).

| Target | Limit | Measured | Commit, tool | Pass |
|---|---|---|---|---|
| Duplex parse (first upload) | ≤ 30 s | engine 3.0 s (median of 3); stack: complete → version ready 2.3 s (2.27/2.33/2.46), job 2.1 s, file varied by trailing newlines to dodge BR-08 dedupe | fc78b12, engine_timing.py --repeat 3; stack-duplex.mjs | ✓ |
| Duplex run (cached parse) | ≤ 5 s | engine 0.7 s; stack: POST run → job succeeded 0.98 s median of 12 (job 0.36 s) | fc78b12, engine_timing.py; stack-duplex.mjs | ✓ |
| Duplex end to end (F04-AC2) | < 10 s | click Generate → new run's lines in the sheet, no reload: 1.02 s first generate, 0.95 s regenerate (medians of 3) | fc78b12, Playwright ui-e2e.mjs | ✓ |
| Federated medium pair, both parses | ≤ 3 min | NBU office Arch-1 + Eng-CON (15.2 MB, 1,303 elements; below the medium class): engine parallel 15.7 s; stack 14.4 s (parses ran one after the other: 2nd waited 7.8 s in queue) | fc78b12, engine_timing.py --federated --repeat 3; stack-fed.mjs | ✓ (see TF-180 serial parses) |
| Federated medium pair, run | ≤ 60 s | engine 5.8 s; stack 6.0 s wall (job 5.4 s), median of 3; 51 lines | same | ✓ |
| CRUD API p95 | ≤ 300 ms | harness (10 in flight): GET /me 27, projects 38, project 24, PATCH project 133, BoQ 101 ms. Local stack, 20 VUs x 60 s: GET /projects/{id} p50 31 / p95 65 / p99 86 ms (570 rps); GET /projects/{id}/boqs 45 / 66 / 81 ms (428 rps); 0 errors | fc78b12, NativeWorkerTest BOQLET_API_PERF; load2.mjs | ✓ |
| Lines page (500 lines) p95 | ≤ 500 ms | harness (500-line run, 10 in flight) 219 ms ✓. Local stack, 20,500-line run, 20 VUs x 60 s: p50 2,090 / p95 2,868 / p99 3,527 ms, 9 rps ✗. 1 VU: 309 ms; limit=1 alone 259 ms; cursor=20000 772 ms | fc78b12, harness; load2.mjs, probe-lines.mjs | ✗ (TF-179) |
| Run ingestion (50k lines) | ≤ 10 s | 3.6 s | fc78b12, harness | ✓ |
| First contentful paint (shell, warm) | ≤ 1.5 s | /{org}: warm 88–120 ms (median 100, 5 loads), cold 204 ms; /{org}/projects warm 88–92 ms | fc78b12, Playwright ui-a.mjs (paint entries) | ✓ |
| Sheet 20k lines, Group by switch | ≤ 300 ms | 20,500 lines: switch 19–47 ms (median 42, 6 switches ACME/Uniclass/none); scroll 345 frames median 16.7 ms, p95 16.8 ms, 0 frames > 50 ms, 0 long tasks; first rows 4.4–4.9 s after navigation (2 lines requests, 5.2 MB gzip, ~55 MB JSON; heap 139 MB) | fc78b12, Playwright ui-d.mjs; lines copied in DB (prep20k.mjs) | ✓ |
| Viewer: Duplex interactive (warm) | ≤ 3 s | tab click → data-ready 41–108 ms (median 41); warm reload, navigation start → ready 670–893 ms (median 790); cold 545 ms | fc78b12, Playwright ui-a.mjs | ✓ |
| Picking | ≤ 100 ms | pointerdown → element panel with the new guid (next frame): 44–67 ms, median 47.5, 12/12 clicks (Duplex) | fc78b12, Playwright ui-a.mjs | ✓ |
| Live update (job finished → UI) | ≤ 2 s | 11–32 ms after a 20 ms API poll saw the job finished; 94–103 ms after job.finishedAt (container clock); 4 runs | fc78b12, Playwright ui-b.mjs | ✓ |
| Live edit seen by another user | ≤ 1 s | A's POST /overrides answered → B's sheet shows the value: 10–31 ms (median 27), 4 edits | fc78b12, Playwright ui-b.mjs | ✓ |
| Change report (Duplex) / cached diff | < 3 s / < 500 ms | first open (navigation → report) 0.94–1.10 s (median 1.04 s; compare 202 → report 0.84 s); cached (compare 200) navigation → report 394–516 ms (median 479), compare request → report 166–288 ms | fc78b12, Playwright ui-c.mjs | ✓ (cached full navigation 516 ms once) |
| Queue wait p95, interactive runs | ≤ 10 s | idle stack: p95 523 ms, median 509 ms, 12 runs (bimodal ~25 / ~515 ms). Behind one 6.3 s parse: 5.36 s (one engine slot) | fc78b12, stack-duplex.mjs, stack-contend.mjs | ✓ idle / ✗ under parse load (TF-180) |

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
- **Retest:** date, stack, result
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
- **Retest:** verified 2026-11-21: CI run 44938492464 (`6cc0594`), job "Deploy Boqlet pilot", 19:18:19Z `Boqlet 6cc059436dc4… deployed.` The next push (`cf58e32`, run 44940268922) deployed too, 19:36:54Z `Boqlet cf58e3217f7c… deployed.` (checked again in the Stage 0 rerun).

### TF-002 · S4 · inconsistency · docs · fixed
- **Found by:** Stage 1 · lanes 1B, 1D · H, local · `8d22de6`
- **Spec:** `docs/testing/README.md` "Layers" (the test counts it states)
- **Steps:** 1. `npm run test:app`. 2. `mvn verify` with the harness variables; read the surefire counts.
- **Expected:** the counts in the Layers table.
- **Actual:** README says App unit "32 files, ~190 tests": 213 pass. `ApiFoundationTest` "(8)": 6 `@Test` methods run. `NativeAuthTest` "(2)": 1. (`NativeWorkerTest` 5, `AlertMonitorTest` 4, `BackupRestoreTest` 1, engine 211, contract 6 files, scenarios 24 files / 173 + 2 todo, smoke 13 match.)
- **Evidence:** `services/api/target/surefire-reports/*.txt`; 1B log "Tests 213 passed (213)".
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: `docs/testing/README.md` layers table from the suites.
- **Retest:**

### TF-003 · S4 · inconsistency · docs · fixed
- **Found by:** Stage 1 · coverage audit · — · `8d22de6`
- **Spec:** `docs/testing/README.md` "Coverage by outcome"; `docs/product/known-limitations.md` "Tests"
- **Steps:** Compare each "Not covered" / "Covered by" claim with the tests.
- **Expected:** the outcome map says what is and isn't covered.
- **Actual:** (1) O5 (README line 160) calls the "new version available" notification uncovered: `tests/scenarios/boqs.test.ts` "a newer ready model version is flagged on the BoQ (F04 §2)" asserts `boq.new_version_available`. (2) O5 calls "F08-AC4 timings" uncovered: the cached diff is asserted in `changes.test.ts` "the second compare answers the cached diff (200), quickly (F08-AC4)"; only the first open < 3 s is uncovered. (3) O5 says `line-edits` proves "edits survive a new model version": that version is the identical Duplex file (deduplicated, same parse; `changes.test.ts` line 125 says "identical file"), so it overstates (see TF-008). (4) O7 (line 162) lists the share page's `noindex` as uncovered: `apps/app/e2e-java/main-flow.spec.ts:96` asserts `x-robots-tag: noindex, nofollow` (Referrer-Policy and the rate limit really are uncovered). (5) O2 (line 157) lists F16-AC8 and AC9 uncovered: `apps/app/src/features/setup/steps.test.ts` covers them as logic, AC4 partly by `scenarios/setup.test.ts`; only rendering is missing. (6) O1 (line 156) "`models` (… retry …)": only "a `not_ifc` version can't be retried" is tested; a successful retry is `it.todo`. (7) `known-limitations.md:120` and README line 163 call "security headers" untested: `e2e-java/accounts.spec.ts` asserts the session cookie's `HttpOnly`, `SameSite=Lax`, `Path` and `403 invalid_origin`.
- **Evidence:** the coverage audit (§C) and the cited lines.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: the outcome map matches the suites (incl. the B6 scenarios).
- **Retest:**

### TF-004 · S3 · test-gap · suites · fixed
- **Found by:** Stage 1 · coverage audit · — · `8d22de6`
- **Spec:** v1-3 (A) "answers carried, exact change report"; F05-AC2 "a new model version with the same names asks nothing again"; F08-AC2
- **Steps:** Look for a test that answers questions on Duplex v1, swaps in `Ifc2x3_Duplex_Architecture_v2.ifc`, regenerates and checks the questions and the change report through the stack.
- **Expected:** an automated test through Java (v1-3 is marked (A)).
- **Actual:** the exact lines and elements are proven only in the engine (`engine/tests/test_diff.py` `test_duplex_revision_matches_known_changes`); `NativeWorkerTest.verifyRevisedIfc` checks 3 diff elements and no lines; no test checks that an answered question isn't asked again after a swap (`scenarios/changes` and `line-edits` upload v2 but don't look at questions).
- **Evidence:** §C rows v1-3, F05-AC2, F08-AC2.
- **Route:** fix now · B6 (API-level test gaps (scenarios, JUnit, engine tests))
- **Fix:** `9698476` (engine, `test_versions.py`) and `7077e83` (`tests/scenarios/model-versions.test.ts`: v2 asks nothing, the change report matches `duplex_v1_v2_diff.json`).
- **Retest:**

### TF-005 · S3 · test-gap · suites · fixed
- **Found by:** Stage 1 · coverage audit · — · `8d22de6`
- **Spec:** v1-9 (A) "`402 limit_reached` and the UI"; F14-AC1 "every limit enforced with `402` and the limit name"
- **Steps:** Look for a test per limit in `docs/product/plans-and-limits.md`.
- **Expected:** each limit tested.
- **Actual:** covered: `seats`, `activeProjects`, `maxModelVersionMb`, `maxModelsPerBoq`, `approvalWorkflow`. Untested: `libraryOrgPresets`, `processingMinutesPerMonth`, `shareLinks`. The UI's limit dialog (`e2e-java/orgs.spec.ts` "F01-AC3") is checked, but its upgrade path is not asserted.
- **Evidence:** §C rows v1-9, F14-AC1.
- **Route:** fix now · B6 (API-level test gaps (scenarios, JUnit, engine tests))
- **Fix:** `7077e83` (`tests/scenarios/limits.test.ts`: every plan limit → `402 limit_reached`, reads and exports keep working past the minutes) and `3179d79` (browser `batch6.spec.ts @b6-limits`).
- **Retest:**

### TF-006 · S3 · test-gap · suites · deferred
- **Found by:** Stage 1 · coverage audit, lane 1F · — · `8d22de6`
- **Spec:** v1-10 (A) "nfr.md targets"; F06-AC11 (perf test) "20,000 lines scroll smoothly"; F07-AC7
- **Steps:** Look for asserted performance tests and where they run.
- **Expected:** the targets proven automatically.
- **Actual:** `tests/perf/api.test.ts` (CRUD p95, 500-line page) runs only with `BOQLET_API_PERF=1`, not in CI or any schedule; `tests/perf/engine_timing.py` prints and asserts nothing; there is no UI performance test at all since P53 (20k-line sheet, viewer ≤ 3 s, live update). Covered: `engine/tests/test_diff.py` 40k lines < 5 s, `scenarios/boqs` "F04-AC2 … < 10 s".
- **Evidence:** §C rows v1-10, F06-AC11, F07-AC7; run log 1F.
- **Route:** deferred (TS-006: the performance suite in CI or on a schedule, and UI performance specs on e2e-java)
- **Fix:**
- **Retest:**

### TF-007 · S3 · test-gap · suites · deferred
- **Found by:** Stage 1 · coverage audit · — · `8d22de6`
- **Spec:** v1-11 (A) "pseudo-locale shows no untranslated strings"; F15-AC1
- **Steps:** Look for a test that renders screens in `en-XA`.
- **Expected:** shell, sheet, questions, Library and share page checked in the pseudo-locale.
- **Actual:** only static checks: the lint rule (`apps/app/src/__tests__/no-literal-strings.test.ts`) and the transform (`apps/app/scripts/pseudo-locale.test.mjs`). The rendered check was `e2e/pseudo-locale.spec.ts`, deleted with the mock (P53).
- **Evidence:** §C rows v1-11, F15-AC1.
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:**
- **Retest:**

### TF-008 · S3 · test-gap · suites · fixed
- **Found by:** Stage 1 · coverage audit · — · `8d22de6`
- **Spec:** v1-13 (A) "edits survive versions; Excel round trip"; F06-AC3; F08-AC3
- **Steps:** Read `tests/scenarios/line-edits.test.ts` "a new model version keeps them" and `edits-import.test.ts`.
- **Expected:** edits proven to survive a changed model version, and each edit type in the Excel.
- **Actual:** the "new model version" is the identical Duplex file: deduplicated, so the same parse and the same elements; a changed model (v2) is never exercised for edits. The Excel round trip has quantity, move, delete and add but no text edit; the quantity edit's reason in the export is untested.
- **Evidence:** §C rows v1-13, F06-AC3, F08-AC3; `changes.test.ts:125` "(none: identical file, the v2 fixture fake)".
- **Route:** fix now · B6 (API-level test gaps (scenarios, JUnit, engine tests))
- **Fix:** `9698476` (engine) and `7077e83` (`model-versions.test.ts` with the real v2 file; `edits-import.test.ts` text edit).
- **Retest:**

### TF-009 · S3 · test-gap · suites · fixed
- **Found by:** Stage 1 · coverage audit · — · `8d22de6`
- **Spec:** F14-AC4 "usage minutes equal the sum of job durations"
- **Steps:** Read `ApiFoundationTest.organisationRolesAndInviteSeatReservation`.
- **Expected:** several real jobs; `/orgs/{id}/usage` `processingMinutes` equals the sum of their durations.
- **Actual:** one synthetic 90 s usage event, recorded twice, gives 1.5 min (proves idempotency, not the sum over jobs).
- **Evidence:** §C row F14-AC4.
- **Route:** fix now · B6 (API-level test gaps (scenarios, JUnit, engine tests))
- **Fix:** `179987f`: `NativeWorkerTest.usageMinutesAreTheTimeOfTheJobsThatRan` (a parse, a run, a preview vs `/orgs/{id}/usage`; HTTP within 1 s per job; queue: upper bound, metering uses the engine's `durationMs`, not the process start).
- **Retest:**

### TF-010 · S3 · test-gap · suites · fixed
- **Found by:** Stage 1 · coverage audit · — · `8d22de6`
- **Spec:** v1-5 (A); BR-20 "every write to a saved version, by every role including owner, gets `409 revision_locked`"
- **Steps:** Read `tests/scenarios/versions.test.ts` "BR-20: a saved version refuses writes with 409 revision_locked, for every role".
- **Expected:** the writes tried as each role.
- **Actual:** every write is tried only as `lead` (the org owner); the title claims "for every role".
- **Evidence:** `versions.test.ts` lines 141–145.
- **Route:** fix now · B6 (API-level test gaps (scenarios, JUnit, engine tests))
- **Fix:** `7077e83`: `tests/scenarios/versions-roles.test.ts`, 8 writes × 7 roles on a saved version.
- **Retest:**

### TF-011 · S1 · bug · java · verified
- **Found by:** Stage 2 · R2 (code), confirmed live by the main session · L · `8d22de6`
- **Spec:** `docs/domain/permissions.md` "Platform admins" ("They reach only `/admin/*` … Non-admins get `404` on `/admin/*`"); `docs/architecture/security.md` "Admin endpoints check `platformRole` on every request"; BR-57; F19-AC1
- **Steps:** 1. Sign in on the local stack as an ordinary account (`platform_role` null). 2. `GET /api/v1/admin/orgs` → 404. 3. `GET /api/v1/%61dmin/orgs`, `/api/v1/%61dmin/overview`, `/api/v1/adm%69n/orgs`.
- **Expected:** `404 not_found` for every spelling.
- **Actual:** `200` with every org's metadata (id, name, plan, status, …) and the platform overview. The only platform-role check is a prefix match on the raw, still percent-encoded `getRequestURI()` (`identity/NativeIdentityFilter.java:37,40,52`; same pattern in `identity/IdentityFilter.java:31-32`, the Keycloak rollback), while Spring MVC routes on the decoded path; `AdminController` and the admin services check nothing themselves. `StrictHttpFirewall` rejects `%2e %2f %5c %25 %3b` but not an encoded letter. The origin check (line 42) passes because the raw path still starts with `/api/v1/`, so the admin **write** routes (suspend an org, change a plan, entitlement overrides, end a user's session) are reachable the same way by any signed-in user who sets the `Origin` header (not tried live: same code path). Encoding the `v1` segment instead (`/api/%761/me`, `/api/v%31/me`) fails closed with `401`. **The pilot was most likely not exposed:** its edge decodes percent-encoded unreserved characters before Java sees the path. Unauthenticated, booqlet.com answers `/api/v1/pl%61ns` with `200`, the public `/plans` (the local stack, with no proxy, answers `401`), and `/api/v1/%61dmin/orgs` with `404`, the admin gate's answer (local: `401`), and every letter of "admin" is unreserved. Not tried signed in on the pilot (no account there). The code was exposed wherever no such proxy sits in front: the local stack, or a deployment behind another proxy.
- **Evidence:** session scratchpad `probes/admin-encoded.mjs`; output: `/admin/orgs 404`, `/%61dmin/orgs 200 {"items":[{"id":"01a1ffc2-…","name":"Local check",…`, `/%61dmin/overview 200 {"period":…,"tiles":{"signUps":…`, `/adm%69n/orgs 200`, `/ADMIN/orgs 404`, `/./admin/orgs 404`.
- **Route:** fix now, out of stage order, on the owner's word (2026-11-21).
- **Fix:** commit `fc78b12`. `admin/PlatformAdminGate` (an interceptor on every `AdminApi` handler: `404` unless the signed-in user is a platform admin, whatever URL reached it) and `http/RequestPaths` (the decoded, normalised path) used by `NativeIdentityFilter`, `IdentityFilter` and the bearer-token resolver in `SecurityConfiguration`. Not changed: `Idempotency.java:45` and `RequestIdFilter` still use the raw URI (key and log only, no access decision; see TF-042). Tests that failed before the fix (`Status expected:<404> but was:<200>`) and pass after: `NativeAuthTest.verifiedSetupCookieOriginTakeoverAndOperatorRecovery` (native, reads and the session-ending DELETE), `ApiFoundationTest.platformAdminSeesAccountMetadataAndCannotAccessTenantContent` (OIDC, reads and a PATCH), `tests/contract/admin.test.ts` "answers 404 on encoded spellings of /admin/, reads and writes alike (TF-011)". The gate alone, with the old filter, also passes `NativeAuthTest`.
- **Retest:** verified 2026-11-21 on L: `fc78b12`'s API image (built with `docker build`, see TF-082), the same probe signed in as a non-admin: `/%61dmin/orgs`, `/%61dmin/overview`, `/adm%69n/orgs` → `404`; unauthenticated `/api/v1/%61dmin/orgs` → `404`, `/api/v1/pl%61ns` → `200`. Harness on the fix: Java 18 (1 skipped), contract 182, scenarios 173 + 2 todo, smoke 13, all green. CI run 44949133758 (`fc78b12`) all 6 jobs green; `deploy` 21:18:32Z `Boqlet fc78b12deab1… deployed.`; afterwards booqlet.com answers `/api/v1/admin/orgs` and `/api/v1/%61dmin/orgs` with `404`, `/api/v1/plans` with `200`.

### TF-012 · S3 · bug · java · open
- **Found by:** Stage 2 · R2 · code · `8d22de6`
- **Spec:** `permissions.md` "Permission keys" ("`false` for every write while the project is archived"); F02-AC4 ("an archived project rejects writes with 409 project_archived")
- **Steps:** on an archived project P: (a) a lead who isn't org admin sends `PATCH /boqs/B {"archived": false, "name": "Renamed"}` and `POST /boqs/B/archive`; (b) with approval on, after a submit, the submitter sends `POST /revisions/R/reopen` (withdraw) and a reviewer `POST /revisions/R/comments`; (c) the lead or an approver sends `DELETE /share-links/{id}`; (d) a library editor sends `POST /decisions/{id}/promote`.
- **Expected:** `409 project_archived` each time; no `true` write key in `permissions`.
- **Actual:** (a) BoQ archive/restore lock with the project action `archive`, which is in `ARCHIVED_ACTIONS` (`ProjectAccess.java:31`; `Boqs.java:67,86`), and the restore path applies `name`/`description` (`Boqs.java:73-79`), so a BoQ in an archived project can be renamed; its `permissions.archive` stays `true` and the app offers archive/restore (`boqs/[boqId]/page.tsx:73`, `boq-header.tsx:138`). (b) withdraw and comment lock with `"view"` (`Boqs.java:187,198`); `BoqAccess.java:175-176` sets `withdraw`/`comment` without the project status; `review-tab.tsx:58` shows the comment box. (c) `ShareLinks.revoke` uses `projects.require` + role only (`ShareLinks.java:160-167`, `ProjectAccess.java:89-93`), while the link's `permissions.revoke` is `false`: the server allows what the UI hides. (d) `Decisions.promote` never checks project status (`Decisions.java:134-149`).
- **Evidence:** `Set.of("view", "seeAudit", "archive")` (ProjectAccess.java:31); `access.lockBill(boq, actor, restore ? "archive" : "editBoqs")` (Boqs.java:67).
- **Route:** fix now · B2 for (a) and (b); (c) and (d) answered by the owner (Q42, P54: the first option); fix now · B7 (owner answers)
- **Fix:** (a, b) fixed in `8745980`: an archived project's BoQs can't be archived, restored, withdrawn or commented; revision keys keep view and seeAudit (`permissions.test.ts` cells flipped). **Open:** (c, d), B7 (Q42).
- **Retest:**

### TF-013 · S3 · inconsistency · java · fixed
- **Found by:** Stage 2 · R2 · code · `8d22de6`
- **Spec:** `permissions.md` "Errors" (`403 forbidden` with `{"required": "approver"}`); `api-conventions.md` "403 … `forbidden` (+ `required`)"; F09-AC3 and test-plan J3 ("`403`, `reason: "four_eyes"`")
- **Steps:** as a viewer `POST /projects/{id}/boqs`; as a member `PATCH /orgs/{id}`; with four-eyes on, the submitter `POST /revisions/{id}/approve`.
- **Expected:** `details.required` on every 403; four-eyes in one documented shape.
- **Actual:** project-role denials have no details (`ProjectAccess.java:89-93,116-118`, `Map.of()`); org denials use `details.requiredRole` (`OrgAccess.java:71-76`); four-eyes answers `code: "four_eyes"` with no `reason` (`Boqs.java:344`) (permissions.md matches the code; F09-AC3 and J3 don't).
- **Evidence:** `throw error(HttpStatus.FORBIDDEN, "forbidden", "Your project role does not allow this.")`; `Map.of("requiredRole", …)`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `8745980`: every 403 carries `details.required`. `permissions.test.ts` cell flipped (failed first).
- **Retest:**

### TF-014 · S3 · question · java · open
- **Found by:** Stage 2 · R2 · code · `8d22de6`
- **Spec:** F10 §6 ("Preview: pick a project and model version(s) **the user can access**"); org table "Library: create, edit, publish … org presets: owner, admin, library_editor"
- **Steps:** a library editor who is `viewer` or `approver` on project P previews an org rule set on P's model version (`POST /presets/{id}/preview`).
- **Expected:** the preview runs (they can see P and may edit the preset).
- **Actual:** `403`: the server requires `editPresets` (lead, estimator) on the models' project (`LibraryPreview.java:36`); the picker offers every active project (`model-version-picker.tsx:23`); `Preset.permissions.preview` is `true` for everyone (`Library.java:355`).
- **Evidence:** `projects.lock(selected.getFirst().project(), actor, "editPresets")`.
- **Route:** answered by the owner (Q43, P54: the first option); fix now · B7 (owner answers)
- **Fix:** lock with `view` per F10 §6, or write "edit rights on the project" into F10 and permissions.md and filter the picker and `permissions.preview`.
- **Retest:**

### TF-015 · S4 · inconsistency · java · fixed
- **Found by:** Stage 2 · R2 · code · `8d22de6`
- **Spec:** `permissions.md` "Confirm a BoQ … approver ✓²" ("² only when approval is on")
- **Steps:** approval off; `GET /projects/{id}` as an approver.
- **Expected:** `permissions.confirm: false` (and `approve: false`).
- **Actual:** both `true` whatever the setting (`ProjectAccess.java:38,99-100`); the BoQ revision's keys are right (`BoqAccess.java:177-178`) and the app uses those, so nothing visible breaks.
- **Evidence:** `Map.entry("approve", APPROVAL), Map.entry("confirm", APPROVAL)`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `8745980`: `approve` and `confirm` follow the org's approval setting and plan. `permissions.test.ts` cells flipped.
- **Retest:**

### TF-016 · S3 · gap · app · deferred
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** `screens.md` "Global chrome (all `/{org}` routes): top bar with org switcher, search (projects, BoQs, later elements), notifications bell, user menu"
- **Steps:** as P-OWN open `/{org}`; look at the top bar.
- **Expected:** a search for projects and BoQs on every `/{org}` route.
- **Actual:** no search in the top bar (`apps/app/src/components/shell/app-shell.tsx:14,27-37`, comment "search joins in FE-034", never built); only the `/{org}/projects` list has a filter (`projects/page.tsx:35`). Not in `known-limitations.md` or a status block.
- **Evidence:** the header renders `OrgSwitcher, NotificationBell, ThemeSwitch, UserMenu`.
- **Route:** deferred (FE-034's global search was never built: a feature task; recorded in known-limitations)
- **Fix:** build it, or record it as a known limitation and in screens.md.
- **Retest:**

### TF-017 · S3 · gap · app · fixed
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** `screens.md` "All data screens must handle **loading** (skeletons, not spinners…), … **error** (message + retry …)"; `frontend.md` data layer rule 6 ("inline error with retry")
- **Steps:** block `/api/v1/*` in DevTools (or stop the API) and reload models, BoQs, a BoQ, Library, notifications; throttle to Slow 3G for loading.
- **Expected:** skeletons while loading; on error a message and Retry.
- **Actual:** no inline query error offers a retry: ~40 sites render only `<p role="alert">{message(x.error)}</p>` (e.g. `boqs/[boqId]/page.tsx:65`, `models/[modelId]/page.tsx:36`, `sheet.tsx:493`, `questions-tab.tsx:52`, `decisions-table.tsx:61`, `library-list.tsx:80`, `[org]/page.tsx:77`); retry exists only in the route `ErrorView`, the AuthGate and the failed-parse button. The share page shows "gone" for every error, network and rate limit included (`public-share.tsx:62-68`). One skeleton in the app (`[org]/page.tsx:82`); elsewhere an empty `<div aria-busy className="h-40"/>` (~35 sites). No loading state at all on `[org]/projects`, `models`, the S09 versions table (also no empty or error), "Needs you" (also no error), `library-list`, `notifications`, `account` (no error for `/me`), `versions-tab.tsx:40`, `exports-tab.tsx:30-85` (no error either). The admin orgs CSV silences its error (`orgs-table.tsx:71`).
- **Evidence:** `decisions-table.tsx:61-62`.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: shared `InlineError` (message + Try again) and `LoadingLines` skeleton at every query site; the share page says "gone" only for 404/410. Test `features/projects/states.test.tsx`, `public-share.test.tsx` (failed first); browser `e2e-java/states.spec.ts`.
- **Retest:** L: API down → "The server is not answering…" with Try again, recovers.

### TF-018 · S3 · bug · app · fixed
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** `screens.md` S07 and the loading, empty and error states
- **Steps:** as P-EST open `/{org}/projects/{p}` (with models and BoQs) on a throttled network, then with `/api/v1/projects/*/models` blocked.
- **Expected:** loading, then the lists; on error a message.
- **Actual:** "No models yet." / "No BoQs yet." while pending and on error, no error shown (`app/(app)/[org]/projects/[projectId]/page.tsx:28,43-47,55,72-76`).
- **Evidence:** `{models.data?.length ? (<ul>…) : (<p>{t("noModels")}</p>…)}`.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: the project overview checks loading and error before "No models yet". `states.test.tsx` (failed first).
- **Retest:**

### TF-019 · S3 · bug · app · fixed
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** `screens.md` "error (message + retry; `404` page for not found/no access)"; `frontend.md` rule 6
- **Steps:** 1. `GET /projects/{p}` answers 500 → open a project page. 2. `/me` fails → reload `/{org}`. 3. a preset GET fails during setup → `/{org}/setup`. 4. `/me` fails → `/`.
- **Expected:** a message with retry; the 404 page only for a real 404.
- **Actual:** project pages stay a blank busy box forever on any non-404 error (`src/features/projects/project-context.tsx:36`); org pages show the **404 page** when `/me` fails (`src/features/orgs/org-context.tsx:46-53`); the wizard returns `loading()` forever when a preset fails (`setup-wizard.tsx:90`, `measure-step.tsx:42`, `review-step.tsx:49`), and it gates the dashboard (`[org]/page.tsx:24-28`); `/` stays blank on a `/me` error (`app/page.tsx:51`).
- **Evidence:** `if (!project.data) return <div className="min-h-40" aria-busy="true" />;`
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: project, `/me`, wizard and preset editor errors get a retry; an unreachable API no longer signs people out (session status `unavailable`, retried every 5 s). `states.test.tsx`, `auth/adapters/native.test.ts`.
- **Retest:**

### TF-020 · S3 · bug · app · fixed
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** `permissions.md` "Create models, upload versions, edit scope: lead, estimator"; `frontend.md` rule 7 (`can(resource.permissions, …)`)
- **Steps:** as P-VIEW or P-APR open `/{org}/projects/{p}/models`, or a version page whose parse failed retryably.
- **Expected:** no Retry without `editModels`.
- **Actual:** `VersionStatus` shows Retry for every role, gated only on the error code (not on `retryable`) (`src/features/models/version-status.tsx:46-50`); Java refuses (`Models.java:245`) → a 403 toast.
- **Evidence:** `{version.error?.code !== "not_ifc" && … && (<Button … onClick={() => retry.mutate()}>…)}`.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23` (app follows `retryable`) and `9efea85` (`ModelVersion.error.details.retryable` and `cause` always set, C13; `models.test.ts`).
- **Retest:**

### TF-021 · S2 · bug · app · fixed
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** F15-AC2 ("BoQ values keep the project locale"); F15 §6, §11 / P35 (currency, unit system, separators and date format are org settings, per project; default narrow no-break space); `design-guidelines.md` "Numbers and units"
- **Steps:** set the org's decimal `,` and thousands `.` and a date format; open a BoQ sheet, the line detail, `/s/{token}`, a model version page.
- **Expected:** "12.450,75" (default "12 450.75" with U+202F); dates in the org format.
- **Actual:** `OrgSettings.numberFormat`/`dateFormat` are read only by the settings form (`general-settings.tsx:103-122`); the sheet uses `new Intl.NumberFormat(locale)` of the UI locale (`sheet.tsx:107,203`); everything else uses next-intl `format.number`/`dateTime` with the UI locale and no `formats` (`app/layout.tsx:19`). `Project.locale` is never used. Only the Excel export applies `numberFormat` (`BoqExports.java:98`), so the F15 status block's "org number and date formats … are built" holds for exports only. Some counts bypass formatting (`boqs/page.tsx:97`, `library-list.tsx:129`, `project-card.tsx:41-49`).
- **Evidence:** `sheet.tsx:202-205`.
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `5cc298a` (`useBoqFormat` in the sheet, how it is calculated, line edits, changes, viewer; `boq-format.test.ts`, failed first), `7bd2ae4` (`PublicShare.numberFormat`/`dateFormat`, C11, `shares.test.ts`), `14c2e23` (line detail, preview, questions, review, versions, run history, exports, the BoQ page, the share page). Browser spec `e2e-java/formats.spec.ts`.
- **Retest:** L: org decimal "," and thousands "." → sheet 267,16, how it is calculated 340,575 m².

### TF-022 · S3 · inconsistency · app · fixed
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** P43 (colour only where it means something: orange "to confirm", yellow "manual"); `design-guidelines.md` Status ("Edited: a small blue dot") and contrast ("Orange … fills, markers, large text only"); `design-system.md` (no hard-coded colour)
- **Steps:** edit a quantity in the sheet; open the BoQ in a second browser; open `?tab=changes`; as P-PADM an org with an override.
- **Expected:** blue dot for edited; orange only for to-confirm; no small orange text.
- **Actual:** edited cell = orange corner triangle (`sheet.tsx:1201`); presence row marker and avatars orange, avatars with paper initials (~3.1 contrast) (`sheet.tsx:1138`, `boqs/presence.tsx:125`); small orange text in the Changes "changed" tag (`changes-tab.tsx:25`) and the admin "overridden" label (`admin/org-detail.tsx:124`); hex `text-[#151515]` in `source-tag.tsx:17,19`. No green found.
- **Evidence:** `CHANGE_CLASS = { …, changed: "border-[var(--orange)] text-[var(--orange)]" }`.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: orange used only as a fill (edited-cell dot, presence, change tags, admin label). `__tests__/colour-use.test.ts` (failed first).
- **Retest:**

### TF-023 · S4 · inconsistency · app · fixed
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** F15 §1 ("No literal user-facing strings in components")
- **Steps:** pseudo-locale `en-XA`: a BoQ with several pending changes; the New BoQ dialog; `/{org}/library/rule_set/new`; the sheet's code cell editor with a screen reader.
- **Expected:** sentences, lists and accessible names from the catalogue.
- **Actual:** lists joined with a literal `", "` (`boq-header.tsx:198-202`, `sheet.tsx:229-230`); labels composed in code (`` `${t("notes")} (${t("optional")})` `` in `create-boq-dialog.tsx:113`, `create-preset.tsx:95,98`, `preset-page.tsx:214,217`; `` `${title}: ${t("add")}` `` in `setup-tab.tsx:308`); the code cell editor is named by its column id (`sheet.tsx:1190`); an option placeholder from its id (`rule-set/question-setup.tsx:329`); `EXAMPLE.lineText` is English prose (`library/rule-set/examples.ts:16`).
- **Evidence:** `t("run.pending", { what: otherPending.map(…).join(", ") })`.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: lists by `format.list`, labels by ICU keys. `__tests__/i18n-composition.test.ts` (failed first).
- **Retest:**

### TF-024 · S4 · inconsistency · app · fixed
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** `frontend.md` rule 7 ("Never infer permissions from roles in more than one place (`src/lib/permissions.ts`)")
- **Steps:** grep `role ===` outside `permissions.ts`.
- **Expected:** gating through `orgCan(...)` or API `permissions`.
- **Actual:** `components/errors/limit-dialog.tsx:36` (`membership?.role === "owner"` for "Upgrade"); `settings/members-settings.tsx:141` (make-owner rule inlined). Behaviour correct today.
- **Evidence:** `const owner = membership?.role === "owner";`
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: `orgCan(...)` instead of `"owner"` literals. `lib/permissions.test.ts` (failed first).
- **Retest:**

### TF-025 · S4 · gap · app · fixed
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** `screens.md` "**empty** (explains the next action)"
- **Steps:** empty project list (archived filter), a new project's overview, an empty Library kind, a project Library, a BoQ's Exports tab with no files.
- **Expected:** each empty state names the next action.
- **Actual:** "No projects here." (`projects.list.empty`), "No models yet." / "No BoQs yet." (`projects.overview.*`), "Nothing here yet." / "This project has no presets of its own." (`library.home.*`), "No files yet." (`boqs.exports.none`). `models.list.empty` does it right.
- **Evidence:** `messages/en/projects.json`, `library.json`, `boqs.json`.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: empty states name the next action. `__tests__/empty-states.test.ts`.
- **Retest:**

### TF-026 · S3 · gap · app · fixed
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** `screens.md` error state
- **Steps:** a render error on `/sign-in`, `/invite/{token}`, `/session-conflict` or `/s/{token}`; P-MEM opens `/{org}/settings/shares`.
- **Expected:** the in-app error view with retry; a "not allowed" note like the sibling settings pages.
- **Actual:** no `error.tsx` in `app/(public)` or the root segment, so a public-page error shows the bare English `global-error.tsx` (inline-styled, no locale, lines 8-11); `/{org}/settings/shares` renders nothing for non-admins (`settings/shares/page.tsx:15`, `return null`) while usage, billing and audit say "not allowed".
- **Evidence:** file list of `apps/app/app/(public)`.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: `app/error.tsx`, `app/(public)/error.tsx`; settings/shares says "not allowed". `__tests__/error-boundaries.test.ts` (failed first).
- **Retest:**

### TF-027 · S4 · inconsistency · docs · fixed
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** `screens.md` Inventory ("Every other screen in the inventory exists at its route")
- **Steps:** compare `apps/app/app/**/page.tsx` with the inventory.
- **Expected:** every route has a row.
- **Actual:** no S-id for `/` (start and org picker), `/{org}/projects` (project list), `/{org}/settings/shares`, `/{org}/library/[kind]/new`, BoQ `?tab=review`, `/areas/[area]/…` and `/{org}/settings/[section]` (module hosts). (S36 "vendors" not built: known, F19.)
- **Evidence:** the route list.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: screens S39–S44 and S12i.
- **Retest:**

### TF-028 · S4 · question · docs · open
- **Found by:** Stage 2 · R4 · code · `8d22de6`
- **Spec:** `screens.md` "Who" (S12b questions, S12e log, S13 decisions: lead, estimator, approver; S12f setup: lead, estimator; S16 lead, estimator; S17 lead) vs `permissions.md` (viewers see project, models, BoQs, explanations, viewer, exports)
- **Steps:** as P-VIEW open a BoQ and `/{org}/projects/{p}/decisions`.
- **Expected:** one of the two specs.
- **Actual:** viewers get Questions, Log and Setup read-only (`boqs/[boqId]/page.tsx:55-57` filters only Changes); the project sub-nav shows Decisions, Library and Settings to every role (`project-header.tsx:10-18`), read-only.
- **Evidence:** `TABS.filter((k) => (k !== "changes" || can("seeAudit") || can("editBoqs")) && …)`.
- **Route:** answered by the owner (Q44, P54: the first option); fix now · B7 (owner answers)
- **Fix:**
- **Retest:**

### TF-029 · S2 · bug · java · fixed
- **Found by:** Stage 2 · R3 · code · `8d22de6`
- **Spec:** BR-23 ("Any change that would alter the current run's result (… decisions used by it …) moves an `in_review` or `approved` revision back to `draft`. The user is warned, with the affected revisions listed"); `state-machines.md` BoqRevision `in_review → approved → issued`; F09-AC3
- **Steps:** 1. Approval on. 2. Generate BoQ X, submit, approve (another person). 3. `POST /projects/{p}/decisions` with a decision X's run doesn't use (a question of another BoQ Y in the project, or a name answer that publishes the project dictionary). 4. The response says `reopenedRevisions: []`. 5. `POST /revisions/{X}/issue`; on another `in_review` revision try approve.
- **Expected:** either the change isn't pending for X, or X goes back to `draft` and is listed.
- **Actual:** X stays `approved`, but save and approve answer `409 not_ready` with `pendingChanges: ["decisions"]` (and `"inputs.dictionaries"` after a name answer); regenerating is refused (`revision_in_review`, `Runs.java:63`). The only way out is withdraw and review again. Pending changes compare **all** project decisions and the project dictionary version (`BoqInputs.java:89-97,106-111`, via `BoqAccess.java:145-149`), while the withdraw list keeps only revisions whose run used that question id (`Decisions.java:226-241`); the dictionary publish (`Decisions.java:109-115`) isn't considered.
- **Evidence:** `BoqInputs.java:90` `"decisions", decisions(project.getId())`; `Boqs.java:167,292` → `ready()` → `not_ready` (`:286`).
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `e726a5e`: pending changes count only decisions for the questions the run asked (the withdraw list's set), and a dictionary change unless it only touches name answers the run didn't ask. Scenario in `questions.test.ts` (failed first: `['inputs.dictionaries','decisions']`).
- **Retest:**

### TF-030 · S3 · inconsistency · java · fixed
- **Found by:** Stage 2 · R3 · code · `8d22de6`
- **Spec:** `state-machines.md` (refused "with `409 invalid_transition` and names the current state"); `backend.md` "explicit transition tables per entity"
- **Steps:** `POST /boqs/{id}/reopen` on a working BoQ; `POST /jobs/{id}/cancel` on a succeeded job; `POST /model-versions/{id}/retry` on a ready version; `POST /revisions/{id}/approve` on a draft; as a viewer withdraw an `in_review` revision.
- **Expected:** `details` names the current state (as invitations do, `Invitations.java:212-215`); a role refusal is `403`.
- **Actual:** `details: {}` everywhere else (`Boqs.java:131,164,190,200,215,240` via `BoqAccess.java:245-247`; `Jobs.java:138`; `Models.java:250,261`; `ShareLinks.java:148`); withdraw maps a missing permission to `409 invalid_transition` (`Boqs.java:187-190`); a submit during review is `invalid_transition` (`:131`) but an issue during review is `revision_in_review` (`:119`).
- **Evidence:** `throw conflict("invalid_transition", "Only a confirmed BoQ can be reopened.")` → `Map.of()`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `8745980` (`Boqs`, `ShareLinks`: `details.state`; a withdraw by a role that may not is 403) and `179987f` (`Jobs`, `Models`). `versions.test.ts`, `model-lifecycle.test.ts`.
- **Retest:**

### TF-031 · S3 · inconsistency · java · fixed
- **Found by:** Stage 2 · R3 · code · `8d22de6`
- **Spec:** `state-machines.md` ModelVersion "awaiting_upload → failed: upload not completed within 24 h"; BR-51
- **Steps:** create a version, don't upload, advance 25 h, let the hourly retention task run; `GET /model-versions/{id}`. Also: at 24 h 30 min, before the sweep, `POST /model-versions/{id}/complete`.
- **Expected:** `failed` with an error code and an audit event; a late `complete` refused.
- **Actual:** the sweep soft-deletes it, keeping `status = 'awaiting_upload'` (`Maintenance.java:241-251`): it vanishes (404, gone from the list); no audit, no `error.code`. `complete()` doesn't check the age (`Models.java:219-242`), so until the hourly sweep (`Maintenance.java:203-211`) a late upload is accepted and queued.
- **Evidence:** `UPDATE model_versions SET deleted_at = now() WHERE id = ?`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `179987f`: an upload not completed in 24 h fails with `upload_expired` (hourly sweep, which aborts the multipart upload, and a late complete); audited. `model-lifecycle.test.ts` (failed first).
- **Retest:**

### TF-032 · S3 · bug · java · fixed
- **Found by:** Stage 2 · R3 · code · `8d22de6`
- **Spec:** `state-machines.md` ModelVersion ("Deleting is allowed only when no run references it"); F03 §8 ("Otherwise 'archived' (hidden from pickers)")
- **Steps:** BoQ on model version v1, generate; `DELETE /model-versions/{v1}` → 204; Re-generate.
- **Expected:** a used version is refused or archived; the BoQ can still regenerate.
- **Actual:** `delete` refuses only `queued`/`processing`, never checks usage (`Models.java:255-272`, though `withUsage` exists at `:369-384`); then `inputs.validate` refuses deleted versions (`BoqInputs.java:67-72`) and Re-generate answers `400 invalid_inputs` (`Runs.java:76`): the working version is stuck until its models are changed. (F03's status block lists "no version delete" in the UI; the API allows it.)
- **Evidence:** `UPDATE model_versions SET deleted_at = now() WHERE id = ?` without a usage check.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `179987f`: deleting a version a BoQ's inputs or a run use answers `409 version_in_use` with `details.usedBy`. `model-lifecycle.test.ts` (failed first).
- **Retest:**

### TF-033 · S3 · bug · java · fixed
- **Found by:** Stage 2 · R3 · code · `8d22de6`
- **Spec:** BR-09 ("An excluded line stays listed as excluded … in the sheet, the exports, share links …"); BR-03
- **Steps:** exclude a line with a reason, regenerate, create a share link; `GET /public/shares/{token}/lines` and the detail of the excluded key.
- **Expected:** listed and marked excluded.
- **Actual:** filtered out of the public lines, and the detail answers 404 (`PublicShares.java:63-64,85-87`).
- **Evidence:** `… WHERE run_id = ? AND NOT coalesce((line->>'excluded')::boolean, false)`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `8745980`: share lines include excluded lines (`excluded: true`), their detail opens. `shares.test.ts` (failed first).
- **Retest:**

### TF-034 · S3 · gap · java · fixed
- **Found by:** Stage 2 · R3 · code · `8d22de6`
- **Spec:** BR-51 ("Everything a user does that changes data writes an audit event"); F09 audit list (`model_version.failed`, `run.finished`); F09-AC5
- **Steps:** cancel a queued run job, read `GET /projects/{p}/audit`; let a parse fail (`parse_error`) and a run fail.
- **Expected:** a cancel event with actor and time; `model_version.failed`; a run-finished event for failed or cancelled runs.
- **Actual:** `Jobs.cancel` writes no audit (`Jobs.java:118-141`); `ParseJob.finished` on failure or cancel writes none (`ParseJob.java:42-51`), `model_version.failed` only for `not_ifc` (`Models.java:232`); `RunJob.finished` audits only success as `run.completed` (`RunJob.java:212-217` vs `:247-248`); the expiry sweep (TF-031) isn't audited.
- **Evidence:** no `audit.record` in `Jobs.cancel`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `179987f`: `job.cancelled`, `model_version.failed`, `run.failed`, `run.cancelled` audited. `model-lifecycle.test.ts` (failed first).
- **Retest:**

### TF-035 · S3 · question · docs · open
- **Found by:** Stage 2 · R3 · code · `8d22de6`
- **Spec:** BR-51 ("Audit events are never edited or deleted, except when the whole org is deleted"), BR-57 vs F09 "org audit … retention by plan" and `plans-and-limits.md` `auditLogRetentionDays` (Free 30, "applied (maintenance purge)")
- **Steps:** a Free org, advance 31 days, let the retention task run; read the org and project audit.
- **Expected:** the owner decides: retention deletes (BR-51 needs the exception) or only limits what is shown.
- **Actual:** `pruneAudit` deletes `audit_events` older than the plan's days, project events and mirrored admin actions included (`Maintenance.java:229-239`).
- **Evidence:** `DELETE FROM audit_events WHERE id IN (…)`.
- **Route:** answered by the owner (Q45, P54: the first option); fix now · B7 (owner answers)
- **Fix:**
- **Retest:**

### TF-036 · S4 · inconsistency · java · fixed
- **Found by:** Stage 2 · R3 · code · `8d22de6`
- **Spec:** BR-62 ("A usage event is written for every parse, run and preview job that ends, whatever the plan"); `plans-and-limits.md` (processing minute = wall-clock minutes of parse, run and preview jobs)
- **Steps:** (a) cancel a run job still queued; (b) run the sample project; (c) a job fails retryably, then succeeds; read `GET /orgs/{o}/usage`.
- **Expected:** one event per ended job with its processing time.
- **Actual:** usage only when `attempt.metered() && attempt.startedAt() != null` (`Jobs.java:291-296`): (a) nothing; (b) sample runs and the seeded Duplex parse are unmetered (`Runs.java:57-59`, `Models.java:214`), nothing (F02 says sample processing doesn't count as usage, so the open point is only whether an event with zero billing is still due); (c) a re-queue records nothing for the failed attempt (`Jobs.java:251-257`) and the next claim resets `started_at` (`:146-147`); a job cancelled during the retry wait counts the wait.
- **Evidence:** the condition above.
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `579db30`: every ended metered job gets a usage event (cancelled too); a retried attempt's time is kept in `jobs.processing_ms` (V19) and the retry wait isn't counted. `ApiFoundationTest#aJobCancelledWhileQueuedIsMeteredWithItsEarlierAttempts` (failed first). **Owner (Q62, P54):** a zero-billed event for sample-project jobs: B7.
- **Retest:**

### TF-037 · S4 · inconsistency · java · fixed
- **Found by:** Stage 2 · R3 · code · `8d22de6`
- **Spec:** `state-machines.md` ModelVersion `failed.error.code` (`not_ifc`, `unsupported_schema`, `corrupt_file`, `too_large`, `parse_timeout`, `parse_error`); no `queued → failed` in the diagram
- **Steps:** a parse over `BOQLET_ENGINE_JOB_TIMEOUT`, or kill the worker mid-parse; cancel a queued parse; read `error.code` and the version page.
- **Expected:** codes from the list, translated in the UI.
- **Actual:** other codes: `engine_timeout` (`JobDispatcher.java:146`), `worker_lost` (`Jobs.java:188`), `ingestion_failed`, `engine_unavailable`, `engine_process_failed` (`worker_queue.py:64`), `engine_error`, `invalid_input` (`worker.py:350-356`), `cancelled` (`ParseJob.java:45`, a `queued → failed` the diagram lacks); `parse_timeout` never produced; the app translates six codes (`messages/en/models.json:39-47`) and falls back to the English `message` (`version-status.tsx:44`). `engine_timeout` is retryable, so a model that always times out is parsed 3 times; while a job waits for its retry the version stays `processing` and the run `running`.
- **Evidence:** `failed("engine_timeout", "The worker exceeded the job timeout.", true)`.
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `7704cd9` (engine), `852393e` (app texts), `9efea85` (Java: a failed version's code is one of the documented ones, `details.cause` keeps the job's; the HTTP-path `engine_timeout` is no longer retried; `state-machines.md` has `cancelled`; `ParseJobErrorsTest`).
- **Retest:**

### TF-038 · S4 · question · docs · open
- **Found by:** Stage 2 · R3 · code · `8d22de6`
- **Spec:** `state-machines.md` ShareLink (no `expired → active`; "transitions not drawn here are not allowed") vs F18 §3 ("Editing a link changes its includes and expiry")
- **Steps:** create a link with `expiresAt` in the past (accepted, `expired`); `PATCH` a future `expiresAt`; open the public URL.
- **Expected:** the owner decides whether an expired link may be revived.
- **Actual:** `update` refuses only revoked links (`ShareLinks.java:147-149`): the link is `active` again with the old token; creating with a past `expiresAt` isn't refused (`ShareLinks.java:104-109`).
- **Evidence:** `if (current.getStatus() == ShareLink.StatusEnum.REVOKED) throw … invalid_transition`.
- **Route:** answered by the owner (Q46, P54: the first option); fix now · B7 (owner answers)
- **Fix:**
- **Retest:**

### TF-039 · S1 · gap · engine · verified
- **Found by:** Stage 2 · R5 · code (unconfirmed until §9.3) · `8d22de6`
- **Spec:** `security.md:76-78` ("Spreadsheets … parsed only in the worker or rpc … Size ≤ 20 MB"); BE-D13 ("Isolate parsing with CPU, memory, and time limits")
- **Steps:** build a 2–10 MB xlsx whose `xl/sharedStrings.xml` expands to several GB; as any signed-in account `POST /api/v1/codelists/read` with it (no org role needed: `LibraryController.java:114-115` → `LibraryFiles.codeRead`); watch `docker stats boqlet-local-engine-1`; repeat with `POST /presets/{id}/template-import`.
- **Expected:** `400` before decompressing, as the edits import does.
- **Actual:** only `sheets/boq_import.py:56-58` caps the uncompressed size; `codelist_import._read_xlsx` (`:68-69`) and `templates.read` (`:478-480`) call `load_workbook` directly; openpyxl loads the shared strings even in read-only mode; `MAX_ROWS` (`codelist_import.py:22`) applies after. The rpc engine has 1536 MiB (`compose.yaml:138`): one request likely OOM-kills it and stops the code-list, template, check, names and expression RPCs for every org, repeatable by anyone.
- **Evidence:** `openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)` with no size check vs `if len(zipped.infolist()) > 4096 or sum(…) > (256 << 20): raise ValueError("Workbook is too large.")`.
- **Severity:** raised from S2 to S1 in triage: any signed-in user can make a shared component (the engine's spreadsheet reader, or the API itself) fail for every org; confirmed live in Stage 4.
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `d5e0d8b`: `engine/ifc_boq/sheets/xlsx_guard.py` checks the zip directory (≤ 4096 parts, ≤ 64 MB expanded in rpc, 256 MB for the edits job, ≤ 100:1 per part over 1 MB) before openpyxl; code lists, templates and the edits import open through it. Test `engine/tests/test_xlsx_guard.py` (failed first: members decompressed).
- **Retest:** L, engine rebuilt from the fix: the Stage 4 bomb (3.2 GB of shared strings in 10.9 MB) → `400 invalid_file` "The workbook is too large…" in 319 ms on `/codelists/read` and 364 ms on template import, engine ~140 MiB, other users' requests kept answering 200 (`stage4/out/s4-security/bomb-codelist.log`, `bomb-template.log`). Pushed and deployed in `1be66cb` (CI 44980195142).

### TF-040 · S3 · bug · engine · fixed
- **Found by:** Stage 2 · R5 · code · `8d22de6`
- **Spec:** `security.md:77-78` ("no formulas evaluated"); the export's own guard (`export_xlsx.py:52-56`)
- **Steps:** a classification named `=HYPERLINK("https://example.invalid","codes")`, published and used as the BoQ's only classification; generate, export (also via a share link with Excel); list formula cells in the Inputs sheet with openpyxl.
- **Expected:** none; user text as strings.
- **Actual:** the Inputs sheet writes `wi.cell(row=i, column=2, value=v)` (`engine/ifc_boq/export_xlsx.py:283-285`), bypassing `_row`'s guard; openpyxl makes any `=…` string a formula. Affected: Classifications (`:279`), Rule set (`:276`), Dictionaries, Model. Every recipient, public share viewers included, gets a live formula. Unconfirmed whether Java's name validation allows a leading `=`.
- **Evidence:** `for i, (k, v) in enumerate(info, 3): … wi.cell(row=i, column=2, value=v)`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `b64809f`: the export records its own formulas and turns every other formula cell into text before saving. `test_export_xlsx.py::test_user_text_that_starts_with_an_equals_sign_is_never_a_formula` (failed first: formulas in Lines H1/I1, Inputs B5/B6).
- **Retest:**

### TF-041 · S3 · inconsistency · engine · fixed
- **Found by:** Stage 2 · R5 · code · `8d22de6`
- **Spec:** `security.md:77-78` ("openpyxl in read-only, data-only mode (no formulas evaluated, no macros: `.xlsm` rejected)")
- **Steps:** copy a valid code-list `.xlsx` to `codes.xlsm`; `POST /api/v1/codelists/read` with it.
- **Expected:** `400 invalid_file`.
- **Actual:** `200`: the engine accepts `.xlsm` (`codelist_import.py:85`) and the picker offers it (`apps/app/src/features/library/classification/code-import.tsx:158`); template and edits imports never check the name or content type (`sheets/templates.py:480`, `boq/ImportEdits.java:43-46`). Macros never run; the documented control is missing.
- **Evidence:** `if name.endswith((".xlsx", ".xlsm")): raw = _read_xlsx(data)`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `ff2c5f5` (engine: a `vbaProject.bin` part is refused by every reader, `WorkbookRefused`; `test_xlsx_guard.py`, failed first: did not raise) and `03189a3` (the picker no longer offers `.xlsm`).
- **Retest:**

### TF-042 · S3 · gap · java · fixed
- **Found by:** Stage 2 · R5 · code · `8d22de6`
- **Spec:** `security.md:16` ("only the token's sha256 is stored"), `:51-52`, `:92`
- **Steps:** `curl http://localhost:8080/api/v1/invitations/<token>` and `…/public/shares/<token>`; `docker logs boqlet-local-api-1 2>&1 | grep -E "invitations/|public/shares/"`.
- **Expected:** no raw bearer tokens in logs.
- **Actual:** the access log writes the full path (`http/RequestIdFilter.java:37-42`, `url.path`): raw share and invitation tokens land in the API logs (no retention limit in compose). A logged invitation token is enough to create the invitee's account with a password of the attacker's choosing (`NativeCredentials.java:84-88,107-111`) and accept the membership.
- **Evidence:** `addKeyValue("url.path", path)….log("{} {} {} {} ms", …)`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `cd37865`: the access log logs the routed path with share and invitation tokens masked. `AccountSecurityTest` (failed first).
- **Retest:**

### TF-043 · S3 · gap · java · fixed
- **Found by:** Stage 2 · R5 · code · `8d22de6`
- **Spec:** `security.md:111-113` ("invitations (20/h per org), rpc calls (60/min per user)", marked planned); test-plan B2
- **Steps:** invite `x@example.test` once, then `POST /orgs/{org}/invitations/{inv}/resend` 25 times; count the mails in MailHog; 70× `POST /codelists/read` in a minute.
- **Expected:** `429 rate_limited` after 20 per hour and 60 per minute.
- **Actual:** no limit; resending a pending invitation skips the seat check (`org/Invitations.java:98-122`, only for `EXPIRED`), so the owner of a self-made org can send unlimited emails to any address through boqlet's SMTP; revoke + invite repeats too; rpc has no limit (`library/LibraryController.java:114-115`).
- **Evidence:** `if (row.invitation().getStatus() == …EXPIRED) { limits.checkCapacity(…) }` then an unconditional `orgs.enqueueEmail(…)`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `cd37865`: invitations and resends 20 an hour per org; engine rpc calls 60 a minute per user (`429 rate_limited`, Retry-After). `AccountSecurityTest` (failed first).
- **Retest:**

### TF-044 · S3 · gap · java · fixed
- **Found by:** Stage 2 · R5 · code · `8d22de6`
- **Spec:** BR-51 ("Everything a user does that changes data writes an audit event"); `security.md:120,123`
- **Steps:** create an account via set-password, sign in, sign out, a wrong password, a reset; query `audit_events` for that actor.
- **Expected:** events for account created, password set or reset (sessions ended), session opened and ended, failed sign-in.
- **Actual:** the only identity event is `session.replaced` on takeover (`Sessions.java:66-71`); `NativeCredentials.setPassword` creates users, changes hashes and ends sessions unaudited (`NativeCredentials.java:70-112`); sign-in (`:52-68`) and `Sessions.close` (`:102-108`) aren't audited.
- **Evidence:** `UPDATE native_credentials SET password_hash = ? …; UPDATE sessions SET status = 'ended' …; return;`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `cd37865`: `user.password_set`, `user.password_reset`, `session.opened`, `session.ended`, `auth.sign_in_failed` audited. `AccountSecurityTest` (failed first).
- **Retest:**

### TF-045 · S3 · question · ops · open
- **Found by:** Stage 2 · R5 · code · `8d22de6`
- **Spec:** `security.md:72-75` ("Files are parsed only in the worker, a separate container. The queue worker's database role may only execute the queue functions"); BE-D13
- **Steps:** from a container on the backend network `POST http://engine:8788/rpc/codelist-read` with another org's `fileKey` (no credential); `docker exec boqlet-local-engine-1` boto3 `list_objects_v2` on the bucket.
- **Expected:** a decision: scoped storage access for the workers and an authenticated HTTP worker, or the docs record that the network boundary is the only control.
- **Actual:** the HTTP worker binds `0.0.0.0:8788` (`ops/pilot/engine.Dockerfile`) without authentication (`engine/ifc_boq/worker_http.py:40-91`; `WorkerClient.java:78` sends none); `rpc codelist-read` reads any key (`rpc.py:41-43`); engine and queue containers hold the same full-bucket SeaweedFS admin key as the API (`ops/pilot/compose.yaml:3-9,40-41,111-112,133-159`). A parser exploit or a foothold on the backend network reads, writes or deletes every tenant's files; `internal: true` networking is the only control and the docs don't say so.
- **Evidence:** `AWS_ACCESS_KEY_ID: ${STORAGE_ACCESS_KEY:?}` in both; `@app.post("/rpc/{op}") def invoke(op: str, request: dict)`.
- **Route:** answered by the owner (Q47, P54: the first option); fix now · B7 (owner answers)
- **Fix:** a worker storage identity limited to sources and job prefixes; a shared bearer secret API ↔ worker; or the accepted risk in security.md.
- **Retest:**

### TF-046 · S3 · gap · app · open
- **Found by:** Stage 2 · R5 · code · `8d22de6`
- **Spec:** `security.md:89-90` (HSTS gap), `:101-108` web security
- **Steps:** `curl -sI http://localhost:3000/sign-in`, `/invite/abc`, `http://localhost:8080/api/v1/plans`; on the pilot passively `curl -sI https://booqlet.com/`, `/invite/abc`, `/api/v1/plans` (§9.3).
- **Expected:** app pages send `nosniff`, frame protection and HSTS on the pilot; `/invite/{token}` (a bearer link) sends `Referrer-Policy: no-referrer` and `noindex` like `/s/*`; the docs say what is sent.
- **Actual:** `apps/app/next.config.ts:29-39` sets headers only for `/sign-up` and `/s/*`: no nosniff, frame protection or HSTS on app pages, `X-Powered-By: Next.js` on; `/invite/[token]` has neither no-referrer nor noindex; the four Traefik routers use a `private-headers` middleware defined nowhere in the repo (`ops/pilot/traefik-routes.json:8,16,23,30`); the API probably does send HSTS, nosniff and `X-Frame-Options: DENY` via Spring Security defaults, which would make `security.md:89` wrong about the API (unconfirmed).
- **Evidence:** `headers()` with only `/sign-up/:rest*` and `/s/:token*`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** app part in `a0a34b0`: every page sends nosniff, X-Frame-Options DENY + `frame-ancestors 'none'`, Referrer-Policy, no X-Powered-By, HSTS in production; `/invite/*` no-referrer and noindex (`__tests__/headers.test.ts`). **Open (ops):** HSTS on API responses, and the `private-headers` Traefik middleware named in `ops/pilot/traefik-routes.json` is defined outside the repo.
- **Retest:** L: `/invite/abc` sends nosniff, DENY, frame-ancestors, no-referrer, noindex, no X-Powered-By.

### TF-047 · S4 · inconsistency · java · open
- **Found by:** Stage 2 · R5 · code · `8d22de6`
- **Spec:** `api-conventions.md:73` ("429 … `rate_limited` (+ `Retry-After`)"), `:135-138` (`RateLimit-*` headers); `security.md:19-20` (sign-in and set-password limits per source address and per email)
- **Steps:** 13 wrong sign-ins for one email; 301 share GETs in a minute.
- **Expected:** `429 rate_limited` with `Retry-After` and `RateLimit-*`.
- **Actual:** auth answers `429 auth_throttled` (`NativeCredentials.java:41-43,128-129`), shares `rate_limited` (`ShareController.java:119-121`); no `Retry-After` or `RateLimit-*` anywhere; `set-password` has only the per-source bucket (`NativeAuthController.java:46-49`).
- **Evidence:** `failure(TOO_MANY_REQUESTS, "auth_throttled", …)`.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** docs in `55339a2` describe the 429s as they are (no Retry-After). **Open (optional):** one 429 code and Retry-After (Java).
- **Retest:**

### TF-048 · S4 · inconsistency · docs · open
- **Found by:** Stage 2 · R5 · code · `8d22de6`
- **Spec:** `security.md:3-4` ("Items marked **planned** or **gap** … are also listed in `docs/product/known-limitations.md`")
- **Steps:** compare security.md's planned and gap items with `known-limitations.md` "Security" (lines 85-86).
- **Expected:** all listed.
- **Actual:** only the CSP; missing: HSTS (`:89-90`), invitation and rpc rate limits (`:111-113`), audit of failed permission checks and webhook failures (`:123-125`), MFA (`:25`), the role-matrix sweep (`:65`), per-org data export and account deletion (`:96-98`).
- **Evidence:** `known-limitations.md:85-86`.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** add the rows.
- **Retest:**

### TF-049 · S2 · bug · engine · fixed
- **Found by:** Stage 2 · R6 · code + synthetic export · `8d22de6`
- **Spec:** F06-AC3 ("a reorder … appear[s] in the Excel export"); F06 §13 / BR-28 (numbers follow the line order); F06 §7 ("Add line" between rows)
- **Steps:** drag a line above another in the same section, or add a manual line between two rows; generate; export.
- **Expected:** the Excel rows follow the sheet's order; "No." runs 2.1, 2.2, …
- **Actual:** Java keeps reorders (`sortAfter`) and placements (`sortHint`) only in `run_lines.sort_index` (`RunIndex.java:62-99`) and numbers from it (`BoqExports.java:143-165`); the export renders `result["lines"]` in the engine's order (`worker.py:285-287`, `export_xlsx.py:105-147`). Reorders and placements never reach the Excel, and "No." is out of sequence.
- **Evidence:** synthetic: k2 dragged above k1 → positions {k2: 2.1, k1: 2.2}; rows written `['2','first',…,'2.2']` then `['2','second',…,'2.1']`.
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `f09befd`: `BoqExports` sends `lineOrder` (keys by sort_index), `export_xlsx` sorts by it. Test `engine/tests/test_export_xlsx.py` (failed first); `NativeWorkerTest#verifyBoq` asserts the job's lineOrder.
- **Retest:**

### TF-050 · S2 · gap · engine · deferred
- **Found by:** Stage 2 · R6 · code + Duplex run · `8d22de6`
- **Spec:** F15 §7 ("the engine emits Unit values … imperial when the project is imperial"); F02 edge case ("the next run of each revision shows the converted values"); F12 ("Units: as in the run (metric or imperial per project)")
- **Steps:** set a project to imperial (`Projects.java:110`), generate a BoQ.
- **Expected:** ft, ft², ft³, lb, converted by the engine.
- **Actual:** Java sends `unitSystem` (`Runs.java:113`); the worker stores it in `flat["meta"]` (`worker.py:148-151`) and nothing reads it; units come from each rule's `unit`, metric by default (`rules.py:25,333`). The known limitation "imperial output supported by conversion" covers per-rule units only; the project setting does nothing.
- **Evidence:** Duplex with `meta.unitSystem="imperial"`: units `['item','m','m2','m3','nr','sum','t']`, same as metric.
- **Route:** deferred (EN-imperial: engine output in imperial units per project, F15 §7; recorded in known-limitations; F02/F15 status blocks say the setting has no effect yet)
- **Fix:** map default units to imperial (convert explicit metric or warn) with `UNIT_FACTOR`; or state in F02 and F15 that the setting has no effect yet.
- **Retest:**

### TF-051 · S3 · bug · engine · fixed
- **Found by:** Stage 2 · R6 · code + synthetic round trip · `8d22de6`
- **Spec:** F12 ("new rows without a key (proposed as manual lines under the group they sit in), rows it couldn't read"); CLAUDE.md rule 5
- **Steps:** export; insert a row with only a description, and a full new row below it; import. Later import another workbook with a new row on the same row number. Also mistype one Ref.
- **Expected:** both rows proposed under their group, or the incomplete one listed as a problem; no collision; a bad Ref reported for its row.
- **Actual:** a row with no unit and no quantity is taken as a group heading (`boq_import.py:109-111`), dropped, and resets `heading` to `""`, so the next new rows lose their group and land in Unclassified; new manual ids are `xlsx-{row}` (`:119`) and Java refuses an existing id (`Adjustments.java:210-214`), so a later import fails; Refs aren't checked, one bad Ref makes `Adjustments.codes` throw `unknown_code` and the whole batch fails (`Adjustments.java:223-236`).
- **Evidence:** rows 12 (description only) and 13 ("Extra wall", m2, 5) under group 2 → `manualItems: [{'id': 'xlsx-13', … no 'codes'}]`, `problems: []`.
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `7704cd9`, `83cd787`, `179987f` (the engine checks Refs against `groupCodesBySystem[groupBy]`, the workbook's grouping; `test_worker.py`, failed first).
- **Retest:**

### TF-052 · S3 · bug · engine · fixed
- **Found by:** Stage 2 · R6 · code + Duplex run · `8d22de6`
- **Spec:** BR-09 ("An edit … never silently dropped"); BR-03; CLAUDE.md rule 5
- **Steps:** 1. move a line to D.02, then switch the revision to a classification version without D.02; generate. 2. a reorder-only edit, then the line disappears with a new model version.
- **Expected:** the edit shows as not applied (note, warning or question); the vanished line's reorder raises `orphan_override`.
- **Actual:** 1. `classify.py:108,173` applies the edit only `if edit in codes`, otherwise silently falls back; `overrides._finish` records no field (`overrides.py:39-45`), so no edit marker, warning or log. 2. Java drops `sortAfter` and leaves reorder-only edits out of the engine input (`Runs.java:153-158`), so they never orphan; `RunIndex.java:93-95` ignores a missing target silently.
- **Evidence:** Duplex, `override:{key}` codes D.02 removed from the list: old code kept, `overridden: None`, no question, no warning about the edit.
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `5719dbc` (engine), `852393e` (app text), `83cd787` (Java: reorder-only edits go to the engine as an empty edit; `line-edits.test.ts` failed first; the `it.fails` cell in `model-versions.test.ts` flipped).
- **Retest:**

### TF-053 · S3 · bug · engine · fixed
- **Found by:** Stage 2 · R6 · code · `8d22de6`
- **Spec:** BR-04; CLAUDE.md rule 9 ("stored decisions depend on them matching across runs and model versions")
- **Steps:** federate two models of the same discipline; answer an `overlap` question; upload a new version of one under a new file name (`…_rev2.ifc`); generate.
- **Expected:** the same question id; the answer still applies.
- **Actual:** `model_key` is `{discipline}/{fileName}` when two models share a discipline (`federation.py:63-67`), used in the overlap id and answer values (`:383-386`); a new file name → new id → the question comes back.
- **Evidence:** `qid = f"overlap:{ka}|{kb}:{cls}"`; `fileName` is the upload name (`worker.py:115`, `pipeline.py:120`).
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `5719dbc`: the overlap question between two models of one discipline is keyed on the model's name (stable across versions). Test `test_federation.py` (failed first). Renaming the model asks again; answers given before this change (keyed on the file name) are asked once more.
- **Retest:**

### TF-054 · S3 · inconsistency · engine · fixed
- **Found by:** Stage 2 · R6 · code + synthetic export · `8d22de6`
- **Spec:** F12-AC1 ("its totals match the sheet"); F12 table "subtotals"; F06 §3 (per group count and the quantity sum when the unit is shared)
- **Steps:** export a BoQ whose code list has nested or unpadded numeric codes (2 and 10).
- **Expected:** groups and subtotals as in the sheet.
- **Actual:** the Excel groups only by the top-level code (`export_xlsx.py:110`), the sheet nests every level (`model.ts:141-170`); string sort puts "10" before "2" (`export_xlsx.py:120`), the sheet sorts numerically (`model.ts:131`); the only subtotals are Amount formulas (`=SUM(F…)`, 0 until rates are entered, `:148-155`), no quantity subtotal, so AC1 can't be checked.
- **Evidence:** group `10` written before `2`; subtotal rows `=SUM(F7:F7)`, `=SUM(F11:F12)` only.
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `9cbd591`: nested sections by the full code path in numeric order, SUBTOTAL rows with the line count and the quantity when the unit is shared, TOTAL as SUBTOTAL; the edits import reads the deepest section. `test_export_xlsx.py` (failed first).
- **Retest:**

### TF-055 · S3 · bug · engine · fixed
- **Found by:** Stage 2 · R6 · code · `8d22de6`
- **Spec:** F06 §2 ("numbers use the project locale and the rule set's rounding"); F12 ("Locale: number formats … from the project locale"); F12-AC1
- **Steps:** export lines with 3-decimal quantities, or a fractional `nr`/`item` line (a manual item of 0.4).
- **Expected:** the Excel displays the sheet's value.
- **Actual:** `_qfmt` fixes `#,##0.00`, `0` for nr and item, 3 decimals for t (`export_xlsx.py:64-65`): 0.4 item shows "0", 12.345 m³ shows 12.35; the sheet shows up to 6 decimals (`sheet.tsx:203`); the org `numberFormat` is only dumped as JSON on the cover (`:170`). Stored values are exact.
- **Evidence:** the code cited.
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `9cbd591`: a quantity's number format uses the decimals the value has (≤ 6). `test_export_xlsx.py` (failed first).
- **Retest:**

### TF-056 · S3 · question · engine · open
- **Found by:** Stage 2 · R6 · code + Duplex run · `8d22de6`
- **Spec:** F06 §6 ("Exclude a line: it leaves the totals"; "quantity edits feed derived lines (EN-003)")
- **Steps:** exclude a source line of a derived rule (the concrete wall line formwork derives from); generate.
- **Expected:** the spec is silent; a user would expect the derived line to drop the excluded source, as for a quantity edit.
- **Actual:** exclusions apply after derived lines (`pipeline.py:305` vs `:231`): the derived line still counts the excluded source; a quantity edit to 0 reduces it.
- **Evidence:** Duplex `formwork-walls | m2`: 153.8 baseline, 153.8 after excluding `walls | Foundation - Concrete (417mm) | True |  | m2`, 24.97 after editing it to 0.
- **Route:** answered by the owner (Q48, P54: the first option); fix now · B7 (owner answers)
- **Fix:** decide; then apply `excluded` before `run_derived` with a trace note, or document it in F06 §6.
- **Retest:**

### TF-057 · S3 · question · java · open
- **Found by:** Stage 2 · R6 · code · `8d22de6`
- **Spec:** BR-25 ("Saving writes an Excel export … Later exports of a saved version return that same file")
- **Steps:** save a version; make its `issued_boq_xlsx` export job fail every attempt.
- **Expected:** retried or regenerable from the immutable run and frozen metadata.
- **Actual:** the version stays `issued` with `frozen.exportIds[0]` pointing at an export with no `storage_key`; `startRun` keeps returning the failed job (`BoqExports.java:61-68`, checks `job_id IS NOT NULL`, not its status); download answers 404 (`:138`). Not reproduced.
- **Evidence:** code read.
- **Route:** answered by the owner (Q49, P54: the first option); fix now · B7 (owner answers)
- **Fix:** re-enqueue a failed frozen export with the stored metadata, or block the save until it succeeds.
- **Retest:**

### TF-058 · S4 · inconsistency · engine · fixed
- **Found by:** Stage 2 · R6 · code · `8d22de6`
- **Spec:** F12 "Not in the models" ("Quantities are taken from the models only. Work not modelled as objects is included only where derived or added by hand (N manual lines)."); BR-12
- **Steps:** export a BoQ; read cell A4 of the BoQ sheet.
- **Expected:** the F12 text (the share page has it, `messages/en/shares.json:83`).
- **Actual:** "Review work not in the models. This bill includes {n} manual line(s)." (`export_xlsx.py:99-100`).
- **Evidence:** the cited line.
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `9cbd591`: the Cover's A4 has F12's wording. `test_export_xlsx.py`.
- **Retest:**

### TF-059 · S4 · bug · engine · fixed
- **Found by:** Stage 2 · R6 · code · `8d22de6`
- **Spec:** `rules-language.md` ("rounding (step, nearest/up/down …)")
- **Steps:** round 0.125 at step 0.01 `nearest`, or 2.5 at step 1.
- **Expected:** half-up (0.13, 3), as Excel's ROUND.
- **Actual:** Python `round` (banker's rounding) in `RuleEngine.round_` (`rules.py:437`) and `ROUND()` (`expr.py:243-249,277`): 0.12, 2.
- **Evidence:** `round(0.125/0.01)` = 12, `round(2.5)` = 2.
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `ba2f68c`: `expr.round_half_up` (halves away from zero, 1e-9 tolerance) in ROUND() and rule rounding. Test `test_expr.py` (failed first). No Duplex number moves.
- **Retest:**

### TF-060 · S4 · gap · engine · fixed
- **Found by:** Stage 2 · R6 · code · `8d22de6`
- **Spec:** CLAUDE.md rule 5 ("every decision is logged"); known-limitations "Deductions … embedded … also across models"
- **Steps:** federate models where a column's or slab's mesh isn't closed (the boolean fails).
- **Expected:** a log entry or warning for the skipped pair.
- **Actual:** `geometry.shared_volume` returns `None` on failure (`geometry.py:117-125`) and `_embedded_across` skips silently (`federation.py:618`); the overlap path counts its fallbacks (`:268-271`).
- **Evidence:** the cited code.
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `5719dbc`: failed embedded-element pairs are counted in `log.federation.embedded_failed`. Test `test_federation.py` (failed first).
- **Retest:**

### TF-061 · S3 · inconsistency · docs · fixed
- **Found by:** Stage 2 · R7 · code · `8d22de6`
- **Spec:** `docs/architecture/storage-jobs-realtime.md:14-24` (Key layout)
- **Steps:** compare the table with the keys Java builds and the worker writes.
- **Expected:** the layout an operator would use to find, purge or back up objects.
- **Actual:** parse artefacts are under `orgs/{orgId}/models/{modelVersionId}/{newId}/attempt-N/`, not `orgs/{orgId}/parses/{sha256}/…` (dedupe is a DB lookup); every job output has an `attempt-N/` sub-prefix (runs, diffs, exports, previews); exports are `exports/{exportId}/attempt-N/export.xlsx`, not `{fileName}`; `imports/{id}/source.xlsx` is written by the API from a multipart upload, not by a browser PUT; nothing writes `presets/{presetVersionId}/codelist.json.gz`; the temporary `internal/code-lists/{actor}/{id}` key (outside `orgs/`) is missing.
- **Evidence:** `Models.java:323`, `Jobs.java:74-76`, `worker.py:121-122,288`, `ImportEdits.java:43-46`, `LibraryFiles.java:56`.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: the storage key layout rewritten from the code (attempt-N, uploads, templates, internal code lists, cleanup).
- **Retest:**

### TF-062 · S3 · inconsistency · docs · fixed
- **Found by:** Stage 2 · R7 · code · `8d22de6`
- **Spec:** `docs/architecture/api-conventions.md:72` ("422 | engine refused a document | `preset_invalid` (+ `problems[]`)")
- **Steps:** publish a draft with problems; send a file the engine refuses to `POST /codelists/read`.
- **Expected:** `422 preset_invalid` with `problems`.
- **Actual:** publish answers `409 draft_has_problems` with `details.problems` (`Library.java:247`; app and scenario rely on it); an engine 422 on rpc becomes `400 engine_input` (`WorkerClient.java:55-65`); no 422 or `preset_invalid` anywhere, none in `openapi.yaml`.
- **Evidence:** grep `preset_invalid` matches only api-conventions.md.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: api-conventions error rows as answered.
- **Retest:**

### TF-063 · S4 · inconsistency · docs · fixed
- **Found by:** Stage 2 · R7 · code · `8d22de6`
- **Spec:** `api-conventions.md:131` ("Emails are rendered server-side in the recipient's `locale` (English only in v1)")
- **Steps:** compare with `known-limitations.md:82-83`, F13's status block, `backend.md`, `overview.md`, `EmailDelivery.java`.
- **Expected:** one statement matching the code.
- **Actual:** the others and the code say English and Serbian (`mail/EmailDelivery.java:111,140,148`).
- **Evidence:** as cited.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: emails in English and Serbian; no RateLimit headers.
- **Retest:**

### TF-064 · S4 · inconsistency · docs · fixed
- **Found by:** Stage 2 · R7 · code · `8d22de6`
- **Spec:** `docs/architecture/deployment.md:60,67` (OpenTelemetry traces across web → api → worker, "built in BE-025")
- **Steps:** grep for OpenTelemetry / traceparent.
- **Expected:** traces in all three.
- **Actual:** only the API (Micrometer tracing, `services/api/pom.xml`); app and engine none; the worker correlates through `jobId` in its logs (`worker_queue.py:21-27`); `docs/operations/pilot.md:82` says it correctly.
- **Evidence:** grep `opentelemetry|traceparent|otel` matches only the pom.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: traces in the API only (Micrometer OTLP); jobs followed by jobId.
- **Retest:**

### TF-065 · S4 · inconsistency · docs · fixed
- **Found by:** Stage 2 · R7 · code · `8d22de6`
- **Spec:** `overview.md` Intended vs built ("Client always loads up to 20,000 lines"); `known-limitations.md:66`; F06 status block
- **Steps:** read `useLines` in `apps/app/src/api/hooks/sheet.ts:16-31`.
- **Expected:** a cap at 20,000.
- **Actual:** it follows `nextCursor` to the end, 20,000 per request: every line of the run is loaded into the browser, whatever the size (worse than described for big BoQs).
- **Evidence:** `do { … limit: 20000 … cursor = page.nextCursor ?? undefined; } while (cursor);`
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: overview and F06 say every line of the run is loaded (20,000 per request).
- **Retest:**

### TF-066 · S4 · inconsistency · docs · fixed
- **Found by:** Stage 2 · R7 · code · `8d22de6`
- **Spec:** `docs/development/design-system.md:40` ("document in Storybook or a `/_dev/ui` page")
- **Steps:** look for `.storybook` or a `_dev` route in `apps/app`.
- **Expected:** one exists.
- **Actual:** neither (`/_dev/*` was the deleted mock's prefix).
- **Evidence:** `find apps/app/app apps/app/src -path "*dev*"` → nothing.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: no Storybook; components documented by their doc comments.
- **Retest:**

### TF-067 · S4 · inconsistency · docs · fixed
- **Found by:** Stage 2 · R7 · code · `8d22de6`
- **Spec:** several docs (index and path slips)
- **Steps:** see each item.
- **Expected:** ids, paths and labels match the repo.
- **Actual:** 1. "S01–S37" in `docs/README.md:29`, `test-plan.md:167,444`; screens.md goes to S38. 2. link labels still show `../12-ifc-corpus-catalogue.md` (targets fine): `known-limitations.md:19`, `overview.md:88`, `testing/README.md:107,135`. 3. paths not from the root: `engine.md:260` `tests/test_expr.py` (→ `engine/tests/test_expr.py`), `scope-and-acceptance.md:126` `scripts/pseudo-locale.test.mjs` (→ `apps/app/scripts/…`). 4. `engine-worker.md:205` "a `GET /health` on both transports": the queue worker serves no HTTP. 5. `services/api/README.md:186` omits `/_test/auth-limits/reset` (`SuiteSupport.java:158`). 6. `commands.md:3` "Every npm script" omits `npm run perf -w @ifc-boq/tests`, `i18n:pseudo` and `start` in `apps/app`.
- **Evidence:** as cited.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2` and `179987f` (`services/api/README.md` lists `/_test/auth-limits/reset`).
- **Retest:**

### TF-068 · S4 · inconsistency · ops · fixed
- **Found by:** Stage 2 · R7 · code · `8d22de6`
- **Spec:** `test-plan.md` §9.7 (nothing points at the PoC: `apps/web`, …); P44/FE-046
- **Steps:** `grep -n '"apps/web"' package-lock.json`.
- **Expected:** no reference.
- **Actual:** `package-lock.json:355-356` has an extraneous `"apps/web"` entry (`@ifc-boq/web`), left after `cf58e32`; two provenance comments (`apps/app/src/features/library/lib/names.ts:2`, `readable.ts:2`) are harmless. Note: `npm install` on Windows also rewrites the lock's `@emnapi/*` metadata (Stage 0), so prune on one platform deliberately.
- **Evidence:** as cited.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: the stale `apps/web` entry removed from `package-lock.json` (`npm ci` in the gate).
- **Retest:**

### TF-069 · S4 · bug · java · refuted
- **Found by:** Stage 2 · R7 (noticed outside docs) · code · `8d22de6`
- **Spec:** `security.md` / the API's own message (passwords 15–128 characters)
- **Steps:** set a password of 200 characters.
- **Expected:** refused with the message, or the message says 256.
- **Actual:** `NativeCredentials.java:73` accepts up to 256; its message (`:76`) says "15 to 128 characters" (R5 read `:72-74` as 15–128 code points: check which).
- **Evidence:** as cited.
- **Route:** refuted live (Stage 3, s3a-accounts): the limit is 15–128 code points and the message says so; no change
- **Fix:** align limit and message.
- **Retest:**

### TF-070 · S4 · bug · ops · fixed
- **Found by:** Stage 2 · R7 (noticed outside docs) · code · `8d22de6`
- **Spec:** `docs/development/environment.md` (`LOCAL_*_PORT` move the local stack)
- **Steps:** `LOCAL_MAIL_UI_PORT=18025 npm run local:up`.
- **Expected:** the printed mail URL uses 18025.
- **Actual:** `scripts/local.mjs:85` always prints port 8025.
- **Evidence:** as cited.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: the printed mail URL uses `LOCAL_MAIL_UI_PORT`.
- **Retest:**

### TF-071 · S2 · bug · java · fixed
- **Found by:** Stage 2 · R1 · code (runtime status unconfirmed) · `8d22de6`
- **Spec:** `api-conventions.md:58-74` (error body `{code, message, details}`, `413 too_large`, `500 internal`); `permissions.md:150` (`401 unauthenticated` = not signed in)
- **Steps:** signed in on native auth: `GET /api/v1/notifications?limit=5000` (contract max 1000); a workbook over 20 MiB to `POST /codelists/read`, `/presets/{id}/template-import`, `/revisions/{id}/edits-import`; any unexpected RuntimeException.
- **Expected:** `400 invalid_parameter`, `413 too_large`, `500 internal`.
- **Actual:** `ApiErrors` (`http/ApiErrors.java:16-46`) handles none of `ConstraintViolationException`/`HandlerMethodValidationException` (the generated interfaces are `@Validated` with `@Max`, e.g. `NotificationsApi.java:24,44`), `MaxUploadSizeExceededException`/`MultipartException` (multipart capped at 20 MB in `application.yml:13`, so `LibraryFiles`' own `too_large` at `:20,118-119` is unreachable), `HttpRequestMethodNotSupportedException`, or `Exception`. All go to `/error`, which `SecurityConfiguration.java:45,52` denies (only `ASYNC` dispatch permitted, `anyRequest().denyAll()`); native mode doesn't save the security context (`NativeIdentityFilter.java:57-58`), so the error dispatch is anonymous and answers **`401 unauthenticated`** (OIDC: an empty `403`). The app treats any 401 as "sign in again" (`apps/app/src/auth/index.tsx:39-46`) and native sign-in sends a user with a valid session straight back (`auth/adapters/native.tsx:100`): a failing query can loop.
- **Evidence:** grep for `ConstraintViolation|MaxUploadSize|ExceptionHandler(Exception|"internal"` in `services/api/src/main/java` finds nothing; no test covers 405, 413, 500 or `/error`. Seen live on L (main session, during TF-011): signed in with a valid session, `GET /api/v1/admin;x=1/orgs` and `GET /api/v1//admin/orgs` (both rejected by the firewall) answer `401 {"code":"unauthenticated","message":"Sign in to continue."}`.
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `ff738b6`: ERROR dispatch permitted; `ErrorPages` answers `/error` with the API body and status; `ApiErrors` maps parameter validation, multipart limits, 405, Spring's ErrorResponse and a logged 500. Test `ErrorResponsesTest` (failed first: 401).
- **Retest:** L: `limit=5000` → 400 `invalid_parameter`; `//admin/orgs`, `;x=1` → 400 `invalid_request`; `DELETE /me` → 405; 21 MiB code list → 413; NUL in a name → 500 (TF-176).

### TF-072 · S3 · inconsistency · contract · fixed
- **Found by:** Stage 2 · R1 · code · `8d22de6`
- **Spec:** `openapi.yaml:2313-2321` (`LimitError` = `Error` + **top-level** required `limit`, `current`, `max`), the 402 of every limited operation (`:2021-2023`)
- **Steps:** trigger any 402 (a third active project on Free).
- **Expected:** a body matching `LimitError`.
- **Actual:** Java puts them in `details` (`billing/LimitReached.java:26-28`); the app reads `error.details.*` (`limit-dialog.tsx:38-41`) and the scenarios assert `details` (`projects.test.ts:43`, `orgs.test.ts:97`): Java, app and tests agree; the contract (and the generated TS type) says otherwise; `api-conventions.md:67` is ambiguous.
- **Evidence:** as cited.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `8745980`: `LimitError.details` in the contract; its KNOWN_MISMATCHES entry removed.
- **Retest:**

### TF-073 · S3 · gap · app · fixed
- **Found by:** Stage 2 · R1 · code · `8d22de6`
- **Spec:** `api-conventions.md:92-94` ("`POST` endpoints that create jobs or send emails accept `Idempotency-Key`… The frontend sets it for generate, export, open share link, save version")
- **Steps:** grep app, contract and suites for `Idempotency`.
- **Expected:** declared in the contract, sent by the app per user action, proven by a suite.
- **Actual:** Java implements it (`http/Idempotency.java:28-52`) on generateRun, exportRun, exportDiff, importBoqEdits, previewPreset, createShareLink, inviteMember, resendOrgInvitation, completeModelUpload, retryModelVersion, issueRevision, confirmBoq; `openapi.yaml` never declares the header (only the info text, line 7); the app never sends it; no test sends it. A double click or retry creates duplicate runs, exports, invitation emails.
- **Evidence:** `grep -rn -i idempot apps/app/src` → nothing.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23` (app sends `Idempotency-Key`), `03189a3` (a fresh key per preview, 3 s reuse), `9efea85` (the header on 13 operations in the contract, C14; a bad key → `400 invalid_parameter`; `tests/contract/idempotency.test.ts`).
- **Retest:**

### TF-074 · S3 · bug · java · fixed
- **Found by:** Stage 2 · R1 · code · `8d22de6`
- **Spec:** `api-conventions.md:54` ("Unknown fields in requests are rejected with `400 unknown_field`"); `openapi.yaml:2678,2684,2956` (`scope: ModelScope`; `run-request.schema.json:75-92` `additionalProperties: false`); CLAUDE.md rule 5
- **Steps:** `POST /projects/{id}/models {"name":"A","scope":{"exlude":[{"ifcClass":"IfcFurnishingElement"}]}}`, then generate.
- **Expected:** `400`.
- **Actual:** `201`, stored as given: `ModelScope` is opaque in the pom (`pom.xml:142-146`, "The worker validates their schema"), `Models.java:93-95,107-110` stores it, `Runs.java:84` forwards it, but the worker never validates scope (`worker.py:139-167`); `federation.py:204,216,221` reads only `exclude`/`include`: the typo is ignored and the furniture measured. (The UI can't edit scope: known; API clients only.)
- **Evidence:** no `ModelScope` validation in `engine/ifc_boq`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `179987f`: a model's scope is checked through the engine's `check` rpc (kind `model-scope`, `400 invalid_scope` with problems); the run refuses an invalid scope. `test_presets.py`, `test_worker.py`, `model-lifecycle.test.ts` (failed first).
- **Retest:**

### TF-075 · S3 · bug · java · fixed
- **Found by:** Stage 2 · R1 · code · `8d22de6`
- **Spec:** `openapi.yaml:3072-3076` (`ManualItemInput.item` is `ManualItem`, `additionalProperties: false`, `kind` enum); `api-conventions.md:54`
- **Steps:** `POST /boqs/{id}/manual-items {"item":{"id":"X1","description":"d","unit":"m","kind":"bogus","colour":1}}`, then generate.
- **Expected:** `400` on the add.
- **Actual:** `201` (`Adjustments.java:202-221` checks only non-blank fields and the quantity); every later run fails (`worker.py:166-167` `validate(doc, "manual-item")`): the BoQ can't be generated until the item is removed. The app's form sends valid kinds only.
- **Evidence:** as cited.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `8745980`: manual items checked against the engine's ManualItem shape (400 invalid_body). `line-edits.test.ts` (failed first).
- **Retest:**

### TF-076 · S3 · inconsistency · java · open
- **Found by:** Stage 2 · R1 · code · `8d22de6`
- **Spec:** F03 (`F03-models-and-versions.md:34`: `POST /models/{id}/versions` "Checks entitlements (`402 limit_reached`, `maxModelVersionMb`, `processingMinutesPerMonth`)"); the contract's declared responses
- **Steps:** use up the month's processing minutes; upload a model.
- **Expected:** `createModelVersion` refuses before any bytes go to storage; every 402 declared.
- **Actual:** `createVersion` checks only `maxModelVersionMb` (`Models.java:163-165`); minutes are checked at enqueue (`Jobs.java:94-96`), in `complete`/`retry` (`Models.java:241,252,318`): the whole file is uploaded, then refused with a 402 the contract doesn't declare. Also undeclared: `updateOrg` (`Orgs.java:79-80`), `resendOrgInvitation` (`Invitations.java:104-105`).
- **Evidence:** as cited.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** Java part in `179987f`: `createVersion` checks `processingMinutesPerMonth` before any upload URL (`limits.test.ts`). **Open:** the Invitations part (seat check vs plan), app agent.
- **Retest:**

### TF-077 · S3 · inconsistency · app · fixed
- **Found by:** Stage 2 · R1 · code · `8d22de6`
- **Spec:** `api-conventions.md:60-61` ("The UI translates by `code`… It shows `message` only as a fallback")
- **Steps:** create a share link with public links off; export or save without a run; compare unfinished runs.
- **Expected:** a translated reason.
- **Actual:** `useErrorMessage` (`use-error-message.ts:14-15`) shows `errors.generic` for codes not in `messages/en/errors.json`; untranslated: `public_links_off` (`ShareLinks.java:89`), `no_run` (`BoqExports.java:79`, `Boqs.java:278`, `ImportEdits.java:40,42`), `run_not_ready` (`Diffs.java:55`), `change_note_required`, `preset_archived`, `no_draft`, `model_too_large` (`Models.java:163`), `upload_size_mismatch`, `upload_parts_invalid`, `unknown_field`, `invalid_param`/`invalid_parameter`, `rate_limited`, `auth_throttled` (sign-in shows the server's English message, `native.tsx:119`).
- **Evidence:** 0 hits per code in `apps/app/src`, `messages/en`.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: a text for every error code Java answers; sign-in translates by code. `components/errors/error-codes.test.ts` reads the Java sources (failed first).
- **Retest:**

### TF-078 · S3 · test-gap · suites · fixed
- **Found by:** Stage 2 · R1 · code · `8d22de6`
- **Spec:** `contract-changes.md` ("the suites … stay the spec that Java must pass")
- **Steps:** `grep -rhoE 'expectSchema\("[A-Za-z]+"' tests`.
- **Expected:** main responses validated against `openapi.yaml`.
- **Actual:** only `Me` and `Plan`; all else partial `toMatchObject`; with `default-property-inclusion: non_null` (`application.yml:16`) a required field Java leaves null is silently omitted (TF-072 went unnoticed this way).
- **Evidence:** 2 call sites.
- **Route:** fix now · B6 (API-level test gaps (scenarios, JUnit, engine tests))
- **Fix:** `7077e83`: every suite client validates each JSON response against `openapi.yaml` (`tests/support/contract.ts`); known mismatches listed by finding (TF-072, TF-189).
- **Retest:** harness: contract and scenario suites green with it; it found TF-189.

### TF-079 · S4 · inconsistency · docs · fixed
- **Found by:** Stage 2 · R1 · code · `8d22de6`
- **Spec:** `api-conventions.md:66-74,137-138` (error table, rate-limit headers); `permissions.md:155`
- **Steps:** compare the table with Java's error sites.
- **Expected:** the table matches.
- **Actual:** 413 for models is `model_too_large`, not `too_large` (`Models.java:163`); a bad parameter has three codes: `invalid_param` (most sites, e.g. `Idempotency.java:37`), `invalid_parameter` (`ApiErrors.java:39`), `invalid_cursor` (`AuditReader.java:69`); public-share operations don't declare 429. (422 row: TF-062; 403 details: TF-013; 429 headers: TF-047.)
- **Evidence:** as cited.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `8745980`: one bad-parameter code (`invalid_parameter`, `invalid_cursor` kept for audit); 429 declared on the public share operations.
- **Retest:**

### TF-080 · S4 · question · contract · open
- **Found by:** Stage 2 · R1 · code · `8d22de6`
- **Spec:** F03 (`:84` lists `DELETE /models/{modelId}`); the contract's operations
- **Steps:** diff the contract against the app's calls.
- **Expected:** each operation used by the app or deliberately API-only.
- **Actual:** 9 of 162 never called: `deleteModelVersion` (known), `archiveModel` (no UI removes a model; Java implements it, `ModelController.java:45-47`, the audit label exists; not in known-limitations or F03's status block), `setOverride`, `removeOverride` (superseded by `applyLineEdits`), `getRunResult`, `listOrgs`, `getOrg`, `getRevision`, `billingWebhook` (external). The app calls no path that isn't an operation.
- **Evidence:** the diff.
- **Route:** answered by the owner (Q50, P54: the first option); fix now · B7 (owner answers)
- **Fix:** decide "remove model" in the UI (or list it as a limitation); mark the rest API-only or retire them.
- **Retest:**

### TF-081 · S4 · inconsistency · java · open
- **Found by:** Stage 2 · R1 · code · `8d22de6`
- **Spec:** `api-conventions.md` "Authentication" (`tests/contract/auth.test.ts`: every other operation `401` without a session); `permissions.md:106` (*non-admins* get 404 on `/admin/*`)
- **Steps:** `GET /api/v1/admin/overview` with no cookie, native mode and OIDC mode.
- **Expected:** the same answer.
- **Actual:** native (production) answers `404`: `NativeIdentityFilter.java:62` turns any failure on an admin path, `unauthenticated` and `session_expired` included, into 404; OIDC (the suites) answers `401`, which `auth.test.ts:24` asserts, so the suite tests the mode production doesn't use; an admin whose session expired gets 404, not sign-in.
- **Evidence:** `IdentityFilter.java:43-50` rewrites only after a token was decoded.
- **Route:** answered by the owner (Q51, P54: the first option); fix now · B7 (owner answers)
- **Fix:** 401/`session_expired` for missing or expired sessions and 404 only for signed-in non-admins, or document 404 for both and align the suite.
- **Retest:**

### TF-082 · S3 · bug · ops · fixed
- **Found by:** Stage 2 (during the TF-011 retest) · main session · L · `fc78b12`
- **Spec:** `docs/development/local-setup.md` / `CLAUDE.md` (`npm run local:up` builds and starts the backend; `scripts/local.mjs` `up` runs `compose up -d --build`)
- **Steps:** on Windows with Docker Compose v5.6.0 (Docker 29.8.2), change a file under `services/api`, then `npm run local:up`.
- **Expected:** the images rebuild and the stack starts.
- **Actual:** exit 1 right after `load local bake definitions`: `additional privileges requested: pass "--allow=fs.read=services\api\Dockerfile" to grant requested privileges`. Compose v5 builds through Bake, and Bake wants an entitlement for the Dockerfile path; `COMPOSE_BAKE=false` doesn't help on v5. Stage 1 passed only because nothing needed a rebuild. CI's `local` job (Linux) is green, so it may be Windows-specific (the backslash path). Workaround used: `docker build -t boqlet-local-api:latest -f services/api/Dockerfile .`, then `docker compose -p boqlet-local -f ops/local/compose.yaml up -d --no-build api`.
- **Evidence:** session scratchpad `lanes/logs/tf011-local-up.log`, `tf011-local-up2.log`.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: `scripts/local.mjs` uppercases the drive letter and runs `docker compose` from the repo root (Bake compared paths case-sensitively).
- **Retest:** L: from a lowercase `c:\` working directory the three images build.

### TF-083 · S4 · inconsistency · java · fixed
- **Found by:** Stage 3 · 3c pilot (passive) · P, L · fc78b12
- **Spec:** `docs/domain/permissions.md` / `api-conventions.md` (public routes: `/plans`, `/public/*`, `/invitations/*` need no session); RFC 9110 (HEAD is GET without a body)
- **Steps:** `curl -sI https://booqlet.com/api/v1/plans`; `curl -sI http://127.0.0.1:8080/api/v1/plans`.
- **Expected:** the same status as `GET` (200).
- **Actual:** `HEAD` answers `401`, `GET` `200`, on P and L: the public-route rule is `"GET".equals(method)` (`NativeIdentityFilter`, `IdentityFilter`, the token resolver in `SecurityConfiguration`), so HEAD on `/plans`, `/public/*`, `/invitations/*` needs a session (link checkers and uptime probes that use HEAD get 401).
- **Evidence:** (session scratchpad `stage3/out/s3c-pilot/`) session scratchpad `stage3/out/s3c-pilot/notes.md`.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `cd37865`: `RequestPaths.publicRead` (GET or HEAD) in both identity filters and the bearer resolver. `AccountSecurityTest`, `orgs.test.ts` (failed first).
- **Retest:**

### TF-084 · S4 · bug · ops · verified
- **Found by:** Stage 3 · 3c pilot (passive) · P · fc78b12
- **Spec:** `docs/operations/` (the pilot checks run from an operator's machine); test-plan §9.3 (`check-public-edge.py`)
- **Steps:** on Windows, `python ops/pilot/check-public-edge.py` in a console with the default code page.
- **Expected:** the checks run and print their results.
- **Actual:** `UnicodeEncodeError: 'charmap' codec can't encode character '→'` on the first `print` (cp1252), before any API check runs. With `python -X utf8` it passes.
- **Evidence:** (session scratchpad `stage3/out/s3c-pilot/`) session scratchpad `stage3/out/s3c-pilot/notes.md`.
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: `check-public-edge.py` switches stdout to UTF-8 and prints `->`.
- **Retest:** P: `python -I -X utf8 ops/pilot/check-public-edge.py` runs and prints `->` (and on cp1252 consoles, as tested).

### TF-085 · S1 · bug · java/app · verified
- **Found by:** Stage 3/4 · s3a-shares · L · fc78b12
- **Summary (spec, steps, actual, fix):** public share: clicking any line crashes the page ("Something went wrong"); no line explanation ever on a share link. F18-AC1, v1-15. PublicShares.java:91 detail.setNotes(null); line-detail.tsx:258 reads line.notes.length; all 41 public details lack notes (member endpoint has it). Sheet and 3D render. e2e-java/main-flow.spec.ts opens the share but never clicks a line. Evidence q1-detail.mjs, notes-check.mjs, q1-detail-b-0.png, q1-detail-trace.zip. Fix: notes: [] in public detail, guard in UI, click a line in e2e.
- **Evidence:** session scratchpad `stage3/out/s3a-shares/` (`report.txt` and the scripts named)
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `1be66cb`: public lines and line detail carry an empty `notes` (required by the contract; the team's notes stay private). Tests: `tests/scenarios/shares.test.ts` (`notes` is `[]` on every line and the detail; failed first: missing), `apps/app/e2e-java/main-flow.spec.ts` clicks a share line and expects the detail.
- **Retest:** harness gate on `1be66cb` (clean clone): scenarios green, browser smoke 13/13 with the share-line click; CI 44980195142 green, deployed on P 2026-11-22 03:36 UTC.

### TF-086 · S3 · question · docs · open
- **Found by:** Stage 3/4 · s3a-shares · L · fc78b12
- **Summary (spec, steps, actual, fix):** share shows a hand-edited quantity (4 → 1234.5) as plain measured value, source "measured", no mark, page and public Excel. BR-09 (share links show the engine's value, the edit and its reason) vs F18 §2 / BR-56 (no edit history). Evidence shares-result.json (q1.qtyEdited), public-export.json.
- **Evidence:** session scratchpad `stage3/out/s3a-shares/` (`report.txt` and the scripts named)
- **Route:** answered by the owner (Q52, P54: the first option); fix now · B7 (owner answers)
- **Fix:**
- **Retest:**

### TF-087 · S4 · inconsistency · java · fixed
- **Found by:** Stage 3/4 · s3a-shares · L · fc78b12
- **Summary (spec, steps, actual, fix):** share rate limit: one counter per address across all tokens, reset each clock minute; F18 says "per token and IP". 429 at request 301, no Retry-After. ShareController.java:111-122, q4-ratelimit.mjs.
- **Evidence:** session scratchpad `stage3/out/s3a-shares/` (`report.txt` and the scripts named)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `cd37865`: the share limit counts per address and token (300/min), at most 50 tokens per address a minute. `AccountSecurityTest` (failed first).
- **Retest:**

### TF-088 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3/4 · s3a-shares · L · fc78b12
- **Summary (spec, steps, actual, fix):** (Q): no automated test for public line detail and 3D in a browser, /s/* headers, the 429, expiry over time, revoke in the browser, the free badge, admin revoking any link, share dialog defaults. Scripts shares.mjs, q1-browser.mjs, q2-browser.mjs, q4-ratelimit.mjs, free.mjs.
- **Evidence:** session scratchpad `stage3/out/s3a-shares/` (`report.txt` and the scripts named)
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:**
- **Retest:**

### TF-089 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3/4 · s3a-shares · L · fc78b12
- **Summary (spec, steps, actual, fix):** (M): no test for every Excel line + per-unit totals vs the sheet API, item texts in the export, frozen export without WORKING and byte-identical, free exportWatermark via the plan, import of a file from another BoQ with a run, change-report sheets vs diff API, Exports tab in a browser. Scripts m1-export.mjs, q3-m3.mjs, m3-frozen.mjs, m4-import.mjs, m5-v2.mjs, m-browser.mjs.
- **Evidence:** session scratchpad `stage3/out/s3a-shares/` (`report.txt` and the scripts named)
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:**
- **Retest:**

### TF-090 · S4 · question · docs · open
- **Found by:** Stage 3/4 · s3a-matrix · L · fc78b12
- **Summary (spec, steps, actual, fix):** project permissions.archive stays true while archived (needed to restore) vs permissions.md "false for every write while archived", test-plan C4, F02-AC4. ProjectAccess.ARCHIVED_ACTIONS = {view, seeAudit, archive}; projects.test.ts:100 asserts archive: true. Evidence matrix.md KEYS-archived-OWN/ADM/LEAD. Route owner. Fix: document restore as exception or split archive/restore.
- **Evidence:** session scratchpad `stage3/out/s3a-matrix/` (`report.txt` and the scripts named)
- **Route:** answered by the owner (Q53, P54: the first option); fix now · B7 (owner answers)
- **Fix:**
- **Retest:**

### TF-091 · S4 · gap · java · fixed
- **Found by:** Stage 3/4 · s3a-matrix · L · fc78b12
- **Summary (spec, steps, actual, fix):** review comments never audited (21 comments, 0 events of 1,433). Boqs.comment (Boqs.java:196-206) writes none. F09 minimum list has no comment action (maybe intended). BR-51. Evidence probe-audit.mjs. Fix: revision.commented event + F09, or document.
- **Evidence:** session scratchpad `stage3/out/s3a-matrix/` (`report.txt` and the scripts named)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `8745980`: `revision.commented` audited (comment id and line key, not the text). `versions.test.ts` (failed first).
- **Retest:**

### TF-092 · S3 · test-gap · suites · fixed
- **Found by:** Stage 3/4 · s3a-matrix · L · fc78b12
- **Summary (spec, steps, actual, fix):** not automated: the full matrix (P-PADM, P-ANON on most rows, extra rows), C4 for every write (BoQ, share-link, decision writes), S7 search ?q= per persona, permission key vs server answer per call, owner as four-eyes submitter, four-eyes off, 409 approval_off and not_approved, TF-011 spellings per persona. Run: node setup.mjs; node matrix.mjs --delete-org; node report.mjs (~2.5 min). Fix: port with it.each, it.fails for TF-012/013/015 until fixed.
- **Evidence:** session scratchpad `stage3/out/s3a-matrix/` (`report.txt` and the scripts named)
- **Route:** fix now · B6 (API-level test gaps (scenarios, JUnit, engine tests))
- **Fix:** `7077e83`: `tests/scenarios/permissions.test.ts` (the Stage 3 matrix: 11 personas, three phases, keys, four-eyes, admin paths); cells of open findings are `it.fails` with the finding id.
- **Retest:**

### TF-093 · S2 · bug · engine · fixed
- **Found by:** Stage 3/4 · s3a-versions · L · fc78b12
- **Summary (spec, steps, actual, fix):** change report hides an edited line whose engine qty changed; unchanged elements under the edit reported "changed". F08-AC3, BR-09, F08 §4. Steps: Duplex v1, edit qty of `walls | Interior - Partition (92mm Stud) | False |  | m2` 106.4 -> 117.04, generate, save; upload v2, Use v2, generate; POST /runs/{new}/compare; /diffs/{id}/lines and /elements. Expected: partition listed 106.4 -> 96.38 (-10.02, elements_removed) like the same BoQ without the edit; elements 1 added/1 removed/1 changed. Actual: line missing (117.04 both); 18 elements "changed: [quantities]" (edit spread over fewer elements); identical swap on BoQ "Main" (no edits) matches duplex_v1_v2_diff.json exactly; paint-walls -20.03 -> +0.02, under the 1 % filter. Evidence OUT/i2.json (I1 vs I3), probe-i3.mjs, shots/I-*-i3-edits-changes.png, i1.mjs, i1b.mjs, i2.mjs, i-browser.mjs. Fix: diff the engine quantity too, flag edited lines whose engine value changed; element changes from the model not the edited shares.
- **Evidence:** session scratchpad `stage3/out/s3a-versions/` (`report.txt` and the scripts named)
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `7bd2ae4` (engine: snapshots carry `engineQuantity`, override comparison ignores engine fields, element changes from item lines; `test_diff.py`, failed first. Contract C09; the 1 % filter keeps a moved engine value, `changes.test.ts`, failed first; change-report Excel engine columns) and `14c2e23` (app: "engine 106.4 → engine 96.38" under an edited line; `model.test.ts`, failed first).
- **Retest:**

### TF-094 · S3 · bug · java · fixed
- **Found by:** Stage 3/4 · s3a-versions · L · fc78b12
- **Summary (spec, steps, actual, fix):** second Generate while a run is active returns the old run even after inputs changed. F04 edge cases ("both runs are created; the newest finished becomes current"), BR-22. Steps POST runs; PATCH classifications; POST runs -> 202 same run/job (Runs.java:68-73); finishes on old inputs, pendingChanges stays; one user's Cancel cancels the other's run. UI hides Generate while active (affects 2nd user/tab/API). Evidence probe-double.mjs, probe-double2.mjs. Fix: reuse only if the request equals current state, or change the spec.
- **Evidence:** session scratchpad `stage3/out/s3a-versions/` (`report.txt` and the scripts named)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `179987f`: a second Generate reuses the active run only for the same snapshot, else a new run beside it (V20 drops the one-active-run index); the newest finished run becomes current. `model-lifecycle.test.ts` (failed first).
- **Retest:**

### TF-095 · S3 · gap · app · deferred
- **Found by:** Stage 3/4 · s3a-versions · L · fc78b12
- **Summary (spec, steps, actual, fix):** run history can't open an old run read-only (F04 §5). run-history.tsx rows have no link; only Compare. Evidence e-browser.json E7.links 0, shots/E-09-e7-history.png. Fix: Open link, or list in F04 status.
- **Evidence:** session scratchpad `stage3/out/s3a-versions/` (`report.txt` and the scripts named)
- **Route:** deferred (FE-048: open an old run read-only, F04 §5; recorded in known-limitations)
- **Fix:**
- **Retest:**

### TF-096 · S3 · bug · java · open
- **Found by:** Stage 3/4 · s3a-versions · L · fc78b12
- **Summary (spec, steps, actual, fix):** confirmed BoQ: archive (owner) 200 and restore (PATCH archived:false) 200, audited; while confirmed+archived, reopen and every write answer 409 boq_archived. Other 8 owner writes answer boq_confirmed. F09-AC4, BR-27. Evidence j3.json ownerWrites/reopen, j3b.json restore. Route owner (archivable when confirmed?). Fix: check boq_confirmed in archive/restore or document.
- **Evidence:** session scratchpad `stage3/out/s3a-versions/` (`report.txt` and the scripts named)
- **Route:** answered by the owner (Q54, P54: the first option); fix now · B7 (owner answers)
- **Fix:**
- **Retest:**

### TF-097 · S3 · bug · java · fixed
- **Found by:** Stage 3/4 · s3a-versions · L · fc78b12
- **Summary (spec, steps, actual, fix):** review/approval/reopen notifications render raw keys (notifications.kinds.revision_review_requested, …review_withdrawn, …boq_reopened); console FORMATTING_ERROR "by"/"reason" not provided. Boqs.notify (Boqs.java:359-368) sends only boq, revision, label; changes_requested and approved need {by} too. Emails fine. F13, F15-AC3. Evidence j7.json (bell, notificationsPage, bellProblems), shots/bell-01, bell-02, j7.mjs, j3b.mjs. Fix: by + reason params; generic fallback instead of the key.
- **Evidence:** session scratchpad `stage3/out/s3a-versions/` (`report.txt` and the scripts named)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `8745980`: BoQ and revision notifications carry `by`, `boq.reopened` the reason. `versions.test.ts` (failed first).
- **Retest:**

### TF-098 · S3 · bug · app · fixed
- **Found by:** Stage 3/4 · s3a-versions · L · fc78b12
- **Summary (spec, steps, actual, fix):** free plan: approval toggle enabled in /settings/general (server 402 correctly; entitlements say approvalWorkflow false); 402 dialog shows raw keys "approvalWorkflow: 0 of 0 in use.", "maxModelsPerBoq: 3 of 2 in use.". Test-plan J7, F09 §4, F14 Screens. Evidence j7.json ui, shots/J7-01, J7-02, final.json E8ui, shots/E8-01. Fix: gate toggles on entitlements; translate limit names.
- **Evidence:** session scratchpad `stage3/out/s3a-versions/` (`report.txt` and the scripts named)
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: one name per plan limit (`errors.limit.name`, `limit.feature`) for the dialog and notifications; plan-gated toggles can't be switched on. `i18n/limits.test.ts`, `general-settings.test.tsx` (failed first); browser `batch6.spec.ts @b6-limits` (`3179d79`).
- **Retest:** L: "Active projects: 1 of 1 in use.", Upgrade → billing; approval and four-eyes disabled with the hint.

### TF-099 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3/4 · s3a-versions · L · fc78b12
- **Summary (spec, steps, actual, fix):** (E): Generate in browser to lines with no reload (1.46 s, no document load), needs-input header link, pending notice + disabled Save, running cancel, forced failed run (message "Generating failed: Engine job failed / The last complete run is still shown", currentRun unchanged). Scripts e-browser.mjs, e2-reload.mjs, e-api.mjs, e-fail.mjs.
- **Evidence:** session scratchpad `stage3/out/s3a-versions/` (`report.txt` and the scripts named)
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:**
- **Retest:**

### TF-100 · S3 · test-gap · suites · fixed
- **Found by:** Stage 3/4 · s3a-versions · L · fc78b12
- **Summary (spec, steps, actual, fix):** (I): orphan_override through the stack (engine only today; seen live: orphan:footings | strip_footing |  | m3 after removing the structure model), uncached report < 3 s (1.06 s API, 1.88 s UI; cached 24 ms) + UI export, badge + "Use v2" in a browser. Scripts orphan.mjs, i2.mjs, i-browser.mjs. (I1/I2 = TF-004, I3 = TF-008.)
- **Evidence:** session scratchpad `stage3/out/s3a-versions/` (`report.txt` and the scripts named)
- **Route:** fix now · B6 (API-level test gaps (scenarios, JUnit, engine tests))
- **Fix:** `7077e83`, `3179d79`, and `83cd787` (the reorder-only orphan cell now passes).
- **Retest:**

### TF-101 · S3 · test-gap · suites · fixed
- **Found by:** Stage 3/4 · s3a-versions · L · fc78b12
- **Summary (spec, steps, actual, fix):** (J): label roll-over Z -> AA (seen A…Z, AA, AB, next AC, label_taken), saved Excel bytes + positionNo after working edits (same SHA-256), revision_locked for every role, boq_confirmed as owner (x8), share link after confirm (200), free-plan toggles in UI. Scripts j1.mjs, j1-labels.mjs, j3.mjs.
- **Evidence:** session scratchpad `stage3/out/s3a-versions/` (`report.txt` and the scripts named)
- **Route:** fix now · B6 (API-level test gaps (scenarios, JUnit, engine tests))
- **Fix:** `7077e83` (`versions-roles.test.ts`: labels to AC, `label_taken`, byte-identical saved Excel, `boq_confirmed`, share after confirm) and `3179d79` (free-plan toggles).
- **Retest:**

### TF-102 · S2 · gap · app · fixed
- **Found by:** Stage 3/4 · s3a-sheet · L · fc78b12
- **Summary (spec, steps, actual, fix):** Changes tab: clicking a changed element shows no before/after lines with delta; header "1 element selected · 0 lines". F07-AC6, F07 §9. Steps: save A on Duplex v1; upload v2, move working to it, generate; ?tab=changes (legend Added 1 Changed 1 Removed 1 = /diffs/{id}/elements); click changed door 1hOSvn6df7F8_7GcBWlS8Z (0762 -> 0864). Actual: only the current run's line "Door M_Single-Flush, 0864 x 2032mm 1 nr"; changes-tab.tsx:367 passes no `lines` to ModelViewer. Evidence h6.mjs, h6-panel.txt, shots/h6-changes-click.png. Fix: list the element's lines from both runs with before/after/delta; pass lines.
- **Evidence:** session scratchpad `stage3/out/s3a-sheet/` (`report.txt` and the scripts named)
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `5cc298a`: `elementLineChanges()` (`features/changes/model.ts`) lists a changed element's lines from both runs with before/after/Δ, passed to the viewer. Test `model.test.ts` (failed first).
- **Retest:** L: door `1hOSvn6df7F8_7GcBWlS8Z` → "1 element selected · 2 lines", 0762 4 → 3 nr Δ −1, 0864 6 → 7 nr Δ +1.

### TF-103 · S3 · bug · app · fixed
- **Found by:** Stage 3/4 · s3a-sheet · L · fc78b12
- **Summary (spec, steps, actual, fix):** Item-cell code listbox painted under following rows (each virtualised row absolutely positioned with a transform; z-20 stays in its row); mouse pick hits the next row's cell; keyboard works; bulk Move to unaffected. F06 §6. Evidence shots/picker-open-middle.png, dbg-picker.mjs. Fix: portal/popover.
- **Evidence:** session scratchpad `stage3/out/s3a-sheet/` (`report.txt` and the scripts named)
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: `SearchPicker` portal mode for the sheet's Item editor. `search-picker.test.tsx` (failed first), `states.spec.ts`.
- **Retest:** L: the element under an option is the option; a mouse pick sets A.02.

### TF-104 · S3 · bug · app · fixed
- **Found by:** Stage 3/4 · s3a-sheet · L · fc78b12
- **Summary (spec, steps, actual, fix):** double-click on a Quantity cell of an unselected line doesn't edit: first click opens the detail, grid narrows, cell moves x 1032 -> 816, second click misses. F06 §6. Evidence dblclick.mjs, dblclick-results.txt, shots/dblclick-after.png. Fix: keep column positions (overlay or reserved width).
- **Evidence:** session scratchpad `stage3/out/s3a-sheet/` (`report.txt` and the scripts named)
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: a click on an unselected line's editable cell waits out the double-click; the double-click edits that cell. `states.spec.ts`.
- **Retest:** L: double-click on an unselected Quantity opens its editor.

### TF-105 · S3 · bug · engine · fixed
- **Found by:** Stage 3/4 · s3a-sheet · L · fc78b12
- **Summary (spec, steps, actual, fix):** a text edit re-sorts the line at the next generate and renumbers its section: B.02.2 "Slab, 150mm Exterior Slab on Grade" edited to "Exterior slab on grade, 150 mm (edited text)" -> becomes B.02.1, the 127 mm slab becomes B.02.2. pipeline.py:327-329 sorts by l["description"] (already overridden). F06 §13, BR-28. Evidence lines.json vs lines-after-regenerate.json, working-B.xlsx rows 21-22. Fix: sort by engine text or a stable key; engine test.
- **Evidence:** session scratchpad `stage3/out/s3a-sheet/` (`report.txt` and the scripts named)
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `5719dbc`: lines sort by `overridden.engineDescription`. Test `test_overrides.py` (failed first).
- **Retest:**

### TF-106 · S3 · gap · app · fixed
- **Found by:** Stage 3/4 · s3a-sheet · L · fc78b12
- **Summary (spec, steps, actual, fix):** no WebGL fallback: Chromium --disable-webgl --disable-webgl2 --disable-3d-apis -> viewer stuck "Loading ... 0 of 0 shown", uncaught THREE.WebGLRenderer error (scene-view.ts:74 unguarded, no WebGL check in apps/app/src); no element list; sheet works. nfr.md. Evidence misc.mjs webgl, misc-results-webgl.txt, shots/nowebgl-viewer.png. Fix: WebGL2 check, catch, message + element list.
- **Evidence:** session scratchpad `stage3/out/s3a-sheet/` (`report.txt` and the scripts named)
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `14c2e23`: without WebGL the viewer shows a message and a pickable element list. `viewer/webgl.test.ts`; `states.spec.ts` (own Chromium without WebGL, `bbea6cc`).
- **Retest:** L (WebGL off): message and 218 elements listed.

### TF-107 · S3 · gap · app · fixed
- **Found by:** Stage 3/4 · s3a-sheet · L · fc78b12
- **Summary (spec, steps, actual, fix):** at 1440 px split view: Quantity, Source, Storey past the sheet's edge (Storey alone at 1920); line detail opens under the 3D view at y~1488 (1440) / 1452 (1920), below the fold. F06 Layout, F07 §9. Evidence misc-results-layout.txt, shots/split-1440-line-open.png, shots/explore-sheet.png. Fix: keep Quantity in view; detail beside or overlay.
- **Evidence:** session scratchpad `stage3/out/s3a-sheet/` (`report.txt` and the scripts named)
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: the description gives way first in the split view, Source column off by default, the line detail above the 3D view.
- **Retest:** L at 1440 px: Quantity's right edge 848 < grid 882.

### TF-108 · S4 · inconsistency · engine · fixed
- **Found by:** Stage 3/4 · s3a-sheet · L · fc78b12
- **Summary (spec, steps, actual, fix):** Excel: Cover "Number format" raw JSON {"decimal": ".", "thousands": " "}; BoQ sheet "4 manual line(s)" vs app 1 (Excel counts flagged preliminaries); unit edit note "quantity edited: 0.9 -> 905" no units. F12, F06 §12, §6. Evidence working-B.xlsx, dump_xlsx.py.
- **Evidence:** session scratchpad `stage3/out/s3a-sheet/` (`report.txt` and the scripts named)
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `5719dbc` (the unit edit's note names both units) and `9cbd591` (the BoQ's own manual-line count; the number format in words). `test_overrides.py`, `test_export_xlsx.py` (failed first).
- **Retest:**

### TF-109 · S4 · question · app · open
- **Found by:** Stage 3/4 · s3a-sheet · L · fc78b12
- **Summary (spec, steps, actual, fix):** notice collapse remembered per user per browser (localStorage keyed by user id, not-in-models.tsx:11); fresh profile shows it open. F06-AC8. Evidence g6-results.txt. Fix: user preferences, or spec "in this browser".
- **Evidence:** session scratchpad `stage3/out/s3a-sheet/` (`report.txt` and the scripts named)
- **Route:** answered by the owner (Q55, P54: the first option); fix now · B7 (owner answers)
- **Fix:**
- **Retest:**

### TF-110 · S4 · inconsistency · app · fixed
- **Found by:** Stage 3/4 · s3a-sheet · L · fc78b12
- **Summary (spec, steps, actual, fix):** item_text_blank warning shows the classification's internal id: "[s3a-trades-with-item-texts] Roof, Live Roof...: no value for {fire_rating}." (name is in run.classifications). F15 §1. Evidence g11-warnings.txt, shots/g1-warnings-open.png.
- **Evidence:** session scratchpad `stage3/out/s3a-sheet/` (`report.txt` and the scripts named)
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: `withSystemName()` names the classification in engine messages. `i18n/engine-message.test.ts` (failed first).
- **Retest:**

### TF-111 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3/4 · s3a-sheet · L · fc78b12
- **Summary (spec, steps, actual, fix):** (G): passed live, no browser test: G1 group-by switch, G2 detail/settings links/1-2 clicks to 3D, G4 unit refusal/Ctrl+Z/depth 20, G5 manual line via group "+", G6 item texts, G7 notice + collapse, G8 renumber + frozen, G11 filters, G12 box select + bulk move; drag reorder and Item-cell move. Scripts g1-g2-g11.mjs, g3-edits.mjs, g3-persist.mjs, g4-undo-depth.mjs, g6-g7.mjs, g8-frozen.mjs, g11-edited.mjs, h-viewer.mjs. Fix: port to e2e-java.
- **Evidence:** session scratchpad `stage3/out/s3a-sheet/` (`report.txt` and the scripts named)
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:**
- **Retest:**

### TF-112 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3/4 · s3a-sheet · L · fc78b12
- **Summary (spec, steps, actual, fix):** (H): passed live, no browser test: H1 exact meshes (walls 12, roof 1, windows 9, stairs 2 -> 10 parts, derived formwork 7), H2 shares = API incl. canvas click, H3 unmatched 20 = occurrences, distinct colour + label, H4 toggles 231 -> 16/215, H5 scope 115/37, H7 warm 341 ms, H hides picked. Scripts h-viewer.mjs, h3.mjs, h4.mjs. Fix: e2e-java viewer spec via data-focus/data-scope/data-visible/legend attributes.
- **Evidence:** session scratchpad `stage3/out/s3a-sheet/` (`report.txt` and the scripts named)
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:**
- **Retest:**

### TF-113 · S3 · gap · app · fixed
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** takeover question on native sign-in shows only "Another session is active." + button "End the other session and sign in": no device, no last-active time, no Cancel. 409 body has activeSession {deviceLabel, lastSeenAt} but auth/adapters/native.tsx shows only failure.message; S31 /session-conflict never reached (signed out it redirects to /sign-in). F01 §10, F01-AC5, S31. Evidence shots/a6-02-browser2-question.png, a6.log, a6-sessions.mjs. Fix: render deviceLabel + relative lastSeenAt with S31's openElsewhere text and a Cancel, or route the 409 to /session-conflict.
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `a0a34b0`: on `409 session_active` the form names the other device and its last activity (S31 texts), with Cancel. `native-form.test.tsx`; `e2e-java/sessions.spec.ts` asserts the device text and Cancel.
- **Retest:** L: "You're signed in on campaign, last active now. Continue here and sign out there?…"; Cancel brings back Sign in.

### TF-114 · S3 · gap · java · fixed
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** session.replaced audit rows have org_id NULL and data only {replacementId}: no device labels; org owner can't see takeovers (org audit shows only org.setup_done, org.created). F01 §10 ("Takeovers are audited (session.replaced, both device labels) so an owner can see an account being passed around"). Evidence a6.log (A10). Fix: both device labels in data; write into the user's orgs or an owner-readable audit.
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `cd37865`: `session.replaced` written per org with both device labels. `AccountSecurityTest` (failed first).
- **Retest:**

### TF-115 · S3 · bug · app · fixed
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** the other tab after own sign-out, and after a platform admin's DELETE /admin/users/{id}/session, lands on /sign-in?...&reason=session_replaced within ~0.7 s saying "You were signed out because your account was opened on another device." (false both times; API answers the cookie 401 unauthenticated after the admin action). realtime-provider.tsx:26-28 maps every session.revoked to session_replaced. F01 §10, F19. Evidence shots/ab-32-tab2.png, shots/a6-07-admin-ended.png, ab-browser-run1.log (A9), a6.log. Fix: reason on session.revoked (replaced, signed_out, ended_by_admin), own message each or none.
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `a0a34b0`: `reasonForRevoked()` (event status/reason, else `/me`'s code): replaced, expired or "ended" (`signedOut.session_ended`). `auth/revoked.test.ts`. Optional Java: `status` in the `session.revoked` event data.
- **Retest:** L: a session ended elsewhere lands on sign-in with "Your session was ended…".

### TF-116 · S3 · inconsistency · app · fixed
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** member of orgs T and X opens /{X-slug}/projects/{T project}: T's project opens inside X's chrome (switcher "S3A Other", sidebar/Library/Settings links point at X). F01-AC6, screens.md (URL carries the org slug). Evidence shots/ab-05-deeplink-mixed.png, ab-browser-run1.log (A7). Fix: compare project.orgId with the URL org in the project layout (404 or redirect).
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `a0a34b0`: a project whose `orgId` isn't the URL's org shows not found. `states.test.tsx` (new case).
- **Retest:**

### TF-117 · S4 · bug · app · fixed
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** 409 checkout_unavailable (billing plan pick) and 409 last_owner (leave only owned org from /account): right reason inline plus a toast "Someone else changed this in the meantime. The latest version is shown now." (generic 409 handler). screens.md, C06. Evidence shots/ab-19-checkout-unavailable.png, shots/ab-11-last-owner-leave.png. Fix: concurrency toast only for concurrency codes.
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: only 409s about state someone else changed say "changed in the meantime". `api/query-client.test.ts` (failed first).
- **Retest:**

### TF-118 · S4 · gap · java · fixed
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** memberships.last_active_at never written (only read: Orgs.java:193, AdminOrganisations.java:218); 0 of 45 rows set; members table "last active" shows "-" for everyone. F01 Screens. Evidence b-api-B1-B3.log, shots/ab-15-members.png. Fix: update (throttled) where Sessions refreshes last_seen_at, or drop from spec.
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `cd37865`: `memberships.last_active_at` kept with the session's `last_seen_at` (at most every 5 min). `AccountSecurityTest` (failed first).
- **Retest:**

### TF-119 · S4 · gap · java · fixed
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** org.updated audit data only {"before":{"name","slug"}}: changing fourEyes, approvalRequired, publicLinksAllowed, formats leaves no trace of what changed. BR-51, F01-AC7. Evidence b-api-B1-B3.log. Fix: changed settings before/after in data.
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `cd37865`: `org.updated` records before/after including the settings that changed. `AccountSecurityTest`, `orgs.test.ts` (failed first).
- **Retest:**

### TF-120 · S4 · inconsistency · app · fixed
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** usage page: total "0.1 min" while every project and kind shows "0 min" (API 0.05: parse 0.04, run 0.01); different rounding. F14-AC4, F14 Screens. Evidence shots/ab-21-usage.png, ab-browser-run1.log (B4). Fix: same precision.
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: one rounding for usage minutes; "under 0.1 min". `usage-settings.test.ts`.
- **Retest:**

### TF-121 · S4 · gap · java · fixed
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** PATCH /me {"locale":"not a locale!!"} -> 200, stored; app silently falls back to English. F01, F15. Evidence a-api.log, ab-browser-run1.log. Fix: validate supported locales -> 400.
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `cd37865`: PATCH /me refuses a malformed BCP 47 locale (400 invalid_body). `AccountSecurityTest`, `orgs.test.ts` (failed first).
- **Retest:**

### TF-122 · S4 · question · java · open
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** every sign-in/set-password attempt counts toward the per-address limit, successes included: one office behind NAT (or the shared test host) is locked out after 45 sign-ins in 15 min (host bucket reached 47/45). security.md ("45 per source address, 12 per email"). Evidence native_auth_limits rows; NativeAuthController.java:31,44. Route owner.
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** answered by the owner (Q56, P54: the first option); fix now · B7 (owner answers)
- **Fix:**
- **Retest:**

### TF-123 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** (A): no tests for A2 (unknown email same 401 as wrong password; setup link reused/expired refused; reset for unknown email refused; per-email lockout refuses the right password), A3 (expired and revoked invitations: preview, accept, set-password; resend of an expired one kills the old link; accept twice), A6 (three browsers; 12 h idle -> session_expired while 11 h 58 min works; admin end-session + audit), A8 (notification preferences round trip; leave org then 404), A9 (sign-out, back button, second tab), A11 (Origin null, lookalike, trailing slash, https, other port, upper case on POST/PATCH/DELETE; GET allowed; sign-in refused with foreign Origin). Scripts a-api.mjs, a6-sessions.mjs, ab-browser.mjs.
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:**
- **Retest:**

### TF-124 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3/4 · s3a-accounts · L · fc78b12
- **Summary (spec, steps, actual, fix):** (B): no tests for B1 (admin changes settings, library editor 403, invalid format 400, Free approvalRequired -> 402 approvalWorkflow), B2 (admin removal drops project memberships; resend/withdraw in UI; library editor can't list invitations), B3 (checkout reason in UI; admin 403 on checkout and portal), B4 (usage page, month filter, bad month 400), B5 (filters actor/entity/from-to, cursor paging, CSV from UI, retention purge), B6 (admin revokes from org list -> public 404 at once; UI revoke), B7 (admin 403; wrong name 400 confirm_mismatch; 202; gone for every member at once, open tab 404 within 5 s; slug stays taken; "Organisation being deleted" mail). Scripts b-api.mjs, ab-browser.mjs, b5-retention.mjs.
- **Evidence:** session scratchpad `stage3/out/s3a-accounts/` (`report.txt` and the scripts named)
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:**
- **Retest:**

### TF-125 · S2 · bug · engine · fixed
- **Found by:** Stage 3 · D5 · L · fc78b12
- **Spec:** F03-AC5 ("Every check row opens the viewer with exactly the affected elements highlighted"); F03 §5 ("checks grouped by CheckCode with counts, severity and affected GlobalIds; each row opens the viewer with those elements isolated"); screens.md S10 ("[3D]" per check row)
- **Steps:** 1. Upload the Duplex (any model). 2. Open its version page `/{org}/projects/{p}/models/{m}/versions/{v}`. 3. Look for "Show in 3D" on the check rows. 4. `GET /model-versions/{v}` and read `summary.checkDetails`.
- **Expected:** each check row lists its elements and opens the viewer with them highlighted.
- **Actual:** no check row has a "Show in 3D" button or an "affected elements" list (7 rows on the Duplex: overlap 38, no_material 11, volume_mismatch 9, placeholder_value 6, not_watertight 5, inconsistent_winding 5, duplicate_material_name 1). `summary.checkDetails` is always `[]` (also on every other version tried), so `input-check-report.tsx` builds groups with `elements: []` and hides the button (`g.elements.length > 0`). The engine's `service.model_summary` (`engine/ifc_boq/service.py:38-51`) returns `checks` (counts) but never `checkDetails`; the contract declares it (`openapi.yaml:2727`) and Java's generated model defaults it to an empty array. The per-check element ids exist in `parsed.json` (`verification.checks`). No automated test (test-findings §C row F03-AC5 "none").
- **Evidence:** (session scratchpad `stage3/out/s3b-projects/`) OUT/b-models-d5.log (`"button":false` on all 7 rows; `checkDetails` []), screenshots OUT/shots/d5-*.png, OUT/shots/d1-03-version-report.png; script OUT/b-models.mjs (`node b-models.mjs d5`).
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `4d65638`: `service.model_summary` returns `checkDetails` (code, severity, message, element ids; ≤ 200 per code) from `verification.checks`. Test `engine/tests/test_model_summary.py` (failed first: KeyError). Versions parsed before keep empty details until re-parsed.
- **Retest:** L: a fresh Duplex upload → 75 checkDetails over the 7 codes.

### TF-126 · S3 · bug · java · duplicate
- **Found by:** Stage 3 · C5 · L · fc78b12
- **Spec:** F13 (notification texts for review requested / changes requested); F15-AC1 / v1-11 (no untranslated strings); `apps/app/messages/en/notifications.json` kinds `revision_review_requested` "{by} asks you to review {boq}, version {revision}", `revision_changes_requested`, `revision_approved`, `revision_review_withdrawn` (all use `{by}`)
- **Steps:** 1. Org with approval on (team plan). 2. Estimator submits a revision with the approver as reviewer (`POST /revisions/{r}/submit`). 3. The approver has the app open; 4. the approver requests changes.
- **Expected:** a toast and a bell entry "S3B est asks you to review Review BoQ, version A" (and "… requested changes …" for the estimator).
- **Actual:** the toast shows the raw key `notifications.kinds.revision_review_requested` (screenshot), and every page with the bell logs `FORMATTING_ERROR: The intl string context variable "by" was not provided to the string "{by} asks you to review {boq}, version {revision}"` (same for `revision_changes_requested`). The notification's params are `{"boq":"Review BoQ","label":"A","revision":"A"}`: `Boqs.notify` (`boq/Boqs.java:359-366`) sends only `boq`, `revision`, `label` for every review kind (review_requested, approved, changes_requested, review_withdrawn; `boq_reopened`'s `{reason}` likely the same, not tried). `project_member.added` does carry `by`.
- **Evidence:** (session scratchpad `stage3/out/s3b-projects/`) OUT/shots/c5-02-approver-review-requested.png (toast bottom right), OUT/b-projects-c5.log and OUT/b-projects-c5.console.txt (FORMATTING_ERROR), notification JSON in the C5 probe output (OUT/b-projects-c5.log); script OUT/b-projects.mjs (`node b-projects.mjs c5`).
- **Route:** duplicate of TF-097 (fixed with it; its evidence adds to TF-097)
- **Fix:** pass `by` (actor's name) in `Boqs.notify` (and `reason` for reopen); a unit test that every notification kind's params satisfy its message's placeholders.
- **Retest:**

### TF-127 · S3 · inconsistency · app · fixed
- **Found by:** Stage 3 · C7 · L · fc78b12
- **Spec:** screens.md S18 (project activity: filter) and S25; BR-51; known-limitations.md ("Audit action names differ from the F09 list", which is about naming against F09, not about the app and Java disagreeing)
- **Steps:** 1. As lead open `/{org}/projects/{p}/activity` on a project with runs and uploads. 2. Pick "What: Generated a BoQ". 3. Look at the rows of the unfiltered list.
- **Expected:** the filter finds the runs; every row has a readable action.
- **Actual:** the app's action list (`src/features/audit/audit-view.tsx:17-26`) uses names Java never writes: `run.finished` (Java writes `run.completed`), `revision.inputs_changed` (Java: `revision.inputs_updated`), `revision.reopened` (Java: `revision.review_withdrawn`), so "Generated a BoQ" returns nothing (`GET /projects/{p}/audit?action=run.finished` → 0 rows, `action=run.completed` → 5). Actions Java writes that the app doesn't list show as raw keys in the table and on the project overview's "Recent activity": `run.completed`, `model_version.queued`, `model_version.ready`, `model_version.failed`, also `model.archived`, `project.member_role_changed`, `share_link.*`, `member.invitation_*` (from `SELECT DISTINCT action FROM audit_events`). The row "run.completed · Run 01a2001e-… · 01a2001e-… · needs_input · …" also dumps ids as details.
- **Evidence:** (session scratchpad `stage3/out/s3b-projects/`) OUT/b-projects-c7.log, OUT/c7-api.log, screenshots OUT/shots/c7-01-lead.png, OUT/shots/c6-03-sample-overview-ready.png (overview shows "run.completed", "model_version.ready", "model_version.queued"); probe in OUT/probe.mjs output quoted in the log.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: the activity filter lists the actions Java writes, each labelled ("Another change" otherwise), no ids in Details; families labelled. `features/audit/audit-actions.test.ts` reads Java's action literals (failed first).
- **Retest:**

### TF-128 · S3 · inconsistency · java · fixed
- **Found by:** Stage 3 · D7 · L · fc78b12
- **Spec:** F03 §1 ("discipline (`architecture`, `structure`, `mep` + any discipline key in the org's federation settings) … suggested from the first version's `disciplineGuess` if the user leaves it as 'detect'"); api-conventions.md (validation, `400`)
- **Steps:** 1. `POST /projects/{p}/models {"name":"Facade","discipline":"facade"}` (no such key in the federation settings). 2. Create a model with `"discipline":"detect"` and upload `fixtures/ifc/buildingsmart/IFC2X3/Building-Hvac.ifc`.
- **Expected:** 1 → `400`; 2 → the model gets one of the allowed disciplines (or stays to be chosen).
- **Actual:** 1 → `201` with `discipline: "facade"` (`Models.create` stores any non-blank string, `model/Models.java:89-97`; same for `update`). 2 → the model's discipline becomes `"unknown"` (the engine's guess; `ParseJob.java:91-93` copies any guess: `unknown`, `mixed`, `infrastructure`). The BoQ setup tab then offers "unknown" and "facade" as discipline choices next to Architecture / Structure / Building services, and the models list shows "UNKNOWN" (screenshot). What federation does with such a discipline was not checked.
- **Evidence:** (session scratchpad `stage3/out/s3b-projects/`) OUT/d-api2.log (`D7 unknown discipline key 'facade' 201`, `"discipline":"unknown"`), OUT/d7-ui.log, OUT/shots/d7-03-setup-tab.png, OUT/shots/d1-07-upload-progress.png (Detect me · UNKNOWN); scripts OUT/d-api2.mjs, OUT/d7-ui.mjs.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `179987f`: a discipline is `detect` or a federation key (`400 invalid_discipline`, `details.allowed`); a first-version guess outside them becomes architecture. `model-lifecycle.test.ts` (failed first).
- **Retest:**

### TF-129 · S4 · bug · app · duplicate
- **Found by:** Stage 3 · C2 / O1 · L · fc78b12
- **Spec:** F14 Screens ("Limit prompt: on 402, a dialog says which limit, current/max"); F15-AC1 (no untranslated strings)
- **Steps:** 1. Free org with one active project. 2. `/{org}/projects/new`, create a second project.
- **Expected:** "Active projects: 1 of 1 in use" (a readable limit name).
- **Actual:** the dialog says "activeProjects: 1 of 1 in use." (the API's limit key; `limit-dialog.tsx` passes `String(limit)` into `errors.limit.detail`). The bell's `limit_reached` message already has a `select` with readable names for some limits (`notifications.json`), the dialog doesn't use one; same for `seats`, `maxModelVersionMb`, `maxModelsPerBoq`, `libraryOrgPresets`, `processingMinutesPerMonth`, `shareLinks`, `approvalWorkflow`.
- **Evidence:** (session scratchpad `stage3/out/s3b-projects/`) OUT/b-free.log ("C2 limit dialog: … activeProjects: 1 of 1 in use."), OUT/shots/c2-03-limit-dialog.png; script OUT/b-free.mjs.
- **Route:** duplicate of TF-098 (fixed with it; its evidence adds to TF-098)
- **Fix:** translate the limit key (one `select` covering every limit, shared by dialog and notifications).
- **Retest:**

### TF-130 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3 · C1, C4–C7 · L · fc78b12
- **Spec:** F02-AC3, F02-AC4, F02-AC5, FL-1 step 5, S18
- **Steps:** run the scripts below.
- **Expected:** each passing journey has an automated test (scenario or e2e-java).
- **Actual:** passed live, not automated: C1 the outside-email hint in the project settings UI and defaults from a starred org preset; C4 the read-only banner on overview/models/BoQs/BoQ and the restore from Settings; C5 the 5 s live update of "Needs you" (seen in 186 ms for review_requested, 161 ms for changes_requested) and the kinds needs_input, new_model_version, job_failed, changes_requested on the dashboard; C6 the sample project's processing writes no usage events (usage 0 min, `jobs.metered = false`); C7 the activity page's role gating (lead/approver/owner/admin 200; estimator/viewer 403 + "Only leads and approvers…"; member 404) and its filters and CSV.
- **Evidence:** (session scratchpad `stage3/out/s3b-projects/`) OUT/b-projects.mjs (parts c1, c4, c5, c7), OUT/c-api.mjs (c4, c5, c7), OUT/c4b.mjs, OUT/b-free.mjs; logs alongside.
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:** scenarios (`tests/scenarios/projects.test.ts`: attention kinds, audit role gating and filters, sample usage) and e2e-java (banner, limit dialog, live "Needs you", outside-email hint).
- **Retest:**

### TF-131 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3 · D1–D4, D6, D9 · L · fc78b12
- **Spec:** F03-AC1, F03-AC2, F03-AC4, F03-AC6, F03 §8, F03 edge cases
- **Steps:** run the scripts below.
- **Expected:** each passing journey has an automated test.
- **Actual:** passed live, not automated: D1 upload progress (0…100 % with a throttled upload) then "Waiting to start…" → "Reading the model" → report without reload; leaving and coming back shows the live state; the `model_version.ready` notification in the bell. D2 the UI messages ("Choose an IFC file (.ifc)." with no request sent; "This file is not an IFC file." without Retry), an IFC4 and an IFC4X3 file, unicode and spaces in names, empty file (`400 invalid_body`), `.txt` name (`400 not_ifc` at creation). D3 dedup across two projects of an org (no parse) and no sharing across orgs (parsed again, artifacts under the other org's prefix). D4 the client refusal of a 51 MB file on free (message, zero requests) and the signed URL refusing a body larger than declared (`403`, then `complete` → `400 upload_missing`). D6 a successful retry (status set to a retryable failure in the DB), delete of an unused version (204, gone from list, `model_version.deleted` audited), viewer delete/retry `403`. D9 an upload aborted half-way: version stays `awaiting_upload`, `complete` → `400 upload_missing`, a second PUT to the same URL then `complete` works; in the browser the message "The server could not be reached…" and the version listed as "Waiting for the file" (no way to resume or remove it in the UI: known limits).
- **Evidence:** (session scratchpad `stage3/out/s3b-projects/`) OUT/b-models.mjs, OUT/d1-progress.mjs, OUT/d-api.mjs, OUT/d-api2.mjs, OUT/d6.mjs, OUT/d9.mjs, OUT/o1.mjs (D4 part); logs alongside; shots OUT/shots/d1-*, d2-*, d4-*, d9-*.
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:** scenarios in `tests/scenarios/models.test.ts` (cross-project dedup, cross-org no dedup, size lie, interrupted upload, retry success, delete unused); e2e-java for D1 progress/stages and the client checks.
- **Retest:**

### TF-132 · S4 · test-gap · suites · duplicate
- **Found by:** Stage 3 · O1, O2 · L · fc78b12
- **Spec:** F14-AC1, BR-61, plans-and-limits.md ("Exceeding processingMinutesPerMonth blocks new parse/run/preview jobs, never reading, exporting, answering questions")
- **Steps:** OUT/o1.mjs.
- **Expected:** automated.
- **Actual:** beyond what TF-005 lists (libraryOrgPresets, processingMinutesPerMonth, shareLinks, all confirmed live here), also untested: O2 (over the minutes limit: lines, models, export (202, job succeeded) and answering a question (200) still work; run, preview and complete refused with 402); the `exportWatermark` ("Made with boqlet" row in the free export: OUT/o1-free-export.xlsx); `activeProjects` at unarchive (402) and `maxModelsPerBoq` on `PATCH /revisions/{r}` (402); `approvalWorkflow` on `fourEyes` (402); pending invitations counting as seats.
- **Evidence:** (session scratchpad `stage3/out/s3b-projects/`) OUT/o1.log.
- **Route:** duplicate of TF-005 (fixed with it; its evidence adds to TF-005)
- **Fix:** scenarios in `tests/scenarios/limits` (usage rows can be seeded through SuiteSupport).
- **Retest:**

### TF-133 · S2 · bug · java · fixed
- **Found by:** Stage 3 · L3 (also L4, K5) · L · fc78b12
- **Spec:** F16-AC2 ("Every setup answer changes the preview within 3 s"); F16 step 2 ("The preview shows each line with its item number and filled text"), step 3; F10 §6
- **Steps:** 1. Org A owner starts the wizard with the Duplex as preview model. 2. Finish step 1, go to "Item numbers and texts" (or "Names").
- **Expected:** the preview runs the step's draft with the step-1 rule-set draft and shows the lines.
- **Actual:** every preview of steps 2 and 3 answers `400 {"code":"invalid_preset","message":"The selected preset is unavailable."}`: the wizard sends the rule-set **draft** id as `otherInputs.ruleSetVersionId` (`setup-wizard.tsx` items/names `otherInputs`), and `PresetCatalog.selected()` refuses any draft version (`version.draft()`). The panel shows the wrong reason "Choose one of your organisation's dictionaries." (the app's text for `invalid_preset`). So no preview, no item numbers/texts filled in the preview, and the Codes-per-line samples show a stale step-1 line with the blank unfilled.
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) OUT\wiz-a1.json, wiz-a2.json, wiz-a3.json (console: `HTTP 400 POST /presets/{classification}/preview`, `/presets/{dictionary}/preview`); OUT\shots\wa-06-items.png; reproduced by API in OUT\probe-400.mjs.
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `259da32` (Java: a preview's other inputs may be the caller's own current drafts, same org or project; scenario in `library-publish.test.ts`) and `5cc298a` (app: neutral `invalid_preset` text; `error-messages.test.ts`, failed first).
- **Retest:**

### TF-134 · S2 · bug · app · fixed
- **Found by:** Stage 3 · L3 · L · fc78b12
- **Spec:** F16-AC2 ("Every setup answer changes the preview within 3 s on the Duplex"); F16 step 1 ("re-run at most once per second"); F10 §6 ("runs again after each save")
- **Steps:** 1. Org A wizard, step 1 checklist, Duplex preview. 2. Time a single toggle until the preview summary changes (6 samples). 3. Toggle "Formwork as separate item" off, and 1.3 s later "Include preliminaries" off; wait 12 s.
- **Expected:** each answer reflected within 3 s; the last answer always reflected.
- **Actual:** (a) 2.84, 3.35, 3.36, 3.42, 3.48, 3.72 s from click to the new summary (the preview request leaves ~1.5 s after the click: 1 s autosave debounce, then the save; the job takes ~1.8 s). (b) after two quick answers only one preview runs: it shows formwork removed (4 lines) but not the preliminaries (2 lines), although the saved draft has both; the panel says done. `PreviewPanel` skips a save that lands while a preview is pending (`if (follow && picked && !preview.isPending)`) and never runs it later. A manual "Preview" shows the right 6 removed lines.
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) OUT\wiz-a1.json and wiz-a3.json (`timings`, `rapid`: previews 1, draftParams has both answers, afterManualRun "6 removed"); OUT\shots\wa3-01-rapid.png; traces OUT\traces\wiz-a3.zip.
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `5434435` (app: trailing preview), `98adfb6` (engine: check rpc 1.0 s → 11–34 ms, preview job 2.3 → 0.6 s, queue jobs from a fork server on Linux 1.5–2.7 s → 175 ms; `test_worker.py`, `test_presets.py`, `test_worker_logging.py`), `03189a3` (app: 100 ms polls in the first second; a fresh Idempotency-Key per preview).
- **Retest:** L, Duplex, 10 wizard answers: click → new summary 1.55–2.85 s, median ~1.63 s (F16-AC2: 3 s); was 2.7–3.7 s.

### TF-135 · S2 · bug · engine · fixed
- **Found by:** Stage 3 · K2 · L · fc78b12
- **Spec:** F10-AC2 ("Publishing with problems is impossible"); F10 §3 ("Every save runs the engine check … returns problems[]")
- **Steps:** 1. Rule-set patch draft (K1 preset). 2. `POST /presets/check` (or save the draft) with `params.wall_unit = {value:"banana"}`, `params.masonry_volume_from = {value:"abc"}` or an unknown slot `no_such_slot`. 3. Preview on the Duplex.
- **Expected:** problems ("'banana' is not one of the answers", "'abc' is not a number", unknown slot), publish refused.
- **Actual:** `problems: []` for all three; the draft saves and can be published. Then: with "abc" every preview/run fails `invalid_input` (schema error at `ruleSet/params/masonry_volume_from`); with "banana" the walls come out as `nr` lines with quantity null and no note or question. The Excel template import does catch both ("'wide' is not a number", "'banana' is not one of the answers"), so the check exists elsewhere; the editor's Advanced JSON and the API bypass it.
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) OUT\badchoice.json, OUT\badchoice2.json (walls `[…, null, "nr", null]`), OUT\k8.json (template import problems for the same values); scripts OUT\badchoice.mjs.
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `ecaa68a`: `presets.check` checks every slot answer against its slot (type, options, known slot) with the template reader's wording. Test `test_presets.py::test_check_reports_slot_answers_that_do_not_fit_their_slot` (failed first: `[]`).
- **Retest:** L: `POST /presets/check` lists the three problems (banana, abc, no_such_slot).

### TF-136 · S2 · bug · app · fixed
- **Found by:** Stage 3 · K5 · L · fc78b12
- **Spec:** F10-AC5 ("an item text with `{thickness}` shows 'Reads as' with the preview model's value"); F10 §13 ("filled from the preview model's first matching line")
- **Steps:** 1. Org A classification v1 (imported from `files\codes-3-levels-opis.xlsx`, item text "… debljine {thickness} m …"). 2. As the library editor open it in the Library, preview on the Duplex (P2). 3. Code list tab and Codes per line tab.
- **Expected:** "With a line of Walls from the preview: … debljine 0.417 m …".
- **Actual:** the sample shows the raw blank: "With a line of Walls from the preview: “Zidanje vanjskih zidova debljine {thickness} m …”" (Codes per line: "Item text, with this item's first line in the preview: … {thickness} …"). The preview lines carry only key, description, quantity, unit, so the blank has no value. The run itself fills it (sheet and Excel show "0.417 m", L4).
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) OUT\k5.json, OUT\shots\k5-01-code-list.png, k5-02-codes-per-line.png; run lines in OUT\l4.json.
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `987d9f1` (engine: preview lines carry `codes[system] = {code, text}`; `test_item_texts.py`, failed first), `7bd2ae4` (contract `PreviewLine.codes`, C10), `14c2e23` (app: the samples read the engine-filled text back; `item-text.test.ts`, failed first).
- **Retest:**

### TF-137 · S3 · bug · java · fixed
- **Found by:** Stage 3 · F2, F4 · L · fc78b12
- **Spec:** F05 §1 (the questions tab lists `GET /runs/{runId}/questions` "joined with project decisions"); F05 §8 (a decision whose question no longer appears is shown on the decisions page as "not used by current runs")
- **Steps:** 1. Project P1: BoQ "Questions" (Duplex) raises 14 blocking `missing:doors:*` questions; answer them. 2. Open BoQ "bS IFC2x3" (buildingSMART models only, no doors of the Duplex) › Questions › Answered.
- **Expected:** only the questions this run raised (with their answers).
- **Actual:** the list shows every answered project decision as a question of this run, e.g. 14 "BLOCKING Rule 'Doors' needs a quantity for M_Single-Flush…" with "Show in 3D" for elements that are not in its models, plus the other BoQ's double claim and unmatched answers. `Decisions.questions()` adds every question of the run snapshot's applied decisions (all project decisions are sent to every run).
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) OUT\f4.json (`answeredList`), OUT\f1.json; API: `GET /runs/{q3 run}/questions` has `missing_data/B/answered: 14` (session log in OUT\f2.json context).
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `179987f`: the result lists `answeredQuestionIds` (types first), stored in `runs.answered_questions` (V21); a run's questions are its asked questions plus those. `test_versions.py`, `model-lifecycle.test.ts` (failed first). Runs made before keep the old list.
- **Retest:**

### TF-138 · S3 · bug · java · duplicate
- **Found by:** Stage 3 · F5, F6, K9 (seen in passing) · L · fc78b12
- **Spec:** F13 (notifications render from the catalogue); `messages/en/notifications.json` ("{by} approved {boq}, version {revision}", "{by} asks you to review …", "{by} withdrew the review of …")
- **Steps:** 1. Approval on. 2. Estimator submits, approver approves, a decision change withdraws the review. 3. Open any page as the estimator or the approver (the bell loads notifications).
- **Expected:** "S3B aprA approved Questions, version A".
- **Actual:** notification params have no `by` (`{"boq":"Questions","label":"A","revision":"A"}`); the browser logs `FORMATTING_ERROR: The intl string context variable "by" was not provided` for revision_approved, review requested and review withdrawn.
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) OUT\f5b.json and f6.json (console), `GET /notifications` excerpt in this session (kind `revision.approved`, params above).
- **Route:** duplicate of TF-097 (fixed with it; its evidence adds to TF-097)
- **Fix:** Java adds `by` (actor name) to these notification params; a test that renders every notification kind.
- **Retest:**

### TF-139 · S3 · question · app · open
- **Found by:** Stage 3 · L1 · L · fc78b12
- **Spec:** F16 §1 / P18 ("the org's dashboard opens only when it is finished"); F16-AC6
- **Steps:** new free org W, setup not started; open `/{org}`, `/{org}/projects`, `/{org}/library`, `/{org}/settings`, `/{org}/library/rule_set/new` directly.
- **Expected:** per P18 the owner can't use the org before finishing the wizard (or the spec says which pages stay open).
- **Actual:** only `/{org}` redirects to `/setup`; projects, library, settings and the new-preset form open, and the wizard page itself shows the sidebar links to them. The owner can create projects and presets before setup (the setup e2e only checks the dashboard).
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) OUT\l1.json (`gate`), OUT\shots\l1-00-gate.png, wa-06-items.png (sidebar in the wizard).
- **Route:** answered by the owner (Q57, P54: the first option); fix now · B7 (owner answers)
- **Fix:** gate every `/{org}` route for setup-capable roles until done, or write in F16 that only the dashboard is gated.
- **Retest:**

### TF-140 · S3 · question · docs · open
- **Found by:** Stage 3 · K7 · L · fc78b12
- **Spec:** F10-AC7 ("a later system version of 'As modelled' shows up in the clone"); the create form's "Changes on a rule set: … It follows the original's future versions."
- **Steps:** 1. Clone org rule set "S3B Questions rules" v1 as "Based on it" and as "Independent copy" (browser), publish both. 2. Publish the original v2, v3 (walls m3). 3. Preview both clones on the Duplex.
- **Expected:** the based-on clone measures walls in m3; the copy doesn't.
- **Actual:** both stay m2: the published clone keeps `extendsVersionId` = original v1. It follows only when someone saves its draft again (then it extends v3), which is what `library-publish.test.ts` checks. Nothing tells the clone's editors that the original has a newer version, and BoQs using the clone's published version never get it.
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) OUT\k7.json, k7c.json (`wallUnits: original m3, basedOn m2, independent m2`), k7d.json (re-save extends v3).
- **Route:** answered by the owner (Q58, P54: the first option); fix now · B7 (owner answers)
- **Fix:** decide: follow at run time (flatten on the parent's latest) or say "follows on its next save" in F10 and the form, and show "a newer version of X exists" on the clone.
- **Retest:**

### TF-141 · S4 · inconsistency · docs · open
- **Found by:** Stage 3 · F8 · L · fc78b12
- **Spec:** `known-limitations.md` i18n ("Engine log entries … are English text without a code"); F15-AC3
- **Steps:** Duplex run log (`GET /runs/{id}/log`) vs `apps/app/messages/en/engine.json`.
- **Expected:** the limitation describes the state.
- **Actual:** all 700 (Duplex) / 1475 (federated) log entries carry a `code` (`log.match.coverage`, `log.decision.answer_applied`, …); the catalogue has no `log.*` keys at all, so the Log tab renders every entry from the fallback. Questions and warnings render from keys (no fallback seen).
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) OUT\f8.json (`codesNotInCatalogue`, 27 and 39 codes).
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** reword the limitation ("codes exist, the catalogue lacks log.* entries") or add the keys.
- **Retest:**

### TF-142 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3 · F2, F3 (browser), F4 (browser), F5 (UI warning), F6 · L · fc78b12
- **Spec:** test-plan §7.2 (a passing journey without an automated test)
- **Steps:** passing journeys with no automated test: F2 every question kind on the Duplex + buildingSMART (missing_data, double_claim, unmatched with rule/exclude answers, overlap keep-A/both, contradiction, unknown_name; scripts OUT\f-setup.mjs, f2.mjs, f1.mjs); F3 in a browser: one POST /decisions and one POST /runs for 10 names, "add to project dictionary" on by default (OUT\f3.mjs); F4 dismiss/un-dismiss/change/clear/CSV in a browser (OUT\f4.mjs); F5 the reopen warning dialog listing the approved revision (OUT\f5b.mjs); F6 Promote visible only to library editor/admin/owner, 403 for members, new project not asked (OUT\f6.mjs; promote is listed as untested in known-limitations).
- **Expected:** scenario (API) and e2e-java (browser) tests.
- **Actual:** none for these.
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) the scripts above; coverage.txt.
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:** port to `tests/scenarios/questions.test.ts` and `apps/app/e2e-java`.
- **Retest:**

### TF-143 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3 · K1 (browser), K5, K9 (UI), K10 (Java) · L · fc78b12
- **Spec:** test-plan §7.2
- **Steps:** passing journeys without an automated test: K1 in the browser (patch, three settings, preview beside the editor: OUT\k1.mjs, k1b.mjs); K5 Opis import filling item texts and carrying them into lines and Excel (OUT\wiz-a2.mjs, l4.mjs; the sample part fails, see above); K9 project-layer Library tab per role in the UI (OUT\k9.mjs); K10 `libraryOrgPresets` 402 on Java for all three kinds and the UI message (OUT\l1.mjs, k10ui.mjs; known: ran only on the mock).
- **Expected:** automated tests.
- **Actual:** none.
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) scripts above; coverage.txt.
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:** scenarios for K5/K10 on the harness; e2e-java for K1/K9.
- **Retest:**

### TF-144 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3 · L2, L4, L5, L6, L7, L9 (browser) · L · fc78b12
- **Spec:** test-plan §7.2; known-limitations "setup wizard beyond the suggested answers" not covered in a browser
- **Steps:** passing journeys without a browser test: L2 14 switches, detail screens only for switches on, 6 measuring screens (OUT\wiz-a1.mjs); L4 Publish all → new project's BoQ on the three presets, Excel with item numbers and filled texts (OUT\wiz-a4.mjs, l4.mjs); L5 resume at step 2 a day later with step-1 answers (OUT\wiz-a2.mjs, timestamps moved in `orgs.setup`); L6 free org without 402 (OUT\l1.mjs); L7 rebar can't be left at 0 (OUT\wiz-a1.mjs); L9 member sees "not finished yet", second admin opens the same drafts (OUT\l9.mjs, l9b.mjs).
- **Expected:** e2e-java tests (unit tests exist for L2/L7 logic in `steps.test.ts`).
- **Actual:** only the suggested-answers path is in e2e-java.
- **Evidence:** (session scratchpad `stage3/out/s3b-library/`) scripts above; coverage.txt.
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:** an e2e-java "careful path" wizard spec on the harness.
- **Retest:**

### TF-145 · S3 · inconsistency · app · duplicate
- **Found by:** Stage 3 · P1 · L · fc78b12
- **Spec:** F15-AC1 / v1-11 ("the pseudo-locale build shows no untranslated strings"), F15 §1
- **Steps:** 1. Set cookie `boqlet-locale=en-XA`, sign in as an owner. 2. Open the project overview (Recent activity), `/{org}/projects/{p}/activity`, `/{org}/settings/audit` (rows and the "What" filter). 3. Open a BoQ sheet and the Family filter.
- **Expected:** every UI string pseudo-localised ([Ŵŕáþþéð ~~]).
- **Actual:** (a) audit actions the catalogue has no key for are shown as raw codes: `share_link.created`, `run.completed`, `model_version.queued`, `model_version.ready`, `revision.review_withdrawn` (5 of the 27 actions this org's log holds). `audit-view.tsx` looks up `projects.activity.actions.<action with _>`; Java writes `run.completed` while the catalogue has `run_finished`, `revision.inputs_updated` vs `revision_inputs_changed`, and has nothing for `share_link.*`, `model_version.queued/ready/failed`, `member.invitation_resent/revoked`, `revision.review_withdrawn/review_requested`. Visible in English too (the overview of every project shows "run.completed", "model_version.ready"). (b) The sheet's Family filter options are the raw enum values `volumetric`, `planar`, `linear`, `countable`, `assembly`. Everything else on 47 screens and states passed: shell, dashboard, projects, models, version, all BoQ tabs, decisions, project library/settings/activity, Library and preset editors, settings, notifications, account, onboarding, setup wizard, 404, share page, sign-in, invite, session-conflict. Remaining non-pseudo text was data (names, line texts, rule slot labels, IFC names), Intl dates/relative times (en-XA falls back to en formats), and the known English engine text (log entries, answer options: known-limitations "i18n").
- **Evidence:** (session scratchpad `stage3/out/s3b-ux/`) p1.mjs (the rendered pseudo-locale scan; candidate for TF-007), p1-untranslated.txt, p1-results.json, shots/p1-S07-overview.png, shots/p1-S18-activity.png, shots/p1-S25-audit.png, shots/p1-S12-sheet.png; audit-actions.txt (distinct actions in the org's audit_events).
- **Route:** duplicate of TF-127 (fixed with it; its evidence adds to TF-127)
- **Fix:** catalogue keys for every action Java writes (or rename the Java actions), an `actions.unknown` fallback instead of the raw code, `boqs.family.*` labels for the filter; a unit test diffing Java's audit action literals against the catalogue.
- **Retest:**

### TF-146 · S3 · gap · app · fixed
- **Found by:** Stage 3 · S3 (expired session mid-edit) · L · fc78b12
- **Spec:** test-plan S3 ("an expired session mid-edit (the edit isn't lost silently)"); screens.md error state; F06 inline edits
- **Steps:** 1. As an estimator open a BoQ sheet, double-click a quantity, type 321.5. 2. Expire the session (DB: `UPDATE sessions SET last_seen_at = now() - interval '13 hours'` on the estimator's own row). 3. Press Enter.
- **Expected:** the edit is kept or the user is told it was not saved (and ideally it is re-applied after signing in again, the sheet's `returnTo` already brings them back).
- **Actual:** `POST /boqs/{b}/overrides/batch` → 401; the app goes straight to `/sign-in?returnTo=…&reason=session_expired` with "You were signed out after a long time without activity. Sign in again to continue." Nothing says the typed quantity was not saved, no draft is kept (no storage of pending edits in `src/features/boq-sheet`), and `line_overrides` has no row for the line. After signing in the sheet shows the old quantity. The same happens to any other unsaved input (editor, dialogs) because `signedOut()` navigates away.
- **Evidence:** (session scratchpad `stage3/out/s3b-ux/`) s3b.mjs, s3b-results.json (requests: `401 PUT …/presence`, `401 POST …/overrides/batch`; override count 0), shots/s3b-after-enter.png, shots/s3b-later.png. Without an open editor (s3.mjs) the app notices the expiry on its next background call and signs out cleanly (s3-results.json).
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: an edit refused with 401 is kept (sessionStorage) and offered again after sign-in. `kept-edits.test.ts`.
- **Retest:** L: session expired mid-edit → after sign-in "Your last change was not saved…", Save again saved it.

### TF-147 · S4 · inconsistency · app · fixed
- **Found by:** Stage 3 · P3 · L · fc78b12
- **Spec:** F15 §6 (BoQ values formatted with the project locale; one formatting for the BoQ), design-guidelines "Numbers and units"
- **Steps:** 1. Add manual lines with quantities 123456789.123, 0.000123 and 0 (API `POST /boqs/{b}/manual-items`), generate. 2. Compare the sheet, the share page `/s/{token}` and the Excel.
- **Expected:** the same value shows the same way everywhere (rounded the same, never a non-zero quantity as zero).
- **Actual:** sheet "0.000123" and "123,456,789.123"; share page "0" for 0.000123 (looks like a zero quantity) and "123,456,789.123"; Excel stores 0.000123 but formats `#,##0.00` so it shows "0.00"; the calculation log says "0.0001 m2". Three precisions for one line. (Negative manual quantities are refused with 400 `invalid_quantity` "Enter a quantity of zero or more", fine; a lump sum's `amount` becomes a note "amount 1234567.891" on a flagged line, engine text.)
- **Evidence:** (session scratchpad `stage3/out/s3b-ux/`) p23.mjs, p23-results.json, shots/p23-default-sheet.png, shots/p23-orgComma-share.png, s5-export.xlsx (BoQ!D51, number_format `#,##0.00`), s5x.py output.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e` (app: up to 6 decimals, "< 0.000001" below; `boq-format.test.ts`) and `9cbd591` (Excel: the decimals the value has, TF-055).
- **Retest:**

### TF-148 · S4 · gap · java · duplicate
- **Found by:** Stage 3 · S2 (members screen) · L · fc78b12
- **Spec:** F01 (members table: "joined, last active"); screens.md S22
- **Steps:** 1. Several members sign in and work (generate, edit, review) for an hour. 2. Owner opens `/{org}/settings/members`; `GET /orgs/{org}/members`.
- **Expected:** "Last active" shows when each member last used the org.
- **Actual:** "—" for all 8 members; the API omits `lastActiveAt`; `memberships.last_active_at` is NULL for every row (`SELECT count(last_active_at) FROM memberships WHERE org_id=…` → 0 of 8). Nothing in `services/api` writes the column (only `Orgs.java:193` and `AdminOrganisations.java:218` read it).
- **Evidence:** (session scratchpad `stage3/out/s3b-ux/`) shots/s2-EST-settings-members.png, sql.mjs query, q.mjs `/orgs/{id}/members`.
- **Route:** duplicate of TF-118 (fixed with it; its evidence adds to TF-118)
- **Fix:** update `memberships.last_active_at` (throttled, e.g. once per 5 min) where the session's `last_seen_at` is touched for a request in that org; or drop the column from F01 and the UI.
- **Retest:**

### TF-149 · S4 · bug · app · fixed
- **Found by:** Stage 3 · S5 · L · fc78b12
- **Spec:** nfr.md "Desktop first (≥ 1280 px)"; test-plan S5 (255-character names)
- **Steps:** create a project whose 255-character name has no spaces (API accepts it; the New project form has no maxlength and accepted 300 characters); open it at 1280×720.
- **Expected:** the name wraps or is truncated with a tooltip; no horizontal page scroll.
- **Actual:** the h1 runs off the right edge and the page scrolls horizontally (`scrollWidth > innerWidth`); the projects list cell is clipped. Names with spaces, RTL, CJK, emoji, combining marks and HTML render fine (see coverage S5).
- **Evidence:** (session scratchpad `stage3/out/s3b-ux/`) s5.mjs, s5-results.json (`project 255` hScroll true), shots/s5-project 255.png.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: headings wrap anywhere; the projects list truncates with a title. `__tests__/a11y-layout.test.ts`.
- **Retest:**

### TF-150 · S4 · bug · app · duplicate
- **Found by:** Stage 3 · S8 · L · fc78b12
- **Spec:** nfr.md Accessibility (WCAG 2.1 AA contrast 4.5:1 for small text); design-guidelines colour tokens
- **Steps:** as owner open `/{org}/settings/general` in light and in dark theme; run axe `color-contrast`.
- **Expected:** no contrast violations.
- **Actual:** the "Delete organisation…" button (red text on red tint) is 4.2:1 in light (#c62423 on #eed9d0) and 4.26:1 in dark (#e06a69 on #3e2626). The only other contrast violation on the 33 screens × 2 themes is the orange presence avatar (3.06:1), already TF-022.
- **Evidence:** (session scratchpad `stage3/out/s3b-ux/`) s8.mjs, s8-results.json (`settings-general.contrast`), shots/s8-light-settings-general.png, shots/s8-dark-settings-general.png.
- **Route:** duplicate of TF-162 (fixed with it; its evidence adds to TF-162)
- **Fix:** destructive button text on a lighter tint (or ink text with a red border) to reach 4.5:1 in both themes.
- **Retest:**

### TF-151 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3 · N1, N2, N3 · L · fc78b12
- **Spec:** F13-AC1, F13-AC3 (core version), F13 events table; test-plan §7.2 (a passing journey without a test becomes a test-gap)
- **Steps:** look for a browser test of the toast and live update, the bell, deep links and email preferences.
- **Expected:** automated in `apps/app/e2e-java` (browser) and `tests/scenarios` (API).
- **Actual:** these pass live and have no test: (1) N1 a run started in tab B shows "UX BoQ is generated" in tab A in 177-509 ms and tab A fetches the new run's lines in 102-150 ms after `finishedAt` (3 runs); (2) N2 every core kind reaches the bell with the right recipients and the email kinds reach MailHog (job.failed "Processing failed", boq.confirmed/reopened, review_requested/changes_requested/approved, project_member.added, limit.reached; model_version.ready, version.saved, new_version_available, run.needs_input, review_withdrawn bell only), deep links open the right screen (no 404), "Mark read" and "Mark all read" update the count, the bell item click opens the link and marks it read; (3) N3 unticking "Versions" on /account stops the confirmed/reopened emails (0 new) while the bell gets both. Only `tests/scenarios/versions.test.ts`/`boqs.test.ts` read `/notifications` for review kinds. (The raw `notifications.kinds.*` text for review and reopen kinds is already reported by s3a-versions N5.)
- **Evidence:** (session scratchpad `stage3/out/s3b-ux/`) n1.mjs + n1-results.json, n2.mjs + n2-results.json, n2b.mjs + n2b-results.json, n2ui.mjs + n2ui-results.json, bell.mjs + bell-results.json.
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:** e2e-java: toast + live refetch within 2 s (two pages), bell/mark read; scenarios: kind → recipients/email matrix, preferences off → no outbox row.
- **Retest:**

### TF-152 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3 · S2, S3, S5, S6, S8 · L · fc78b12
- **Spec:** test-plan S2-S8; screens.md states; api-conventions Idempotency
- **Steps:** look for tests of the UI role sweep, back/forward/refresh, escaping, idempotent replay, themes.
- **Expected:** automated.
- **Actual:** these pass live and have no test: S2 the UI matches the API matrix for 8 roles (hidden Generate/Save/Share/More actions, read-only setup, "not allowed" notes, 404 for a member without project role on all 17 project routes, /admin 404 for non-admins); S3 back/forward across tabs and pages, refresh on 9 routes keeps the screen; S5 HTML/`<script>`/`onerror` in project, BoQ, model, manual line and share label are text everywhere (no dialog, no injected element: UI, share page, Excel cells are strings), padded names trimmed, blank name 400; S6 the API replays a UUID `Idempotency-Key` (same body, one run/share/export/invite, one email; same key with another body replays the first answer; a non-UUID key is 400 `invalid_param`); S8 every screen renders in light and dark (only TF-022 and the delete button contrast fail).
- **Evidence:** (session scratchpad `stage3/out/s3b-ux/`) s2.mjs + s2-results.json + s2-summary.txt, s3.mjs + s3-results.json, s5.mjs + s5-results.json + s5x.py, s6.mjs/s6b.mjs + s6b-results.json, s8.mjs + s8-results.json, shots/s2-*, s5-*, s8-*.
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:** e2e-java: role sweep (data-driven from the matrix), escaping on sheet/share page; scenarios: Idempotency-Key replay per endpoint (also asked by TF-073).
- **Retest:**

### TF-153 · S3 · bug · app · fixed
- **Found by:** Stage 3 · R4 (trial extension) · L · fc78b12
- **Spec:** F19 §4 ("extend a trial"), FL-12 step 3 ("Extends the org's trial by 14 days"); the date the admin picks is the date the trial ends
- **Steps:** 1. As platform admin, in a browser on UTC+1 (Europe/Sarajevo), open /admin/orgs/{org} of an org in trial (ends 5 Dec). 2. "Set trial", click "+7 days": the date field shows 2026-12-12. 3. Reason, Save.
- **Expected:** the trial ends on 12 Dec, and the console (and the org's billing page) say 12 Dec.
- **Actual:** the dialog sends `${day}T23:59:59.000Z` (`org-detail.tsx`, Actions, trial `onSubmit`); the DB holds `2026-12-12 23:59:59+00` and the console shows "Trial ends Dec 13, 2026" because it formats in the viewer's zone. Any admin east of UTC sees one day more than picked; the "+N days" buttons also start from the UTC instant, so the shown date drifts each time. The org's audit has `to: 2026-12-12T23:59:59Z`.
- **Evidence:** (session scratchpad `stage3/out/s3b-admin/`) b2-actions.json step "trial" `{"picked":"2026-12-12","shown":"Dec 13, 2026"}`; `SELECT trial_ends_at FROM subscriptions` -> `2026-12-12 23:59:59+00`; script b2-actions.mjs; shots/b2-* .
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `a0a34b0`: the trial end is a day, shown in UTC (`trialEnd`, `trialDay`). `admin/values.test.ts` (Sarajevo, Tokyo, New York).
- **Retest:**

### TF-154 · S3 · inconsistency · app · fixed
- **Found by:** Stage 3 · R (S36 health screen) · L · fc78b12
- **Spec:** F19 status ("Not built: … billing-webhook failures and email bounces in health (`AdminReports.health()` shows failed jobs and durations only)"); F19 §7
- **Steps:** 1. As platform admin open /admin/health.
- **Expected:** what isn't measured isn't shown as a number (hidden, or "not tracked yet").
- **Actual:** the page shows "BILLING WEBHOOK FAILURES 0" and "EMAIL BOUNCES 0". `GET /admin/health` has neither field (`AdminReports.health()`); `health.tsx` renders `format.number(h.billingWebhookFailures ?? 0)` and the same for bounces. An operator reads "no bounces" while bounces aren't counted.
- **Evidence:** (session scratchpad `stage3/out/s3b-admin/`) b1-screens.json note "health"; shots/a-health.png; `/admin/health` response (392 B, only failedJobsPerDay and jobDurationsMs).
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `a0a34b0`: untracked webhook failures and bounces read "not tracked yet". `admin/health.test.tsx`.
- **Retest:**

### TF-155 · S4 · inconsistency · app · duplicate
- **Found by:** Stage 3 · R4 (end a user's session) · L · fc78b12
- **Spec:** F19 §5 ("end a user's active session", support case); F01 §10 message is for a takeover ("opened on another device")
- **Steps:** 1. Member is signed in, a page of the org open. 2. Platform admin, /admin/users, search the member, "End session", confirm.
- **Expected:** the member is signed out with a reason that fits (e.g. "Your session was ended. Sign in again.").
- **Actual:** within 6 s the member lands on `/sign-in?…&reason=session_replaced` with "You were signed out because your account was opened on another device." No other device signed in; the ending came from support. (`realtime-provider.tsx:26-28` maps every `session.revoked` to `session_replaced`.) The API's own answer for the ended session is `401 unauthenticated "Open a new session to continue."`.
- **Evidence:** (session scratchpad `stage3/out/s3b-admin/`) b2-actions.json "member2 page 6 s after end"; shots/b2-member2-after-end.png; r3r4-api.json "R4 mem2 /me after".
- **Route:** duplicate of TF-115 (fixed with it; its evidence adds to TF-115)
- **Fix:** carry the reason in the `session.revoked` event (replaced / ended_by_support / expired) and add a sign-out message for an ended session.
- **Retest:**

### TF-156 · S4 · question · docs · open
- **Found by:** Stage 3 · R5 ("every admin view is audited") · L · fc78b12
- **Spec:** test-plan §7.3 R5 "every admin view is audited" vs F19 Security / BR-57 "Every admin action and every view of an org's detail page writes an audit event"
- **Steps:** 1. As platform admin GET /admin/overview, /admin/funnel, /admin/orgs, /admin/orgs.csv, /admin/users?limit=1000, /admin/health, /admin/orgs/{id}/notes. 2. Count audit_events by the admin per action before and after.
- **Expected:** the owner decides which: the plan's wording (every view) or F19's (detail views only).
- **Actual:** only `GET /admin/orgs/{id}` writes `admin.org_viewed`; the seven reads above write nothing, including the CSV of every org with its owner's email and the users list with every user's email and orgs (personal data exported in bulk without a trace). Detail views are audited with `org_id` null, so they stay out of the org's log, as F19 says.
- **Evidence:** (session scratchpad `stage3/out/s3b-admin/`) b3-funnel-audit.json (`before` = `afterReads`: admin.org_viewed 9 both times); script b3-funnel-audit.mjs.
- **Route:** answered by the owner (Q59, P54: the first option); fix now · B7 (owner answers)
- **Fix:** either audit the list/CSV/users reads (at least `admin.orgs_exported`) or change R5's wording to F19's.
- **Retest:**

### TF-157 · S3 · test-gap · suites · deferred
- **Found by:** Stage 3 · R1, R4, S36 · L · fc78b12
- **Spec:** test-plan §7.2 (a journey that passes without an automated test is a test gap); `apps/app/e2e-java` has no admin spec (accounts, live, main-flow, orgs, sessions only)
- **Steps:** run the scripts below on L.
- **Expected:** browser tests for what only the browser shows.
- **Actual:** these pass live and only their API halves are automated (`tests/contract/admin.test.ts`, `tests/scenarios/admin.test.ts`): (1) R1 browser: a non-admin on /admin, /admin/funnel, /admin/orgs, /admin/orgs/{id}, /admin/users, /admin/health sees the not-found page and no admin shell; anonymous is sent to sign-in (b1-screens.mjs). (2) R4 console dialogs: submit disabled with no or blank reason and with the same plan; plan, trial, override, suspend, reactivate applied from the UI and shown in the owner's audit page (b2-actions.mjs). (3) Suspended org: owner and member get the suspended banner; reactivation removes it (b2-actions.mjs). (4) End a session from /admin/users signs the member's open browser out within 6 s (b2-actions.mjs). (5) Console search, plan/status/signal/tag filters, sort in the URL, CSV download, funnel "Stuck here" -> orgs with `stuckAt` (b1-screens.mjs, b3-funnel-audit.mjs). (6) A pending invitation counts as a seat on both the usage data and the admin row (r2-pending-and-tf081.mjs).
- **Evidence:** (session scratchpad `stage3/out/s3b-admin/`) scripts named above, in this folder; coverage.txt.
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:** `apps/app/e2e-java/admin.spec.ts` for (1)–(5); (6) as a line in the scenario "shows the same seats…".
- **Retest:**

### TF-158 · S2 · bug · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** F18-AC1 ("…shows the sheet, the line explanation and the 3D view"); screens.md S35 ("read sheet, line explanation"); nfr.md Accessibility ("WCAG 2.2 AA for … share page …: keyboard reachable"); WCAG 2.1.1 Keyboard
- **Steps:** 1. Open a share link (lineDetail included) with no account. 2. Press Tab repeatedly; try to reach a line and press Enter.
- **Expected:** each line is reachable by keyboard and Enter/Space opens its explanation (as a click does).
- **Actual:** the lines are `<tr data-testid="share-line" onclick…>` with no tabindex, role or key handler. Tab order is: search, the viewer, its 6 controls, then back to the start; no line is ever focused, so a keyboard or screen-reader user can't open any line's "How it is calculated". The aria tree shows plain rows with no hint that they open anything.
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/keyboard.log ("share page tab order (30)", "share: first line focus: NONE (lines not reachable by Tab)"); OUT/aria-share.txt; OUT/zoom-sr.txt (`first: {"tag":"TR","tabindex":null,"role":null,"onclick":true}`); OUT/shots/fl11-01-share.png; script OUT/fl2.mjs (step "open share link").
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `5cc298a`: with line detail on, the description cell is a button (`aria-expanded`, `aria-controls`); focus moves to the detail heading and back on close. Test `public-share.test.tsx` (failed first), `e2e-java/resilience.spec.ts`.
- **Retest:** L: Tab from search reaches line 1, Enter opens the detail, Close returns focus.

### TF-159 · S2 · bug · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** F06 §6 ("The sheet is edited like a spreadsheet: Overwrite a cell: quantity…, description…, unit"; move by changing the Ref/code); F06-AC3 (quantity edit); nfr.md ("keyboard reachable"); WCAG 2.1.1
- **Steps:** 1. Working BoQ sheet, keyboard only. 2. Tab to the grid, ArrowDown to a line. 3. Look for a way to edit its quantity, unit or Item (code).
- **Expected:** every editable cell can be opened for editing by keyboard (F2/Enter on the cell, or edit controls in the line detail).
- **Actual:** F2 opens the description editor only (`sheet.tsx:465` `startEdit(selected, "description")`); quantity, unit and Item cells open only on `onDoubleClick` (`sheet.tsx:1204`); the grid has no cell-level focus (arrows move rows), and the line detail's edit section offers Restore / Exclude / Mark to confirm / Add line below, no quantity or unit field. So a keyboard user can't make a quantity edit (FL-2 "sheet edit", F06-AC3) or move a line by code. Description edit by F2 + Enter works.
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/keyboard.log ("F2: input#cell-editor "Wall, Foundation…""); OUT/fl2.out; OUT/shots/fl2-07-f2-editor.png; scripts OUT/fl2.mjs, OUT/fl2b.mjs.
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `5cc298a`: the selected line has an active cell (ArrowLeft/Right over the editable cells), F2/Enter edits it. Browser spec `e2e-java/resilience.spec.ts`.
- **Retest:** L (`stage6/app/kbd-edit.mjs`, failed on the old code): quantity edited to 77.5 with a reason and saved; the Unit editor opens by Enter.

### TF-160 · S3 · bug · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** test-plan §9.2 ("dialogs return focus"); WCAG 2.4.3 Focus Order
- **Steps:** keyboard only: 1. S11 "New BoQ" → Enter → Escape. 2. BoQ header "Generate". 3. Share dialog "Create link". 4. Sheet: F2, type, Enter. 5. Setup wizard: "Start", "Use the suggested answers", "Skip".
- **Expected:** focus returns to the trigger when a dialog closes, and lands on something sensible when the focused control disappears.
- **Actual:** focus falls to `<body>` in each case: Create BoQ dialog closed with Escape (seen in two runs; the Share and Save-version dialogs do return focus to their trigger); after Generate (the button is replaced while running); after "Create link" (the button is replaced by the URL block); after committing an in-cell edit with Enter (focus does not return to the grid, so the arrows stop working); after each setup-wizard step change. Next Tab then continues from the browser's starting point, not from a logical place.
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/keyboard.log lines "create BoQ: after Escape focus -> body … (NOT returned to trigger)", "after Generate: focus body", "after create focus: body", "after Enter: reason dialog: false focus: body", "measure step focus: body"; OUT/fl2.out, OUT/fl2-run1.out; scripts OUT/fl1.mjs, OUT/fl2.mjs, OUT/fl2b.mjs.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: `useRefocusWhenLost` (Generate/Cancel, in-cell edits, wizard steps); share link field and Create BoQ return focus. `lib/focus.test.tsx`; `e2e-java/a11y-layout.spec.ts`.
- **Retest:** L: F2 edit Enter → focus on the grid; Generate → Cancel → Generate; Escape → "New BoQ".

### TF-161 · S3 · bug · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** F06 §10 (keyboard); WAI-ARIA treegrid pattern (one Tab stop, arrows inside); WCAG 2.4.3, 2.4.6
- **Steps:** keyboard only on the sheet: Tab to the grid, Enter (selects a line, detail opens), then Tab.
- **Expected:** the grid is one Tab stop; the next Tab leaves it (to the line detail or the next region); controls inside rows have distinguishing names.
- **Actual:** every rendered row's checkbox is its own Tab stop (all named "Select line"): 45 Tabs from the grid to the split handle/viewer on the 41-line Duplex; with virtualisation, Tab keeps scrolling rows into view, so on a long BoQ anything after the grid (viewer, line detail) is practically unreachable by Tab. Arrow keys, Enter, Escape and "/" behave as F06 §10 says (see coverage).
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/keyboard.log ("Tab order after selecting a line (45)"); script OUT/fl2b.mjs.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: the grid is one Tab stop; Space ticks, Ctrl+A all; row boxes named. `a11y-layout.test.ts`, `a11y-layout.spec.ts`.
- **Retest:** L: one Tab from the grid reaches the split handle.

### TF-162 · S3 · bug · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** design-guidelines.md "What may be text" (red text 4.9 on paper) and Accessibility ("focus is always visible (2 px --ring)"); WCAG 1.4.3 (axe color-contrast, serious) and 1.4.11
- **Steps:** S21 settings/general "Delete organisation…" or S36 admin org detail "Suspend" (any `variant="destructive"` button, 6 call sites + confirm actions), light and dark; Tab onto it.
- **Expected:** ≥ 4.5:1 text; a focus indicator ≥ 3:1.
- **Actual:** the shadcn destructive variant draws red text on a 10 % red tint: 4.21:1 light (#c62423 on #eed9d0), 4.26:1 dark (#e06a69 on #3e2626); hover (red/20) 3.59:1. Its focus indicator is a destructive/40 border + destructive/20 ring: ~1.6:1 against the button, barely visible (screenshot). axe flags both screens in both themes.
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/axe-results.json (S21, S36 admin org detail; light+dark); OUT/contrast.txt; OUT/focusring.txt; OUT/shots/focus-light-destructive.png vs OUT/shots/focus-light-outline.png; scripts OUT/axe.mjs, OUT/focusring.mjs, OUT/contrast.mjs.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: destructive fill 4.9:1 / 5.6:1 and full-strength focus rings. `__tests__/focus-and-destructive.test.ts` (failed first).
- **Retest:**

### TF-163 · S3 · bug · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** design-guidelines.md contrast table (only "on paper" is given); WCAG 1.4.3 (axe color-contrast, serious)
- **Steps:** sheet, select a line (ArrowDown).
- **Expected:** secondary text ≥ 4.5:1 on every fill it sits on.
- **Actual:** `--muted-foreground` #6b6762 on the selected-row fill `--selection` #dce3f3 = 4.36:1 (the "Measured" source label in the selected row; axe serious). Token check: the same text on `--muted` #e8e2d6 = 4.35:1 (light), used e.g. in bg-muted notices. Dark theme passes (5.46 / 5.23).
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/fl2-axe.json ("sheet with a line selected (working)"); OUT/contrast.txt.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: `--muted-foreground` `#625e59` (≥ 5:1). `__tests__/tokens.test.ts` (failed first); design-guidelines updated.
- **Retest:**

### TF-164 · S3 · bug · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** design-guidelines.md ("On ink (dark theme) blue and red get lighter variants for text (#7D9BE6, #E06A69)"); design-system.md (no raw colour); WCAG 1.4.3
- **Steps:** dark theme; a BoQ whose working version uses a newer model version than the saved one (Duplex → Duplex v2); Changes tab.
- **Expected:** "Added" and "Removed" tags in the dark-theme text colours.
- **Actual:** `changes-tab.tsx:24-26` uses the raw palette `var(--blue)` / `var(--red)`, which `.dark` does not redefine: "Added" #1e4fb8 on ink 2.49:1, "Removed" #c62423 on ink 3.19:1 (axe serious, 11 px text). (The light-theme orange "Changed" tag is TF-022.) Same raw-palette pattern, not yet seen rendered: `admin/org-detail.tsx:124` orange "overridden", `sparkline.tsx` stroke.
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/states2.txt, OUT/states2-axe.json ("dark changes with changes"); OUT/shots/states2-dark-changes.png; script OUT/states2.mjs.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: themed tokens instead of raw palette colours. `colour-use.test.ts` (failed first).
- **Retest:**

### TF-165 · S3 · bug · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** WCAG 2.2 2.5.8 Target Size (Minimum) (axe target-size, serious)
- **Steps:** sheet → select a line → the elements list under the 3D view in the line detail; any screen → Tab once (skip link).
- **Expected:** targets ≥ 24×24 px or spaced so a 24 px circle fits.
- **Actual:** `viewer-line-element` buttons are 20 px tall and stacked with no gap (safe space 16 px), 3–4 nodes per scan, light and dark; the "Skip to content" link is 133×20 px when shown and overlaps the wordmark.
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/axe-results.json ("S12a line detail open"), OUT/fl2-axe.json; script OUT/axe.mjs.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: viewer targets ≥ 24 px, skip link 40 px. `a11y-layout.test.ts`.
- **Retest:**

### TF-166 · S3 · bug · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** WCAG 4.1.2 / 1.3.1 (axe label, critical) and 2.5.3 Label in Name (axe label-content-name-mismatch, serious); F15 (names from the catalogue)
- **Steps:** 1. BoQ → Share → Create link: the created-URL field. 2. /account: the header link.
- **Expected:** every field has a label; a control's accessible name contains its visible text.
- **Actual:** the read-only URL input `data-testid="share-url"` has no label, aria-label or labelledby (critical). On /account the wordmark link shows "boqlet" but is named "Back to the start" (speech-input users saying "boqlet" can't hit it); elsewhere the wordmark is "boqlet home", which passes.
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/fl2-axe.json ("share dialog with created link"); OUT/axe-results.json (S04 account, light+dark).
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: share URL field labelled; account wordmark named. `a11y-layout.test.ts`.
- **Retest:**

### TF-167 · S3 · bug · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** WCAG 2.4.2 Page Titled (A); nfr.md WCAG 2.2 AA
- **Steps:** open sign-in, dashboard, project, models, BoQ sheet, questions, Library, settings/members, notifications, admin, share page; read `document.title`.
- **Expected:** a title naming the page (e.g. "Duplex A11y BoQ · Sheet · boqlet").
- **Actual:** every page is titled "boqlet"; tabs, history and screen-reader page announcements can't tell pages apart.
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/titles.txt; script OUT/titles.mjs.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: `usePageTitle` on every page. `lib/page-title.test.ts`, `a11y-layout.spec.ts`.
- **Retest:** L: "Duplex Sheet BoQ · Sheet · Duplex Sheet · boqlet", "Notifications · boqlet".

### TF-168 · S3 · bug · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** test-plan §9.2 (zoom 200 %: nothing cut off or overlapping on S01, S05, S12a, S35); WCAG 1.4.4 Resize Text; nfr.md (share page usable ≥ 768 px)
- **Steps:** viewport 640×450 CSS px at deviceScaleFactor 2 (= a 1280×900 window at 200 %); open S01, S05, S12a, S35.
- **Expected:** no content cut off; no sideways scrolling of the page (data grids may scroll inside themselves).
- **Actual:** S01 and S05 fine. S12a: the sidebar stays 207 px wide; the project tabs and BoQ tabs run past the right edge (page scrollWidth 782 > 640: "Activity", "Settings", "Exports", "Versions" off-screen, "ACTI…" cut). S35: the 3D view is 1205 px wide (page scrollWidth 1205), so the share page scrolls sideways; the sheet itself reflows.
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/zoom-sr.txt; OUT/shots/zoom200-S12a-viewport.png, OUT/shots/zoom200-S35-crop.png, OUT/shots/zoom200-S01.png, OUT/shots/zoom200-S05.png; script OUT/zoom-sr.mjs.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: the sidebar folds below 1024 px, tab rows wrap, the viewer box doesn't overflow. `a11y-layout.test.ts`.
- **Retest:** L: 200 % zoom, BoQ and share page 640 px wide, no overflow.

### TF-169 · S4 · inconsistency · app · fixed
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** design-guidelines.md Accessibility ("focus is always visible (2 px --ring)"); WAI-ARIA landmarks; test-plan §9.2 (moderate/minor go into one S4)
- **Steps:** see evidence.
- **Expected:** as the guideline says.
- **Actual:** axe found **no moderate or minor violations** on any screen or state (WCAG tags only). Smaller things seen by hand: (a) buttons and inputs show focus as a 1 px `--ring` border plus a 2 px ring at 30 % opacity (#b2bed6 on paper, 1.6:1), not the 2 px `--ring` the guideline promises (the 1 px border alone passes 3:1); (b) the share page has no `<main>` landmark (the app shell's skip link targets `#main`, the share page has neither); (c) the 41 row checkboxes all have the same name "Select line" (also in the S3 grid finding). BoQ and project tabs are links with `aria-current="page"` (fine; arrows don't move between them, as expected for links).
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) OUT/focusring.txt, OUT/shots/focus-light-outline.png; OUT/zoom-sr.txt (share: `"main":0`); OUT/keyboard.log.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: focus ring (TF-162), the share page is `<main id="main">`, row boxes named (TF-161). `a11y-layout.test.ts`.
- **Retest:**

### TF-170 · S3 · test-gap · suites · deferred
- **Found by:** Stage 4 · 4.2 · L · fc78b12
- **Spec:** test-plan §9.2 ("the TS-003 suite was deleted with the mock; porting it to e2e-java is a test-gap"); known-limitations.md ("Not covered in a browser any more: … the axe accessibility checks (TS-003)"; "The accessibility pass by keyboard and screen reader has not been done")
- **Steps:** `apps/app/e2e-java` has 5 specs (accounts, live, main-flow, orgs, sessions), none runs axe or a keyboard path.
- **Expected:** an axe scan of the main screens in both themes and keyboard checks of FL-1/FL-2/FL-11 run in CI against Java.
- **Actual:** nothing automated. Candidates to port: OUT/axe.mjs (39 screens × light/dark, the screen list and world setup in OUT/world.mjs), OUT/states.mjs + OUT/states2.mjs (presence, Changes with changes, wizard steps), OUT/fl1.mjs, OUT/fl2.mjs, OUT/fl2b.mjs (keyboard FL-1/FL-2/FL-11 with the focus helpers in OUT/kb.mjs), OUT/zoom-sr.mjs, OUT/focusring.mjs. Untested journeys that passed by hand: FL-1 by keyboard, the sheet's arrows/Enter/Escape/"/"/F2, the Share and Save-version dialogs' focus trap and return, the shell menus by keyboard (OUT/menus.mjs).
- **Evidence:** (session scratchpad `stage4/out/s4-a11y/`) the scripts above; `ls apps/app/e2e-java`.
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:** `apps/app/e2e-java/a11y.spec.ts` with `@axe-core/playwright` (already a devDependency) failing on serious/critical, plus a keyboard spec.
- **Retest:**

### TF-171 · S3 · bug · app · fixed
- **Found by:** Stage 4 · 4.5 widths · L · fc78b12
- **Spec:** docs/architecture/nfr.md "Browser support": "Read-only views (saved BoQ version, share page, vendor request page) usable at >= 768 px"; test plan §9.5 widths.
- **Steps:** 1. Save a version of a Duplex BoQ. 2. Open it (Versions › Open, `?tab=sheet&version=<id>`) in a 768 px wide window (Chromium, Firefox or WebKit). 3. Look at the sheet.
- **Expected:** the saved version is usable at 768 px: each line's description, unit and quantity readable.
- **Actual:** identical in Chromium 158, Firefox 159 and WebKit 27.2. The app sidebar (208 px) stays open at 768 px, so the sheet grid is 496 px wide against 920 px of columns. You see No., Item and Description, and Unit is cut off ("UN"). The Quantity column (left 784 px) is outside the grid: you only see it by scrolling the grid sideways (after that it is at 360-488 px). The empty Item column takes 128 px. On the working version at 768 px the BoQ tab row also makes the whole page scroll sideways (document scrollWidth 782 for viewport 768, `tab-versions` sticks out), on the Sheet, Questions and Versions tabs. Below 768 px (not required): the signed-in shell's top bar is 460 px wide (page scrolls sideways at 390/360) and the sheet grid shrinks to 88-118 px, so the app can't be used on a phone.
- **Evidence:** (session scratchpad `stage4/out/s4-compat/`) shots/w-<browser>-savedVersion-768.png, shots/col-<browser>-savedVersion-768-scrolled.png, shots/w-<browser>-sheet-768.png, widths-chromium-firefox-webkit.json, columns.json; scripts widths.mjs, columns.mjs (all in …/scratchpad/stage4/out/s4-compat/).
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: at 768 px the sidebar folds and Item shows only while grouping. `a11y-layout.spec.ts`.
- **Retest:** L: a saved version at 768 px shows Quantity, no sideways scroll.

### TF-172 · S4 · bug · app · fixed
- **Found by:** Stage 4 · 4.5 widths · L · fc78b12
- **Spec:** test plan §9.5 "below 768 px (nothing breaks so badly that the share page can't be read)"; nfr.md browser support.
- **Steps:** 1. Open a public share link (no cookie) at 390 px or 360 px wide (Chromium, Firefox, WebKit).
- **Expected:** the share page can be read: every line with its quantity.
- **Actual:** same in all three engines. The page doesn't scroll sideways (scrollWidth = viewport) and the title, search and descriptions are readable. But description cells don't wrap, so the table is 577 px wide inside a 312-342 px scroll box. Unit and Quantity (left 525 px) are off-screen, and you only see the numbers by swiping the table sideways. Nothing on the page says the table scrolls. The page is fine at 768 px and up (Quantity at 649-744 px).
- **Evidence:** (session scratchpad `stage4/out/s4-compat/`) shots/w-<browser>-share-360.png, shots/w-<browser>-share-390.png, shots/col-<browser>-share-360-scrolled.png, columns.json, widths.mjs, columns.mjs.
- **Route:** fix now · B3 (app UX, states, a11y, i18n (S3/S4))
- **Fix:** `852393e`: the share description cell wraps. `a11y-layout.spec.ts`.
- **Retest:** L: 360 px, Quantity at 336 px.

### TF-173 · S4 · question · app · open
- **Found by:** Stage 4 · 4.5 FL-2 (all browsers) · L · fc78b12
- **Spec:** F05 §4 "if the question carries `suggestion`, it is preselected and marked suggested"; F05 §2 "Answering writes a project decision".
- **Steps:** 1. Generate the Duplex BoQ. 2. Questions tab: the "thickness/volume stated vs measured" contradiction questions show the RECOMMENDED radio already checked and a SUGGESTED tag. 3. Click the checked (recommended) option.
- **Expected:** spec doesn't say. A user who agrees with the suggestion expects one click to accept it.
- **Actual:** clicking the preselected radio fires no change: no `POST /projects/{p}/decisions` (waited 15 s) and the question stays unanswered. To accept the suggestion on one row you have to pick the other option and then switch back, or use the bulk bar. Same in all four browsers (found because the scripted "answer a question" step timed out until it picked the unchecked option).
- **Evidence:** (session scratchpad `stage4/out/s4-compat/`) shots/chromium-11-fl2-questions.png; first Chromium run of journeys.mjs (step "answer a question" timed out waiting for the decisions response).
- **Route:** answered by the owner (Q60, P54: the first option); fix now · B7 (owner answers)
- **Fix:** an "Accept" button next to a suggested answer, or don't check the radio (show the suggestion as a hint).
- **Retest:** clicking accept writes a decision.

### TF-174 · S1 · bug · java · verified
- **Found by:** Stage 4 · 4.3 · L · fc78b12
- **Spec:** `docs/architecture/security.md` "Input handling" (JSON inputs validated against the OpenAPI schemas) and BE-D13 (bounded work per request); `docs/architecture/nfr.md` availability; set-password already caps a name at 120 characters (`NativeCredentials.java:73`), the same field through `PATCH /me` has no cap
- **Steps:** 1. Any signed-in user: `PATCH /api/v1/me {"name": "<8 MiB>"}` -> `200`, stored. 2. `POST /projects/{id}/decisions?dryRun=true` with 50,000 decisions (4 MiB body). 3. Safe size: name of 2 MiB, then `POST …/decisions?dryRun=true` with 20 decisions (1.6 KB), `GET /orgs/{id}/audit?limit=50`, `GET /projects/{id}/audit?limit=50`, `GET /models/{id}/versions`.
- **Expected:** names, labels and texts bounded (`400 invalid_body`), arrays bounded (`maxItems`), a request-body cap; one member can't make the shared API run out of memory.
- **Actual:** no `maxLength` anywhere in `openapi.yaml` and no `maxItems` on `decisions`; the only cap is Jackson's 20M-character string limit (32 MiB name -> `400 invalid_body`, 8 MiB -> `200`). 1 MiB is stored for org name, project name, BoQ name, model name, preset description, share-link label, manual-item description, override reason, decision note. The user name is copied into every row that embeds the user (`decidedBy`, audit actor, `uploadedBy`): with a 2 MiB name, 20 decisions (1.6 KB request) -> **40 MiB** response; org audit page (50 rows) -> **101 MiB**; project activity -> 100 MiB; model versions -> 6 MiB. Step 2 with the 8 MiB name ran 74 s and answered `401 unauthenticated`; the API log shows `java.lang.OutOfMemoryError: Java heap space` (heap 4 GiB on L) in `StoredJson.read` <- `Decisions.view(Decisions.java:214)` <- `Decisions.save(Decisions.java:119)` (and the 401 is TF-071's error path). On the pilot the heap is about 1 GB (`mem_limit 1536m`, `MaxRAMPercentage=65`): any member of any org can take the API down for every tenant with one name change and one request, or just by letting org-mates open the audit page. The API recovered on L (health `UP`).
- **Evidence:** (session scratchpad `stage4/out/s4-security/`) OUT/bigjson.mjs + bigjson.log (8/32/64 MiB, 50k decisions -> `401 … (74302 ms)`), OUT/lengths.mjs + lengths.log (per-field 1 MiB, scaling 100/1000/3000 decisions = 256/1685/4108 ms), OUT/amplify.mjs (2 MiB name: `decisions dryRun 20 entries (1605 B request) -> 200 40 MiB 604 ms`, `GET org audit -> 200 101 MiB`); `docker logs boqlet-local-api-1` 22:31:34Z `Handler dispatch failed: java.lang.OutOfMemoryError: Java heap space`. Names restored afterwards.
- **Severity:** raised from S2 to S1 in triage: any signed-in user can make a shared component (the engine's spreadsheet reader, or the API itself) fail for every org; confirmed live in Stage 4.
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `5e69e2c`: `maxLength`/`maxItems` on every request string and array (contract C08), enforced by the generated DTOs (`400 invalid_body`); `RequestSizeFilter` caps JSON bodies at 1 MiB (32 MiB for document and batch operations, `413 too_large`); the fields the DTOs can't reach are checked in code; V17 cuts names stored before. Tests `ApiFoundationTest#requestStringsArraysAndBodiesAreBounded` (failed first: 121-character name → 200), `RequestSizeFilterTest`, `tests/contract/validation.test.ts`.
- **Retest:** L, API rebuilt from the fix: 8 and 32 MiB names → `413`; each Stage 4 field one character over its cap → `400 invalid_body`; 10,001 and 50,000 decisions → `400` in 0.5–0.8 s (was a 74 s OOM); with a 120-character name decisions dryRun of 20 → 10 KiB, project activity 26 KiB (`stage6/java/retest-tf174.log`). Audit rows written before the fix keep their copies (append-only). Pushed and deployed in `1be66cb`.

### TF-175 · S3 · inconsistency · java · fixed
- **Found by:** Stage 4 · 4.3 · L · fc78b12
- **Spec:** `docs/architecture/security.md` "Cross-tenant access returns `404`, not `403`"; `docs/domain/permissions.md` (another org's objects are not found)
- **Steps:** as owner of org A, with ids of org B (a stranger's org): 1. `POST /boqs/{A boq}/share-links {"mode":"pinned","revisionId":"<B revision>"}`. 2. `PATCH /revisions/{A rev} {"inputs":{"ruleSetVersionId":"<B private rule-set version>"}}`, and the same in `POST /projects/{A}/boqs {"inputs":…}`. 3. `POST /runs/{A run}/compare {"againstRunId":"<B run>"}`. Repeat each with a random UUID.
- **Expected:** the same answer for another org's id as for an id that doesn't exist (`404 not_found`, same message).
- **Actual:** 1. B's revision -> `400 invalid_body "That version belongs to another BoQ."`, random -> `404 "The revision was not found."`. 2. B's version -> `400 invalid_inputs "A selected preset isn't a published rule set available in this project."`, random -> `404 not_found "The preset or version was not found."` (createBoq the same). 3. B's run -> `404 "The project was not found."`, random -> `404 "The run was not found."`. Nothing of B's is returned or changed (every other nested-id check passed: OUT/isolation.log), and ids are UUIDv7, so this is an existence oracle only.
- **Evidence:** (session scratchpad `stage4/out/s4-security/`) OUT/isolation.mjs, isolation2.mjs, isolation.log ("oracle check" lines).
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `8745980`: another org's preset version, pinned revision or run answers 404 like a random id. `isolation.test.ts` (failed first).
- **Retest:**

### TF-176 · S4 · gap · java · fixed
- **Found by:** Stage 4 · 4.3 · L · fc78b12
- **Spec:** `security.md` "Input handling"; the upload file-name check already refuses control characters (`Invalid model filename.`)
- **Steps:** `PATCH /projects/{id}` and `PATCH /me` with names containing BEL (`\u0007`), ESC (`\u001b[31m`), CR LF, the right-to-left override `‮` ("abc‮txt.exe"), a lone surrogate (`\ud800`), NUL.
- **Expected:** control and bidi-override characters refused (`400 invalid_body`), as for file names.
- **Actual:** BEL, ESC, CR LF and U+202E stored and returned (`200`); a lone surrogate silently becomes `?`; NUL -> `401 unauthenticated` (Postgres `invalid byte sequence for encoding "UTF8": 0x00`, TF-071 path). Model file names reject all of these (`fname.mjs`), entity names none. A U+202E in an org or user name spoofs text in members lists, mails and exports.
- **Evidence:** (session scratchpad `stage4/out/s4-security/`) OUT/bigjson.log (control-character lines), OUT/filenames.log.
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `cd37865`: `TextInputAdvice` refuses NUL and unpaired surrogates in every body, and control/separator/bidi characters in names and labels (400 invalid_body). `AccountSecurityTest`, `orgs.test.ts` (failed first).
- **Retest:**

### TF-177 · S4 · gap · engine · fixed
- **Found by:** Stage 4 · 4.3 · L · fc78b12
- **Spec:** CLAUDE.md rule 5 ("Nothing is silently dropped"); `security.md:77-78` (openpyxl data-only: formulas not evaluated)
- **Steps:** a code list `.xlsx` saved by a tool that writes no cached values (openpyxl), with formula cells (`=1+1`, `=HYPERLINK(…)`, a formula in the Code column); `POST /api/v1/codelists/read`.
- **Expected:** the formula text kept as a string, or a problem "formula cells are read as empty" per cell.
- **Actual:** `200`; every formula cell comes back as `""` (`["S4-02",""]`, a code `=2+2` -> `["","formula as code"]`), no problem reported; the user builds a code list with silently missing titles or codes. (Workbooks saved by Excel carry cached values, so this hits generated files.) No formula is evaluated: the security control holds.
- **Evidence:** (session scratchpad `stage4/out/s4-security/`) OUT/xl-run.mjs, OUT/xlsx.log, OUT/mkxlsx.py (`codes-formulas.xlsx`).
- **Route:** fix now · B4 (engine and exports (S3/S4))
- **Fix:** `7704cd9`: `xlsx_guard.uncached_formulas` finds formula cells with no saved value from the sheet XML; code lists refuse the file, templates and the edits import report the cells. Tests `test_xlsx_guard.py`, `test_boq_import.py` (failed first).
- **Retest:**

### TF-178 · S3 · test-gap · suites · deferred
- **Found by:** Stage 4 · 4.3 · L · fc78b12
- **Spec:** test-plan §9.3; `security.md` "Isolation tests"
- **Steps:** grep `tests/`, `services/api/src/test`, `apps/app/e2e-java` for the checks below.
- **Expected:** the security behaviour that passed live is pinned by a test.
- **Actual:** passed live, no automated test: per-source sign-in limit (46th -> 429) and `X-Forwarded-For` ignored for the bucket; per-email limit counting successes and case/space variants; session fixation (a pre-set cookie isn't adopted, new cookie at sign-in); sign-out replay (`/me`, `/events`, `DELETE /sessions/current` -> 401) and `session.revoked` on the SSE stream at sign-out; Origin check on PUT and on `/auth/sign-in`, `/auth/set-password`, `/sessions`, `DELETE /sessions/current` (16 Origin spellings, Referer-only, `Sec-Fetch-Site`, cross-site form content types, the app proxy); signed URLs (key swap -> `SignatureDoesNotMatch`, PUT +/-1 KiB refused, GET refused after 300 s, method swap refused); nested foreign ids (revision inputs, createBoq, createShareLink, compare, decisions, promote, notifications, presence, public share with another org's version id, SSE replay from `Last-Event-ID: 0`); stored script strings escaped in the app, the share page and the invitation page; upload file-name validation.
- **Evidence:** (session scratchpad `stage4/out/s4-security/`) OUT/auth.mjs, csrf.mjs, signed.mjs, expiry.mjs, isolation.mjs, isolation2.mjs, browser.mjs, fname.mjs, persource.log.
- **Route:** deferred (TS-005: port the browser coverage lost with the mock to `apps/app/e2e-java`; the Stage 3/4 scripts named here are its starting point)
- **Fix:** port these to `NativeAuthTest` (auth, origin) and `tests/scenarios` (isolation, signed URLs with a short TTL override, names) and one Playwright spec for escaping.
- **Retest:**

### TF-179 · S2 · bug · java · fixed
- **Found by:** Stage 4 · 4.1 · L · fc78b12
- **Spec:** v1-10 / nfr.md "Lines page (500 lines) p95 ≤ 500 ms" (test plan §9.1: "with a small load, for example 20 virtual users"); F06 §1 (runs up to 20,000 lines)
- **Steps:** 1. A run with 20,500 lines in my own org (Duplex run, rows copied in SQL: prep20k.mjs). 2. 20 concurrent clients loop `GET /runs/{id}/lines?limit=500` for 60 s on the local stack (load2.mjs). 3. One client: limit=1, 50, 500 and cursor=20000 (probe-lines.mjs).
- **Expected:** p95 ≤ 500 ms.
- **Actual:** p50 2,090 / p95 2,868 / p99 3,527 ms (9 req/s, 0 errors). One client: limit=1 259 ms, limit=50 260 ms, limit=500 309 ms, cursor=20000 772 ms; the same request on a 41-line run takes 11 ms. The cost grows with the run, not the page: every call runs `count(*)` over the run and `positions.positions(...)` (`BoqExports.positions`, `RunReads.java` lines()), which reads the codes of every line of the run and numbers them in Java, then `OFFSET` pagination. The harness passes (219 ms) only because its run has 500 lines.
- **Evidence:** (session scratchpad `stage4/out/s4-perf/`) measure.log "load2 … lines" and "lines probe"; load2.json; services/api/src/main/java/com/boqlet/api/boq/RunReads.java (`var positionsByKey = positions.positions(id, …)`)
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `f09befd` (positions per run, page by sort_index) and `9efea85` (each line's JSON stored at indexing in `run_lines.view`, V18, sent as stored; byte-identical to the typed path, asserted in `NativeWorkerTest`). `NativeWorkerTest#verifyLargeRunPages` (failed first).
- **Retest:** L, 20,500 lines, 500-line pages, 20 clients 60 s: p95 **122 ms at the API** (access log, p50 80), 679 ms at a client through Docker Desktop's port forwarding on a loaded laptop (was 2,868). To confirm from a Linux client (Stage 7).

### TF-180 · S2 · gap · ops · open
- **Found by:** Stage 4 · 4.1 · L · fc78b12
- **Spec:** v1-10 / nfr.md "Queue wait (p95) for interactive runs: ≤ 10 s on the standard pool at expected load" (capacity: 10 concurrent parse jobs, 30 runs/min); nfr.md federated pair "both parses in parallel"
- **Steps:** 1. Local stack (HTTP transport, `BOQLET_ENGINE_HTTP_CONCURRENCY` default 1). 2. Upload the NBU Eng-CON file (6.3 s parse), 1.5 s later start a Duplex run (stack-contend.mjs). 3. Upload the NBU office pair as two models at once (stack-fed.mjs).
- **Expected:** an interactive run starts within 10 s whatever parses run; the two parses run in parallel.
- **Actual:** the run waited 5.36 s in queue (job created → started) behind the parse; the second parse of the pair waited 7.8 s for the first. One engine slot serves parses and runs, so a run waits for any parse ahead of it: behind the 9-min medium parse (nfr.md) it would wait minutes. The pilot defaults are the same shape: one queue worker, `ENGINE_QUEUE_CONCURRENCY` 1, model and general pool both `default` (ops/pilot/compose.yaml:115-116, 151-152). Idle, the queue wait is fine (p95 523 ms over 12 runs). `engine_timing.py --federated` parses in a process pool, so its parallel figure is not what the stack does.
- **Evidence:** (session scratchpad `stage4/out/s4-perf/`) measure.log "contention: …", "fed parse con: … job queue 7755 ms"; application.yml `concurrency: ${BOQLET_ENGINE_HTTP_CONCURRENCY:1}`
- **Route:** answered by the owner (Q61, P54: the first option); fix now · B7 (owner answers)
- **Fix:** separate pools (or a reserved slot) for runs vs parses, concurrency ≥ 2 where the CPUs allow; or restate the target in nfr.md for a single-slot deployment.
- **Retest:**

### TF-181 · S3 · inconsistency · docs · fixed
- **Found by:** Stage 4 · 4.1 · L · fc78b12
- **Spec:** docs/testing/README.md "Engine timing" (`PERF_OUT=<file>` appends JSON lines); nfr.md "Federated medium pair" row; test plan §9.1
- **Steps:** 1. `PERF_OUT=x.jsonl engine/.venv/Scripts/python.exe tests/perf/engine_timing.py fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc`. 2. Compare the federated pair in the campaign (NBU office Arch-1 + Eng-CON) with nfr.md.
- **Expected:** the file gets the JSON lines; the reference pair is a medium pair, the same one nfr.md measured.
- **Actual:** 1. engine_timing.py never reads `PERF_OUT` (it only prints; no file written). 2. The office pair is 15.2 MB and 1,303 elements (below the medium class, 10k–50k elements and 50–300 MB; near the small one, < 1k elements and < 20 MB), while nfr.md's row names the NBU Medical Clinic pair (18 + 19 MB): the "medium pair" target is checked against a small pair and the two measurements are not comparable.
- **Evidence:** (session scratchpad `stage4/out/s4-perf/`) tests/perf/engine_timing.py (`emit` prints only); engine-fed.out; measure.log "fed parse … elements 805 / 498"
- **Route:** fix now · B5 (docs, ops, contract wording)
- **Fix:** `55339a2`: `engine_timing.py` prints JSON lines (no PERF_OUT claim); one federated reference pair named everywhere.
- **Retest:**

### TF-182 · S2 · bug · app · fixed
- **Title:** Live updates stop for good 5 minutes after a page opens (and after any API restart or deploy): the SSE client never reconnects when the server closes the stream
- **Found by:** Stage 4 · 4.4 · L · fc78b12
- **Spec:** `docs/architecture/storage-jobs-realtime.md` "Realtime" ("a stream lives 5 minutes and the client reconnects"; "On reconnect the client sends `Last-Event-ID` and the instance replays the last five minutes"); `nfr.md` "Live update latency (job finished → UI) ≤ 2 s" and "Live edit visible to other users of the BoQ (P31) ≤ 1 s"; BR-54 (`session.revoked` reaches the replaced session); test plan §9.4 "the client reconnects and catches up"
- **Steps:** 1. Open a BoQ page and leave it idle (headless Chromium, no other tabs). 2. Rename the BoQ through the API at t+20 s: the page shows the new name. 3. Wait past t+5 min. 4. Rename it again, or generate a run, through the API. Same with `docker restart boqlet-local-api-1` instead of waiting (API back in ~9 s).
- **Expected:** when the stream ends the client reconnects (1 s `retry`, the server even sends `reconnectTime(1000)`) with `Last-Event-ID`; the missed `entity.changed` / `job.finished` / `notification.created` are replayed; the page updates.
- **Actual:** the server ends the stream cleanly at exactly 5:00 (`Realtime.java:51,103` `emitter.complete()`) and on shutdown. `@microsoft/fetch-event-source` retries only on errors: a clean end calls `onclose` and resolves (`fetch.js:65-67`), and `apps/app/src/realtime/sse.ts` passes no `onclose`, so no new `GET /events` is ever made. `<html data-realtime>` stays `"open"`. Plain run (no instrumentation): one `/events` request at 23:38:59, "finished" at 23:44:00, none in the next 92 s; the rename at t+24 s reached the page, the rename at t+392 s did not. Instrumented run: `SSE-END` at 5:00.1, then a run finished (`job.finished`, `notification.created`) and no toast, no refetch. API restart: stream ended at 23:30:59, API ready 8.7 s later, no reconnect for 44 s until a page reload; events 11176–11186 (run progress, `job.finished`, the notification, the rename) never reached the tab. Every tab therefore loses co-editing (P31), run/parse progress and finish, notification toasts and the takeover sign-out after 5 minutes; only window-focus refetches (TanStack default) hide part of it. Every green push to `main` restarts the pilot's API, so each deploy also silences every open tab.
- **Evidence:** (session scratchpad `stage4/out/s4-resilience/`) OUT/sse-5min-plain.mjs + sse-5min-plain.log; OUT/sse-5min.mjs + sse-5min.log; OUT/sse-restart.mjs + sse-restart.log (`SSE-END 23:30:59.080`, no `SSE-REQ` until the reload at 23:31:43, `realtime_events` 11176…11186 listed); shots/sse-5min.png, sse-2-after.png
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `5cc298a`: `sse.ts` treats a clean end as a reconnect (1 s after a stream that lived ≥ 10 s, with Last-Event-ID; 2–15 s backoff otherwise) and `onResume` refetches. Test `apps/app/src/realtime/sse.test.ts` (3 of 4 failed first); browser spec `e2e-java/resilience.spec.ts`.
- **Retest:** L (dev app :3200): an ended stream reconnected with `last-event-id: 7` and a rename showed live; after 40 s with the API unreachable it reconnected with Last-Event-ID 11830.

### TF-183 · S2 · bug · app · fixed
- **Title:** A sheet edit committed while the API is unreachable (every deploy restarts it) is dropped without a "not saved" message; the BoQ page then turns into "Something went wrong" and stays so after the API is back
- **Found by:** Stage 4 · 4.4 · L · fc78b12
- **Spec:** `screens.md` states ("error (message + retry)"); `frontend.md` data layer rule 6 (inline error with retry); F06 line edits (an edit is saved or the user is told); test plan §9.4 "Does an in-flight edit survive?"
- **Steps:** 1. BoQ sheet, double-click a Description cell, type new text. 2. `docker stop boqlet-local-api-1` (or `docker restart`). 3. Press Enter. 4. Start the API again and wait.
- **Expected:** the edit is kept (pending) and retried when the API answers, or the user sees "not saved" with Retry and the typed text is not lost; the page recovers when the API is back.
- **Actual:** the app's proxy answers `POST /api/v1/boqs/{id}/overrides/batch` with a bare `500 Internal Server Error` (text, not the JSON error body; a 502/503 would be right for an unreachable upstream). The editor closes and the cell shows the old text; no toast, no `edit-error` alert, Undo stays disabled; `GET /boqs/{id}/overrides` after the restart is `[]`, so the text is gone. With a 9 s restart the sheet stayed on screen with the old value (no message at all); with a 60 s stop the whole BoQ page became "Something went wrong. Try again." (plain text, no button) and was still that 8 s after the API was ready, until a reload (the refetch had already given up). Same 500s for `presence`, `manual-items`, `GET /boqs/{id}`.
- **Evidence:** (session scratchpad `stage4/out/s4-resilience/`) OUT/edit-down.mjs + edit-down.log (`edit POST -> 500 Internal Server Error`, `edit-error []`, `overrides after restart: []`), shots/edit-down-1.png, edit-down-2.png; OUT/sse-restart.log (9 s restart: `after Enter while down: toasts []`, `overrides after: []`), shots/sse-1-edit-while-down.png
- **Route:** fix now · B1 (S1/S2 and what hits the deployed pilot now)
- **Fix:** `5cc298a`: `/api/v1` in development goes through `app/api/v1/[...path]/route.ts` (`src/api/proxy.ts`), `503 api_unavailable` for an unreachable API; edits retry while unavailable, an unsaved batch stays listed (Save again / Discard) and is sent again on resume or online; the BoQ page keeps its workspace on a refetch error. Tests `proxy.test.ts` (failed first), `errors.test.ts`, `e2e-java/resilience.spec.ts`.
- **Retest:** L (dev app, API cut for ~20 s): 503 JSON, "Saving…", the not-saved alert; the edit saved by itself ~5 s after the API was back.

### TF-184 · S3 · gap · java · fixed
- **Title:** HTTP job transport: transient failures burn job attempts: an engine outage longer than ~35 s fails every queued and running job, and a sub-second database restart aborts every in-flight job for ~55 s
- **Found by:** Stage 4 · 4.4 · L · fc78b12
- **Spec:** `nfr.md` "Availability and recovery" ("Jobs survive worker crashes (heartbeat re-queue). No job is lost on deploy."); `storage-jobs-realtime.md` "Jobs" step 5; `engine-worker.md` "Transports" (HTTP is the default transport and the local stack's)
- **Steps:** 1. Start a parse (NBU Eng-CON, 11 MB), `docker kill boqlet-local-engine-1` in the geometry stage, start it again after 60 s. 2. Start a parse, `docker restart boqlet-local-db-1` (0.7 s) in the geometry stage. 3. Start the engine and retry a failed version within ~1 s of the engine's health turning 200.
- **Expected:** jobs wait for the worker and finish once it is back (attempts < 3); a database blip doesn't cancel a healthy worker exchange.
- **Actual:** 1. the dropped connection re-queues at once (`engine_unavailable`, retryable), but attempts 2 and 3 are claimed at +10 s and +20 s (`available_at = now() + attempts*10 s`, `Jobs.java:253`) while the engine is still down, fail on connect, and the job ends `failed` 44 s after the kill (3 attempts); the version shows FAILED "The processing service was not available. Try again." (the Try again button then works). Every job queued during a longer engine stop fails the same way, and the API's readiness stays UP throughout (the engine isn't part of it). With an immediate restart (engine healthy after 5.7 s) the job re-queues and succeeds on attempt 2 (parse 22.6 s instead of ~7 s; run 11.6 s instead of 0.6 s). 2. the heartbeat `UPDATE jobs` throws during the restart; `JobDispatcher.await` doesn't catch it, `execute` records `ingestion_failed`, which also fails, and cancels the engine exchange (`JobDispatcher.java:131-141`): the engine's work is thrown away and the row stays `running` until `reclaimLostJobs` (30 s stale + 30 s scan) re-queues it at +55 s; attempt 2 then succeeds. API requests themselves survived the restart (13/13 200). 3. a retry 1.3 s after the engine came back hit `java.net.ConnectException` and spent an attempt (+10 s).
- **Evidence:** (session scratchpad `stage4/out/s4-resilience/`) OUT/worker-kill.mjs, worker-parse-kill-60.log (failed at 44.3 s, attempts 3), worker-parse-kill-0.log, worker-run-kill-0.log; OUT/db-restart.mjs, db-restart.log ("Could not ingest job …", "Could not record ingestion failure …" in the API log at 23:48:49), db-stop.log; OUT/ui-outage.log, shots/outage-2-requeued.png (version shows QUEUED with no hint of a retry), outage-4-version-failed.png
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `179987f`: a refused or timed-out worker connection re-queues without using an attempt (`waiting_for_worker`, first 30 min); a refused heartbeat no longer cancels the exchange; result writes retry 15 s. `worker/JobDispatcherTest` (4).
- **Retest:**

### TF-185 · S4 · gap · java · fixed
- **Title:** Request ids: echoed and in the pilot's JSON logs, but not in error bodies, and the local stack's log format drops them; readiness hangs while the database is down
- **Found by:** Stage 4 · 4.4 · L · fc78b12
- **Spec:** test plan §9.4 "request ids in logs and error bodies"; `deployment.md:59` and `docs/operations/pilot.md` "Logs" (every line with `requestId`, `userId`, `orgId`, `jobId`); `api-conventions.md` "Errors" (body `{code, message, details}`: silent on a request id)
- **Steps:** 1. Send `X-Request-Id: s4res-rid-404` (and 400, 401, 403, through the app proxy too). 2. `docker logs boqlet-local-api-1 | grep s4res-rid`. 3. A second API instance with `BOQLET_LOG_FORMAT=ecs`, same request. 4. `docker stop boqlet-local-db-1`, `GET /actuator/health/readiness`.
- **Expected:** the id echoed, in the log line and in the error body (so a user's screenshot of an error leads to the log); readiness answers `503 DOWN` quickly when the database is gone.
- **Actual:** echoed on every status, also through the app proxy; unsafe or 65+ character ids are replaced by a UUID (good). Error bodies carry no request id. In ECS format the access line has `requestId`, `userId` (and job lines `jobId`); in the local stack's default text format (`BOQLET_LOG_FORMAT` unset) no line contains the request id, user or job id, only empty trace brackets, so local logs (and the campaign's) can't be followed by request id. With the database stopped, `/actuator/health` and `/readiness` didn't answer within 3 s (liveness did, 200); readiness came back 1.5 s after the database started.
- **Evidence:** (session scratchpad `stage4/out/s4-resilience/`) OUT/reqid.mjs + reqid.log (0 log lines per id in text format), OUT/two-api.mjs + two-api.log (ECS line with `"requestId":"s4res-two-api-404"`), OUT/db-stop.log (`"ready":"ERR:TimeoutError"` for 18 s)
- **Route:** fix now · B2 (Java correctness, security, audit (S3/S4))
- **Fix:** `cd37865`: text logs carry the correlation fields; the DB health check gives up after 2 s (`HealthTimeoutTest`); the app shows "Reference for support" on 5xx (`error-reference.test.tsx`).
- **Retest:**

### TF-186 · S3 · test-gap · suites · fixed
- **Title:** Resilience lane (§9.4): worker loss, DB blips, SSE reconnect and rollback compatibility have no automated test
- **Found by:** Stage 4 · 4.4 · L · fc78b12
- **Spec:** test plan §9.4; `nfr.md` "Availability and recovery"
- **Steps:** grep `services/api/src/test` and `apps/app/e2e-java` for worker kill / reclaim / `Last-Event-ID` reconnect: `NativeWorkerTest` covers two API instances (`realtimeReachesClientsOfAnotherApiInstance`, confirmed by hand here) and a server-side replay with `Last-Event-ID: 0`, `BackupRestoreTest` covers the dump/restore; nothing kills a worker mid-job, restarts the database, ends a client's stream, or starts an older API on a newer schema.
- **Expected:** the behaviours above guarded in CI.
- **Actual:** passing but untested here (script paths): engine kill mid-parse and mid-run with re-queue (worker-kill.mjs), graceful engine restart mid-parse (worker-kill.mjs restart), queue reclaim after a database restart (db-restart.mjs), API restart during a stream (sse-restart.mjs), older app on a newer Flyway history (rollback.log, manual SQL), backup and restore into a throwaway Postgres and SeaweedFS (backup-restore.sh, verify-restore.py: the storage half isn't in `BackupRestoreTest`), xlsx bomb on the RPCs (mkbomb.py, bomb.mjs; TF-039's fix).
- **Evidence:** (session scratchpad `stage4/out/s4-resilience/`) the scripts above in OUT
- **Route:** fix now · B6 (API-level test gaps (scenarios, JUnit, engine tests))
- **Fix:** `3179d79` (browser: missed events replayed) and `179987f`: `NativeWorkerTest.jobsSurviveTheWorkerAndTheDatabaseGoingAway` (worker killed mid-parse, DB paused and connections dropped; ≤ 2 attempts; `BOQLET_NATIVE_RESILIENCE`, on in CI), `BackupRestoreTest` restores the object volume, CI job `rollback` starts the previous release on the migrated schema before deploy.
- **Retest:**

### TF-187 · S3 · gap · engine · fixed
- **Found by:** Stage 6 · B1 engine fix agent (TF-039 retest) · L · d5e0d8b
- **Spec:** BE-D13 ("Isolate parsing with CPU, memory, and time limits"); `security.md` "Input handling"
- **Steps:** with TF-039's guard, send three or four workbooks at once to `POST /codelists/read` that each expand to just under the 64 MB cap.
- **Expected:** the rpc engine stays within its memory (one bounded read at a time, or a bound on parallel reads).
- **Actual:** the rpc handler is a sync FastAPI route (thread pool); each read can take ~500 MB RSS (openpyxl ≈ 8x the shared-strings XML), so a few parallel reads can still exhaust the 1536 MiB engine. Not reproduced live (measured per read only).
- **Route:** fix now · B1 (follows TF-039)
- **Fix:** `f172e84`: the rpc engine reads at most two workbooks at once; a third waits up to 5 s, then `503` with Retry-After (API: `engine_unavailable`). Test in `engine/tests/test_xlsx_guard.py` (failed first: no bound).
- **Retest:**

### TF-188 · S4 · gap · tests · fixed
- **Found by:** Stage 6 · S1 push gate (clean clone, `browserSmokeAgainstJava`) · harness · 1be66cb
- **Spec:** test-plan §11.2 (the gate is trusted only if it is deterministic); `docs/testing/README.md` browser smoke
- **Steps:** run the browser smoke on a fresh `.next-java` (first run after `npm ci`).
- **Expected:** 13/13, every run.
- **Actual:** the first spec, `accounts.spec.ts:9` (F01-AC1 sign-up), failed once: `set-password` answered 204, then no `POST /auth/sign-in` was ever sent and `data-session` stayed empty for 20 s (the sign-in submit landed before the cold-compiled page hydrated). The rerun on the same commit, with the build cache warm, passed 13/13. Trace: session scratchpad `stage6/trace1/trace.zip`.
- **Route:** fix now · B6 (API-level test gaps)
- **Fix:** `a0a34b0`: `<html data-hydrated>` once React runs (`components/hydration.tsx`); the browser helpers wait for it (`hydrated(page)` in `signInWithForm`, `setPasswordWithForm`). The cold-start race also exposed TF-190.
- **Retest:**

### TF-189 · S3 · bug · java · fixed
- **Found by:** Stage 6 · B6 (TF-078's response validation in the suites) · harness · 9698476
- **Spec:** `openapi.yaml` `RunLine` (`quantity` required, `number | null`); `api-conventions.md` (responses match the contract)
- **Steps:** a run with a flagged line (quantity `null`); `GET /runs/{runId}/lines/by-key?key=…` for it (`sheet.test.ts` F06-AC2).
- **Expected:** `quantity: null` in the body, as `GET /runs/{id}/lines` sends it.
- **Actual:** the field is missing: `default-property-inclusion: non_null` drops it on the line-detail path. The suites list it as the known mismatch `getLine 200` (`tests/support/contract.ts`).
- **Route:** fix now · B2 (Java correctness)
- **Fix:** `8745980`: a Jackson mix-in keeps `LineDetail.quantity: null` (getLine, getPublicShareLine); the KNOWN_MISMATCHES entry removed.
- **Retest:**

### TF-190 · S2 · bug · app · verified
- **Found by:** Stage 6 · B2 app fix agent, from TF-188's trace · harness, L · 852393e
- **Spec:** `docs/architecture/security.md` (credentials only in POST bodies, never in URLs or logs); OWASP ASVS 2.x (no secrets in URLs)
- **Steps:** open `/sign-in` on a cold or slow page and press Sign in before React has hydrated (seen in the browser smoke right after set-password).
- **Expected:** nothing is sent until the form works, or a POST; never the password in a URL.
- **Actual:** the native form had no `method`, so the browser submitted it as `GET /sign-in?email=…&password=…`: the password landed in the URL, the browser history and any access log on the way (Traefik on P). Seen in the TF-188 trace (`stage6/trace1/trace.zip`).
- **Route:** fix now · B2 (found in Stage 6)
- **Fix:** `a0a34b0`: the form is `method="post"` and its submit is disabled until hydration (`useHydrated()`); `src/auth/adapters/native-form.test.tsx`. **Owner:** check whether P's access logs hold such URLs and purge them.
- **Retest:** P after `95a0e96` (deployed 2026-11-22 09:14 UTC, CI 45004989803): `/sign-in` serves `<form … method="post">`.

### TF-191 · S3 · bug · contract · fixed
- **Found by:** Stage 6 · B2 fix agent (identity/org slice) · harness · 9efea85
- **Spec:** `api-conventions.md` (PATCH changes only the fields sent); F15 (the org's default language)
- **Steps:** `PATCH /orgs/{id} {"settings":{"defaultLanguage":"sr"}}`, then `PATCH /orgs/{id} {"settings":{"defaultCurrency":"USD"}}`.
- **Expected:** `defaultLanguage` stays `"sr"`.
- **Actual:** it is `"en"` again: the generated `OrgSettings` has `defaultLanguage = "en"` (openapi `default: en`), so `Orgs.merge` writes `"en"` whenever settings are patched without it.
- **Route:** fix now · B2 (Java agent: drop `default: en` from `OrgSettings.defaultLanguage` in `openapi.yaml`, api:gen; a scenario)
- **Fix:** `8745980`: no generated default for `OrgSettings.defaultLanguage`. `orgs.test.ts` (failed first).
- **Retest:**
