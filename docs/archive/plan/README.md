# plan/ — specification of the deployment-ready product

> **Archived (history, not current).** The README of the build plan (`plan/`, phases 1–3, P38). Its decisions table moved to [../../decisions.md](../../decisions.md) and its v1 acceptance results to [../../product/scope-and-acceptance.md](../../product/scope-and-acceptance.md); the rest ("Start here", phases, branch `v_1`, status) is the history of the build.


This folder specifies **boqlet**, the product built on top of the proof of concept in this repository.
It is written for **coding agents** (and the people steering them) who build the frontend
(Next.js/React) and then the backend (Java), with the existing Python engine as the
computation worker.

`docs/` describes the engine and the proof of concept as they are. `plan/` describes the
product to build. When they disagree about the *product*, `plan/` wins. When they disagree about
*how the engine measures*, `docs/` and the code win.

## Start here (a new session)

**Build status.** **Released as v1.0.0 on 2026-11-21**: phases 1–3 are done. The Java API, the
Python workers and the Next.js app run as an invite-only pilot on one deployed environment (P51),
deployed from `main` by GitHub Actions. Nothing is scheduled; the owner sets what comes next. Every session
starts with the prompt in `docs/archive/plan/sessions.md` and works by that file: it says how to
start, what to decide yourself and what to ask, when to stop and how to hand over.

