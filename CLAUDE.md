# CLAUDE.md

Guidance for AI agents (and people) working on boqlet. The repository root is the product root:
every path below and in `plan/` is relative to it, and every command runs in it. Read this first,
then `docs/README.md` (the engine) and `plan/README.md` (the product being built).

## What this is

A tool that turns IFC building models into a Bill of Quantities (BoQ). The measuring rules,
the classification (codes and grouping) and the naming dictionary are **data the user
chooses**, not code. Every number in the output can be traced to a formula, the parameter
values used and the elements that contributed.

```
getBoq(models, rules, classifications, dictionaries, decisions) -> BoqResult
```

The product is the monorepo specified in `plan/`: a Next.js app, a **Java** backend (owns users,
projects, storage, jobs) and the Python engine as its worker. The mock API that stood in for Java
while it was built was removed (P53); locally the real backend runs in Docker (`docs/20`).
Anything that decides something belongs in the engine as plain functions over the contract types
(see `docs/03-architecture.md`, code boundaries); the backend stores, permits and schedules. The
proof of concept it grew from (a React dev UI and a local engine API) was removed in FE-046; it
stays reachable as the git tag `poc-final`.

## Run it

```bash
npm install                              # also creates engine/.venv (Python 3.10-3.13)
npm run dev:app                          # backend in Docker (Java, engine, PostgreSQL, storage, mail) + app on http://localhost:3000
npm run local:user -- you@example.com    # sign-up link for a first account
```

