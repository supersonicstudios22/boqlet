# 02 — Product review (Product manager persona)

Reviewer: product manager persona (10+ years B2B SaaS, construction tech / BIM). Written 2026-11-23 on
`main` at `3868013`, against the shared local Docker stack. Hands-on with a brand-new account
(`pm-new@review.test`, org "Petra Design Studio", Free plan) and the platform admin account
(`pm-admin@review.test`). Scripts: `docs/review/_scratch/prd/*.mjs` (driver `run.mjs`). Screenshots:
`docs/review/_screenshots/prd/`. Market claims cite URLs; prices for competitors come from third-party
listings and are marked as unverified where the vendor publishes none.

---

## 1. Verdict

boqlet solves a real and under-served problem — turning IFC models into a *traceable, firm-specific*
Bill of Quantities in a browser — and its core idea (measuring rules, codes and names as versioned data
the firm owns, with every number explained down to the element) is a genuine differentiator against
CostX, Autodesk Takeoff, Solibri and Excel. The machinery is fast and the "explain every number" loop
works: a 2.2 MB model parsed in 10.8 s and generated a BoQ in 1 s, with a per-element Calculation sheet
in the Excel. It is **not ready for a self-serve or paid launch**. The first BoQ a new customer gets
from a public Revit sample shows a 146,199 m² slab and 68,714 m³ of concrete on a small house, labelled
"measured" and "COMPLETE"; the required setup wizard delivers nothing on a first run; the only
self-serve entry (Free, one seat, no trial, every price "on request", no way to pay) cannot show a firm
what it would buy; and the stated first market (design-led DACH/CEE) cannot use an Excel-only tender
BoQ. Fix trust on the first BoQ, move the wizard after first value, and give buyers a trial and a path
to pay before opening sign-up. Then validate Q1/Q2 with pilots before building more scope.

---

## 2. What works (keep and reinforce)

