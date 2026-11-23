# Verification — frontend, UX and design (79 findings)

Verifier: frontend/UX/design. 2026-11-23, `main` at `3868013`, shared local stack (`next dev` on :3000).
I wrote none of the reports. Own accounts: `verify-fe@review.test` (org "Verify FE" `/verify-fe`, enterprise,
Duplex sample) and `verify-fe-new@review.test` (fresh sign-up link → onboarding → wizard, Free plan,
org "Verify Newcomer Studio"). Data I created: one model "Broken uploads" with S14 and S13 versions,
one pinned share link (label `verify-fe`), one dismissed name question on my own Duplex BoQ.

Scripts and logs: `docs/review/_scratch/verify-frontend/` (`sheet.mjs`, `newuser.mjs`, `wizard*.mjs`,
`viewer.mjs`, `batch1–4.mjs` + `.log`, `upload.mjs` + `upload*.log`, `strictmode-focus.cjs`).
Screenshots: `docs/review/_screenshots/verify-frontend/` (cited below without the folder).

## 1. Summary

| Verdict | Count | Original severity → |
|---|---|---|
| **Verified** | **66** | high 1 · medium 22 · low 43 |
| **Adjusted** | **11** | high 4 · medium 5 · low 2 |
| **Rejected** | **2** | low 2 |
| Total | 79 | high 5 · medium 27 · low 47 |

Final severities (non-rejected): **high 1** (UX-003) · **medium 26** · **low 50** · critical 0.

Most important corrections:

1. **UX-002 (focus jumps to "Generate again") is a development-only artefact.** The hook
   `useRefocusWhenLost` (`apps/app/src/lib/focus.ts:16-35`) guards the first run with a `mounted` ref;
   React StrictMode (on by default for the App Router in `next dev`, not disabled in `next.config.ts`)
   runs effects twice and keeps the ref, so the second pass moves focus. Reproduced in the browser on
   `next dev` (active element = `generate` at 1 s–12 s) **and** isolated in jsdom with React 19.3.1: dev
   build + StrictMode → focus moves; without StrictMode → stays on body; **production build + StrictMode →
   stays on body** (`strictmode-focus.cjs`). On the pilot (production build) a settled BoQ does not steal
   focus. High → **low** (fragile guard; the same hook is used in the sheet and the wizard).