| Command | What it does |
|---|---|
| `npm run dev:app` | The product in development: `local:up`, then the app (`apps/app`, Next.js, http://localhost:3000; `/api/v1` proxied to the Java API on 8080). Native sign-in; accounts from `local:user`. |
| `npm run local:up` / `local:down` / `local:reset` | The local backend (`ops/local/compose.yaml`, `docs/20-local-backend.md`): build and start Java, the engine worker, PostgreSQL, SeaweedFS and MailHog (http://localhost:8025) in Docker / stop / stop and delete the data. Run `local:up` again after changing `services/api` or `engine`. |
| `npm run local:user -- <email>` / `local:admin -- <email>` | A one-hour sign-up (or password reset) link / make an account a platform admin. |
| `npm run local:check` / `local:status` / `local:logs -- [service]` | End-to-end check of the local backend (sign-up, upload, parse, BoQ run) / readiness / logs. |
| `npm run dev:engine-worker` | A standalone engine worker on port 8788, files in `engine/.cache/blobs` (the local backend runs its own in Docker). `ENGINE_WORKER_PORT`, `ENGINE_STORAGE`, `ENGINE_HTTP_CONCURRENCY`, and `ENGINE_MAX_MODEL_MB` configure it. |
| `npm run test` | Typecheck all workspaces, lint the app, the app's unit tests, then the engine tests (pytest). |
| `mvn -f services/api/pom.xml verify` | The Java build and its tests (Docker needed). With `BOQLET_NATIVE_WORKER_PYTHON`, `BOQLET_NATIVE_NODE`, `BOQLET_NATIVE_SCENARIOS=1` and `BOQLET_BROWSER_SMOKE=1` it also runs the shared contract and scenario suites (`tests/`) and the browser smoke (`apps/app/e2e-java`) against Java, as CI does (`services/api/README.md`). |
| `npm run lint` / `npm run test:app` | The app's ESLint (no literal UI strings, F15) / Vitest unit tests. |
| `npm run test:engine` | Engine tests only. Includes the Duplex acceptance test. |
| `npm run typecheck` | Typecheck all workspaces. |
| `npm run api:lint` | Lint both HTTP contracts (`packages/api/openapi.yaml`, `packages/pricing-api/openapi-pricing.yaml`). |
| `npm run api:gen` / `npm run api:check` | Regenerate the clients' types from the contracts / fail if they are out of date (CI). Run `api:gen` after editing a contract. |
| `npm run build:app` | Production build of the product app (`apps/app`, Next.js). |
| `npm run ui:add -w @ifc-boq/app -- <name>` | Add a shadcn/ui component (style base-mira); never `npx shadcn add` (`plan/06-frontend/architecture.md`). |
| `npm run boq -- <file.ifc> --out boq.xlsx` | Command-line run, no UI. `--help` for options. |
| `npm run corpus -- <folder>` | Run every IFC in a folder; one summary row per file, schema-validated. Use before adding fixtures. |
| `npm run catalogue` | Regenerate `docs/12-ifc-corpus-catalogue.md` from `fixtures/corpus/catalogue.json` (every IFC looked at, tagged). |
| `npm run codegen` | Regenerate JSON Schemas from the TypeScript types. Run after editing `packages/types/src`. |
| `npm run setup:engine` | Recreate the Python venv (after editing `engine/requirements.txt`). |
| `npm run import:uniclass` | Download Uniclass 2015 EF into `presets/classifications/uniclass2015-ef/codelist.json`. |

Environment: `IFC_BOQ_PYTHON` (python to use), `IFC_BOQ_SKIP_ENGINE_SETUP=1`,
`IFC_BOQ_USER_PRESETS` (the engine's user preset folder, default `presets/user`).

## Repo map

| Path | What lives there |
|---|---|
| `apps/app` | The product frontend, Next.js. |
| `packages/api` | `openapi.yaml` (the core HTTP contract) and its generated client (`@ifc-boq/api`). |
| `packages/pricing-api`, `packages/pricing-ui` | The optional, removable pricing module's contract, client and frontend (P36). |
| `packages/types/src` | **The engine contract.** Every shape as TypeScript: rules, parsed model, measured element, dictionary, classification, BoQ result, HTTP API. Source of truth. |
| `packages/types/schema` | JSON Schemas generated from the types (`npm run codegen`). The Python engine validates presets and its own output against them. Do not edit by hand. |
| `services/api` | The Java backend. |
| `engine/ifc_boq` | The Python engine: parse, names, measure, rules, classify, pipeline, export, worker (HTTP and Postgres queue), CLI. |
| `engine/tests` | pytest. `test_duplex.py` is the acceptance test against the hand-made BoQ. |
| `presets/` | Rule sets, dictionaries, classifications, resolution settings, as JSON. Loaded from disk on every run, so edits apply without restarting. `presets/user/` (git-ignored) holds what the Library saves; shipped presets are never written. |
| `fixtures/` | The NIBS Duplex IFC and the hand-made reference BoQ; buildingSMART certification samples (CC BY 4.0) in `ifc/buildingsmart/`. |
| `scripts/` | Node helpers that set up and run the Python engine from npm. |
| `tests/contract`, `tests/scenarios`, `tests/perf` | Shared contract and behaviour suites and the performance suite, run against Java by `NativeWorkerTest`. |
| `plan/` | The product specification, with `10-build-log.md` (where the build stands). |
| `ops/pilot` | The deployed environment on Contabo: Compose, Dockerfiles, deploy receiver, checks, backups (`docs/18`, `docs/19`). |
| `ops/local` | The backend on one machine for development, in Docker Compose (`docs/20`). |
| `docs/` | The engine and everything decided so far, written for the next developer or agent. |
| `.github/workflows/` | CI and the automatic rollout (`docs/19`). |

## Rules of the road

1. **Types first.** Change a shape in `packages/types/src`, run `npm run codegen`, then update the
   engine and the UI. `test_result_matches_the_typescript_contract` fails if the engine drifts.
2. **No measuring logic in rules, no rule logic in measuring.** `measure.py` decides which number
   to trust per element; `rules.py` only selects, combines and labels. See `docs/05-engine.md`.
3. **Rules are data.** New behaviour for a standard is a new slot, quantity kind or expression
   function in the type, not a special case in Python keyed on a preset id.
4. **Formulas are evaluated in one place**, the engine's safe evaluator (`expr.py`). Never `eval`.
   Never add a second evaluator in the browser; preview through the engine.
5. **Nothing is silently dropped.** An element no rule measures becomes an `unmatched` question;
   a missing value becomes a flagged line or a question; every decision is logged.
6. **Classification never changes a number.** If a change to a code list moves a quantity, it is a bug.
7. **Keep the Duplex acceptance test green.** If a number changes on purpose, update `HAND_BOQ`
   in `engine/tests/test_duplex.py` and say why in the commit.
8. **No licensed standard content in the repo.** No DIN, VOB, CSI (MasterFormat, OmniClass,
   UniFormat) text, tables or code lists, and never feed such documents to AI tools to extract
   rules. Presets here are illustrative placeholders. See `docs/08-knowledge-gaps-and-sourcing.md`.
9. **Question ids are deterministic** (built from content). Do not add random ids; stored
   decisions depend on them matching across runs and model versions.
10. **International product.** Do not bias defaults, language or examples to one country.

## Where to look

| Task | Read |
|---|---|
| Understand the domain (BoQ, IFC, measurement, classification) | `docs/01-domain-primer.md` |
| Which IFC files exist and which were tested | `docs/12-ifc-corpus-catalogue.md` |
| Which measurement standards exist and what each covers | `docs/13-measurement-standards.md` |
| Why something is the way it is | `docs/02-decisions.md` |
| Add or change an engine stage | `docs/05-engine.md` |
| Write or change a rule set | `docs/06-rules-authoring.md` |
| Use the Library to manage rule sets (user guide) | `docs/14-rules-guide.md` |
| Use the Library to manage classifications (user guide) | `docs/15-classifications-guide.md` |
| Use the Library to manage dictionaries (user guide) | `docs/16-dictionaries-guide.md` |
| Operate the deployed environment | `docs/18-contabo-pilot.md`, `docs/19-native-auth-and-cd.md` |
| Run the backend locally | `docs/20-local-backend.md` |
| Dictionaries and code lists | `docs/07-dictionaries-and-classification.md` |
| What is not built yet, open questions | `docs/11-roadmap-and-open-questions.md` |
| Build the product (Next.js frontend, Java backend, engine worker): specs, API contract, phases, tasks | `plan/README.md` "Start here", then `plan/08-delivery/sessions.md` and `plan/10-build-log.md` |
| Everything from the original conversation, verbatim | `docs/reference/` |

## Status in one paragraph

Working end to end on the NIBS Duplex (Revit 2011, IFC2x3): parse, verify,
dictionary resolution, measuring, federation of several models into one BoQ, rule execution
(items, derived, manual), classification
into any number of code lists, questions and answers, calculation log, Excel export, and a dev
UI, plus real wall faces with the rooms on them and room-by-room finishes. The engine reproduces the
hand-made Duplex BoQ exactly. Across federated models the engine links doors to openings, rooms to walls
and columns through slabs (with the `meshes.npz` sidecar), and it asks about contradictions and double claims.
Since phase 2 the engine also runs as a worker for the Java backend (users, orgs, projects, model
revisions and their change reports, background jobs, Library, exports, sharing). Not yet built:
coordinate alignment between models, AI name suggestions. Also run on 309 public IFC files from 30 authoring tools (buildingSMART samples,
DURAARK, the Auckland OpenIFC repository, Schependomlaan): no engine errors, output valid
against the contract; quantities checked only for the Duplex and the buildingSMART samples.
What was run and what is still uncovered: `docs/12-ifc-corpus-catalogue.md`.

The product built on top of this is specified in `plan/` (decisions P01–P53, phases,
milestones, tasks). **Released as v1.0.0 (2026-11-21)**: phases 1–3 are done. The invite-only
pilot runs on one deployed environment (P51), deployed from `main` by GitHub Actions (`docs/18`,
`docs/19`); a separate staging environment is a future todo. Work on `main`; every green push deploys. Every build session starts with the prompt in `plan/08-delivery/sessions.md` and
works by that file. **Where the build stands** (phase, role, next task, what agents decided along
the way) is in `plan/10-build-log.md`.