| # | What | Evidence |
|---|---|---|
| W1 | **Engine speed at small/mid size.** S09 (2.2 MB IFC4 Revit) parsed in 10.8 s; BoQ "generated in 1 second"; regenerate ~5 s; Excel export ~8 s. Baseline S05 Duplex parses in 4.4 s, S10 (65 MB) in 67 s. Compute is not what makes time-to-value slow. | `_screenshots/prd/16-model-uploaded.png` ("PROCESSING TIME 10.8 s"), `18-first-boq.png` ("generated in 1 second"); `docs/review/00-context.md` §8 |
| W2 | **Input-check report after upload** is the best "first value" moment in the product: schema, authoring tool, element and class counts, checks (overlaps, reported vs geometry volume, open geometry) each with "Show in 3D", storeys, names the dictionaries don't understand, and a direct "Generate a BoQ" button. No competitor I checked tells a designer this much about their export before a takeoff. | `16-model-uploaded.png`; route `…/models/{m}/versions/{v}` |
| W3 | **Sheet and model side by side** with source / storey / family filters, coverage colouring (measured / covered by parent / excluded) and the plain "This BoQ contains what the models contain…" notice (P15). This is the "trust every number" promise made visible. | `18-first-boq.png` |
| W4 | **Traceability carried into Excel**: the workbook has a `Calculation` sheet (formula, parameters, every element's contribution with GUID), `Inputs` (rule set chain, dictionaries, counts), `Questions`, live Amount formulas and a yellow Rate column. Reviewers can audit a line without the app. | `docs/review/_scratch/prd/first-boq.xlsx` (sheets Cover, BoQ, _boqlet, Calculation, Lines, Log, Questions, Inputs) |
| W5 | **Question workflow**: name questions with a hierarchical term picker ("Aluminium › Metal"), multi-select "Apply same answer", "Also add name answers to the project dictionary" on by default, and a banner "6 answers not applied yet – Generate again". Answers persisted as project decisions (`POST /projects/{p}/decisions` 200). | `19-questions.png`, `21-after-answers.png`, output of `s13-answer.mjs` |
| W6 | **Share dialog** is well thought out for the client persona: pin "this version as it is now" vs "always the latest saved version", choose what is included (sheet, explanations, 3D, log, Excel download), expiry, revoke. | `35-share-dialog.png` |
| W7 | **Plans as data with honest enforcement.** Every limit is a row the admin edits; the API answers `402 limit_reached` with `{limit, current, max}`; the dialog names the limit ("Active projects: 1 of 1 in use"); limit hits are stored as `limit_events` and shown in the admin org page. | API log in `s15-limits.mjs` output; `24-limit-second-project.png`; `services/api/src/main/java/com/boqlet/api/billing/LimitAlerts.java:39-46`; `31-admin-org-detail.png` |
| W8 | **Admin console for a sales-led pilot**: org detail (plan, trial date, entitlements, members with last activity, counts, setup state, usage by month, limit events, notes, tags), org list signals ("Hit a limit", "Trial ends in 7 days", "Stuck in setup"), a plan editor with an **impact preview** ("Seats: 5 organisations would be over the new limit"), and an activation funnel with "Stuck here" lists. | `30-admin_admin_orgs.png`, `31-admin-org-detail.png`, `32-admin-plan-edit.png`, `30-admin_admin_funnel.png` |
| W9 | **Usage page** shows processing minutes by project and by kind against the plan. | `27-_settings_usage.png` |
| W10 | **Product principles are the moat and are kept in code**: rules / classifications / dictionaries are data (`presets/`, Library editors), classification never changes a number, nothing silently dropped, deterministic question ids, Duplex acceptance test reproduces a hand BoQ exactly. These are what a BIM-literate buyer cannot get from Revit schedules or a generic takeoff tool. | `CLAUDE.md` rules 1–9; `engine/tests/test_duplex.py`; `docs/review/00-context.md` §4 (265 engine tests green) |

---

## 3. Findings

Severity: critical / high / medium / low. Confidence: high / medium / low. Details follow the table.

| ID | Title | Category | Severity | Confidence | Evidence | Impact | Recommendation |
|---|---|---|---|---|---|---|---|
| PRD-001 | First BoQ from a public Revit sample shows quantities 1000× too large, labelled "measured" and the BoQ "COMPLETE" | launch-readiness | critical | high | `18-first-boq.png`; `docs/review/baseline/engine/S09-default/lines.json`; details below | Destroys trust in the first session; a firm that sends this Excel loses credibility with its client | Unit-scale sanity check that blocks; recommend geometry when reported ≈ 1000× geometry; never "COMPLETE" with an open magnitude contradiction |
| PRD-002 | Required setup wizard gives no value on first run (no model, no sample, one-click no-op) and gates the dashboard | onboarding / spec-issue | high | high | `07-setup-wizard-start.png`, `10-wizard-00…03.png`; F16 §"When it appears"; P18 | Adds a mandatory step before first value that produces an "As modelled" clone and two empty drafts | Let the user reach a first BoQ first (sample or own model), then offer the wizard on that model; make it optional |
| PRD-003 | Free is the only self-serve entry and cannot sell the product: 1 seat, no approval, no trial, all prices "Price on request", "Choose" → dead end | monetisation / pricing-and-plans | high | high | `28-billing-checkout-attempt.png`; `BillingController.java:52-56`; `settings.json:127` | When sign-up opens, interested firms cannot evaluate collaboration or pay; upgrade intent is lost | Time-boxed Team trial on sign-up; "Request upgrade" that notifies the operator; real prices or "from €x" before opening sign-up |
| PRD-004 | Trial and downgrade logic not built: a "trial" is only a date and status label; nothing reverts; orgs already sit over their limits | pricing-and-plans | high | high | `AdminOrganisations.java:134-140`; `30-admin_admin_orgs.png` ("S3B Wizard Errors free 2 / 1" seats); plans-and-limits "Not built" | Manual trials will leak paid features forever or be forgotten; no predictable downgrade behaviour to communicate to customers | Trial = temporary plan with end date and a daily job; downgrade rules (read-only excess projects, invite block) with in-app notices |
| PRD-005 | Primary market is design-led DACH/CEE, but the only output is Excel: no GAEB / ÖNORM, no standard-text libraries | spec-issue / competitive | high | high | `docs/product/personas.md` ("v1 is designed for design-led markets first", DACH listed first); known-limitations "Export: Excel only"; competitor AVA tools (§4) | The firms named as first customers produce tenders in GAEB/ÖNORM through AVA software; an Excel BoQ is a side input for them | Either pick a first market where Excel is the tender format (QS-led UK/IE/AU, Balkans, Middle East) or put GAEB DA XML 3.3 / ÖNORM A 2063 export on the critical path |
| PRD-006 | Names are the main blocker and the vocabulary is tiny: 56 terms, common English Revit names ("Laminate", "Damp-proofing", "Air") block; no AI or bSDD | feature-gap | high | high | `presets/dictionaries/global-seed.json` (56 terms, 68 entries); `s13-answer.mjs` output (no term for "laminate", "melamine", "plastic", "damp"); known-limitations "Multi-language names" | Every real model starts in "needs input"; non-English models much worse (Dutch in S10). Time-to-value and the "minutes not days" claim depend on it | Treat Q8 as roadmap #1 after trust: bigger seed per language, bSDD lookup, AI suggestion with confirmation; non-blocking "unspecified" for placeholders like "Air"/"Default" |
| PRD-007 | Accuracy never validated against a professional BoQ while the product claims O1/O3 "Built" and "minutes, not days" | launch-readiness / spec-issue | high | high | `docs/product/known-limitations.md:18` ("the biggest open question"); overview O1/O3 "Built"; PRD-001 | Selling the outcome before proving it; first pilots become the QA | Before any paid pilot: 2–3 reference projects with a QS BoQ as answer key, publish a per-element-family accuracy table internally, gate marketing claims on it |
| PRD-008 | No takeoff for what is not modelled (2D/PDF), so firms still need a second tool | competitive | medium | high | P15 "What isn't in the models is the user's to add"; sheet only offers "Add line" (manual); CostX, Autodesk Takeoff, Kreo do 2D + 3D (§4) | A design-stage tender BoQ is often 30–50% non-modelled work (finishes, preliminaries, MEP details) [prior knowledge, unverified]; boqlet becomes the 3D half of a two-tool workflow | Keep the model focus but make manual lines first-class: quantities from other lines (derived formulas already exist), import of an Excel/CSV block, item templates per firm; later a PDF measure tool or integration |
| PRD-009 | Developer demo presets shown to real customers ("ACME Ltd house rules", "Demo: small custom rule set", "Demo: as modelled, two slots changed", "ACME cost codes", "Demo: trade sections") | launch-readiness | medium | high | `07-setup-wizard-start.png`; `17-generate-clicked.png`; `presets/rules/*.json`, `presets/classifications/` | Looks unfinished; invites customers to build on fake standards; "slots" jargon | Ship only "As modelled" and neutral, documented examples as system presets; move ACME/Demo to a test seed |
| PRD-010 | Admin plan editor shows the watermark feature inverted: "Excel without the watermark — Included" is ticked for Free, which has `exportWatermark: true` | pricing-and-plans | medium | high | `32-admin-plan-edit.png`; `apps/app/src/features/admin/plans.tsx:243-246` (`checked={entry}`); `apps/app/messages/en/errors.json:11` (`exportWatermark {Excel without the watermark}`) | An operator unticking it to "remove a feature" would remove the watermark from Free, or add it to paid plans | Label the key by its value ("Watermark on exports") or invert the binding; same in the limit dialog |
| PRD-011 | "Paying organisations" counts any org not on the plan id `free`, with no payment and no price | pricing-and-plans / spec-issue | medium | high | `services/api/src/main/java/com/boqlet/api/admin/AdminReports.java:74` (`plan_id <> 'free'`); `30-admin_admin.png` ("PAYING ORGANISATIONS 26", "REVENUE —") | Operator sees 26 "paying" orgs that are test or comped orgs; breaks if the admin makes another plan the default (P57) | Rename to "Orgs on a paid plan"; derive from the default/price flag, not a hard-coded id; add "comped" status |
| PRD-012 | The Excel handed to clients mixes internal working: line keys, rule-set version UUID chain, 220-row engine Log, Questions | flow | medium | high | `first-boq.xlsx` BoQ!A2 ("Rules: … (version-9d493c18-… -> petra-design-studio-rules)"), "Line key" column, `Log` (220 rows), `Questions` sheets | A tender BoQ sent to contractors exposes internal ids and modelling problems; firms will strip it by hand every time | Two export profiles: "Issue" (Cover, BoQ, optional Calculation) and "Working" (everything); hide keys in a hidden sheet only |
| PRD-013 | Limits UX is reactive: forms that always fail on Free, no alternatives in the limit dialog, "Manage billing" does nothing | pricing-and-plans | medium | high | `33-members-free.png`/`34-invite-on-free.png` (Invite form visible, `402 seats 1/1`); `24-limit-second-project.png` (form filled, then 402); `BillingController.java:59-69` (portal echoes return URL) | Users do work then hit a wall; no "archive a project to free a slot" or plan comparison at the point of need | Show quota next to the action ("1 of 1 projects"), disable with an explanation, offer archive / request-upgrade in the dialog; hide "Manage billing" until a provider exists |
| PRD-014 | Sample project only on an empty dashboard, only after the wizard, never as the wizard's model; criterion 12 cannot be met as written | onboarding / spec-issue | medium | high | `apps/app/app/(app)/[org]/page.tsx:85-99` (`projects.data?.length === 0`); `26-dashboard-with-project.png` (no sample once a project exists); scope-and-acceptance criterion 12 "on the sample Duplex"; F16 status | The best learning asset disappears after the first own project; the acceptance criterion contradicts the built flow | Offer "Explore the sample" permanently (projects list, Library preview picker, wizard model); sample first in onboarding |
| PRD-015 | Question noise and misleading completion: "COMPLETE" with 4 unquantified lines and open contradictions; tab badge "6 questions to answer" counts 4 "not used by the current rules" items; "Air" is a blocking question | flow | medium | high | `s14-regen-export.mjs` dump ("COMPLETE", "QUESTIONS6 6 QUESTIONS TO ANSWER"); `19-questions.png` | Users can't tell done from not done; badges teach them to ignore questions | Split "must answer" / "worth checking" / "FYI"; badge only blocking + magnitude contradictions; rename COMPLETE to "No blocking questions" |
| PRD-016 | Imperial is offered in onboarding and project creation but does nothing | spec-issue / feature-gap | medium | high | `03-after-sign-in.png` (UNITS Metric/Imperial); known-limitations "project's unit system… no effect"; FM-14, FM-61 | US and part of UK/ME buyers get silent metric output after choosing imperial | Hide imperial until output supports it, or label "metric only for now" |
| PRD-017 | The pilot cannot answer its own questions: success measures mostly not instrumented | spec-issue | medium | high | `docs/product/overview.md` "How we know it's working" (3 of 6 "No"); funnel medians shown as "0 h" (`30-admin_admin_funnel.png`) | Q1/Q2 (will firms pay, are models good enough) stay unanswered after the pilot | Instrument: % lines measured vs flagged per run, questions per model version, time to re-saved version; funnel in minutes |
| PRD-018 | No in-product help, documentation, support contact, terms or privacy pages | launch-readiness | medium | high | `grep mailto:` in `apps/app` finds none; no help keys in `apps/app/messages/en`; checkout message "contact us" is plain text (`errors.json:63`); FM-04 | A self-serve user stuck in Questions or billing has nowhere to go; legal blocker for public sign-up | Help link + support email in the shell, a short "How boqlet measures" guide, terms/privacy acceptance at sign-up |
| PRD-019 | Pricing model not fit for the market evidence in the docs: pay-per-project entry point dropped, processing minutes unpredictable for buyers | spec-issue / pricing-and-plans | medium | medium | D50 ("pay-per-project as entry point"), conversation turn 63; `plans-and-limits.md` has no per-project plan; S06 (18 MB MEP) parses in ~9 min = 15% of Free's 60 min | Occasional users (bursty tender work) have no fitting plan; minutes are a cost metric, not a value metric | Price on seats + active projects; keep minutes as a fair-use cap hidden from plan cards; test a per-project pass |
| PRD-020 | Scope ahead of validation: pricing module, vendors, offer requests, four-eyes approval and live co-editing specified or built before Q1–Q3 are answered | simplification | medium | medium | `docs/product/open-questions.md` Q1–Q3 "after pilots"; F11/F17/F20 (~380 lines of spec); P31, P29 | Engineering spent on breadth while the core loop (trust, names, export format) has gaps | Freeze the pricing module; measure use of co-editing / approval in the pilot before more investment |
| PRD-021 | No rates at all in the core: the design-stage "cost check" job is unsupported until the whole pricing module ships | feature-gap | medium | medium | P32/P48 (pricing deferred); Excel has a Rate column only; personas "Ana… cost check" milestone | Design firms' most frequent BoQ use (cost plan at each stage) needs rates; competitors (CostX) link rate libraries | A simple firm rate library keyed by item code (no vendors) as a core or small-module feature |
| PRD-022 | After setting a password the user must sign in again | onboarding | low | high | `02-after-set-password.png` (lands on `/sign-in`) | One more step and a password retype in the first minute | Sign in automatically after set-password |
| PRD-023 | Onboarding form: address prefilled "000", currency and country are free-text boxes; "Au" was stored as AU (Australia) when Austria was meant | onboarding | low | high | `03-after-sign-in.png`; `/api/v1/me` → `"defaultCountry":"AU"` | Wrong country defaults without the user noticing | Pickers for currency and country; derive the address only from the name |
| PRD-024 | Copy promises what isn't built: "You can invite colleagues next" and "You can change them per project" | onboarding | low | high | `apps/app/messages/en/orgs.json:15`; `projects.json:61`; FM-05, FM-12 | Small trust leaks | Change the copy or build the step |
| PRD-025 | Small first-run friction: model is created then uploaded (two steps); project overview empty state has no buttons | flow | low | high | `14-models-empty.png`, `15-model-added.png`, `13-project-created.png` | Extra clicks on the critical path | Drop a file → create model + version; CTA buttons in empty states |
| PRD-026 | Free-plan watermark is one deletable cell ("Made with boqlet" in Cover!A19) | monetisation | low | high | `first-boq.xlsx` Cover!A19; `engine/ifc_boq/export_xlsx.py:259-260` | Not a reason to upgrade | Header/footer on every printed sheet and on share pages; or drop the lever and gate on seats |
| PRD-027 | Billing page shows "Price on request" even for Free, and lists only some limits | pricing-and-plans | low | high | `28-billing-checkout-attempt.png`; `settings.json:127` | Confusing; company presets per kind and audit history are limits buyers never see | Show "Free" for zero-priced plans; show every enforced limit |
| PRD-028 | Single active session plus a 5.3 s logo splash after each sign-in add friction to a daily work tool | simplification / spec-issue | low | medium | P22, P56 in `docs/decisions.md`; `apps/app/src/components/shell/splash.tsx` | People with a laptop and a site tablet are signed out; anti-sharing value unproven | Allow 2 devices per person; show the splash once per account, not per sign-in |

### Finding details

**PRD-001 — 1000× quantities on the first BoQ.** Steps: new account → org → wizard (suggested answers)
→ project → upload `docs/review/_samples/S09-samplehouse-ifc4.ifc` (Revit 2015, IFC4, a single-storey
sample house) → "Generate a BoQ" with defaults. The sheet shows:

| Line | Quantity shown | Plausible |
|---|---|---|
| Slab, Floor-Grnd-Susp_65Scr-80Ins-100Blk-75PC | **146,199.06 m²** | ~150 m² |
| Slab, Simple floor (roof) | **80,262.86 m²** | ~80 m² |
| In-situ concrete, Floor-Grnd-Susp… (after answering "Damp-proofing") | **68,713.56 m³** | 68.7 m³ |
| In-situ concrete, Simple floor | **13,243.37 m³** | 13.2 m³ |

Same numbers in the engine baseline (`docs/review/baseline/engine/S09-default/lines.json`), so this is
the engine, not the stack. The trace says `area (top) = 146199.0563`, source "measured". The engine
*does* notice the volume difference (question `contradiction:volume:IfcSlab:…`: "68713.556 m3 from
BaseQuantities.GrossVolume vs 68.714 m3 measured", displayed as "disagree by -100%"), but the question
is non-blocking ("INFO"), its **recommended answer is "Use the volume stated in the file"** (the wrong
one), and there is no question at all about the area. After the names are answered the header says
**COMPLETE** and the exported Excel carries the numbers (`first-boq.xlsx` BoQ rows 10–13). A 1000×
ratio is a unit-scale error (mm vs m), not a modelling difference; the QS reviewer should confirm the
root cause, but from a product standpoint this is the worst possible first impression and directly
contradicts O3 "Trust every number". Screenshots: `18-first-boq.png`, `19-questions.png`.

**PRD-002 — The required wizard on a first run.** The wizard is the first screen after creating the
org and every org page except settings redirects to it (P18, P54 Q57). On a new org:
"Model to try it on" offers only "Pick a project…" with no options (there are no projects; the sample
Duplex is not offered, F16 status). "Start from" lists demo presets (PRD-009). Clicking "Use the
suggested answers" on screen 1 of 10 skipped all of step 1; steps 2 and 3 were skipped as well
("Item numbers and texts": full code-list editor with "0 codes"; "Names": "Without a model there are
no names to explain"). The review step says: rules "The suggested answers, unchanged"; items "No item
list yet… Nothing to publish: it stays a draft"; names "No names taught yet… stays a draft". Whole fast
path: **28 s** (`s07-wizfast.mjs` output). Result: a published rule set identical to As modelled and two
empty drafts — and the rule set uses Free's single `libraryOrgPresets` slot. The required step costs
time and teaches nothing; the engaged path ("About fifteen minutes") has no preview without a model.
`spec-issue`: P18 assumed the wizard creates value before the first BoQ; the as-built evidence says it
can only do so after a model exists. Screenshots `07-setup-wizard-start.png`, `09-wizard-step1-loaded.png`,
`10-wizard-01.png`, `10-wizard-03.png`.

**PRD-003 — Free cannot sell the product.** Billing page (`28-billing-checkout-attempt.png`): all four
plans "Price on request" (including Free); "Choose" on Professional → `POST …/billing/checkout 409
checkout_unavailable` → red text "Plans can't be changed here yet. The boqlet team changes your plan:
contact us." (no link, no address; the refused checkout is not recorded anywhere the operator would
see it, unlike a limit hit). Free = 1 seat (`34-invite-on-free.png`: invite → `402 seats 1/1`), 1 active project, no
review/approval, 2 models per BoQ, watermark. The personas are firms of 3–200 that pay per seat
(`personas.md` P-A); the features that justify a team subscription (co-editing, approval, roles,
invitations) cannot be seen on Free, and there is no trial (PRD-004). Competitors offer trials:
Autodesk Takeoff (30 days, per BuildVision comparison), Kreo (7 days on Pro). Once the admin opens
public sign-up (`/admin/settings`), every sign-up lands here.

**PRD-004 — Trial and downgrade.** `PUT /admin/orgs/{id}/subscription` with `trialEndsAt` only sets
`subscriptions.trial_ends_at` and `status = 'trialing'` (`AdminOrganisations.java:134-140`); it does not
change the plan or any entitlement, and nothing scheduled flips the status back or moves the org — so
"trial" means "admin also put them on Team and must remember to move them back". The org list already
shows an org on Free with 2 / 1 seats ("S3B Wizard Errors", `30-admin_admin_orgs.png`): over-limit
states exist and the customer is told nothing. Plans-and-limits specifies "excess projects become
read-only… no new invites", not built (FM-53, FM-54).

**PRD-005 — Excel-only vs the stated first market.** `personas.md` puts Germany, Austria, Switzerland
and CEE first ("v1 is designed for design-led markets first (P01)"). In those markets the architect's
tender BoQ ("Leistungsverzeichnis") is produced in AVA software and exchanged as GAEB DA XML (DE) or
ÖNORM A 2063 (AT); ORCA AVA is GAEB-certified and handles GAEB XML 3.3 and the BIM-LV container (DIN
SPEC 91350) and does IFC quantity takeoff in its Professional/Enterprise editions; G&W's BIM2AVA does
IFC → LV with learned mappings (sources in §4). boqlet produces Excel only (`known-limitations.md`
"Export | Excel only"; FM-46) and Q12 ("Do firms need GAEB/ÖNORM at launch in DACH?") is still open.
Either the market choice or the export roadmap is wrong.

**PRD-006 — Names.** `presets/dictionaries/global-seed.json` has 56 terms / 68 entries across 8 locales.
On an English Revit sample, the term search found nothing for "laminate", "melamine", "plastic" or
"damp" (`s13-answer.mjs` output: `"Laminate laminate -> []"`, `"Damp-proofing" damp -> []`), and
"Air" (an air-gap layer) is a *blocking* question. Known-limitations: "Most 'needs input' results on
real files are a name". bSDD offers a free multilingual dictionary API with 300+ dictionaries
(buildingSMART), a natural source.

**PRD-008 — Non-modelled work.** The sheet's notice says work not modelled "is in it only if your rule
set derives it or you add it", and "Add line" creates a manual line without measurement support.
Autodesk Takeoff and CostX combine 2D (PDF/DWG) and 3D takeoff in one tool; Kreo is 2D-first with BIM.
For a firm that must hand over a complete BoQ, boqlet is half the workflow. The P15 stance (never
guess) is right; the gap is tooling for the user's half.

**PRD-012 — Workbook content.** `first-boq.xlsx` BoQ sheet row 2: "Rules: Petra Design Studio rules
(version-9d493c18-59b5-3526-8341-2b9f9797b59b -> petra-design-studio-rules) | Grouping: none |
Status: complete…"; column I "Line key" (`walls | Wall-Ext_… | True |  | m2`); sheet `Log` 220 rows of
engine detail; sheet `Questions` lists the model's problems; `Inputs` shows "Model id (sha256)" empty.

**PRD-013 — Limits UX.** Members page on Free shows the invite form; submitting gives `402
{"limit":"seats","current":1,"max":1}` then the dialog. New project: the whole form can be filled before
`402 activeProjects 1/1`. The dialog ("Your plan's limit is reached… Active projects: 1 of 1 in use.
Cancel / Upgrade") offers neither "archive a project" (which frees the slot per plans-and-limits) nor a
plan comparison. "Manage billing" calls `/billing/portal`, which just returns the return URL.

**PRD-015 — Completion semantics.** After answering the 6 blocking names and regenerating, the header
shows "COMPLETE", "17 lines · 4 to confirm" (roof area, site setup, scaffolding, landscaping have no
quantity) and the Questions tab badge "6 QUESTIONS TO ANSWER" — two magnitude contradictions marked
INFO and four "What is 'Plain' (type name)? … Not used by the current rules."

**PRD-017 — Instrumentation.** Of the six pilot measures in `overview.md`, three are "No", one
"approximated by the admin funnel", one "per run, not aggregated". The funnel shows medians in hours,
"0 h" for every step except one (`30-admin_admin_funnel.png`), useless for an activation that takes
minutes.

**PRD-019 — Pricing model.** The original owner conversation (turn 63, `docs/archive/reference/conversation/part3-turns-061-090.md`) and D50 proposed pay-per-project as the entry point for bursty
users and warned "One pricing model won't fit all three"; `plans-and-limits.md` kept seats + projects +
minutes and dropped per-project. Processing minutes are an infrastructure cost measure: a buyer cannot
predict them (S06 Duplex MEP, 18 MB, ~9 min parse; FM-82).

---

## 4. Missing or planned-but-absent features (PM view) and competitive position

### 4.1 Feature matrix items that matter most for a credible launch

| Priority | FM id | Feature | Status (re-checked) | Why it matters |
|---|---|---|---|---|
| 1 | (new) FM-111 | Unit-scale / magnitude sanity check that blocks, with geometry recommended | missing | PRD-001 |
| 1 | FM-83 | Accuracy validated against a professional BoQ | missing | PRD-007 |
| 1 | FM-53 | Trial driven by plan config, expiry job | missing (confirmed `AdminOrganisations.java:134`) | PRD-004 |
| 1 | FM-54 | Downgrade handling | missing (over-limit orgs exist) | PRD-004 |
| 1 | FM-52 | Billing provider adapter, checkout, portal | missing (out of review scope for the provider; entitlement side ready) | PRD-003 |
| 1 | (new) FM-112 | Self-serve upgrade request / contact path that reaches the operator | missing | PRD-003 |
| 1 | FM-04 | Terms / privacy acceptance and pages | missing | PRD-018 |
| 1 | (new) FM-113 | In-product help, docs and support contact | missing | PRD-018 |
| 1 | FM-27 / FM-26 | Names at scale (seed per language, bSDD, AI suggestions) | missing | PRD-006 |
| 2 | FM-46 | GAEB / ÖNORM / CSV export | missing | PRD-005 |
| 2 | FM-63 / FM-62 | Wizard after first value, on the sample or the user's model | partial / diverges | PRD-002 |
| 2 | (new) FM-114 | Client "issue" export profile vs working export | missing | PRD-012 |
| 2 | (new) FM-115 | System presets cleaned of ACME/Demo fixtures | diverges | PRD-009 |
| 2 | FM-14 / FM-61 | Imperial output (or hide the option) | missing | PRD-016 |
| 2 | FM-84 | Pilot success measures instrumented | partial | PRD-017 |
| 2 | FM-16 | Uploads > 100 MB (multipart + resume) | missing (likely broken) | Real federated projects exceed 100 MB; Professional/Team allow 300 MB per version |
| 2 | FM-05 | Invite during onboarding | missing | Team plans live on invitations |
| 3 | (new) FM-116 | Simple firm rate library (no vendors) | missing | PRD-021 |
| 3 | (new) FM-117 | Measurement aids for non-modelled work (lines from other lines, CSV block import, item templates; later PDF) | missing | PRD-008 |
| 3 | FM-12 | Default-preset pickers per project | missing | Copy already promises it (PRD-024) |
| 3 | FM-100 | Pull models from CDEs (ACC, Trimble Connect) | missing (v1 out) | Removes the download/upload step for every model version — core to "a new version takes minutes" |
| 3 | FM-47 | Client template / previous-BoQ import | missing | QS-led firms work to client templates (personas P-B) |
| later | FM-43, FM-65, FM-72 | Pricing module (offer requests, vendors, pricebooks) | missing (deferred P48) | Freeze until Q1–Q3 are answered (PRD-020) |
| later | FM-10 | MFA / SSO | missing | Needed for enterprise and for platform admins before public launch |

### 4.2 Competitive positioning

Prices are third-party list figures unless noted; treat as indicative.

| Tool | Strengths | Weaknesses vs boqlet | Source |
|---|---|---|---|
| **RIB CostX** (desktop + CostX Cloud) | Mature QS tool; 2D and 3D/BIM takeoff incl. IFC and Revit; live-linked rate libraries and workbooks; auto-revisioning; strong in UK/AU/ME QS markets | Desktop-centric; cloud needs ≥ 4 users and a 12-month term; rules are user-built takeoff dimensions rather than versioned firm-wide measuring rules; no per-number explanation to element level shared with clients | https://www.rib-software.com/en/rib-costx ; https://www.rib-software.com/pdf/en/rib-costx-cloud-brochure.pdf ; https://www.capterra.com/p/75416/CostX/ |
| **Autodesk Takeoff / Forma Takeoff** (ACC) | 2D + 3D takeoff in the cloud, IFC supported; part of the ACC/Docs CDE (no re-upload); ~US$1,250–1,300 per user/year list; 30-day trial | Contractor-oriented; tied to Autodesk's CDE; no rulebook-as-data or classification-independent measuring; no question/decision memory across versions | https://www.autodesk.com/blogs/construction/autodesk-takeoff-one-year/ ; https://construction.autodesk.com/pricing/autodesk-takeoff ; https://www.buildvisionai.com/compare/buildvision-vs-autodesk |
| **Solibri Office** (Information Takeoff, ITO) | Best-in-class IFC model checking; ITO extracts quantities/properties to Excel templates; computes quantities from geometry | Takeoff is a by-product of checking, not a BoQ tool; extraction limited to higher editions; no item texts, versions, sharing or BoQ workflow | https://help.solibri.com/hc/en-us/articles/1500004203942-Understanding-Information-Takeoff-ITO ; https://help.solibri.com/hc/en-us/articles/4901566051095-IFC-Model-Requirements-for-Information-Takeoff |
| **BIMcollab** | Open-BIM issue management and model checking via IFC/BCF | Not a takeoff tool; complementary (boqlet's input-check report overlaps a little) | https://www.g2.com/compare/autodesk-construction-cloud-vs-bimcollab |
| **Revit schedules / material takeoff** | Free inside the authoring tool; designers already use them | No measurement rules, deductions or item texts; known discrepancies at joins; export to delimited text; Revit-only | https://help.autodesk.com/cloudhelp/2018/ENU/Revit-DocumentPresent/files/GUID-F8270A42-CA71-46C7-B145-85EC2CB8E4A1.htm ; https://help.autodesk.com/cloudhelp/2023/ENU/Revit-DocumentPresent/files/GUID-B2CCAC4F-1D38-4D5D-B4D1-95619D1B7EBE.htm |
| **AVA tools in DACH: ORCA AVA, G&W California / BIM2AVA** | The incumbent for design-led tender BoQs: GAEB-certified, standard texts, IFC quantity takeover, BIM-LV container (DIN SPEC 91350), bid comparison | Desktop, national; IFC mapping per project; not international — but they own the exact job boqlet targets first | https://www.baulinks.de/bausoftware/2020/0126.php4 ; https://baulinks.de/bkd_file/orca-software/ORCA_AVA_Testversion_20250221.pdf ; https://www.baulinks.de/bkd_file/gw-software/G_und_W_CaliforniaX_BIMzweiAVA_Flyer_20230818.pdf |
| **Kreo** (cloud) | Browser-based, 2D-first with AI, BIM takeoff; transparent per-user pricing (~US$35–250/user/month depending on tier and date); 7-day trial | 2D-centric; BIM/IFC in upper tiers; no firm rulebooks or decision memory | https://civils.ai/compare/kreo ; https://www.saasworthy.com/product/kreo-takeoff/pricing |
| **Vico Office** (Trimble) | Pioneered 5D (quantity takeoff + cost + location-based schedule) | Legacy; no evidence of current development found (search returned only 2014-era material) | https://www.tenlinks.com/news/trimble-ships-vico-office-r5-bim-for-construction-mgmt/ |
| **Other IFC → BoQ cloud apps** (Open BIM Quantities, ifcreport.app, APS-based Trivix, AiN Engine) | Low-cost or free, quick IFC/ACC reports | Report generators without firm rules, versioning, questions or editing | https://store.bimserver.center/en/app/280/open_bim_quantities ; https://alternativeto.net/software/ifcreport-app/about/ ; https://marketplace.autodesk.com/apps/bad61907-cfc9-41b6-a66b-cd21df07e8a8 |
| **Excel + model exports** (the real incumbent) | Free, flexible, everyone prices in it | Manual, untraceable, redone per revision — the exact pain boqlet targets | `docs/product/overview.md` "The problem" |

**Where boqlet wins (defend these):** firm-owned measuring rules as versioned data (no competitor above
separates "how to measure" from "how to code" from "what names mean"); every number explained to the
element, in the app, in the Excel and on a client share link; questions instead of silent guesses, with
answers carried across model versions; tool-neutral IFC in a browser. **Where it loses today:** trust on
first use (PRD-001), the national tender format (PRD-005), non-modelled work (PRD-008), pricing (PRD-021)
and the ecosystem pull of ACC/CDEs (FM-100).

**Positioning recommendation:** lead with "the auditable model-to-BoQ layer for design and engineering
firms" — a tool that *checks* and *measures* the firm's own models the firm's way, outputs to whatever
the tender tool needs (Excel now, GAEB next), and shares an explainable BoQ with the client. Don't
position against CostX/AVA as a full estimating suite; position as the step before them, and integrate
(export formats, CDE import) rather than replace.

### 4.3 What to simplify

1. **Onboarding:** sign-up → org (name only) → "Explore the sample" or "Upload your model" → first BoQ.
   The wizard becomes "Make it yours" on the BoQ the user is looking at (PRD-002, PRD-014).
2. **Model upload:** one drop zone that creates the model and its first version (PRD-025).
3. **Questions:** three buckets (must answer / worth checking / FYI); the badge counts only the first
   (PRD-015).
4. **System presets:** one neutral "As modelled" plus clearly named examples; no ACME/Demo (PRD-009).
5. **Plan cards:** show seats, projects, model size and the features; keep processing minutes as a
   fair-use note (PRD-019, PRD-027).
6. **Exports:** "Issue" vs "Working" workbook (PRD-012).
7. **Sessions and splash:** two devices per person; splash once per account (PRD-028).

### 4.4 Time to first value (measured)

Fresh account `pm-new@review.test`, sign-up link from `npm run local:user`, headless Chromium, `next dev`
(first compile of each route 10–60 s, included in wall clock).

| Step | Clock (UTC) | Notes |
|---|---|---|
| Open sign-up link | 08:03:07 | `01-sign-up-link.png` |
| Password set, then **forced to sign in again** | 08:03:54 | PRD-022 |
| Org created | 08:04:29 | Country typed "Au" → stored AU (PRD-023) |
| Wizard started | 08:09:42 | after inspecting the page |
| Wizard published (fast path itself 28 s) | 08:12:47 | produced nothing useful (PRD-002) |
| Project created | 08:14:10 | |
| Model added + S09 uploaded, **ready** | 08:16:28 | parse 10.8 s |
| First BoQ generated (needs input: 6 blocking names) | ~08:18 | run 1 s; 1000× slab (PRD-001) |
| 6 names answered (2 had no matching term) | ~08:23 | PRD-006 |
| Regenerated, **Excel downloaded** | 08:24:55 | `first-boq.xlsx` |

Wall clock 21 min 48 s, dominated by dev-mode compiles and scripting; system compute under 30 s in
total. Estimate for a person on the production build with a small model: **~8–12 min to an Excel**,
of which the required wizard adds 1 min (fast path) to 15 min (engaged) with no effect on the result.
v1 criterion 12 (wizard on the sample Duplex in < 15 min) cannot be run as written because the wizard
cannot use the sample (PRD-014).

---

## 5. Assumptions and judgement calls

1. **The S09 quantities are an engine/unit-scale bug, not a modelling choice.** Based on the 1000× ratio
   between reported and geometric volume in the engine's own question and the house's visible size in
   the viewer. Root cause left to the QS/engine reviewers; I rated it critical because of where it
   appears (the first BoQ a customer sees), not because of its frequency, which I did not measure.
2. **Time-to-value estimate for a human** (8–12 min) is my judgement from the measured steps minus
   dev-mode compile time; it was not measured with a person.
3. **Answers to name questions** were my choices (e.g. "Laminate" → Timber because no laminate term
   exists); they don't affect the findings.
4. **I did not change any plan in the admin console** (the stack is shared and a plan change reaches
   every org on it). The watermark inversion (PRD-010) is from the read-only plan editor and the code,
   not from saving a change.
5. **I did not open public sign-up** in `/admin/settings`; the sign-up path was the operator setup link,
   which lands on the same Free plan.
6. **Competitor prices** come from third-party listings (Capterra, G2, BuildVision, civils.ai,
   SaaSworthy) that disagree with each other; vendors publish few list prices. Claims about the share of
   non-modelled work in a tender BoQ (PRD-008) are prior knowledge, marked as such.
7. **Market claims for DACH** (GAEB/ÖNORM as the tender exchange format) are partly prior knowledge,
   supported by the ORCA and G&W sources cited; I did not verify public-procurement rules per country.
8. **The pricing-module decision (P48) is the owner's**; I recommend freezing it, not removing the
   extension points.
9. **Severity calibration:** "critical" = blocks a credible launch on its own; "high" = must be fixed or
   consciously accepted before paid or public use; "medium" = hurts conversion or trust; "low" = polish.
10. **Web access worked** (WebSearch); no page was fetched in full, so cited facts are from search
    result extracts of the URLs listed.
11. My account `pm-new@review.test` / org `petra-design-studio` (Free) holds one project "Riverside
    House" with S09 and one BoQ; nothing else on the shared stack was changed. A seat-limit and a
    project-limit event were recorded for this org on purpose.