2. **UX-001 (Source column hidden beside the 3D view) is a deliberate trade-off (TF-107, `sheet.tsx:273`),
   and flagged lines are not hidden.** The lines stay listed (BR-03 is about lines), a flagged quantity
   shows "—", and the same screen shows "3 to confirm" twice (header and the "33 measured · 5 derived ·
   0 manual · 3 to confirm" summary) plus a Source filter. What is lost is the per-line word for derived
   and manual lines. High → **medium**.
3. **UX-004 and UX-005 are real but not high**: the wizard has a one-click "Use the suggested answers"
   escape (UX-004); the viewer colours break the guidelines but mislead no one about numbers (UX-005).
   Both → **medium**.
4. **UX-003 stays high**: at 1440×900 the grid starts at y = 595 with 9 rows fully visible; even after
   collapsing the note and dismissing the banner it is y = 465 / 13 rows; the top bar is static and the page
   scrolls around a second scroll container. CAS-031, QS-019 and UX-008 are the same layout pressure.
5. **CAS-030 rejected**: the Add-line dialog's Unit and Kind selects *do* have accessible names
   (`combobox "Unit"`, `combobox "Kind"` in the ARIA snapshot; axe clean). They are labelled implicitly by a
   wrapping `<label>`, which is why `getByLabel(/^unit$/)` (exact match on label text that includes the
   option texts) returned 0. **CAS-032 rejected**: "Leave it" removed the question in 335 ms on an idle
   stack; the reported ~30 s is most likely shared-stack load / dev compile.
6. **CAS-016 (share page on a phone hides quantities) is conditional**: on an unedited share at 390 px all
   three columns fit (`share-390.png`, quantity header right edge 366 < 390). The reporter's share had an
   edited line, and the quantity cell inherits `whitespace-nowrap` from `components/ui/table.tsx:85`, so
   "Edited (measured: 44.91)" widens the column off-screen. Mobile is out of v1 scope (nfr.md) → **low**.
7. **CAS-007**: "Ireland" → stored `IR` reproduced exactly, but the country only pre-fills a project's
   location and shows in the admin console; it changes no number, format or default → medium → **low**.
8. Found while verifying (not assigned, worth a row elsewhere): the public share's line detail lists each
   element's model as a raw version-id prefix (`01a2079c`) because `public-share.tsx:248-256` passes an
   empty `modelNames` map and `slots={{}}` (the latter is the cause of UX-009); the share 3D panel shows
   "0 elements of this line" for a line with 3 elements; model and model-version pages have the bare title
   "boqlet" (UX-020 is worse than reported); a 74-byte file shows "SIZE 0 MB".

## 2. Table

| ID | Source report | Title (short) | Original severity | Verdict | Final severity | Final category | Evidence of check | Correction / reason | Duplicates / related |
|---|---|---|---|---|---|---|---|---|---|
| UX-001 | 06-design | Source column hidden by default beside 3D | high | adjusted | medium | states / density | `sheet-1440-default.png`: headers NO/ITEM/DESCRIPTION/UNIT/QUANTITY/STOREY; `sheet-1440-model-off.png` adds SOURCE with 2 "TO CONFIRM"; `sheet.tsx:273` | Deliberate (TF-107); lines not hidden, flagged qty "—", counts visible on same screen; derived/manual lose their tag | CAS-031, QS-019, UX-044, UX-010 (same status-gutter fix) |
| UX-002 | 06-design | Focus jumps to "Generate again" on load | high | adjusted | low | keyboard / robustness (dev only) | `sheet.mjs` (active = generate @1–12 s on `next dev`); `strictmode-focus.cjs` (prod React: no move) | StrictMode double-effect defeats the `mounted` guard; production unaffected for a settled BoQ. Fix: compare previous deps, not a mount flag | — |
| UX-003 | 06-design | Sheet gets a third of the screen; page scrolls | high | verified | high | density-power-use | `sheet.mjs`: grid top 594.6, 9 rows, doc 1319 px, header `position: static`, wheel scrolls page 400 px; `batch1.log`: 465 / 13 rows after collapse+dismiss | — | UX-008, UX-026, UX-027, UX-044, CAS-031, QS-019 |
| UX-004 | 06-design | Wizard shows raw formula editors | high | adjusted | medium | progressive-disclosure | `wiz-01.png` (screen 2: 3 textareas, 9 Names/fx/code buttons, "1.05 = 5 %"); `wiz-step-names.png` (precedence text) | One-click "Use the suggested answers" on every screen; friction, not a blocked flow | CAS-006, PRD-002, UX-035 |
| UX-005 | 06-design | Viewer colours break guidelines (green, Tableau) | high | adjusted | medium | design-system | `viewer-light.png` (whole model green); `links.ts:84-90`, `scene-view.ts:31-40`, default mode `coverage` (`model-viewer.tsx:92`) | Correct facts; a guideline breach, not a misleading state | UX-006 |
| UX-006 | 06-design | Dark mode: viewer light, toolbar icons invisible | medium | verified | medium | visual / a11y (1.4.11) | `viewer-dark.png`: icons stroke rgb(242,237,227) on clear colour 0xf2f0ea; buttons transparent `outline` | Cause precisely: transparent outline buttons over a hard-coded light canvas (`scene-view.ts:76`) | UX-005 |
| UX-007 | 06-design | No sort, density switch, resize | medium | verified | medium | density / spec-issue | `aria-sort` only in admin `orgs-table.tsx:85`; `ROW = 32` (`sheet.tsx:50`); tokens 28/36 in `globals.css:103-105` unused | — | UX-048 |
| UX-008 | 06-design | Line detail squeezes description | medium | verified | medium | density / responsive | `line-detail.png` (model off: desc 256 px, page 2,229 px); with model on desc 160 px | — | UX-003, CAS-031, QS-019 |
| UX-009 | 06-design | Share page shows raw setting keys / formula syntax | medium | verified | medium | microcopy | `share-line-detail.png`: `wall_unit`, `wall_recess_mode`…; `public-share.tsx:251` passes `slots={{}}` so `slotLabel` falls back to the key | Also element model shown as `01a2079c` (empty `modelNames`) | UX-046, PRD-012 |
| UX-010 | 06-design | Share page hides flags and item numbers | medium | verified | medium | states | `share-1280.png`: DESCRIPTION/UNIT/QUANTITY, flagged lines "—" with no word | Section codes are shown as group headings (A.01…), per-line numbers are not | UX-001, CAS-028 |
| UX-011 | 06-design | Failed upload is a dead end; failed versions consume numbers | medium | verified | medium | states | `up-S14.png`, `up-S13.png`: version pages show FAILED + one sentence, no action; second failure is v2; `up-dashboard.png` "A parse job failed" | Nuance: the model page lists the failed version and has "Upload new version" (`86-model-with-failed-version.png`) | CAS-010, ENG-012, FM-19 |
| UX-012 | 06-design | Always-open Add-model form; two-step upload; no drop zone | medium | verified | medium | progressive-disclosure | `models.png`; drop handlers only in `sheet.tsx` and `code-import.tsx` | — | CAS-022, PRD-025 |
| UX-013 | 06-design | Disabled primary buttons give no reason | medium | verified | medium | states / a11y | `project-new.png` "Create project(disabled)" with nothing nearby; enterprise settings: Four eyes disabled, no text (`settings-general-ent.png`) | On Free the approval checkboxes do show "Not part of your plan…" | UX-014, PRD-013 |
| UX-014 | 06-design | Tooltips are `title=`; no Tooltip component | medium | adjusted | low | design-system | 155 `title={` (grep); `components/ui/` has 12 files, no Tooltip | Icon buttons have `aria-label`; the cited `saveBlockedPending` has a visible companion status line ("N answers not applied yet", `boq-header.tsx:253-265`); engine value also in line detail | UX-013 |
| UX-015 | 06-design | More than one primary per screen | low | verified | low | visual-consistency | `batch1.log`: Exports = Save version + Export Excel purple; billing 3 purple "Choose" (`billing-free.png`); empty dashboard code `[org]/page.tsx:72-90` | — | UX-039 |
| UX-016 | 06-design | Checkboxes/radios in three looks | low | verified | low | design-system | 43 native inputs, 8 with `accent-`; no global `accent-color`; browser-blue wizard radio `nu-wiz-00.png` | — | — |
| UX-017 | 06-design | Inputs 28 px grey 12 px; buttons 32 px | low | verified | low | design-system | `input.tsx`: `h-7 … bg-input/20 … md:text-xs/relaxed`; guidelines 32 px / 13 px | — | — |
| UX-018 | 06-design | Dashboard card labels collide; Questions = blocking only | medium | verified | medium | visual / microcopy | `dash-1440.png` "QUESTIONSIN REVIEW", value 0 while BoQ has 2 open; `project-card.tsx:38-50` | — | LEAD-023 |
| UX-019 | 06-design | BLOCKING uses filled ink; share WORKING orange | low | verified | low | visual-consistency | `questions-tab.tsx:220` `Tag filled`; `104-questions.png`; share WORKING border rgb(232,89,12) (`batch2.log`) | — | — |
| UX-020 | 06-design | No breadcrumbs; generic titles | medium | verified | medium | ia-navigation | Titles: New project "Verify FE · boqlet"; rule-set editor "Verify FE · boqlet"; model and version pages "boqlet"; no breadcrumb nav | Worse than reported on model pages | — |
| UX-021 | 06-design | No global search / command palette | medium | verified | medium | ia-navigation | No cmdk/Command in `src`; screens.md:73 lists search; known-limitations:76 tracks it (FE-034) | Known, tracked gap | FM-31, UX-047 |
| UX-022 | 06-design | /account, /notifications outside the shell | medium | adjusted | low | ia-navigation | `/account` has `<main>`, axe clean; `/notifications` no `main` (axe landmark-one-main, region×4); neither has the left nav (`account.png`, `notifications.png`) | Only Notifications lacks `main`; notification items already link to their subject | UX-023, UX-042 |
| UX-023 | 06-design | Notifications and toasts vague | low | verified | low | microcopy | `up-notifications.png` "A job failed"; toast "A job failed / Open"; `notifications.json` `job_failed` `other {A job failed}` for parse; unread dot `bg-[var(--link)]` | — | CAS-026, LEAD-019 |
| UX-024 | 06-design | 37 Tab stops before sheet; separator no focus ring | medium | verified | medium | keyboard | `sheet.mjs`: treegrid is stop 38; separator `box-shadow: none`, `outline-style: none` | — | — |
| UX-025 | 06-design | Long lists not virtualised (Log 13k px) | low | verified | low | density | Log page 13,034 px (`batch1.log`); `useVirtualizer` only in `sheet.tsx` | — | — |
| UX-026 | 06-design | Toolbar reflows; "Add line" twice | low | verified | low | visual / responsive | `sheet-1440-default.png` (Add line in note and toolbar); `r-sheet-1024.png` three toolbar rows | — | UX-003, UX-044 |
| UX-027 | 06-design | Bulk bar pushes grid down | low | verified | low | density | Grid top 497 → 559 after ticking one line (`batch4.log`, `bulk-bar.png`) | — | — |
| UX-028 | 06-design | Decisions page shows ids and enum values | medium | verified | medium | microcopy | `decisions.png`: `contradiction:volume:IfcWall:Party Wall…`, answer `reported` | — | QS-010 |
| UX-029 | 06-design | Jargon and raw identifiers | low | verified | low | microcopy | `nu-wiz-00.png` "Based on: standard-style-example", "master template", "two slots changed"; `boqs.json:463` "Move to a {system} section"; "Family", "Leave it", "Address", Clone vs Make a copy | — | CAS-020, CAS-006, UX-036 |
| UX-030 | 06-design | Question text: IFC internals, negative % | low | verified | low | microcopy | `104-questions.png` "-50% … Qto_SlabBaseQuantities.Width", "Used 171 times. — 171 elements"; my sample "Used 1 time… — 1 element" | — | CAS-013, QS-022 |
| UX-031 | 06-design | Line-detail numbers unrounded / unit-less | low | verified | low | visual-consistency | `batch1.log` detail: shares 5.250625, total 12.483345, log "m2" | — | — |
| UX-032 | 06-design | Native validation bubble; no confirmation after set-password | low | verified | low | states / microcopy | `nu-02-short-password.png` (Chrome bubble, form not `noValidate`); `nu-03-after-set-password.png` empty sign-in, email not prefilled | — | CAS-019, PRD-022 |
| UX-033 | 06-design | Onboarding promises an invite step | low | verified | low | microcopy | `orgs.json:15`; next screen is `/setup` (`newuser.mjs`) | — | CAS-021, PRD-024, FM-05 |
| UX-034 | 06-design | Wizard and sign-in lack poster language | low | verified | low | visual / spec-issue | `Poster` used only in onboarding, dashboard, project card, invite; wizard "SCREEN 1 OF 10" + "Step" nav | — | — |
| UX-035 | 06-design | Wizard offers choices that do nothing | low | verified | low | microcopy | Wizard screen 5 contains "does not measure each face separately" (`wizard.mjs` log, `wiz-04.png`) | — | UX-004 |
| UX-036 | 06-design | Demo presets clutter the Library | low | verified | low | progressive-disclosure | `library.png`: ACME Ltd house rules, two "Demo:" rule sets beside the firm's | — | CAS-009, PRD-009 |
| UX-037 | 06-design | During a run the sheet says "Generate the BoQ…" | low | verified | low | states | `RunFigures` in `boqs/[boqId]/page.tsx:148-158` shows `sheet.empty` whenever no run has stats | Applies to the first run of a BoQ only (later runs keep the previous sheet) | — |
| UX-038 | 06-design | "Needs you" actions all "Open" | low | verified | low | a11y / microcopy | `[org]/page.tsx:64-66`: every row's control is "Open" (a Link rendered as Button); seen in `up-dashboard.png` | — | — |
| UX-039 | 06-design | Free plan "Price on request" | low | verified | low | microcopy | `billing-free.png` | — | CAS-012, PRD-027 |
| UX-040 | 06-design | Model version layout; ambiguous counts | low | verified | low | visual / microcopy | `model-version.png`: "Elements overlap 38 · 76 elements"; `86-model-with-failed-version.png` "DETECT FROM THE FILE" | — | CAS-014 |
| UX-041 | 06-design | Activity entries vague | low | verified | low | microcopy | `projects.json:128` `decision_set: "Answered a question"` with no subject | Timestamp wrap taken from the reviewer's screenshot | LEAD-006 |
| UX-042 | 06-design | axe results (1 serious) | medium | verified | medium | accessibility | Re-ran: dictionary editor **serious** `scrollable-region-focusable` (.overflow-x-auto) + `landmark-unique`; dashboard `page-has-heading-one`; notifications `landmark-one-main`, `region`×4; share `heading-order` | — | UX-022, FM-110 |
| UX-043 | 06-design | 390 px org chrome overflows | low | verified | low | responsive | Dashboard scrollWidth 454 > 390 (`batch2.log`) | — | — |
| UX-044 | 06-design | 1024/768: Source cut, 3-row toolbar | low | verified | low | responsive | 1024: Source header right edge 1064 > 1024; `r-sheet-1024.png` toolbar 3 rows | — | UX-001, UX-026 |
| UX-045 | 06-design | Share header plain; watermark behind detail | low | verified | low | visual / spec-issue | `share-line-detail.png`; guidelines:201 header spec; guidelines:276 still asks for the wordmark SVG though `shell/logo.ts`, `wordmark.tsx` exist (P56) | — | — |
| UX-046 | 06-design | Model names generic or raw | low | verified | low | microcopy | Share 3D "Model 1"; share elements `01a2079c` | — | UX-009 |
| UX-047 | 06-design | design-system.md lists missing components; screens.md claims search | low | verified | low | spec-issue | design-system.md:45-46 vs 12 files in `components/ui/`; `ui/select` imported nowhere; screens.md:73 | — | UX-021 |
| UX-048 | 06-design | Density switch and clamp untracked | low | adjusted | low | spec-issue | known-limitations.md:79 already says "no three-line clamp"; density switch not tracked | Half wrong: only the density switch is untracked | UX-007, FM-30 |
| CAS-006 | 03-casual-user | Mandatory wizard before upload; preview needs a model | medium | verified | medium | onboarding | `newuser.mjs`: `/projects` → `/setup` before setup; Names step "No project to take a model from yet. Upload an IFC model in a project, then come back." | — | PRD-002, PRD-014, UX-004, FM-63 |
| CAS-007 | 03-casual-user | Country/currency silently truncate ("Ireland" → IR) | medium | adjusted | low | onboarding | `nu-06-onboarding-filled.png` "eur"/"Ir"; `/me` → `defaultCountry: "IR"`; `onboarding/page.tsx:95,98` | Country only pre-fills project location and the admin console; it changes no number or format | PRD-023 |
| CAS-008 | 03-casual-user | No classification → flat list | medium | verified | medium | confusion / feature gap | Group-by options are only the run's classifications + "No grouping" (`sheet.tsx:600-607`) | — | — |
| CAS-010 | 03-casual-user | Vague error; no next step; failed versions invisible | medium | adjusted | medium | error-message | `up-S13.png` "The model could not be processed."; models list "Broken uploads … No version uploaded yet." after two failed versions | Failed versions *are* listed on the model page with "Upload new version"; invisible only in the project's Models list | UX-011, ENG-012 |
| CAS-011 | 03-casual-user | File-size limit "62.06393051147461 of 50" | medium | verified | medium | error-message | Code: `Models.java:165` size ÷ MiB unrounded; `LimitAlerts.java:87` passes the BigDecimal; ICU simple `{current}` prints it raw (`use-notification-text.ts:14`, `limit-dialog.tsx:59`) | Not re-uploaded (65 MB on Free; shared-engine rule) | — |
| CAS-013 | 03-casual-user | Questions written for BIM experts | medium | verified | medium | jargon | `questions.png` "Not used by the current rules"; `104-questions.png` SUGGESTED + RECOMMENDED, pre-selected radio | — | UX-030, QS-022, PRD-015 |
| CAS-014 | 03-casual-user | Model page full of technical checks | medium | verified | medium | jargon | `model-version.png`: IfcFurnishingElement 61…, "Faces point inconsistently", "Placeholder values 6 · 787 elements" | — | UX-040 |
| CAS-016 | 03-casual-user | Share on a phone hides quantity | medium | adjusted | low | responsive | `share-390.png` (unedited share: all columns fit) vs `cas/80-share-page-phone.png` | Only with edited lines: `TableCell` `whitespace-nowrap` (`ui/table.tsx:85`) on "Edited (measured: …)" (`public-share.tsx:225-229`); < 768 px is out of v1 scope | CAS-028, FM-104 |
| CAS-019 | 03-casual-user | After set-password, empty sign-in | low | verified | low | onboarding | `nu-03-after-set-password.png`; email field empty | — | PRD-022, UX-032 |
| CAS-020 | 03-casual-user | "ADDRESS" means web address, prefilled "000" | low | verified | low | jargon | `suggestSlug("")` pads to "000" (`orgs/slug.ts:15`); slug value "000" before typing | — | PRD-023, UX-029 |
| CAS-021 | 03-casual-user | Promised invite step absent | low | verified | low | onboarding | `orgs.json:15` | — | UX-033, PRD-024 |
| CAS-022 | 03-casual-user | Two steps to upload | low | verified | low | confusion | `models.png` | — | UX-012, PRD-025 |
| CAS-023 | 03-casual-user | COMPLETE next to "to confirm" and questions | low | verified | low | confusion | `sheet-1440-default.png`: "41 lines · 3 to confirm … ✓ COMPLETE" + "QUESTIONS 2" | — | PRD-015 |
| CAS-024 | 03-casual-user | "Lines changed 2" but lists one | low | verified | low | confusion | `changes/model.ts:3,45` default 1 % threshold; summary uses `s.linesChanged` (`changes-tab.tsx:155`); no "N hidden" message | — | — |
| CAS-026 | 03-casual-user | Notifications/emails say what, not to what | low | verified | low | error-message | `EmailDelivery.java:195-208` generic subjects, body = subject + link; bell "A job failed" | "in 2 seconds" future timestamp not checked | UX-023, LEAD-019 |
| CAS-027 | 03-casual-user | Same export file name twice | low | verified | low | export | `BoqExports.java:248-250` name = project_boq_Rev_date | List does have a time column | CAS-002 |
| CAS-030 | 03-casual-user | Add-line Unit/Kind selects unlabelled | low | rejected | — | — | ARIA snapshot: `combobox "Unit"`, `combobox "Kind"`; axe clean on the dialog (`batch4.log`) | Implicit `<label>` wrapping; the test's exact-text `getByLabel` failed because the label text includes the options | — |
| CAS-031 | 03-casual-user | 3D panel squeezes descriptions | low | verified | low | density | Description column 160 px at 1440 and 1600 (`sheet.mjs`) | — | QS-019, UX-001, UX-008 |
| CAS-032 | 03-casual-user | Clicks in questions take ~30 s | low | rejected | — | — | "Leave it": 2 → 1 questions in 335 ms (`batch4.log`) | Not reproducible on an idle stack; likely shared-load / dev compile | — |
| PRD-013 | 02-product | Limits UX reactive; "Manage billing" does nothing | medium | verified | medium | pricing-and-plans | `members-free.png` invite form at Seats 1 of 1; no quota near create actions (grep); `BillingController.java:59-69` echoes the return URL | — | UX-013, CAS-012 |
| PRD-022 | 02-product | Must sign in again after set-password | low | verified | low | onboarding | `nu-03-after-set-password.png` | — | CAS-019, UX-032 |
| PRD-023 | 02-product | Address "000"; free-text country/currency | low | verified | low | onboarding | as CAS-007/CAS-020 | — | CAS-007, CAS-020 |
| PRD-024 | 02-product | Copy promises unbuilt features | low | verified | low | onboarding | `orgs.json:15`; `projects.json:61` "change them per project" with no project default pickers (FM-12) | — | CAS-021, UX-033 |
| PRD-025 | 02-product | Create-then-upload; empty overview without buttons | low | verified | low | flow | `projects.json:79` text only; `models.png` | — | UX-012, CAS-022 |
| PRD-028 | 02-product | Single session + 5.3 s splash per sign-in | low | verified | low | spec-issue | `splash.tsx:10-13` PLAY 5,333 ms + 300 ms fade, per sign-in; P22 | Splash skips on any click/key (`splash.tsx:68-69`); single session is a settled decision → owner question | — |
| LEAD-012 | 05-team-lead | Joining from an invitation takes five screens | medium | verified | medium | onboarding | `invite/[token]/page.tsx:86-94` primary "Sign in"; `native.tsx:237` secondary "invited" link; invitation mail body `EmailDelivery.java:120` | — | — |
| LEAD-013 | 05-team-lead | New members land on "Create your first project" | medium | verified | medium | onboarding | `[org]/page.tsx:79-95`: empty state for anyone with no visible projects; no member-specific copy | — | UX-015 |
| LEAD-019 | 05-team-lead | Notification emails generic | low | verified | low | collaboration | `EmailDelivery.java:195-208` | — | CAS-026, UX-023 |
| LEAD-022 | 05-team-lead | Presence avatars initials only | low | adjusted | low | collaboration | `presence.tsx:121-130`: `title` "editing/viewing {name}" and `sr-only` name | Names are on hover and for screen readers; only the visual collision remains | UX-014 |
| LEAD-023 | 05-team-lead | Project cards lack BoQ state; labels collide | low | verified | low | reporting | `dash-1440.png`; card shows BoQs / Questions / In review only | — | UX-018 |
| QS-019 | 04-civil-engineer | Descriptions truncated beside 3D | low | verified | low | sheet | 160 px description column at 1600 | — | CAS-031, UX-008 |

## 3. Details

### UX-003 — high, verified
`sheet.mjs` at 1440×900 on the Duplex BoQ: treegrid top **594.6 px**, **9 rows** fully visible, document
height 1,319 px, top `header` `position: static`; a wheel over the chrome scrolls the page by 400 px while
the grid (`h-[max(24rem,calc(100dvh-24rem))]`, `sheet.tsx:1066`) has its own scroll. After "Show less" on
the note and "Dismiss" on the banner: top **465 px, 13 rows**. Stacked above the grid: project title, project
tabs, BoQ header, status line, BoQ tabs, banner, the summary note with its own "Add line", five filter
selects, the search/toolbar row (`sheet-1440-default.png`, `sheet-collapsed.png`). Three personas hit
the same pressure (CAS-031, QS-019, UX-008). The recommendation (full-height layout, sticky bar, one-line
header, filter chips) fits the guidelines. Note that UX-001 is the side-effect of an earlier fix (TF-107)
for exactly this lack of width; fixing UX-003's height and the split's width together would make the
Source trade-off unnecessary.

### UX-001 — adjusted high → medium
Facts hold: `sheet.tsx:273` turns `source` off when `split && hasModels` and the person has not chosen
otherwise. But the column was hidden on purpose so Quantity stays in view (TF-107, commit `852393e`),
lines are not hidden (BR-03 says "never hides flagged lines"), flagged quantities read "—" with a
`title`, and the counts "3 to confirm" appear twice on the same screen with a Source filter right above
the grid. A user cannot "save a version without seeing the flags" unawares; what is lost is which lines
are derived or manual. The proposed status gutter is the right fix; it also serves UX-010 and UX-044.

### UX-002 — adjusted high → low
Browser (`next dev`): active element is `button[data-testid=generate]` at 1, 3, 6 and 12 s. Cause:
`useRefocusWhenLost` skips only the *first* effect run via `mounted.current`; StrictMode's dev-only
mount → unmount → mount keeps the ref, so the second run schedules `focus()` while focus is on body.
jsdom with the app's React 19.3.1 (`strictmode-focus.cjs`): dev build — no StrictMode: BODY;
StrictMode: `generate`. Production build — both: BODY. `headerState` does not change kind between the
first render and loaded `runs` for a complete BoQ, so production has no second trigger on a normal load.
Residual: the guard is fragile (any dependency change from loading to loaded would trigger it); compare
the previous dependency value instead of a mount flag. The reviewer's fix ("track initial data loaded")
would also work but treats a symptom.

### UX-004 — adjusted high → medium
Reproduced on a brand-new account: screen 2 of 10 "Formwork as separate item: details" has three formula
textareas with Names / fx / code buttons and the "1 = none, 1.05 = 5 %" factor (`wiz-01.png`); step 3
explains dictionary precedence ("starts with…"). Every screen has "Use the suggested answers", which
finishes the step, so the 15-minute path is not blocked. Recommendation is sound (choices only; formula
behind a closed disclosure; % input).

### UX-005 — adjusted high → medium
Confirmed in code and screenshot (default `coverage` mode paints measured elements `0x9fc29a` green;
`PALETTE` is Tableau 10; selection `FOCUS` blue / `PICKED` orange; unmatched red `0xd9534f`). It contradicts
guidelines lines 46 and 155-159, but it misleads nobody about numbers or status; the legend names each
colour. Medium (design-system defect). The fix (read tokens once through a `viewerPalette()` helper) is
consistent with design-system.md's "no hard-coded colour".

### UX-014 — adjusted medium → low
The count and the missing Tooltip component are right. The impact is overstated: icon buttons carry
`aria-label`, the blocked "Save version" is accompanied by a visible `role="status"` line
(`boq-header.tsx:253-265`), and the engine value of an edited cell is also in the line detail. Remaining
issue: hover-only hints for mouse users and inconsistent styling → low; the visible-reason part is UX-013.

### UX-022 — adjusted medium → low
`/account` renders its own `<main>` and passes axe; `/notifications` has no `main` (axe
`landmark-one-main` + `region`×4). Both lack the left nav, but both show the logo and org link. Notification
rows are already links to their subject (`notifications/page.tsx:53`), so half of the recommendation exists.

### UX-048 — adjusted (low)
`known-limitations.md:79` already records "item texts are one line (no three-line clamp)". Only the sheet
density switch (guidelines:189) is untracked.

### CAS-007 — adjusted medium → low
Reproduced exactly ("euro" → `eur` → EUR; "Ireland" → `Ir` → **IR**, `/me` settings). But
`defaultCountry` only pre-fills the project form's location (`projects/new/page.tsx:29`) and the admin
console; currency, number and date formats are separate settings. Wrong metadata, no wrong numbers.

### CAS-010 — adjusted (medium)
S13 → "The model could not be processed." (the specific `corrupt_file` text exists but the engine's
`IndexError` never maps to it, ENG-012); S14 → "This file is not an IFC file." without the hint; neither
version page has an action. The project's Models list says "No version uploaded yet." after two failed
versions (`up-models-list.png`). Correction: the model's own page lists failed versions with FAILED and
offers "Upload new version", so they are not invisible everywhere.

### CAS-016 — adjusted medium → low
At 390 px my unedited pinned share shows Description / Unit / Quantity, all on screen
(`share-390.png`). The reporter's share contained an edited line; the quantity cell inherits
`whitespace-nowrap` from the shadcn `TableCell` and appends "Edited (measured: 44.91)", which widens the
column beyond the viewport inside an `overflow-x: auto` wrapper with no cue. Fix: `whitespace-normal` on
that cell (the description cell already overrides it, TF-172). Below 768 px is outside the nfr.md target.

### CAS-030 — rejected
ARIA snapshot of the open dialog: `textbox "Description"`, `combobox "Unit"`, `combobox "Kind"`,
`radio "A number"`, `textbox "Quantity"`, `combobox "ACME cost codes"`; axe clean. The selects sit inside
`<label>` elements, so their `labels` property includes the option texts; Playwright's
`getByLabel(/^unit$/i)` matches label text exactly and fails, `getByRole("combobox", { name: "Unit" })`
works. (Implicit labels are valid; an explicit `htmlFor` would be marginally more robust for voice
control, not a defect.)

### CAS-032 — rejected
On my BoQ, clicking "Leave it" removed the question from the list in 335 ms. The original session ran while
six reviewers, two baseline captures and `mvn verify` loaded the machine (00-context §4), and `next dev`
compiles on first use. Not a product defect as stated; adding a pending state to the button would still be
cheap insurance.

### LEAD-022 — adjusted (low)
Each avatar `li` has `title="… is editing/viewing"` with the full name and an `sr-only` name
(`presence.tsx:121-130`). Two people with the same initials still look identical at a glance.

## 4. Judgement calls

1. **Severity scale** used is the brief's (high = core flow seriously degraded / a11y blocker / misleading
   state on a main screen). Guideline breaches with no wrong numbers or blocked flows are medium (UX-005),
   even where the reviewer's own scale called them high.
