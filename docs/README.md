# Documentation

The source of truth for what boqlet is, how it is built, how to run it and how to test it, written
for the next agent or developer. **Start with [product/overview.md](product/overview.md).** Agents:
[CLAUDE.md](../CLAUDE.md) first.

Conventions: one topic lives in one doc, and others link to it. Paths in backticks are relative to the
repository root. For how things work, the code wins over any doc; for what the product should be,
the product docs say it, and each feature spec's status block says what is actually built. Values in
presets and examples are illustrative, never taken from a licensed standard. Stable ids (P-, D-,
BE-, F-, BR-, FL-, S-, Q-, TF-) never change when docs move.

```text
CLAUDE.md                      agent entry point: product summary, docs map, key commands, rules of the road
AGENTS.md                      pointer to CLAUDE.md for other agents
README.md                      for people: what it is, requirements, start
docs/
  README.md                    this index
  decisions.md                 every decision: P01–P53 (product), D01–D91 (engine, early platform), BE-D/BE-B (backend)
  changelog.md                 what was done, newest first (a row after every task)
  product/
    overview.md                the north star: problem, users, outcomes O1–O10, journeys, value, principles, non-goals, current state, intent vs built, success criteria
    personas.md                markets, personas, how a project runs, jobs to be done
    scope-and-acceptance.md    v1 scope, out of v1, the 17 v1 acceptance criteria and their results
    plans-and-limits.md        plans, entitlements, limits, usage events (and what is built)
    features/README.md         index of the feature specs F01–F20 with their status
    features/F01…F20           one spec per feature: intent, acceptance criteria, status block with gaps
    flows.md                   end-to-end flows FL-1…FL-12
    screens.md                 screen inventory S01–S44 and wireframes
    roadmap.md                 what could come next, in order of value; what is out by decision
    known-limitations.md       what isn't built or is approximate: engine, product, tests (kept current)
    open-questions.md          assumptions to validate and questions for the owner (Q-ids)
    guides/rules.md            user guide: rule sets in the Library
    guides/classifications.md  user guide: classifications in the Library
    guides/dictionaries.md     user guide: dictionaries in the Library
  domain/
    primer.md                  BoQ, IFC, measurement and classification for newcomers; the six knobs
    glossary.md                platform terms and their code names
    business-rules.md          invariants BR-01…BR-62 every component keeps
    permissions.md             org and project roles, who may do what
    state-machines.md          lifecycles: model versions, jobs, runs, BoQ revisions, sessions, share links
    measurement-standards.md   the world's measurement standards and how much of the rule template each covers
    sourcing-and-licensing.md  where rules and code lists come from, licences, knowledge gaps
  architecture/
    overview.md                components, stack, repository layout, request types, key flows, design choices
    engine.md                  the Python engine: modules, stages, adoption policy, federation, questions, log, Excel, CLI, tests
    rules-language.md          the rule type: slots, master template, items, derived, manual, patches
    dictionaries-and-classification.md  dictionaries, name resolution, code lists, maps, item texts
    contracts.md               packages/types and its JSON Schemas; the HTTP contract files
    engine-worker.md           job envelopes and job types, HTTP and Postgres-queue transports, rpc
    backend.md                 the Java service: packages, conventions, tests
    database.md                tables by Flyway migration
    data-model.md              the logical entities and fields
    api-conventions.md         HTTP conventions: auth, errors, pagination, idempotency, SSE
    frontend.md                the Next.js app: structure, libraries, conventions
    storage-jobs-realtime.md   object storage layout, jobs and retries, SSE, scheduled work
    security.md                authentication, authorisation, input handling, headers, secrets
    nfr.md                     performance, availability and accessibility targets, with measurements
    modules.md                 core vs the removable pricing module; extension points
    deployment.md              the deployment shape (containers, services, configuration)
  development/
    local-setup.md             run everything on one machine (Docker backend + app)
    commands.md                every npm script and the Maven build
    environment.md             every environment variable, by component
    workflow.md                how to work: before a task, while working, what to ask, what to record
    contract-changes.md        how to change the HTTP contract; C01–C07
    design-guidelines.md       the owner's visual direction (P43): tokens, type, colour meanings
    design-system.md           components and patterns (the guidelines win where they differ)
  brand/                       the owner's logo: boqlet.svg, and the animation (boqlet.mp4, boqlet.gif) the sign-in splash follows
  testing/
    README.md                  test strategy: layers, how to run each against the real backend, CI, definition of done, coverage by outcome
    test-plan.md               the full test campaign (stages 0–7, journeys, personas)
    test-findings.md           the campaign's log: run log, coverage matrix, findings TF-xxx
    engine-validation.md       how the engine's numbers are proven: the Duplex, acceptance numbers, the corpus
    ifc-corpus-catalogue.md    every public IFC file looked at and run, tagged (generated by `npm run catalogue` from `fixtures/corpus/catalogue.json`)
  operations/
    pilot.md                   the deployed pilot on Contabo: topology, worker capacity, observability, backups
    auth-and-deploys.md        native sign-in enrollment, setup links, the automatic rollout from main
  archive/                     history, not current: see archive/README.md
```

## Old paths

Code comments and older docs still use the paths from before the 2026-11-21 reorganisation. Where
they went:

