# plan/ — specification of the deployment-ready product

This folder specifies **boqlet**, the product built on top of the proof of concept in this repository.
It is written for **coding agents** (and the people steering them) who build the frontend
(Next.js/React) and then the backend (Java), with the existing Python engine as the
computation worker.

`docs/` describes the engine and the proof of concept as they are. `plan/` describes the
product to build. When they disagree about the *product*, `plan/` wins. When they disagree about
*how the engine measures*, `docs/` and the code win.

## Start here (a new session)

**Build status.** Phases 1 and 2 are done. The Java API, the Python workers and the Next.js
app run as an invite-only pilot on one deployed environment (P51), deployed from `v_1` by
GitHub Actions. **Phase 3 (frontend role) is under way: M8a is done, M8 (starting with FE-044) waits for the owner's approval.** Every session
starts with the prompt in `08-delivery/sessions.md` and works by that file: it says how to
start, what to decide yourself and what to ask, when to stop and how to hand over.

1. Read this README (decisions P01–P52 are settled; don't reopen them),
   `08-delivery/sessions.md`, and `10-build-log.md` "Current position" (where the build
   stands, the next task, and your role).
2. `08-delivery/milestones.md`: phases, milestones, exit criteria.
   - **Phase 1**, frontend role, started with **FE-000** (P44: the product built beside the
     proof of concept, until FE-046 made it the repository root).
   - **Phase 2**, backend role, starts with **BE-000** (P47): the agent analyses the backend
     plan and puts every backend decision, open or already made, to the backend owner (whoever
     runs the session). No backend code before it.
   - **Phase 3**, frontend role, ends with **FE-046** (the product root becomes the repository
     root, the proof of concept is removed) and **FE-047** (production release).
3. Take the next task of your phase in order from `08-delivery/tasks-frontend.md`,
   `tasks-backend.md` or `tasks-engine.md`. Read the specs the task names, build only that, and
   meet its acceptance criteria and the definition of done in `08-delivery/testing.md`.
4. Commit straight to the build branch **`v_1`** (P40, P46). After every task, record it in
   `docs/11-roadmap-and-open-questions.md` ("Done") and in the build log's Current position. At
   the end of a milestone, write its build-log entry and update the status table here.
5. If a spec is silent or contradictory, or a decision is the owner's, add it to
   `09-open-questions.md` and ask; never guess product behaviour. Meanwhile go on with tasks
   that don't depend on it.

Rules that catch people out:
- **Paths in `plan/` are relative to the repository root** (the product root since FE-046; P44).
- The core never depends on the pricing module (P36, `04-architecture/modules.md`).
- Only the engine computes quantities (BR-01). In phase 1 the mock fakes engine features
  without measuring (`06-frontend/mock-api.md`).
- The look follows `06-frontend/design-guidelines.md` (P43).

## How to use this folder

1. Read `00-product/` (what and for whom), then `03-domain/` (the nouns, states and rules),
   then the feature specs you are working on in `01-features/`.
2. Take a task from `08-delivery/` (`tasks-frontend.md`, `tasks-backend.md`, `tasks-engine.md`).
   Every task names the spec sections it implements and its acceptance criteria.
3. The HTTP contract is `packages/api/openapi.yaml` (core) plus `packages/pricing-api/openapi-pricing.yaml` (the optional pricing module; both moved from `05-api/` in FE-001). Frontend, mock API and Java backend all
   implement or consume exactly these files. Change the contract first, then the code.
4. If a spec is silent or contradictory, do not guess on product behaviour: add the question to
   `09-open-questions.md` and ask the owner. Implementation details inside a module are yours.
5. `07-backend/decisions-to-make.md` lists decisions the **backend agent must stop and ask the
   owner about before writing backend code** (auth provider first).

## Reading order

| # | Path | What it gives you |
|---|---|---|
| 1 | [00-product/01-problem-and-vision.md](00-product/01-problem-and-vision.md) | The problem, the product, why it wins |
| 2 | [00-product/02-personas-and-markets.md](00-product/02-personas-and-markets.md) | Who uses it and how they work |
| 3 | [00-product/03-v1-scope.md](00-product/03-v1-scope.md) | What v1 contains, v1 acceptance criteria |
| 4 | [00-product/04-glossary.md](00-product/04-glossary.md) | Every term used in these specs |
| 5 | [00-product/05-plans-and-limits.md](00-product/05-plans-and-limits.md) | Free plan, paid plans, entitlements |
| 6 | [03-domain/data-model.md](03-domain/data-model.md) | Entities, fields, relations |
| 7 | [03-domain/state-machines.md](03-domain/state-machines.md) | Lifecycles of model versions, jobs, runs, BoQ versions, sessions, share links; the pricing module's own |
| 8 | [03-domain/permissions.md](03-domain/permissions.md) | Who may do what |
| 9 | [03-domain/business-rules.md](03-domain/business-rules.md) | Invariants every component must keep |
| 10 | [01-features/](01-features/) | One spec per feature (F01–F20; F11, F17, F20 form the removable pricing module) |
| 11 | [02-flows/flows.md](02-flows/flows.md), [02-flows/screens.md](02-flows/screens.md) | End-to-end flows, screen inventory, wireframes |
| 12 | [04-architecture/](04-architecture/) (start with `modules.md` for the core/module boundary) | System, engine worker contract, storage/jobs/realtime, security, deployment, NFRs |
| 13 | [05-api/](05-api/) | `openapi.yaml` (core), `openapi-pricing.yaml` (pricing module), API conventions |
| 14 | [06-frontend/](06-frontend/) | Next.js architecture, what to reuse from the PoC, mock API (and its engine fakes), design system, the owner's design guidelines (when supplied) |
| 15 | [07-backend/](07-backend/) | Java architecture, DB schema, decisions to make |
| 16 | [08-delivery/](08-delivery/) | Milestones, task lists, testing, how sessions run (`sessions.md`) |
| 17 | [09-open-questions.md](09-open-questions.md) | What is still open, who decides, and by when |
| 18 | [10-build-log.md](10-build-log.md) | Where the build stands, and what the agents decided along the way |

## Decisions taken (Nov 2026, product owner)

These are settled. Do not reopen them without the owner. Earlier engine and platform
decisions D01–D68 are in `docs/02-decisions.md` and still hold unless changed here.

| ID | Decision |
|---|---|
| P01 | **Primary tenant: the firm that produces the BoQ.** Design studios and engineering firms first (in design-led markets they author the model and the tender BoQ). QS / cost consultant firms use the same flows. Per-seat subscription. |
| P02 | *(Superseded by P28, P33, P34.)* **Bidders are contractors and subcontractors**, invited per tender package. One global bidder identity can receive invitations from many tenants. Bidders see only what they were sent. |
| P03 | **v1 is federated and versioned**: several discipline models per project; new model versions carry decisions over; change report per line between revisions. |
| P04 | *(Superseded by P33, P34.)* **No rate database.** Pricing happens through **tendering**: an issued BoQ is split into packages, bidders price lines, the firm compares offers side by side and awards per package. |
| P05 | **Full Library in v1**: org rule sets, classifications and dictionaries, versioned, with preview against a project model. |
| P06 | *(Workflow refined by P29.)* **v1 includes** the 3D viewer, review → approve → issue with an audit log, and an i18n-ready UI. **BCF is out.** |
| P07 | *(Refined by P35.)* **English only at launch**; every UI string goes through i18n from day one; engine messages get codes and parameters. |
| P08 | **Invite-only pilots first, then public sign-up with a limited free plan.** Billing is provider-agnostic. Pilots use manual billing; Paddle is deferred until paid self-service. |
| P09 | **Cloud-neutral deployment**: containers, Postgres, S3-compatible storage. The provider is chosen at deploy time. |
| P10 | **Authentication is not decided.** The agent that starts the backend asks the owner (options in `07-backend/decisions-to-make.md`). The frontend codes against an auth adapter. |
| P11 | *(Refined by P38, P39: phases; in phase 1 the mock uses the PoC engine API plus fakes.)* **Frontend first, against a mock API** that implements `openapi.yaml`, keeps CRUD state itself and uses the **real Python engine** for computation. The Java backend replaces the mock by changing a base URL. |
| P12 | Frontend: **React + Next.js**. Backend: **Java** (D62). Engine: **Python workers** (D61). |
| P13 | "Needs input" is a state of a **run and its BoQ revision**, not of a job. A job always ends (succeeded, failed or cancelled); answering questions starts a new run. (Refines doc 10.) |
| P14 | **Item texts live on the classification's codes.** A firm's BoQ item is a number plus a written description that is priced. The text is the code's `description`, a template with blanks the engine fills per line; the line shows it instead of the rule set's short line text. Classification still never changes a number (BR-02, BR-11). |
| P15 | **What isn't in the models is the user's to add.** The engine does not guess missing work. The app says so plainly on the sheet, when a version is saved and in exports, and makes manual lines easy (BR-12). |
| P16 | **A setup wizard in v1** for a new org's first rule set, classification and dictionary (F16). "Start from your last BoQ" comes after v1. |
| P17 | **Sign-up lands in a default tier.** Paid tiers are levels by active projects, seats, or both; the commercial model is undecided, so entitlements stay data (refines P08). |
| P18 | **The setup wizard is required on first start** of a new org, for its rule set and classification (and names). It must be finishable in minutes with suggested answers (refines P16). |
| P19 | **Presets per BoQ.** A project has default presets; any BoQ may use others, chosen when it is created or later. Any preset can be cloned: independent copy, or based on it (a patch). |
| P20 | **The BoQ is fully editable**: overwrite quantity, text and unit, move lines between sections, reorder, exclude, add lines anywhere. Edits are kept across regenerations and model versions and always shown as edits. The BoQ Excel can be edited and imported back. |
| P21 | *(Refined by P33, P34, P36: price requests became offer requests in the pricing module.)* **Vendors are accounts linked to orgs by invitation** (one vendor, many orgs, always free). Anyone working on a project can send the whole BoQ or a part to vendors for prices (price request); the formal tender stays as the advanced path. Any revision can be sent, frozen at sending, unless the org requires issued ones (refines P02, BR-40). |
| P22 | **One active session per account.** Signing in elsewhere shows where the account is open and asks to end that session first. Discourages account sharing. |
| P23 | **UI: shadcn/ui** (Tailwind + Base UI, from preset `b38miVKzY`; Radix would also do) with a monospace face for the UI; very clean, no visual noise, modern. Look in `06-frontend/design-guidelines.md` (P43). |
| P24 | **Guided preset editing and Excel templates.** New rule sets and classifications start in guided mode; every preset can be downloaded as an Excel template and uploaded back. |
| P25 | **"How it is calculated" and the 3D model are central.** Every line explains its number in plain words; the model sits beside the sheet while editing and in revisions, with filters shared by both. |
| P26 | **Public read-only share links** for BoQ versions, revocable, with expiry. |
| P27 | **Platform admin console** for the operator: all orgs, users, seats, usage and activation, metadata only (no project content); support messages later. |
| P28 | **No logged-in guests.** Three kinds of access: org users, vendor users (pricing module) and public share links (plus platform admins). |
| P29 | **A BoQ is a living document until confirmed.** An always-editable working version; "Save version" locks labelled snapshots and work continues; "Confirm" marks the BoQ done (reopenable). Review and approval are optional per org, off by default. Archiving the project is separate. |
| P30 | **Position numbers per section,** automatic (5.1, 5.2…), renumbered while working, frozen in saved versions. Item numbers (codes) stay a separate column. |
| P31 | **Live co-editing per line.** Everyone in a BoQ sees others' edits within a second; on the same line the later edit wins and the other person is told. |
| P32 | **Pricing is an optional module** (vendors, pricebooks, estimates, offer requests) behind a platform flag and a plan entitlement. The product's lifecycle ends at a confirmed BoQ: no construction-phase features. |
| P33 | **Pricebooks are the core of pricing.** Firms and vendors keep their own; a vendor chooses which list each linked firm sees; a firm prices its BoQ on a separate Pricing tab from its own and shared lists. Matching pricebook items to lines is manual, and remembered. No market price database from us. |
| P34 | **No formal tendering.** Offer requests only: the whole BoQ or a part to vendors, offers filled from their pricebooks, side-by-side comparison. No packages, sealed bids, addenda or award. |
| P35 | **International by design.** No market built in; the wizard and rules are generic. Orgs set currency, units, number and date formats; English is the default UI language and more are added as translations. |
| P36 | **The pricing module is separate and removable.** The core never depends on it: own API file under `/pricing/`, own DB schema, own frontend package, own backend module; it plugs in through generic extension points and core events. Removing it changes no core code (04-architecture/modules.md). |
| P37 | **Release 1 is the full v1**: every v1 acceptance criterion (00-product/03). The pricing module stays optional inside it. |
| P38 | **Three sequential phases by two agents.** Phase 1: the frontend agent builds the whole app and the mock API (the backend's executable spec). Phase 2: the backend agent makes the platform decisions (BE-000), builds the real engine changes and the Java backend against the same contract and scenario suites. Phase 3: the frontend agent wires the app to Java, removes the fakes, hardens and releases. Refines P11. |
| P39 | **Engine (Python) work belongs to the backend agent, in phase 2.** In phase 1 the mock runs the proof-of-concept engine API and fakes the engine features that don't exist yet, never measuring; each fake names the task that replaces it (`06-frontend/mock-api.md`). |
| P40 | *(Branch refined by P46.)* **Everyone commits straight to the build branch**, small commits, no feature branches; the phases don't overlap. |
| P41 | **The owner sets the visual direction**; it is recorded in `06-frontend/design-guidelines.md` (P43), which overrides `design-system.md`. |
| P42 | **The setup wizard's questions come from the rule set's data.** Every yes/no question that switches BoQ items on or off forms one checklist, with the follow-ups of what was switched on; the measuring questions for walls, openings, roofs, windows and doors and line splitting are marked in the rule set (`setupSteps`, six screens for "As modelled"). Step 2 lists only the BoQ items the answers switch on. F16. |
| P43 | **The product is called boqlet** (always lowercase). **Visual direction:** warm paper and ink, JetBrains Mono for the UI and Inter Tight for display, 2 px corners, colour only where it means something (blue accent and "derived", orange "to confirm", yellow "manual" and selection, red errors, no green), poster compositions only in the wizard, onboarding, sign-in, share page and dashboard cards, the dimension line as a recurring device, light theme default plus dark. Details and tokens in `06-frontend/design-guidelines.md`. |
| P44 | **One product root: `boqlet_v1/`.** All product code is built there, as one npm workspace. The first task (FE-000) moves the proof of concept (engine, contract types, presets, fixtures, scripts, PoC UI, docs, this plan) into it, so nothing ever refers across two roots; the PoC demo deployment stays pointed into it. The last structural task (FE-046) removes the PoC leftovers and makes `boqlet_v1/` the repository root. Paths in `plan/` are relative to the product root. |
| P45 | **Agents work on their own from task to task and milestone to milestone**, by `08-delivery/sessions.md`. They stop only for an owner decision that blocks every remaining task, at the end of a phase, or before an irreversible step. Implementation decisions and deviations are written in `10-build-log.md`, which, with its "Current position", is the handover between sessions and agents. |
| P46 | **The build happens on the branch `v_1`**, made from `main`. `main` keeps the proof of concept and its live demo untouched until the release: FE-047 tags `main` as `poc-final` and merges `v_1` into it. CI runs on both branches; staging deploys from `v_1` until the release, production from `main` after it. *(Until staging exists, the pilot deploys from `v_1`: P51.)* |
| P47 | **The backend belongs to its backend owner**: the person who runs phase 2 (the product owner or a backend developer they choose). BE-000 is their entry point: the agent analyses the backend plan and asks them about every backend decision, the open ones and the ones the plan already made (`07-backend/decisions-to-make.md`). The plan's backend choices are defaults. Their answers win over the backend plan, which BE-000 rewrites to match. They may change the HTTP contracts when the backend needs it, by `05-api/contract-changes.md`: contract, suites, mock and the smallest app fix in one commit, every change listed, and the frontend adapted in phase 3 (FE-041). Not theirs alone: product behaviour (the product decisions and business rules, what users can do or see) and the engine rules; changes there go to the product owner. |
| P48 | **The pricing module is for a later phase** (2026-11-14). MP1 (pricing on the mock, FE-P1…FE-P7) and MP2 (EN-P1, BE-P1…BE-P4) are not built in phases 1 and 2; the owner schedules them later. Phase 1 ends after M4, phase 2 after M7. The module boundary (P36) stays: the extension points (FE-039), `openapi-pricing.yaml`, the core-only build and the module-removed checks are still built and kept green. v1 criterion 6 ("only if the module ships in v1") is not part of release 1 unless the owner brings the module forward. |
| P49 | **Backend defaults confirmed for invite-only pilots** (2026-11-16). Java 21 with Spring Boot, PostgreSQL, Keycloak OIDC, and the Python engine worker. Keep worker sizing configurable. Hosting and staging deployment are deferred to a separate session. See [BE-000 decisions](07-backend/decisions.md). *(Sign-in refined by P50; staging by P51.)* |
| P50 | **Native sign-in instead of Keycloak** (2026-11-18, the deployment session). Users sign in with email and password on the boqlet domain; the Java API checks Argon2id password hashes and issues an opaque Secure, HttpOnly session cookie. Requests that change state must come from the exact boqlet origin. The single active session and takeover (BR-54) stay. The first owner and assisted resets use a one-hour setup link issued on the server. Refines D1 in `07-backend/decisions.md`. Runbook: `docs/19-native-auth-and-cd.md`. |
| P51 | **One deployed environment until further notice** (2026-11-20, the owner). The invited pilot on Contabo (`docs/18`, booqlet.com) is the only deployed environment; GitHub Actions deploys every green push to `v_1` there. A separate staging environment (BE-032) is a **future todo**, not part of phases 2 and 3. Wherever the plan says "staging", read the pilot deployment: acceptance there uses synthetic accounts in a controlled verification window (`ops/pilot/verify-live.sh`), and load, performance and restore tests that would disturb pilot users run against the local native stack instead. At the release (FE-047) the same host becomes production, deployed from `main`. Refines P46 and D8. *2026-11-20, the owner: it stays the only environment and is development for now (no real users), so checks may run there.* |
| P52 | **Browser tests against Java are a focused smoke set** (2026-11-20, the owner). The 106 Playwright tests keep running on the mock; a separate set of about 15–20 browser tests runs against Java with native sign-in (F01 criteria, FL-1 to the sample BoQ, upload to share link, live co-editing), in CI. The shared contract and scenario suites cover every operation on Java. Refines FE-041 and FE-043 acceptance ("every M1–M4 flow against Java"). |

## Where the code lives (P44)

The repository root is the product root, and every path in `plan/` is relative to it. (From FE-000
to FE-046 the product was built in a folder `boqlet_v1/` beside the proof of concept; FE-046 removed
the proof of concept and moved that folder to the root.)

```text
./                             one npm workspace (apps/*, packages/*), name "boqlet"
  apps/app                     Next.js product frontend
  apps/mock-api                Mock backend implementing both contracts through the engine worker; the e2e test double
  packages/api                 openapi.yaml + generated client (@ifc-boq/api)
  packages/pricing-api         openapi-pricing.yaml + its generated client (pricing module only)
  packages/types               Engine contract (TS -> JSON Schema)
  services/api                 Java backend
  engine/                      Python engine and its workers (worker.py, worker_http.py, worker_queue.py)
  presets/  fixtures/          presets and test models
  scripts/                     Node helpers that set up and run the engine
  tests/contract  tests/scenarios
                               shared suites: run against the mock and against Java
  tests/perf                   performance suite (TS-002)
  ops/pilot                    the deployed environment (docs/18, docs/19)
  plan/                        this specification, with 10-build-log.md
  docs/                        engine documentation and operations
  .github/workflows/           CI and the rollout
  CLAUDE.md  README.md  notes.md  .gitignore  package.json  package-lock.json
```

The proof of concept (its dev UI `apps/web`, the dev API `engine/ifc_boq/api.py` and `store.py`,
and its Vercel demo) is the git tag `poc-final` (FE-047).

## Status

| Part | State |
|---|---|
| Product definition (00) | Written; personas and scope to be validated with users (09) |
| Domain, features, flows (01–03) | Written |
| Architecture, API (04–05) | Written; `openapi.yaml` (core) and `openapi-pricing.yaml` (pricing module) cover every endpoint; the core never references the module (`04-architecture/modules.md`) |
| Frontend, backend specs (06–07) | Written; backend decisions open on purpose |
| Delivery (08) | Phases, milestones, task lists, session rules and build log written (P37–P40, P44, P45); the pricing module (MP1, MP2) is for a later phase (P48) |
| Design (06) | Design guidelines decided (P43); wordmark SVG still to come from the owner |
| **Build** | Phase 1 completed 2026-11-14 (M0–M4 on the mock). Phase 2 completed 2026-11-20 (BE-000, ME, M5–M7 on Java and the real engine; pilot live on one environment, P51; staging BE-032 deferred; carried-over checks listed in the phase-2 summary). Phase 3: **M8a completed 2026-11-21** (FE-041…FE-043: the app on Java with native sign-in, engine fakes gone, every contract change adapted). **Next: M8** (FE-044), after the owner's approval. Live position: `10-build-log.md` |

## v1 acceptance (TS-004, BE-026), 2026-11-21

Checked at `v_1` after M8 segment 3. **Where:** P51 makes booqlet.com the staging environment, but it is
invite-only and synthetic accounts need host access (`ops/pilot/verify-live.sh`), which the agent did not use.
So the automated criteria ran through the shared suites on **CI's local native stack** (Java, Postgres, object
storage and the real engine worker: the code the pilot runs) and on the mock with the real engine. On the
pilot itself: every deploy's route and private-health probes, and the deployment session's synthetic smoke
(`docs/19`). A live acceptance run on booqlet.com is left for an operator session with host access.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Duplex reproduction | ✓ | `tests/scenarios/duplex.test.ts` (every `HAND_BOQ` line and count, on Java and the mock), `e2e/duplex.spec.ts`, engine `test_duplex.py` |
| 2 | Federation | ✓ | `tests/scenarios/federation.test.ts` (one BoQ from architecture + structure, nothing measured twice, the shared chimney once; Java and mock), engine `test_federation.py` (overlap questions and answers) |
| 3 | Revision | ✓ | scenarios `changes`, `versions`, `questions` (answers carried over), `e2e/versions-flow.spec.ts`, `e2e/new-versions.spec.ts` |
| 4 | Traceability (M) | ✓ automated; person check open | `e2e/sheet.spec.ts` F06-AC2/AC5 (detail with formula, settings, shares), `e2e/viewer.spec.ts` F07-AC2 (element to its lines and back) |
| 5 | Versions | ✓ | scenarios `versions` (`409 revision_locked`, `409 boq_confirmed`, approval), `e2e/versions-flow.spec.ts` |
| 6 | Pricing module | — | not in v1 (P48) |
| 7 | Library (M) | ✓ automated; person check open | `e2e/library-editors.spec.ts` F10-AC1 (three settings, preview on the Duplex, publish), scenarios `library-publish` |
| 8 | Isolation | ✓ | `tests/scenarios/isolation.test.ts` on Java and the mock; Java integration tests (cross-tenant denial) |
| 9 | Limits | ✓ | scenarios `orgs`, `projects`, `models`, `boqs` (`402 limit_reached` with the limit), `e2e/billing.spec.ts`, `e2e-java/orgs.spec.ts` |
| 10 | Performance | ✗ one target | `04-architecture/nfr.md`: every target met except the medium-model parse (9 min, target 5; bound by the geometry kernel, `docs/11`) |
| 11 | i18n | ✓ | `e2e/pseudo-locale.spec.ts` (shell, sheet, questions, Library, share page in en-XA) |
| 12 | First setup (M) | open | needs a person new to the app; `e2e/setup.spec.ts` runs the wizard end to end |
| 13 | Editing | ✓ | `e2e/co-editing.spec.ts` F06-AC10, `e2e-java/live.spec.ts`, scenarios `line-edits` (edits survive a new model version), `e2e/exports.spec.ts` FE-037 (Excel edits imported back) |
| 14 | Vendors | — | not in v1 (P48) |
| 15 | Share link | ✓ | scenarios `shares`, `e2e/shares.spec.ts` F18-AC1/AC2 (revoked at once), `e2e-java` (upload through a share link) |
| 16 | Single session | ✓ | `e2e/sessions.spec.ts` F01-AC5, `e2e-java/sessions.spec.ts`, scenarios `state-machines` |
| 17 | Admin console | ✓ | scenarios `admin` (numbers match the usage pages; no response contains project content), `e2e/admin.spec.ts` |

**Open for v1:** criterion 10's medium parse, the person checks of 4, 7 and 12, and a live run on booqlet.com.
