# Multi-perspective review of the IFC → BoQ app (Boqlet)

You are running an unattended review session on the app in the current working directory. It takes IFC (BIM) files and generates a Bill of Quantities (BoQ). The app was built from the owner's input, which AI then expanded into instructions, and AI built the code from those instructions. The domain is large (measurement rules, classification systems, naming dictionaries, review queues, versioned runs, merging), and the code has a lot of business and technical logic.

**Your goal:** produce a set of review documents in `docs/review/`, ending with `docs/review/BLUEPRINT.md` and `docs/review/PROGRESS.md`. Later sessions will work through the blueprint one work package at a time to refactor, fix and enhance the app, and to build what is missing.

**Scope is exhaustive, not prioritized down.** This is not a "top N issues" exercise. Capture and plan every finding at every severity, and every missing or partial feature, however much work that adds up to. Severity and phases set the order of the work. They never decide what gets left out. Only real billing-provider integration is out of scope.

## Ground rules

- **Do not ask the owner any questions.** Use judgement for every decision, and record each judgement call and assumption in the documents.
- **Do not modify application code in this session.** Write only to `docs/review/` and its subfolders.
  - Scratch scripts go in `docs/review/_scratch/`, downloaded samples in `docs/review/_samples/` and screenshots in `docs/review/_screenshots/`. Add those three folders to `.gitignore`.
  - The baseline in `docs/review/baseline/` and the tools in `docs/review/tools/` are committed.
- If git exists, commit the review docs on a new branch, `review/blueprint`. Never push.
- **Every finding needs evidence:** a `file:line` reference, steps to reproduce, a screenshot path, or a command with its output. Drop anything you can't back up.
- **Good findings count as much as bad ones.** Record what works and should be kept.
- **The docs are not ground truth.** They were written by AI too. Reviewers may conclude that a spec itself is wrong, incomplete or contradictory (domain rules, flows, data model), not only that the code drifts from it. Record these as findings in their own category, `spec-issue`.

## Phase 0: shared context and baseline (you, before spawning any agents)

1. **Map the repo:** structure, packages, entry points, the React/TS frontend, the backend, the Python IFC engine, how the three talk to each other (APIs, queues, file handoffs), the data model and persistence, and the tests.
2. **Read all original docs:** specs, phase plans and AI-written instructions. Build a **feature matrix** with these columns:
   - feature
   - where it is planned (doc reference)
   - status: built / partial / missing / diverges from spec / spec questionable
   - evidence
3. **Get the full stack running locally:** frontend, backend, engine, and any database or services they need. Install dependencies, then run the build, tests, lint and type checks for every part. Record exact commands and results, including failures.
4. **Fetch public IFC sample files** into `docs/review/_samples/`. Sources include the buildingSMART repos (e.g. `buildingSMART/Sample-Test-Files`, `buildingSMART/IFC4.3.x-sample-models`) and the IfcOpenShell test files. Aim for a varied set:
   - a tiny, simple model
   - a mid-size real building with architectural and structural content
   - one with MEP elements
   - a large file (50 MB or more, if available)
   - both IFC2x3 and IFC4
   - at least one malformed or edge-case file

   Write `docs/review/tools/fetch-samples.sh`, which re-downloads the exact set and checks SHA-256 checksums, so later sessions can get the same files. Record each file's source URL, schema, size, checksum and contents.
5. **Capture the baseline.** Run every sample through the current app, using default settings plus at least one non-default ruleset or classification where the app supports it. Save the outputs to `docs/review/baseline/`: the BoQ data in its richest machine-readable form, the exports, and the run metadata and any review-queue items. Write `docs/review/tools/compare-baseline` (a script in whichever language suits). It re-runs the samples and diffs the results against the baseline line by line, with quantities compared within a tolerance. This is the safety net that lets later sessions tell intended changes from accidental ones.
6. **Make sure a headless browser works** (install Playwright if needed) so agents can use the UI and take screenshots.
7. Write everything to `docs/review/00-context.md`: architecture map, how to run, docs inventory, feature matrix, sample files, baseline summary, and the results of the build, test and lint runs.

## Phase 1: six independent reviews (parallel subagents)

Spawn six subagents in parallel. Each one gets `00-context.md`, its persona brief below, and the report format. **They must not read each other's reports.** Each persona has deep, relevant experience and matching expectations, uses the app hands-on wherever its role would, and records every finding and opinion, good or bad.