2. **Dev vs production**: the review stack runs `next dev`. I did not run a production build (it would
   write into `apps/app` and compete with the shared dev server); for UX-002 I isolated the hook in jsdom
   against the app's own React in both builds instead. Other findings do not depend on StrictMode.
3. **CAS-011** was checked in code only: reproducing needs a > 50 MB upload on a Free org, which the
   brief rules out on the shared engine.
4. **UX-011 vs CAS-010** kept as separate rows (same root: failed parse has no next step and no specific
   reason); UX-011 verified because its claims hold on the version page; CAS-010's "invisible" was narrowed.
5. **UX-018 kept medium**: the label collision alone is polish, but the "Questions" figure contradicts the
   BoQ tab on the landing page.
6. **UX-021** is verified though already tracked (known-limitations:76): tracking does not make the gap
   less real; the duplicate with FM-31 is noted.
7. **PRD-028** verified as stated (low, spec-issue): P22 (single session) is a settled decision, so the
   two-device proposal is an owner question, not a defect; the splash is skippable, which softens it.
8. Proposed fixes I would not follow as written: UX-002 "track initial data loaded" (fix the StrictMode-
   unsafe guard instead); UX-013 "keep primary buttons enabled and validate on submit" conflicts with the
   guidelines' disabled style (guidelines:128) — a visible reason next to the disabled button satisfies
   both; UX-016 "accent-color: var(--link)" is fine, but `--link` is the brand purple, which the guidelines
   reserve for act/here — `--foreground` (ink) may fit the guidelines better; the owner should pick one.
9. Guideline staleness: design-guidelines.md "Still to supply: wordmark SVG" (line 276) is stale since P56
   (UX-045); design-system.md's component list reads as built (UX-047).
