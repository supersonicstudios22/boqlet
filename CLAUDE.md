# CLAUDE.md

The entry point for AI agents (and people) working on **boqlet**. The repository root is the product
root; every path in the docs is relative to it, and every command runs in it.

## What boqlet is

A web app that turns IFC building models into a **Bill of Quantities**, measured, coded and
traceable, for **the firm that produces the BoQ**: design and engineering firms first, QS and
cost-consultant firms on the same flows. A firm uploads its discipline models, chooses how to
measure, how to code and what its names mean (all three are data it owns, not code), answers the
questions the engine can't decide, edits and versions the BoQ, confirms it, exports it to Excel and
shares it by link. Every number shows its formula, its values and the elements behind it, and a
new model version takes minutes, not days.

```
getBoq(models, rules, classifications, dictionaries, decisions) -> BoqResult
```

**Released as v1.0.0 (2026-11-21)**, running as an invite-only pilot at booqlet.com: Next.js app
(`apps/app`), Java backend (`services/api`), Python engine as its worker (`engine/`).

## Before any work

1. **Read [docs/product/overview.md](docs/product/overview.md)**: the problem, the users, the
   outcomes (O1–O10), the principles and non-goals, what is built and what isn't. Check that your task
   serves those outcomes and keeps the principles; if it would break one, or a settled decision
   ([docs/decisions.md](docs/decisions.md)), stop and ask the owner.
2. Read [docs/development/workflow.md](docs/development/workflow.md): how to work, what to decide
   yourself and what to ask, and where to write things down after every task.
3. Read the docs for the area you touch (map below). For how things work, **the code wins**: if a
   doc disagrees with it, fix the doc.

## Docs map

| Need | Read |
|---|---|
| Index of every doc, and where old paths (`plan/…`, `docs/NN-…`) went | [docs/README.md](docs/README.md) |
| The product: overview, features F01–F20 with status, flows, screens, plans, roadmap, known limitations, open questions | [docs/product/](docs/product/overview.md) |
| The domain: BoQ and IFC primer, glossary, business rules (BR-xx), permissions, state machines, measurement standards, licensing | [docs/domain/](docs/domain/primer.md) |
| How it is built: components, stack, flows; engine, rule language, worker, backend, database, API, frontend, security, NFRs | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Run it locally, commands, environment variables, design guidelines, contract changes | [docs/development/](docs/development/local-setup.md) |
| Testing: layers, how to run each against the real backend, CI, coverage by outcome; the test campaign | [docs/testing/README.md](docs/testing/README.md) |
| Operate the pilot: hosting, deploys, sign-in enrollment, backups | [docs/operations/](docs/operations/pilot.md) |
| Every decision (P01–P53, D01–D71, BE-D…) | [docs/decisions.md](docs/decisions.md) |
| What was done | [docs/changelog.md](docs/changelog.md) |
| History: the build plan, build log, mock API, proof of concept, original conversation | [docs/archive/](docs/archive/README.md) |

## Key commands

```bash
npm install                              # workspaces + engine/.venv (Python 3.10–3.13)
npm run local:demo                       # backend + app on :3000 + a demo account; prints the email and password to sign in with
npm run dev:app                          # backend in Docker (Java, engine, PostgreSQL, SeaweedFS, MailHog) + app on http://localhost:3000
npm run local:user -- you@example.com    # one-hour sign-up link for an account (local:admin -- <email> makes a platform admin)
npm run local:check                      # end to end on the local stack: sign-up, upload, parse, BoQ run
npm run test                             # typecheck, lint, app unit tests, engine tests (incl. the Duplex acceptance test)
mvn -f services/api/pom.xml verify       # Java tests; with BOQLET_NATIVE_* also the shared suites and browser smoke (docs/testing)
npm run codegen                          # after editing packages/types/src
npm run api:gen                          # after editing packages/api/openapi.yaml
npm run boq -- model.ifc --out boq.xlsx  # the engine from the command line, no backend
```

All commands: [docs/development/commands.md](docs/development/commands.md). Environment variables:
[docs/development/environment.md](docs/development/environment.md).

## Rules of the road

1. **Types first.** Change a shape in `packages/types/src`, run `npm run codegen`, then update the
   engine and the UI. `test_result_matches_the_typescript_contract` fails if the engine drifts.
   **Contract first** for HTTP: `packages/api/openapi.yaml`, then `npm run api:gen`, Java and the app
   in one commit ([contract changes](docs/development/contract-changes.md)).
2. **No measuring logic in rules, no rule logic in measuring.** `measure.py` decides which number
   to trust per element; `rules.py` only selects, combines and labels ([engine](docs/architecture/engine.md)).
3. **Rules are data.** New behaviour for a standard is a new slot, quantity kind or expression
   function in the type, not a special case in Python keyed on a preset id.
4. **Only the engine computes; formulas are evaluated in one place**, the engine's safe evaluator
   (`expr.py`). Never `eval`. No second evaluator in the browser or Java; preview through the engine.
5. **Nothing is silently dropped.** An element no rule measures becomes an `unmatched` question;
   a missing value becomes a flagged line or a question; every decision is logged.
6. **Classification never changes a number.** If a change to a code list moves a quantity, it is a bug.
7. **Keep the Duplex acceptance test green.** If a number changes on purpose, update `HAND_BOQ`
   in `engine/tests/test_duplex.py` and say why in the commit.
8. **No licensed standard content in the repo.** No DIN, VOB, CSI (MasterFormat, OmniClass,
   UniFormat) text, tables or code lists, and never feed such documents to AI tools to extract
   rules. Presets here are illustrative placeholders ([sourcing](docs/domain/sourcing-and-licensing.md)).
9. **Question ids are deterministic** (built from content). No random ids; stored decisions depend
   on them matching across runs and model versions.
10. **International product.** Do not bias defaults, language or examples to one country. No
    literal UI strings: everything goes through `apps/app/messages` (the lint rule enforces it).
11. **The core never depends on the pricing module** (P36, [modules](docs/architecture/modules.md)).

## Working rules

- **Work on `main`; every green push deploys to booqlet.com** (the only environment, which counts as
  development, P51). Never push red. CI: [docs/testing/README.md](docs/testing/README.md#ci).
- After every task: a row in [docs/changelog.md](docs/changelog.md); update
  [docs/product/known-limitations.md](docs/product/known-limitations.md) and the feature's status
  block when a limitation or gap changes; record decisions in [docs/decisions.md](docs/decisions.md).
- Each topic lives in one doc; link to it instead of repeating it.
- The app has its own agent note from Next.js: [apps/app/AGENTS.md](apps/app/AGENTS.md) (read the
  bundled Next.js docs before writing Next.js code).