### 1. Senior software engineer → `01-engineering.md` (IDs `ENG-`)
Has 12+ years of experience across TypeScript/React, backend services in the backend's language, and Python, and has run production data pipelines. Reads the code to understand how it works end to end, then reviews:
- **Architecture:** module boundaries, separation between UI, backend and engine, API contracts and their consistency, data model and persistence, auth and access control (project membership as the boundary, audit of who created what), and monorepo hygiene.
- **Correctness of the business logic:** rules engine, unit handling, rounding, deductions, review queue state, run immutability and versioning, merge logic.
- **Code built by AI:** look specifically for logic that looks right but is wrong, the same rule implemented in several places, dead or unused code, drift from the spec, inconsistent patterns, and over-engineering.
- **Error handling and robustness:** behaviour on malformed IFC files, missing properties, odd units and schema differences.
- **Performance:** test on the large sample, covering memory, parse time and UI responsiveness on big BoQs.
- **Security:** file upload and parsing, path handling, injection, dependency vulnerabilities, secrets.
- **Tests:** coverage, and whether the tests actually check behaviour or only check themselves. Also cover types, linting, and the build and dev workflow.

For each issue, say what industry-standard practice would look like.

### 2. Product manager → `02-product.md` (IDs `PRD-`)
Has 10+ years in B2B SaaS, including construction tech or BIM. Works out what problem the app solves, for whom, and how. Compares the app against the docs' intent using the feature matrix, and challenges the intent itself where the docs got the product wrong. Uses the web to research comparable tools (e.g. CostX, Vico, Solibri, BIMcollab, Revit/Navisworks takeoff, Excel-based workflows) and positions the app against them. Reviews:
- core user flows, onboarding and time to first value
- where the app meets user expectations and where it falls short
- which features are missing or half-built
- what is needed for a credible launch, including subscription logic (seats, IFC-processing quota). Billing-provider integration is out of scope.
- the differentiators, and what should be simplified

### 3. Casual one-time user → `03-casual-user.md` (IDs `CAS-`)
A small contractor or freelance estimator with a single project and a few days of work. Needs the basics: upload an IFC file, get a sensible BoQ, adjust a few things, export to Excel or PDF. Not a BIM expert, and dislikes jargon. Uses the app hands-on through the browser with the samples and records the session step by step:
- moments of confusion and dead ends
- error messages and whether they help
- how long the result takes and whether it can be trusted
- the export
- whether they would pay for it, finish the project with it, or come back

Takes screenshots of key moments.

### 4. Senior civil engineer / quantity surveyor → `04-civil-engineer.md` (IDs `QS-`)
Has 15+ years doing quantity takeoffs, both by hand and in tools such as CostX and Excel, under standards such as DIN 276/VOB and NRM2 and in regional practice. Needs in-depth analysis and fine-tuning. Uses the app hands-on.

**Verifies accuracy independently** across at least 10 elements of different types in two or more samples, in two ways:
- **(a) Script:** recompute quantities with an IfcOpenShell script (in `_scratch/`).
- **(b) By hand:** for simple elements (walls, slabs, columns, beams, openings), calculate from the raw dimensions and placement in the IFC, using plain arithmetic rather than library quantity functions or the model's built-in quantity sets. This guards against the app and the check sharing the same library error.

Compares both against the app's BoQ line by line, and writes the reusable part of this check to `docs/review/tools/verify-quantities` for later sessions to use as a regression test.

Reviews:
- units, net vs gross, opening deductions, layers and materials
- measurement-rule configuration and parameter templates
- mapping to classification systems
- the naming dictionary
- the review queue for ambiguous items
- how missing data is flagged and how proxy values are used
- traceability from each BoQ line back to element GUIDs
- run versioning, revision comparison and merging
- export formats and their professional usefulness

Challenges domain rules in the docs that a practitioner would consider wrong. Gives a verdict on whether they would sign off a BoQ produced this way.

### 5. Head of a large estimating team → `05-team-lead.md` (IDs `LEAD-`)
Leads 20–30 estimators and engineers across several projects at once. Judges how the app changes the team's work:
- collaboration and the User → Org → Project hierarchy
- shared org libraries (rulesets, classifications, dictionaries)
- consistency of output across team members
- permissions and audit trail
- onboarding new staff
- throughput, and realistic time saved compared with the current manual or tool-based workflow (give estimates and the reasoning behind them)
- QA and trust controls, and reporting
- cost to justify against the subscription model

Uses the app hands-on as far as the current build allows, and flags what a team would need that isn't there.

### 6. Senior UI/UX designer → `06-design.md` (IDs `UX-`)
Has 10+ years designing data-heavy B2B tools such as spreadsheets-in-browser, BIM viewers and analytics products. Uses the app hands-on in the browser and reviews:
- information architecture and navigation
- visual consistency and design-system adherence (components, spacing, typography, color, states)
- how dense screens hold up for power users: large BoQ tables, filtering, sorting, bulk edits, keyboard use
- progressive disclosure, so casual users aren't overwhelmed by power features
- empty, loading and error states
- responsiveness
- accessibility (WCAG 2.2 AA: contrast, focus, keyboard, labels, screen-reader semantics)
- microcopy and jargon

