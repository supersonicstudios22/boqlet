# boqlet — product overview

The north star for all work on boqlet. Read it before any task, and check that new work serves
the outcomes and principles here. Last checked against the code: 2026-11-21 (v1.0.0 plus P53).

## In one paragraph

boqlet turns IFC building models into a **Bill of Quantities (BoQ)**: every piece of work,
measured, described and coded so contractors can price it. A firm uploads its models, chooses
**how to measure** (a rule set), **how to code and group** (one or more classifications) and **what
its names mean** (dictionaries). All three are data the firm owns, not code. It gets a BoQ in minutes,
and every number links to its formula, its parameter values and the elements behind it. The
engine asks about what it can't work out instead of guessing. Answers are kept, so a new
model version takes minutes, not days. The firm edits the BoQ freely, saves locked versions,
confirms it, exports it to Excel and shares it read-only by link.

```
getBoq(models, rules, classifications, dictionaries, decisions) -> BoqResult
```

## The problem

1. **Take-off is manual and slow.** People measure from drawings or copy model schedules into
   Excel; a medium building takes days to weeks.
2. **Every design change means doing it again,** and finding by hand what changed.
3. **Numbers aren't traceable.** "412.6 m²" in a cell has no link to the walls or rule behind it;
   errors surface on site, where they are expensive.
4. **Every firm, client and country measures differently** (deductions, units, what counts as an
   item, codes and grouping). Model-based take-off tools (CostX, RIB iTWO, Revit schedules) are
   rigid, expensive, tied to one vendor, or not built for BoQs.
5. **Pricing runs on email and Excel.** (Addressed only by the optional pricing module, not built.)

## Who it is for

The **tenant is the firm that produces the BoQ** (P01): design and engineering firms first (in
design-led markets they author both the model and the tender BoQ), and QS / cost-consultant firms on
the same flows. The product is international: no country's standard is built in (P35, rule 10).
Personas, markets and jobs to be done: [personas.md](personas.md).

| Who | Kind of access | Roles in code | What they do |
|---|---|---|---|
| Firm staff | Org user (uses a seat) | Org: `owner`, `admin`, `library_editor`, `member`. Project: `lead`, `estimator`, `approver`, `viewer` | Owners and admins run the org (members, settings, billing, usage, audit). Library editors encode the office standard. Leads, estimators and approvers produce, check and confirm BoQs. Viewers read. |
| Client / investor | Public share link, no account (P28) | — | Read one BoQ version: sheet, explanation, 3D |
| The operator | Platform admin | `users.platform_role = 'admin'` | Admin console: orgs, users, seats, usage, funnel, health. Metadata only, never project content (BR-57) |
| Contractor / supplier | Vendor user (pricing module) | **not built** (P48) | Pricebooks, offer requests |

Who may do what: [../domain/permissions.md](../domain/permissions.md) (enforced in
`services/api/.../project/ProjectAccess.java` and `OrgAccess`).

## What users must be able to achieve

