# boqlet review — PROGRESS

Tracker for `docs/review/BLUEPRINT.md`. One row per work package; every package starts as **todo**.

## How to use this file

1. **Read `docs/review/BLUEPRINT.md` and `docs/review/PROGRESS.md`, and pick the next package whose
   prerequisites are done**: the first package in section 5's order whose status is `todo` and whose
   prerequisites are all `done`. Mark it `in progress` in PROGRESS.md (with the date) before starting.
2. **Run its entry check, then work through its items, committing once per item** (on `main`, CLAUDE.md;
   message `WP-xx A-nn: <title>` plus the reason when numbers change on purpose, rule 7). Each item's commit
   includes its tests, its doc changes (section 3.5) and the CLAUDE.md after-task duties.
3. **Run the exit check**: run `docs/review/tools/compare-baseline` and `docs/review/tools/verify-quantities`,
   and record each baseline difference in PROGRESS.md's "Baseline differences log" as **intended** (with the
   item id) or treat it as a **regression** and fix it. When a package intentionally changes output, update
   the baseline in the same commit as the change that causes it (`docs/review/tools/compare-baseline
   --capture`, plus the stack layer when the stack is up) and note it; update `verify_quantities.py` when a
   KNOWN row turns FIXED.
4. **Mark the package done in PROGRESS.md** with notes, decisions and anything newly discovered. **New issues
   become new items in a later package** ("New items discovered" in PROGRESS.md, with an id like `N-01` and a
   proposed package), **never silent scope changes**.