Takes screenshots, and proposes concrete fixes: the pattern or component to use, not just "improve X".

### Report format (all six)
1. **Verdict:** 3–5 sentences.
2. **What works (keep and reinforce):** each item with evidence.
3. **Findings table:** ID, title, category (including `spec-issue`), severity (critical / high / medium / low), confidence (high / medium / low), evidence, impact, recommendation.
4. **Missing or planned-but-absent features**, from this persona's point of view.
5. **Assumptions and judgement calls made.**

## Phase 2: verification (parallel subagents, spawned by you)

When all six reports are done, you (the main session) sort every finding into areas and spawn one fresh verifier subagent per area, in parallel:
- engine and domain logic
- backend, API and data
- frontend, UX and design
- product and features

Each verifier checks every finding assigned to it, at every severity, against the code or the running app. It marks each one verified, adjusted (with the correction) or rejected (with the reason), and writes the results to `docs/review/verify-<area>.md`. Critical and high findings get the deepest check, including reproducing them where possible. Verifiers didn't write any of the reports they check.

## Phase 3: consolidation (one fresh subagent, spawned by you)

The consolidator reads `00-context.md`, all six reports and all verification files, then:

1. **Removes duplicates** across personas and keeps the source IDs.
2. **Resolves conflicts** between personas, such as power-user depth vs casual simplicity, and between the code and spec issues. Each decision is recorded with its rationale.
3. **Writes `docs/review/BLUEPRINT.md`** with these sections:
   - **Executive summary:** overall state, the most serious issues and the main strengths. This is orientation only. The plan below holds everything.
   - **Keep and reinforce:** what must not be broken in the refactor, and why.
   - **Decision log:** every judgement call, including spec corrections, with its rationale.
   - **Phased plan,** ordered by dependency:
     - **Phase A:** correctness and safety. Wrong quantities, data loss, security, crashes.
     - **Phase B:** architecture and refactor. Remove duplicated logic, set clean boundaries, test foundations.
     - **Phase C:** UX, design and flows, for both casual users and power users.
     - **Phase D:** planned-but-missing features from the docs, plus features the reviews found necessary. Everything in the feature matrix marked missing or partial goes here. Subscription and quota logic is built behind a payment-provider interface with a stub implementation; no real provider gets linked.
     - **Deferred / out of scope:** only real billing-provider integration.
   - **Each item:** ID, title, source finding IDs, problem, why it matters, the change and the approach, files and modules affected, acceptance criteria, tests to add or update, effort (S/M/L), dependencies, risk.
   - **Work packages.** Group the items into packages, each completable in a single focused session, so that no package depends on memory of an earlier session. A package should hold roughly one coherent theme and a session's worth of work; split anything larger. Each package has:
     - ID and goal
     - the items it includes
     - which packages it requires first
     - which files and areas it touches
     - an entry check (what must already pass)
     - an exit check (tests, lint, type-check and build green; acceptance criteria met; baseline comparison and quantity verification run, with every difference explained)
     - expected baseline changes, if the package intentionally changes quantities or output
   - **Execution instructions for every follow-up session:**
     1. Read `BLUEPRINT.md` and `PROGRESS.md`, and pick the next package whose prerequisites are done.
     2. Run its entry check, then work through its items, committing once per item.
     3. Run the exit check: run `compare-baseline` and `verify-quantities`, and record each baseline difference in `PROGRESS.md` as intended (with the item ID) or treat it as a regression and fix it. When a package intentionally changes output, update the baseline in the same commit and note it.
     4. Mark the package done in `PROGRESS.md` with notes, decisions and anything newly discovered. New issues become new items in a later package, never silent scope changes.
     5. If a package turns out too large, finish a coherent subset, split the rest into a new package, and record that.
4. **Writes `docs/review/PROGRESS.md`:** a tracker table with package ID, title, status (todo / in progress / done / blocked), prerequisites, session date, commits, baseline changes and notes. Every package starts as todo. Add a short "How to use this file" header containing the execution instructions above.

## Finish

- Check that every blueprint item traces back to at least one finding or feature-matrix row, and that every item belongs to exactly one work package.
- Check that every verified finding (all severities) and every missing or partial feature appears in the blueprint. Add a coverage table at the end of `BLUEPRINT.md` that maps each finding ID and feature-matrix row to its blueprint item, or to its rejection reason.
- Check that `fetch-samples.sh`, `compare-baseline` and `verify-quantities` run cleanly against the current code. With no changes yet, `compare-baseline` should report zero differences.
- Commit on `review/blueprint`.
- Print a short summary: the documents produced, counts of findings by severity and persona, counts of verified, adjusted and rejected findings, the number of work packages per phase, and the assumptions that most affect the plan.