| Old path | Now |
|---|---|
| `docs/00-overview.md` | [product/overview.md](product/overview.md) (old text: [archive/overview-2026-10.md](archive/overview-2026-10.md)) |
| `docs/01-domain-primer.md` | [domain/primer.md](domain/primer.md) |
| `docs/02-decisions.md` | [decisions.md](decisions.md) |
| `docs/03-architecture.md` | [architecture/overview.md](architecture/overview.md) (old text: [archive/architecture-2026-10.md](archive/architecture-2026-10.md)) |
| `docs/04-types-and-contracts.md` | [architecture/contracts.md](architecture/contracts.md) |
| `docs/05-engine.md` | [architecture/engine.md](architecture/engine.md) |
| `docs/06-rules-authoring.md` | [architecture/rules-language.md](architecture/rules-language.md) |
| `docs/07-dictionaries-and-classification.md` | [architecture/dictionaries-and-classification.md](architecture/dictionaries-and-classification.md) |
| `docs/08-knowledge-gaps-and-sourcing.md` | [domain/sourcing-and-licensing.md](domain/sourcing-and-licensing.md) |
| `docs/09-validation-and-test-corpus.md` | [testing/engine-validation.md](testing/engine-validation.md) |
| `docs/10-platform.md` | [archive/platform-design-2026-10.md](archive/platform-design-2026-10.md) (the pre-build platform design) |
| `docs/11-roadmap-and-open-questions.md` | [product/known-limitations.md](product/known-limitations.md), [product/roadmap.md](product/roadmap.md), [changelog.md](changelog.md) ("Done"), [product/open-questions.md](product/open-questions.md); dev-build and phase-1 sections: [archive/limitations-history.md](archive/limitations-history.md) |
| `docs/12-ifc-corpus-catalogue.md` | [testing/ifc-corpus-catalogue.md](testing/ifc-corpus-catalogue.md) |
| `docs/13-measurement-standards.md` | [domain/measurement-standards.md](domain/measurement-standards.md) |
| `docs/14-rules-guide.md`, `15-classifications-guide.md`, `16-dictionaries-guide.md` | [product/guides/](product/guides/rules.md) |
| `docs/17-deploying-a-demo.md` | removed earlier with the proof of concept (FE-046) |
| `docs/18-contabo-pilot.md` | [operations/pilot.md](operations/pilot.md) |
| `docs/19-native-auth-and-cd.md` | [operations/auth-and-deploys.md](operations/auth-and-deploys.md) |
| `docs/20-local-backend.md` | [development/local-setup.md](development/local-setup.md) |
| `docs/reference/` | [archive/reference/](archive/reference/) |
| `plan/README.md` | decisions table → [decisions.md](decisions.md); v1 acceptance → [product/scope-and-acceptance.md](product/scope-and-acceptance.md); the rest → [archive/plan/README.md](archive/plan/README.md) |
| `plan/00-product/01-problem-and-vision.md` | [product/overview.md](product/overview.md) |
| `plan/00-product/02-personas-and-markets.md`, `03-v1-scope.md`, `05-plans-and-limits.md` | [product/personas.md](product/personas.md), [product/scope-and-acceptance.md](product/scope-and-acceptance.md), [product/plans-and-limits.md](product/plans-and-limits.md) |
| `plan/00-product/04-glossary.md` | [domain/glossary.md](domain/glossary.md) |
| `plan/01-features/Fnn-….md` | [product/features/](product/features/README.md) (same file names) |
| `plan/02-flows/flows.md`, `screens.md` | [product/flows.md](product/flows.md), [product/screens.md](product/screens.md) |
| `plan/03-domain/business-rules.md`, `permissions.md`, `state-machines.md` | [domain/](domain/business-rules.md) (same names) |
| `plan/03-domain/data-model.md` | [architecture/data-model.md](architecture/data-model.md) |
| `plan/04-architecture/system.md` | [architecture/overview.md](architecture/overview.md) (old text: [archive/plan/system-phases.md](archive/plan/system-phases.md)) |
| `plan/04-architecture/*.md` (engine-worker, storage-jobs-realtime, security, nfr, modules, deployment) | [architecture/](architecture/overview.md) (same names) |
| `plan/05-api/conventions.md` | [architecture/api-conventions.md](architecture/api-conventions.md) |
| `plan/05-api/contract-changes.md` | [development/contract-changes.md](development/contract-changes.md) |
| `plan/05-api/openapi.yaml`, `openapi-pricing.yaml` | `packages/api/openapi.yaml`, `packages/pricing-api/openapi-pricing.yaml` (since FE-001) |
| `plan/06-frontend/architecture.md` | [architecture/frontend.md](architecture/frontend.md) |
| `plan/06-frontend/design-guidelines.md`, `design-system.md` | [development/](development/design-guidelines.md) (same names) |
| `plan/06-frontend/mock-api.md`, `reuse-from-poc.md` | [archive/plan/](archive/plan/README.md) |
| `plan/07-backend/architecture.md` | [architecture/backend.md](architecture/backend.md) |
| `plan/07-backend/db-schema.md` | [architecture/database.md](architecture/database.md) |
| `plan/07-backend/decisions.md` | [decisions.md](decisions.md#backend-decisions-be-000) (ids D1–D18 / B1–B20 are now BE-D1… / BE-B1…) |
| `plan/07-backend/decisions-to-make.md`, `review.md` | [archive/plan/](archive/plan/README.md) |
| `plan/08-delivery/testing.md` | [testing/README.md](testing/README.md) |
| `plan/08-delivery/test-plan.md`, `test-findings.md` | [testing/](testing/test-plan.md) (same names) |
| `plan/08-delivery/milestones.md`, `sessions.md`, `tasks-*.md` | [archive/plan/](archive/plan/README.md); how to work now: [development/workflow.md](development/workflow.md) |
| `plan/09-open-questions.md` | [product/open-questions.md](product/open-questions.md) |
| `plan/10-build-log.md` | [archive/build-log.md](archive/build-log.md) |