1. Read this README (decisions P01–P53 are settled; don't reopen them),
   `docs/archive/plan/sessions.md`, and `docs/archive/build-log.md` "Current position" (where the build
   stands, the next task, and your role).
2. `docs/archive/plan/milestones.md`: phases, milestones, exit criteria.
   - **Phase 1**, frontend role, started with **FE-000** (P44: the product built beside the
     proof of concept, until FE-046 made it the repository root).
   - **Phase 2**, backend role, starts with **BE-000** (P47): the agent analyses the backend
     plan and puts every backend decision, open or already made, to the backend owner (whoever
     runs the session). No backend code before it.
   - **Phase 3**, frontend role, ends with **FE-046** (the product root becomes the repository
     root, the proof of concept is removed) and **FE-047** (production release).
3. Take the next task of your phase in order from `docs/archive/plan/tasks-frontend.md`,
   `tasks-backend.md` or `tasks-engine.md`. Read the specs the task names, build only that, and
   meet its acceptance criteria and the definition of done in `docs/testing/README.md`.
4. Commit straight to the build branch **`v_1`** (P40, P46). After every task, record it in
   `docs/product/known-limitations.md` ("Done") and in the build log's Current position. At
   the end of a milestone, write its build-log entry and update the status table here.
5. If a spec is silent or contradictory, or a decision is the owner's, add it to
   `docs/product/open-questions.md` and ask; never guess product behaviour. Meanwhile go on with tasks
   that don't depend on it.

Rules that catch people out:
- **Paths in `plan/` are relative to the repository root** (the product root since FE-046; P44).
- The core never depends on the pricing module (P36, `docs/architecture/modules.md`).
- Only the engine computes quantities (BR-01).
- There is one backend, Java (P53). The mock API of phases 1–3 was removed; where the plan
  describes it (phase history, task specs, milestones), read it as history. Locally the
  backend runs in Docker (`docs/development/local-setup.md`).
- The look follows `docs/development/design-guidelines.md` (P43).

## How to use this folder

1. Read `docs/product/` (what and for whom), then `docs/domain/` (the nouns, states and rules),
   then the feature specs you are working on in `docs/product/features/`.
2. Take a task from `docs/testing/` (`tasks-frontend.md`, `tasks-backend.md`, `tasks-engine.md`).
   Every task names the spec sections it implements and its acceptance criteria.
3. The HTTP contract is `packages/api/openapi.yaml` (core) plus `packages/pricing-api/openapi-pricing.yaml` (the optional pricing module; both moved from `05-api/` in FE-001). The app, the shared suites and the Java backend all
   implement or consume exactly these files. Change the contract first, then the code.
4. If a spec is silent or contradictory, do not guess on product behaviour: add the question to
   `docs/product/open-questions.md` and ask the owner. Implementation details inside a module are yours.
5. `docs/archive/plan/backend-decisions-to-make.md` lists decisions the **backend agent must stop and ask the
   owner about before writing backend code** (auth provider first).

## Reading order

| # | Path | What it gives you |
|---|---|---|
| 1 | [docs/product/overview.md](../../product/overview.md) | The problem, the product, why it wins |
| 2 | [docs/product/personas.md](../../product/personas.md) | Who uses it and how they work |
| 3 | [docs/product/scope-and-acceptance.md](../../product/scope-and-acceptance.md) | What v1 contains, v1 acceptance criteria |
| 4 | [docs/domain/glossary.md](../../domain/glossary.md) | Every term used in these specs |
| 5 | [docs/product/plans-and-limits.md](../../product/plans-and-limits.md) | Free plan, paid plans, entitlements |
| 6 | [docs/architecture/data-model.md](../../architecture/data-model.md) | Entities, fields, relations |
| 7 | [docs/domain/state-machines.md](../../domain/state-machines.md) | Lifecycles of model versions, jobs, runs, BoQ versions, sessions, share links; the pricing module's own |
| 8 | [docs/domain/permissions.md](../../domain/permissions.md) | Who may do what |
| 9 | [docs/domain/business-rules.md](../../domain/business-rules.md) | Invariants every component must keep |
| 10 | [docs/product/features/](../../product/features/) | One spec per feature (F01–F20; F11, F17, F20 form the removable pricing module) |
| 11 | [docs/product/flows.md](../../product/flows.md), [docs/product/screens.md](../../product/screens.md) | End-to-end flows, screen inventory, wireframes |
| 12 | [docs/architecture/](../../architecture/) (start with `modules.md` for the core/module boundary) | System, engine worker contract, storage/jobs/realtime, security, deployment, NFRs |
| 13 | 05-api/ (now `docs/architecture/api-conventions.md`, `docs/development/contract-changes.md`) | `openapi.yaml` (core), `openapi-pricing.yaml` (pricing module), API conventions |
| 14 | [docs/architecture/frontend.md](../../architecture/frontend.md) | Next.js architecture, what to reuse from the PoC, the removed mock API (history, P53), design system, the owner's design guidelines (when supplied) |
| 15 | [docs/architecture/backend.md](../../architecture/backend.md) | Java architecture, DB schema, decisions to make |
| 16 | [docs/testing/](../../testing/) | Milestones, task lists, testing, how sessions run (`sessions.md`) |
| 17 | [docs/product/open-questions.md](../../product/open-questions.md) | What is still open, who decides, and by when |
| 18 | [docs/archive/build-log.md](../build-log.md) | Where the build stands, and what the agents decided along the way |

## Decisions taken (Nov 2026, product owner)

Moved to [../../decisions.md](../../decisions.md#product-decisions-p01p53) (P01–P53).

## Where the code lives (P44)

The repository root is the product root, and every path in `plan/` is relative to it. (From FE-000
to FE-046 the product was built in a folder `boqlet_v1/` beside the proof of concept; FE-046 removed
the proof of concept and moved that folder to the root.)

```text
./                             one npm workspace (apps/*, packages/*), name "boqlet"
  apps/app                     Next.js product frontend
  packages/api                 openapi.yaml + generated client (@ifc-boq/api)
  packages/pricing-api         openapi-pricing.yaml + its generated client (pricing module only)
  packages/types               Engine contract (TS -> JSON Schema)
  services/api                 Java backend
  engine/                      Python engine and its workers (worker.py, worker_http.py, worker_queue.py)
  presets/  fixtures/          presets and test models
  scripts/                     Node helpers that set up and run the engine
  tests/contract  tests/scenarios
                               shared suites: run against Java (NativeWorkerTest)
  tests/perf                   performance suite (TS-002)
  ops/pilot                    the deployed environment (docs/operations/pilot.md, docs/operations/auth-and-deploys.md)
  ops/local                    the backend on one machine for development (docs/development/local-setup.md)
  plan/                        this specification, with docs/archive/build-log.md
  docs/                        engine documentation and operations
  .github/workflows/           CI and the rollout
  CLAUDE.md  docs/decisions.md  notes.md  .gitignore  package.json  package-lock.json
```

The proof of concept (its dev UI `apps/web`, the dev API `engine/ifc_boq/api.py` and `store.py`,
and its Vercel demo) is the git tag `poc-final` (FE-047).

## Status

| Part | State |
|---|---|
| Product definition (00) | Written; personas and scope to be validated with users (09) |
| Domain, features, flows (01–03) | Written |
| Architecture, API (04–05) | Written; `openapi.yaml` (core) and `openapi-pricing.yaml` (pricing module) cover every endpoint; the core never references the module (`docs/architecture/modules.md`) |
| Frontend, backend specs (06–07) | Written; backend decisions open on purpose |
| Delivery (08) | Phases, milestones, task lists, session rules and build log written (P37–P40, P44, P45); the pricing module (MP1, MP2) is for a later phase (P48) |
| Design (06) | Design guidelines decided (P43); wordmark SVG still to come from the owner |
| **Build** | **Released: v1.0.0, 2026-11-21** (tag `v1.0.0` on `main`; the proof of concept is the tag `poc-final`). Phase 1 completed 2026-11-14, phase 2 2026-11-20, phase 3 (M8a, M8) 2026-11-21. Open items: `docs/product/known-limitations.md` "Known limitations … phase 3" and "v1 acceptance" below. Live position: `docs/archive/build-log.md` |

## v1 acceptance (TS-004, BE-026), 2026-11-21

Moved to [../../product/scope-and-acceptance.md](../../product/scope-and-acceptance.md#v1-acceptance-results-2026-11-21).