5. **If a package turns out too large**, finish a coherent subset, split the rest into a new package (e.g.
   `WP-C2b`, prerequisites = the original's), record the split in PROGRESS.md and in BLUEPRINT.md's package list (section 5)
   (append, don't renumber).

Pushing: every green push to `main` deploys to booqlet.com (P51). Push only after the exit check is green; never
push red. If a package needs an owner decision that isn't recorded (items marked "owner to confirm"), do the
documented fallback or mark the item `blocked` and continue with the rest of the package.

Statuses: `todo` · `in progress` · `done` · `blocked` (say why in Notes). Practical notes (stack, samples, tool run times, Java timing sensitivity, CLAUDE.md duties): BLUEPRINT.md §6.2.

State at the start (unchanged code, 2026-11-23): `compare-baseline` 0 differences in 47 runs; `verify-quantities` 22 OK / 8 KNOWN, exit 0.

## Tracker

| Package | Title | Status | Prerequisites | Items | Session date | Commits | Baseline changes | Notes |
|---|---|---|---|---|---|---|---|---|
| WP-A1 | Reported quantities vs geometry (the ×1000 and ×2 slab errors) | in progress | — | A-01, A-02, A-03, A-04 | 2026-11-23 |  |  |  |
| WP-A2 | Flags, decisions and plausibility | todo | WP-A1 | A-05, A-06, A-07, A-08 |  |  |  |  |
| WP-A3 | Measurement defaults: walls, finishes, reveals, formwork | todo | WP-A2 | A-09, A-10, A-11, A-12, A-13 |  |  |  |  |
| WP-A4 | Measurement defaults: slabs, roofs, proxies, steel | todo | WP-A3 | A-14, A-15, A-16, A-17 |  |  |  |  |
| WP-A5 | Federation, double counts and wall codes | todo | WP-A4 | A-18, A-19, A-20, A-21 |  |  |  |  |
| WP-A6 | Expression language and rule-engine correctness | todo | — | A-22, A-23, A-24, A-25, A-26, A-27 |  |  |  |  |
| WP-A7 | Units and numbers | todo | — | A-28, A-29, A-30 |  |  |  |  |
| WP-A8 | Parser robustness and CLI/worker parity | todo | WP-A5 | A-31, A-32, A-33, A-34 |  |  |  |  |
| WP-A9 | Security hardening | todo | — | A-35, A-36, A-37, A-38, A-39 |  |  |  |  |
| WP-A10 | Hand-off correctness: uploads, the sheet's Excel, the watermark switch | todo | — | A-40, A-41, A-42 |  |  |  |  |
| WP-A11 | Library and approval controls | todo | — | A-43, A-44, A-45, A-46 |  |  |  |  |
| WP-B1 | Engine invariants and independent oracles | todo | WP-A6, WP-A8 | B-01, B-02, B-03, B-04 |  |  |  |  |
| WP-B2 | Shared suites and browser coverage on the local stack | todo | — | B-05, B-06, B-07, B-08 |  |  |  |  |
| WP-B3 | CI gates and tooling | todo | — | B-09, B-10, B-11 |  |  |  |  |
| WP-B4 | One source of truth, legacy auth, spec corrections | todo | WP-A6, WP-A7 | B-12, B-13, B-14, B-15, B-16, B-17 |  |  |  |  |
| WP-B5 | Sheet payload, server-side grouping, query and API hygiene | todo | WP-B2, WP-B4 | B-18, B-19, B-20, B-21 |  |  |  |  |
| WP-B6 | Parse performance | todo | WP-A8 | B-22, B-23, B-24 |  |  |  |  |
| WP-C1 | BoQ workspace layout and keyboard | todo | — | C-01, C-02, C-03, C-04, C-05 |  |  |  |  |
| WP-C2 | Sheet power features | todo | WP-C1, WP-B4, WP-A10 | C-06, C-07, C-08, C-09 |  |  |  |  |
| WP-C3 | Traceability, review and change report | todo | WP-A2, WP-B5 | C-10, C-11, C-12, C-13, C-14 |  |  |  |  |
| WP-C4 | Questions and decisions | todo | WP-A5, WP-A6 | C-15, C-16, C-17, C-18, C-19, C-20 |  |  |  |  |
| WP-C5 | An Excel the firm can send | todo | WP-A8, WP-B3 | C-21, C-22, C-23, C-24 |  |  |  |  |
| WP-C6 | The public share page | todo | WP-C1 | C-25, C-26, C-27 |  |  |  |  |
| WP-C7 | Sign-up, onboarding and invitations | todo | — | C-28, C-29, C-30, C-31, C-32, C-33 |  |  |  |  |
| WP-C8 | Setup wizard, sample project and example presets | todo | — | C-42, C-34, C-35, C-36, C-37 |  |  |  |  |
| WP-C9 | Models and uploads | todo | WP-A8, WP-A10 | C-38, C-39, C-40, C-41 |  |  |  |  |
| WP-C10 | Billing copy, limits, units note, suspended orgs | todo | — | C-43, C-44, C-45, C-46 |  |  |  |  |
| WP-C11 | Navigation, notifications and dashboard | todo | — | C-47, C-48, C-49, C-50, C-51 |  |  |  |  |
| WP-C12 | Design system and accessibility | todo | WP-B2 | C-52, C-53, C-54, C-55, C-56, C-57, C-58, C-59 |  |  |  |  |
| WP-D1 | Accuracy validation and measuring depth I | todo | WP-B1 | D-01, D-02, D-03, D-04, D-05 |  |  |  |  |
| WP-D2 | Names at scale and languages | todo | WP-C4, WP-B2, WP-A7, WP-A8 | D-06, D-07, D-08, D-09 |  |  |  |  |
| WP-D3 | Accounts: legal, help, sessions | todo | — | D-10, D-11, D-12, D-13, D-14 |  |  |  |  |
| WP-D4 | Billing core behind a payment-provider interface (stub) | todo | — | D-15, D-16, D-17, D-18, D-19 |  |  |  |  |
| WP-D5 | Seats, revenue, usage and pilot measures | todo | WP-D4 | D-20, D-21, D-22, D-23 |  |  |  |  |
| WP-D6 | Team governance I: answers, audit, library visibility, publish approval | todo | WP-A11 | D-24, D-25, D-26, D-27 |  |  |  |  |
| WP-D7 | Team governance II: approval policy, preset policy, team view, staffing | todo | WP-A11, WP-B4, WP-C8 | D-28, D-29, D-30, D-31 |  |  |  |  |
| WP-D8 | Models, runs and library depth | todo | WP-C9, WP-A11, WP-B4 | D-32, D-33, D-34, D-35, D-36 |  |  |  |  |
| WP-D9 | Work beyond the model | todo | WP-A7, WP-C8 | D-37, D-38, D-39 |  |  |  |  |
| WP-D10 | Export formats | todo | WP-C5 | D-40, D-41 |  |  |  |  |
| WP-D11 | Engine measuring depth II | todo | WP-B6, WP-D1 | D-42, D-43, D-44, D-45, D-46 |  |  |  |  |
| WP-D12 | Security features | todo | WP-A9, WP-D7, WP-B4 | D-47, D-48, D-49, D-50, D-51 |  |  |  |  |
| WP-D13 | Federation alignment, CDE pull, viewer depth | todo | WP-A5, WP-B5, WP-C1, WP-C9, WP-C12 | D-52, D-53, D-54, D-55 |  |  |  |  |
| WP-D14 | Platform operations | todo | WP-D3, WP-D4 | D-56, D-57, D-58, D-59 |  |  |  |  |
| WP-D15 | Pricing module I: rate library, pricebooks and estimates | todo | WP-C5, WP-D14 | D-60, D-61 |  |  |  |  |
| WP-D16 | Pricing module II: vendors and offer requests | todo | WP-D15 | D-62, D-63 |  |  |  |  |

## Baseline differences log

One row per difference reported by `compare-baseline` or `verify-quantities` at an exit check.

| Date | Package | Item | Run(s) | What changed | Intended / regression | Baseline recaptured in commit |
|---|---|---|---|---|---|---|

## New items discovered

Problems found while working. Each becomes an item in a later package (never a silent scope change).

| Id | Found in (package/item) | Problem | Proposed item / package | Status |
|---|---|---|---|---|
