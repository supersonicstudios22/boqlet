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

State after WP-A1 (2026-11-23, baseline recaptured): `compare-baseline` 0 differences in 47 runs on the new baseline; `verify-quantities` 26 OK / 4 KNOWN, exit 0 with `--strict` (KNOWN: S04-footing-formwork, S05-beam-mass, S05-partywall-area, S05-partywall-line).

State after WP-A2 (2026-11-23, baseline recaptured): `compare-baseline` 0 differences in 47 runs on the new baseline; `verify-quantities` 26 OK / 4 KNOWN, exit 0 with `--strict` (unchanged: WP-A2 moves no quantity).

State after WP-A3 (2026-11-24, baseline recaptured): `compare-baseline` on the new baseline from run 20261124-091847; `verify-quantities` 29 OK / 1 KNOWN, exit 0 with `--strict` (KNOWN: S05-beam-mass).

## Tracker

| Package | Title | Status | Prerequisites | Items | Session date | Commits | Baseline changes | Notes |
|---|---|---|---|---|---|---|---|---|
| WP-A1 | Reported quantities vs geometry (the ×1000 and ×2 slab errors) | done | — | A-01, A-02, A-03, A-04 | 2026-11-23 | 827a9a7 (A-01), 1b68da9 (A-02), e3a62c1 (A-03), 48bc72d (A-04), and the exit-check commit (baseline, verify-quantities, this row) | S07, S08, S09, S11, F01 runs (both layers) move as intended; S05, F02 only gain question params; see the log below | Entry check green (S12 differs only with `--parse-cache`, DEC-06). Exit check: `npm run test`, `build:app`, `bundle:check` green; `mvn verify` with the CI variables green (questions/library scenarios also run targeted after A-04); full compare-baseline (both layers, after `local:up`) differences all intended; baseline recaptured from that run (identical code and writer to `--capture`; a fresh re-run of S05/S08/S09/S11 on both layers then gave 0 differences); `verify-quantities` S09-slab-area, S09-floor-volume, S08-pilecap-area, S08-pilecap-edge-formwork FIXED and their KNOWN entries removed (26 OK / 4 KNOWN, `--strict` exit 0); `check-blueprint.py` OK (its PROGRESS check now accepts every documented status). Acceptance: S09 146.199 / 80.26 m², 13.24 m³, both S09 volume questions recommend the geometry with the same ids; S07 slab areas = volume ÷ thickness (1,089.86 m²; the blueprint's "≈ 1,077" was approximate), S08 within 0.3 % (413.27 vs 414.47 m²; "≈ 402"); pile cap 14.44 m², edge formwork 15.20 m²; S07 landing and S08 pile-cap thickness block with geometry recommended; S05 party wall stays optional; thresholds editable in the Library and honoured by a run (scenario). Decisions: D71–D73 in docs/decisions.md; judgement calls DEC-77…DEC-82 in BLUEPRINT.md §3.6 (999× is a unit error; Width-exceeds-plan only for clear plates; `suggestion` = what is used; resolution.json not edited; resolution drafts checked + `id`/`name` fix; one recapture per package). No Duplex (HAND_BOQ) change. |
| WP-A2 | Flags, decisions and plausibility | done | WP-A1 | A-05, A-06, A-07, A-08 | 2026-11-23 | 908502e (A-05), 0bc104c (A-06), 52dfa86 + 380a6ba + 8a368d8 (A-07), d8c20cc (A-08), and the exit-check commit | No quantity or status change in any run; lines to confirm, decisions count, implausible and unhosted_opening warnings; see the log below | Entry check green (0 differences on the WP-A1 baseline). Exit check: `npm run test`, `build:app`, `bundle:check`, `api:check`, `api:lint` (3 warnings, all older than this work) green; `mvn verify` with the CI variables: every class green except one timeout, `duplex.test.ts`'s setup hook (400 s), while the machine was suspended (the log is silent 16:49-18:28, then resumes); re-run once targeted (DEC-07, `BOQLET_SCENARIO_FILTER=duplex`): green, so the exit check is green; full compare-baseline twice (both layers after `local:up`): the first run found an S10 false positive (fixed in 8a368d8), the second only intended differences; baseline recaptured from it (no code change since; a fresh run of S05, S09, S10, S12 on both layers then 0 differences); `verify-quantities` 26 OK / 4 KNOWN, `--strict` exit 0; `check-blueprint.py` OK. Acceptance: S09 "Wall, Wall-Ext…" 2 of 3 measured in sheet and Excel; Duplex with both party-wall answers: `decisionsApplied` 2, both named on the line with author and date, Excel "Decisions applied 2"; S07 warnings on Pad 2 and the 600 mm piles, S03/S05 none; Duplex v2 warns on window 1FM6kRbt1Q98O7nMvcxWi0, v1 none. Found and fixed on the way: Java could not read `TraceDecision.answer` (schema `{}` now); public share lines leaked the trace decisions (BR-56; stripped) and every element gained `"decisions": []` (`@JsonInclude(NON_EMPTY)` at build); `schema.d.ts` was not regenerated after A-07 (380a6ba). Decisions D74, D75 (docs/decisions.md), contract changes C20, C21; judgement calls DEC-83…DEC-86 (BLUEPRINT.md §3.6). No Duplex (HAND_BOQ) change. |
| WP-A3 | Measurement defaults: walls, finishes, reveals, formwork | done | WP-A2 | A-09, A-10, A-11, A-12, A-13 | 2026-11-23, 2026-11-24 | 729a785 (A-09), 7dab399 (A-10), 5d2220f (A-11), ef6a3d0 (A-12), c6b1ea5 (A-13), 91626f4 (A-11 follow-ups), 1d34d6b (system presets sync), and the exit-check commit (baseline, this row) | Party wall +7.16 m2, paint per face, footing formwork from the vertical faces, walls by their faces on S04/S07/S08/S09/S10/F01, S03 paint on the plumbing wall; every run gains `vertical_face_area`, `perimeter_outer`/`perimeter_openings` and face `layer_material` fields; see the log below | **Session 1 (2026-11-23):** A-09..A-11 (notes in their commits; D76-D78, DEC-87..89). **Session 2 (2026-11-24):** Docker up, `local:up`, samples verified; entry state = session 1's (Duplex green). **A-12** reveals move to the finish (D79, DEC-35, DEC-90): `addReveals` adds one face's reveals at half the opening depth, so `both` counts each once (ENG-023); as-modelled drops `wall_add_reveals`, `paint-walls` takes `finish_add_reveals` (off); standard-style turns it on. The blueprint's "standard-style wall areas lose reveals" could not happen: standard-style replaces `walls` by `wall-layers`, which never had `addReveals` (no baseline run had a reveal step); S05-standard paint gains 31.14 m2 of reveals instead. **A-13** `perimeter_outer` / `perimeter_openings` (D80, DEC-91); the slab-edge choices do what they say; default unchanged in number. **Exit check** found three problems, fixed in this package: (1) F02 paint 2.56 m2: federation rebuilt room faces without `layer_material` (A-11 regression, `keep_face_layers`); (2) S03-standard/house lost the plumbing wall's paint: a one-material wall now carries it on both faces; (3) **system presets never left the V5 seed**, so A-10..A-13 never reached the stack (its first run had only A-09): new repeatable migration `R__Sync_system_presets` publishes changed presets as new versions, children re-pointed, pinned versions untouched (D81, DEC-92, `SystemPresetSyncTest`); on booqlet.com the first deploy publishes as-modelled v2 and the four rule sets built on it. Exit check: `npm run test` (409 app, 349 engine), `build:app`, `api:check` green; `mvn verify` with the CI variables: every class green except `sharedScenariosPassAgainstJava`, whose federation check counted paint's two faces of one wall twice (fixed: keyed by part, as `test_federation`) and whose F08-AC4 change-report timing took 4.9 s (3 s budget); re-run once targeted (DEC-07, `BOQLET_SCENARIO_FILTER=federation,model-versions`): green; full compare-baseline twice (both layers, `local:up` before each stack layer): every line difference intended (log below), outcomes and statuses unchanged, no question added or removed; baseline recaptured from the second run 20261124-091847; `verify-quantities --strict` 29 OK / 1 KNOWN (S05-beam-mass, WP-A4); `check-blueprint.py` OK. No `HAND_BOQ` change in session 2 (session 1 changed it in A-09, A-10, A-11). |
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
| 2026-11-24 | WP-A3 | A-09 | S05-*, F02 (both layers); S04, S07-*, S08, S09-*, S10, F01-* | Walls by their measured faces: Duplex party wall 71.67 -> 78.83 m2 (`HAND_BOQ` re-derived in A-09); S07 SIP 108.69 -> 118.28, partitions 182.1 -> 190.98, CL_W1 (S08) 321.76 -> 325.91, S10 2,094.35 -> 2,074.80, S04 and S09 walls +0.1-0.9 %; standard-style `wall-layers` and `formwork-walls` follow | intended | exit-check commit (from the full run 20261124-091847) |
| 2026-11-24 | WP-A3 | A-10 | every run with footings (both layers) | Footing formwork from the vertical faces less contacts: Duplex 37.02 -> 36.19 m2 (house 38.87 -> 38.00), S04 ring 3.72 -> 15.15, S07/S08/F01 33.72 -> 32.76; new `vertical_face_area` field | intended | exit-check commit |
| 2026-11-24 | WP-A3 | A-11 | every run with plasterboard (both layers) | Paint per face by the walls' opening rule: S05 703.19 -> 712.68, tweaked 720.14, S07/F01 670.30 -> 697.75; standard-style/house: the derived `paint-walls | wall-layers | ...` lines become one item line (S05 745.44 house, 743.82 standard incl. A-12 reveals; S07 730.07); S03-* gain the plumbing wall's paint 13.73 m2 (both faces, follow-up fix); line counts drop by 3-4 where several derived lines merged; new `mixed_line` warning on the paint line in demo-trades runs (map rule `drywall` reads `element_type`; classification only, N-11); face `layer_material` in every result | intended | exit-check commit |
| 2026-11-24 | WP-A3 | A-12 | S05-standard, S05-house, S05-duplexproject, S07-standard/house, F01-house, S03-standard/house | Reveals on the paint (standard-style turns `finish_add_reveals` on): S05-standard +31.14 m2; no wall area changes (standard-style's walls never had reveals, DEC-90); Inputs sheet: `wall_add_reveals` row replaced by `finish_add_reveals` | intended | exit-check commit |
| 2026-11-24 | WP-A3 | A-13 | every run with slabs | No quantity change (the default is outer + openings, the old number); new `perimeter_outer`, `perimeter_openings` fields; Inputs sheet slab-edge formula text | intended | exit-check commit |
| 2026-11-23 | WP-A2 | A-05 | every run with an open contradiction or a partly measured line (S05-*, F02, S07-*, S08, S09-*, S10, F01-*, stack S12; both layers) | Lines gain `toConfirm` (S09 "Wall, Wall-Ext…" `{measured: 2, elements: 3}`; S10 three lines partly measured; S12 two; lines fed by the S05 party wall, the S07/S08 slab and wall contradictions and the S09 unit errors with their question ids); `stats.flaggedLines` rises accordingly (S05 3 → 5, S07 3 → 12, S08 3 → 9, S09 4 → 9, S10 3 → 6, F01 3 → 15); Excel yellow fills and "To confirm: …" notes. No quantity changes | intended | exit-check commit (from the full run 20261123-160328) |
| 2026-11-23 | WP-A2 | A-06 | runs whose elements carry answered contradictions or missing values | None in the baseline (its runs have no decisions); `decisionsApplied` stays 0 everywhere | intended | exit-check commit (from the full run 20261123-160328) |
| 2026-11-23 | WP-A2 | A-07 | S07-*, S08-default, F01-* (both layers) | `implausible` warnings: S07 Pad 2 (name), 600 mm piles (thickness and name), 600×600 caps (name); S08 piles, 3800×3800, 600×600 and 400×400 caps; log entries `log.measure.plausibility`; Excel Questions sheet rows. S03, S05, S09, S10 none (after 8a368d8) | intended | exit-check commit (from the full run 20261123-160328) |
| 2026-11-23 | WP-A2 | A-08 | S07-*, F01-*, S10-default (both layers) | `unhosted_opening` warnings: S07 two pocket sliding doors and two skylights; S10 all 205 doors and 259 windows (the file has no IfcOpeningElement or IfcRelFillsElement at all), each naming its nearest wall | intended | exit-check commit (from the full run 20261123-160328) |
| 2026-11-23 | WP-A1 | A-01 | S09-default/house/standard/tweaked (engine, stack) | Slab areas ÷1000: "Floor-Grnd-Susp…" 146,199.06 → 146.20 m², "Simple floor" 80,262.86 → 80.26 m² (`BaseQuantities.GrossArea` now read); building footprint 146.20, gross floor area 226.46 m², gross volume 443.77 m³ | intended | exit-check commit (from the full run 20261123-133212) |
| 2026-11-23 | WP-A1 | A-01 | S11-default (engine, stack) | Wall "AR | Wand | KS 2,0 20 | EPS+PERI 420 x 3040": thickness 4,490.571 mm (smallest extent of the sample's broken mesh) → 420 mm (`BaseQuantities.Width`, a newly listed thickness source), area 1.49 → 15.88 m² (file NetSideArea 16.75); line description follows. Not in the blueprint's expected list: an effect of the A-01 source audit, checked by hand | intended | exit-check commit (from the full run 20261123-133212) |
| 2026-11-23 | WP-A1 | A-02 | S09-* (engine, stack) | "In-situ concrete, Simple floor" 13,243.37 → 13.24 m³; S09-house/standard rebar estimate 1,324.34 → 1.32 t; both `contradiction:volume:IfcSlab:*` questions: suggestion reported → geometry, recommended option flips, params `used`/`unitError`/`scale`; slab lines gain the unit-error note | intended | exit-check commit (from the full run 20261123-133212) |
| 2026-11-23 | WP-A1 | A-02 | every run with a contradiction (S05-*, F02, S07-*, S08, F01-*, both layers) | Question shape only: params `used`, `unitError`, `scale` added; the non-recommended option gets an explicit `recommended: false`. No number changes | intended | exit-check commit (from the full run 20261123-133212) |
| 2026-11-23 | WP-A1 | A-03 | S07-*, S08-default, F01-* (engine, stack) | Slab areas from ×2.2–2.5 to volume ÷ thickness (S07 Pad 2 921.16 → 436.76, Generic 150mm 257.72 → 123.91, Warm Roof 153.61 → 70.79, piles "600mm Diameter" 63.78 → 0.78 m² …; S08 pile cap 44.08 → 14.44, Insitu Concrete 327.6 → 143.78 …); edge formwork: 3800×3800 cap 57.76 → 15.20, 600×600 caps halved (0.6 → 0.3 m thick); new questions `contradiction:area:IfcSlab:{Pad 2, Warm Roof - Timber, Monolithic Landing:220mm Thickness}`; thickness questions on slabs suggest geometry; building values follow | intended | exit-check commit (from the full run 20261123-133212) |
| 2026-11-23 | WP-A1 | A-04 | S07-*, S08-default, F01-* (engine, stack) | Blocking: S07 area questions (Pad 2 −53 %, Warm Roof +976 %, landing +1,938 %) and the landing thickness (−95 %); S08/F01 3800×3800 pile-cap thickness (−74 %). The 600×600 caps (exactly −50 %) stay optional. Run statuses unchanged (already needs_input) | intended | exit-check commit (from the full run 20261123-133212) |

## New items discovered

Problems found while working. Each becomes an item in a later package (never a silent scope change).

| Id | Found in (package/item) | Problem | Proposed item / package | Status |
|---|---|---|---|---|
| N-01 | WP-A1 A-04 | Federation settings drafts are never checked before publishing (`Library.java` CHECKS has no FEDERATION; `presets.check` has no federation branch); a bad draft is only caught when a run's worker validates it | A check like A-04's for resolution; WP-D8 (Library depth) or WP-B4 | open |
| N-02 | WP-A1 A-03 | A reported `Gross*` area is adopted as the element's **net** area (it is used when no `Net*` exists), so an element with hosted openings gets gross_area = gross + openings. No sample has such a slab (checked); the cross-check already compares a gross source with the sides plus openings | Adopt net = gross − openings for a `Gross*` source; WP-A3 (measurement defaults) | open |
| N-03 | WP-A1 A-04 | One element can raise two blocking questions with one cause: S07's landing has `contradiction:thickness` (Width 6.0 m vs 0.294 m) and `contradiction:area` (GrossArea 0.58 = volume ÷ that Width vs 11.85 m²); answering one does not settle the other | Group or suppress the derived question; WP-C4 (questions in plain words, C-15/C-20) | open |
| N-04 | WP-A1 exit check | `compare_baseline.py` stops listing a run's differences at 400 (`diff(..., limit=400)`), so differences.txt hides the rest of a large change (S07/S08/F01 here, reviewed with a separate line/question diff) | Report the count beyond the cap and add a line/question summary per run; WP-B3 (tooling) or B-04 | open |
| N-05 | WP-A1 A-02 | CLAUDE.md's docs map says decisions "P01–P53" while docs/decisions.md has P54–P57 (stale count; the D range was updated by this package) | B-17 (spec corrections that need no code) | open |
| N-06 | WP-A2 A-08 | A model with no openings at all gets one `unhosted_opening` warning per door and window (S10: 464), which buries the other warnings | Group them per model ("464 doors and windows fill no opening; this model has no openings"); WP-C4 or WP-C11 | open |
| N-07 | WP-A2 A-05 | The public share page drops `toConfirm` (its line builder keeps a fixed field list), so a client never sees that a line is to confirm | Show a neutral "to confirm" mark without the question ids; WP-C6 (C-26 status marks) | open |
| N-08 | WP-A2 A-06 | Name (`unknown_name`) and `unmatched` answers are counted in `decisionsApplied` but not named on the trace elements they moved (known-limitations row "Decisions on the trace") | Name the decision layer's entries per element; WP-C3 (C-10 measured inputs) | open |
| N-09 | WP-A3 A-10 | A footing against another model's wall or slab (federation) keeps that face in its formwork: `verticalFaces` contact is found within one file only | Contact across models from the mesh sidecar, as rooms and shared volumes do; WP-A5 (federation) | open |
| N-10 | WP-A4 (planning A-14) | The seed dictionary resolves "Concrete Masonry, Floor Block" (S09) and "Concrete Masonry Units" (S05, S07) to `concrete`: `rx-concrete` matches before `rx-block`, so block layers count as concrete (in-situ concrete, formwork and rebar estimates select them) | A block entry ahead of `rx-concrete` ("concrete masonry", "CMU", "block"); moves Duplex wall materials, so it needs its own `HAND_BOQ` review; WP-D2 (names) or a Phase A follow-up | open |
| N-11 | WP-A3 exit check | demo-trades' map rule `drywall` reads `element_type`, but as-modelled's paint item (A-11) is one line over all wall types, so demo-trades runs get a `mixed_line` warning on the paint line | Split the paint line by `element_type` (lineKey) or let the map rule read the face's wall type; WP-C5 (C-23) or WP-B4 | open |