These outcomes are the yardstick for every feature and test. The test plans map tests to these ids
([../testing/README.md](../testing/README.md#coverage-by-outcome)).

| Id | Outcome | Features | State |
|---|---|---|---|
| **O1** | **From IFC models to a measured, coded BoQ in minutes**: several discipline models per project, federated into one BoQ, nothing counted twice | F03, F04 | Built. Not built: coordinate alignment |
| **O2** | **Measure the firm's own way**: rule sets, classifications with item numbers and item texts, and dictionaries as versioned presets; a setup wizard for the first ones | F10, F16 | Built. Gaps: wizard simplified, no per-project default-preset pickers, scope rules not editable |
| **O3** | **Trust every number**: each line explains itself ("How it is calculated", formula, parameters, element shares), and line ↔ elements link both ways in the 3D viewer | F06, F07 | Built |
| **O4** | **Nothing silently dropped**: everything the engine can't decide becomes a question; answers are kept and carried across versions and BoQs; work not in the models is flagged as the user's to add | F05, F06 | Built. Gap: no AI name suggestions; unknown local-language names are the main source of questions |
| **O5** | **Keep up with design changes**: a new model version re-runs with earlier answers and edits, and a change report shows what changed, line by line | F08 | Built |
| **O6** | **Edit, version and confirm**: full line editing with live co-editing, locked saved versions, optional review and approval, confirm and reopen, audit log | F06, F09 | Built |
| **O7** | **Hand it over**: Excel export (run, frozen version, change report) with edits imported back, and public read-only share links | F12, F18 | Built. Workbooks recalculated in LibreOffice in CI (review B-11); not yet opened in Excel |
| **O8** | **Run the firm's account**: org, invitations, roles, one active session per account, notifications, plans and limits | F01, F02, F13, F14, F15 | Built: public sign-up (a platform setting, off by default) and self-service password reset by email, plans the platform admin configures (P57). Not built: a payment provider (prices are shown, not charged), stronger bot protection than a hidden field and throttling, trial and downgrade handling |
| **O9** | **Operate the platform**: admin console with usage, funnel and health, metadata only | F19 | Built. Gaps: no MFA, revenue always empty, health lacks email and webhook failures |
| O10 | (Pricing module) pricebooks, estimates, offer requests to vendors | F11, F17, F20 | **Not built** (P48): contract only |

### Main journeys (as built)

| Journey | Steps and routes | Flow spec |
|---|---|---|
| **Onboarding** | The person signs up at `/sign-up` while public sign-up is open (an emailed link, P57), or an operator issues a setup link (`ops/pilot/issue-setup-link.sh`, locally `npm run local:user`), or an owner invites → `/sign-up?token=…` sets a password → `/sign-in` (takeover at `/session-conflict`) → `/onboarding` creates the org → `/{org}/setup` wizard (required for owner, admin and library editor) → `/{org}` dashboard, "Try with a sample project" (the Duplex) | FL-1 |
| **Main loop** | `/{org}/projects/new` → `/projects/{p}/models`: add a model, upload to object storage, parse job with live progress, input-check report → `/projects/{p}/boqs`: create a BoQ (model versions + presets) → Generate → Questions tab (bulk answer, promote to the company dictionary) → Sheet (edit, move, exclude, manual lines, co-editing), Viewer, Log → Save version → Confirm | FL-2, FL-7, FL-9 |
| **New model version** | Upload v2 → "new version available" → regenerate (answers and edits carried over) → Changes tab (change report, Excel) → save the next version | FL-3 |
| **Encode the office standard** | `/{org}/library`: rule sets, classifications, dictionaries, resolution settings; draft (autosaved), preview against a model version, publish version n; Excel templates round trip | FL-6 |
| **Hand over** | BoQ Exports tab (run Excel, frozen version Excel, edits import, change report); share link → public `/s/{token}`; org-wide links at `/{org}/settings/shares` | FL-11 |
| **Operate** | `/admin` (orgs, users, funnel, health): plan changes with reason, trial dates, suspend, end a session | FL-12 |

## Why someone would use it

| Strength | Why it matters | Compared with |
|---|---|---|
| **Rules are data the firm owns** | Any standard, client rulebook or house style is a preset, not a feature request | Hard-coded take-off logic in CostX / iTWO; Revit schedules that know no measurement rules |
| **Measure once, view many ways** | Switch code system or grouping without recomputing (classification never changes a number) | Re-doing the take-off per code system |
| **Every number is traceable** | Reviewers check a line in seconds: formula, values, elements in 3D | A number in an Excel cell |
| **Nothing silently dropped** | A missing line in a tender is the worst outcome; the engine flags and asks instead | Tools that skip what they can't classify |
| **Revisions are cheap** | Cached parse, answers and edits carried over, line-by-line change report | Re-measuring and diffing by hand |
| **IFC from any tool** | No vendor lock-in for firms on mixed tool stacks | Tools tied to one authoring vendor (run on 309 files from 30 tools, [the corpus catalogue](../testing/ifc-corpus-catalogue.md)) |
| **Browser-based, Excel out and in** | Nothing to install; the BoQ still lives in the format everyone prices in | Desktop tools, export-only spreadsheets |

## Product principles

Every decision should keep these. The engineering form of several of them is the "Rules of the
road" in [CLAUDE.md](../../CLAUDE.md).

1. **Rules, classifications and dictionaries are data**, chosen per BoQ (P19), never code paths per standard.
2. **Only the engine computes quantities** (BR-01); formulas evaluate in one place (`expr.py`).
3. **Classification never changes a number** (BR-02, D14).
4. **Nothing is silently dropped**: unknowns become questions, missing values become flagged lines, every step is logged.
5. **Every number is traceable** to formula, parameters and elements (P25).
6. **What isn't in the models is the user's to add** (P15): the engine never guesses missing work; the app says so plainly.
7. **The model is never changed**: answers and edits live beside it (D18).
8. **The BoQ is the user's document**: fully editable (P20), edits always shown as edits and kept across regenerations.
9. **Decisions are stable**: question ids are deterministic, so answers survive new runs and model versions.
10. **International by design** (P35): no market, standard or language built in; formats per org.
11. **The core never depends on the pricing module** (P36).
12. **Quiet, precise UI**: colour only where it means something (P43, [design guidelines](../development/design-guidelines.md)).

### Non-goals

- **Not a certified BoQ**: output is a draft that a qualified person approves (D07).
- **Not a price database**: prices come only from a firm's or vendor's own pricebooks, in the optional module (P33).
- **No formal tendering** (packages, sealed bids, award; P34) and **no construction phase** (valuations, final accounts): the lifecycle ends at a confirmed BoQ (P32).
- **Not a model editor**, and **no BCF** to designers (P06).
- **No licensed standard content** in the product or repo (DIN, VOB, CSI…; D30–D32, [sourcing](../domain/sourcing-and-licensing.md)).
- **No logged-in guests** (P28): org users, public links, platform admins (and later vendors) only.

## Current state (2026-11-22)

**Released as v1.0.0** and running as an **invite-only pilot** at booqlet.com, the only deployed
environment, which counts as development (P51). Every green push to `main` deploys there. The mock
API used during the build is gone (P53): Java is the only backend, and it runs locally in Docker.
The test campaign (Stages 1–6, `docs/testing/test-findings.md`) fixed what it found on `main`, the
owner answered its questions (P54), and the deferred items are in [known-limitations.md](known-limitations.md).

| | What |
|---|---|
| **Built and working** | Everything in O1–O9 above: native sign-in with one active session, orgs and invitations, projects, models and versions with parse jobs, federation, BoQs and runs, questions and decisions, the virtualised sheet with full editing and live co-editing, "How it is calculated", the three.js viewer, change reports, saved versions, review, approval and confirmation, the Library with versions and preview, the setup wizard, Excel exports and edits import, share links, notifications (in-app and SMTP email), plans and limits with manual billing, the admin console, i18n infrastructure (English plus a pseudo-locale) |
| **Verified how** | The engine reproduces the hand-made Duplex BoQ exactly (`engine/tests/test_duplex.py`, and through the API in `tests/scenarios/duplex.test.ts`). The shared contract and scenario suites, the JUnit classes and the browser smoke run against Java on every push ([../testing/README.md](../testing/README.md)). 13 of 17 v1 acceptance criteria pass automatically, 2 are pricing (n/a), the medium-model parse misses its target, and 3 need a person ([scope-and-acceptance.md](scope-and-acceptance.md#v1-acceptance-results-2026-11-21)) |
| **Accuracy** | Checked only on the Duplex and the buildingSMART samples. No professional BoQ to compare with yet: the biggest open risk ([known-limitations.md](known-limitations.md)) |

### Intended vs. built

Planned in the specs but **not built**:

| Gap | Spec | Note |
|---|---|---|
| Strong bot protection for public sign-up | P57, BE-D12 | Sign-up is built and off until the platform admin opens it; its bot protection is basic (a hidden field, a minimum fill time, throttling) |
| Invite colleagues during onboarding | FL-1 step 3 | Onboarding is a single create-org form; the wizard follows, and until it is finished every org page but the settings leads to it (P54 Q57) |
| Payment provider, checkout, webhooks | F14, BE-D7 | Manual billing: checkout answers `409 checkout_unavailable`, the webhook `400 unsupported_provider` |
| Trial driven by plan config, downgrade rules | plans-and-limits | Admins set `trialEndsAt` by hand; no job drops an org to Free; excess projects don't become read-only |
| Default presets chosen per project | F02 | Defaults come from the org's starred presets or the wizard's "Publish all" |
| Scope rules editable per model / BoQ | F03, D44 | Stored and used by the engine; the UI only shows them |
| Large uploads (> 100 MB) | F03 | Multipart in 16 MiB parts with retries; resume in the same tab only (A-40). A model can be removed (archived, P54 Q50); a version can't be deleted from the UI |
| Server-side grouping above 20,000 lines; three-line item-text clamp | F06 | The client loads every line of the run, 20,000 per request, and groups them in the browser |
| Setup wizard as specified | F16 | Simplified: steps 2 and 3 are the full editors; no "Suggest codes", no "setup in progress by…" |
| Pricing module (vendors, pricebooks, estimates, offer requests) | P32–P36, F11, F17, F20 | Deferred (P48). Only `openapi-pricing.yaml` and the core's extension points exist; `packages/pricing-ui` does not exist |
| AI name suggestions; coordinate alignment between models | v1 scope "out" | Settings type exists for AI; federation assumes shared coordinates and warns |
| Languages other than English | P07, F15 | Infrastructure only; engine log texts are still English strings. The org's number and date formats apply everywhere (TF-021); imperial output is deferred (EN-imperial) |
| Global search; opening an earlier run read-only | FE-034, F04 §5 (FE-048) | Deferred in the test campaign ([known-limitations.md](known-limitations.md)) |
| Admin MFA, revenue, email and webhook health | F19 | Health says "not tracked yet" for webhook failures and bounces; every admin read is audited (P54 Q59) |
| Separate staging environment | P51 | A future todo |
| Success measures "instrumented from day one" | below | Partly: usage events per job, and the admin funnel (setup → model → BoQ → saved → shared, with median hours) |

**Built but in no feature spec:** native email-and-password sign-in with setup links (P50, a decision
rather than a feature spec); Keycloak OIDC kept as a rollback adapter (`legacy-identity` profile);
Serbian email templates next to English (`EmailDelivery`), while the UI has no Serbian (Q41); the Postgres
job queue, idempotency keys, JSON logs (request, user, org and job ids in text logs too), metrics and alerts as log lines; rate limits on sign-in, invitation mail, engine rpc calls and share links (`security.md`); admin tags and notes; the
local Docker stack (`ops/local`).

## Where it is heading

Nothing is scheduled; the owner sets what comes next. The candidates, with reasons, are in
[roadmap.md](roadmap.md). The open product questions (market validation, tiers and prices,
legal) are in [open-questions.md](open-questions.md).

## How we know it's working

**For users (pilot success measures, P-level targets):**

| Measure | Target | Instrumented? |
|---|---|---|
| Time from first upload to first saved BoQ version, medium project | < 1 working day | Approximated by the admin funnel (model → saved, median hours) |
| Time to a new saved version after a new model version | < 1 hour | No |
| Share of lines with a quantity from the model (measured or derived) vs flagged | Baseline from pilots | Per run in the result's stats; not aggregated |
| Questions per new model version after the first | Falls with every version | No |
| BoQs confirmed per active project | Baseline from pilots | No |
| A person new to the app finishes the setup wizard on the Duplex | < 15 minutes (v1 criterion 12) | Person check still open |

**For the product as built:** the 17 v1 acceptance criteria ([scope-and-acceptance.md](scope-and-acceptance.md)),
the NFR targets ([../architecture/nfr.md](../architecture/nfr.md)), and the standing checks: the Duplex
acceptance test reproduces the hand-made BoQ exactly, CI is green on `main`, and the pilot answers
its smoke checks after every deploy ([../operations/auth-and-deploys.md](../operations/auth-and-deploys.md)).

**For the business (not yet validated):** firms pay per seat (Q1); their models are good enough that
most quantities come from them (Q2). Both need pilot firms ([open-questions.md](open-questions.md)).
