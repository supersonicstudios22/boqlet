# Verification: product and features

Verifier: product and features area. Written 2026-11-23 on `main` at `3868013`, against the code, the docs
and the shared local stack. I wrote none of the six reports.

**Own account:** `verify-prd@review.test` / `review-verify-password-2026`, org "Verify PRD" (`/verify-prd`,
Free, setup **not** finished, so the first-run gate could be reproduced). Scripts:
`docs/review/_scratch/verify-product/api-checks.mjs` (billing, checkout, portal, usage, presets through
the Java API), `ui-checks.mjs` (Playwright: setup gate, wizard model picker, billing cards, "Choose"),
`xlsx_check.py` (sheets, page setup and BoQ rows of the reviewers' exported workbooks and the baseline).
Screenshots: `docs/review/_screenshots/verify-product/01-setup-gate.png`, `02-model-picker-open.png`,
`03-billing.png`, `04-billing-choose.png`. No plan, platform setting or other account was changed.

---

## 1. Summary

25 findings checked: **17 verified, 8 adjusted, 0 rejected.**

| Original severity | Checked | Verified | Adjusted | Rejected | Final severity of the group |
|---|---|---|---|---|---|
| high | 5 | 2 (PRD-003, PRD-007) | 3 (PRD-002, PRD-005, CAS-003, all to medium) | 0 | 2 high, 3 medium |
| medium | 18 | 13 | 5 (PRD-008, PRD-012: evidence corrected, still medium; PRD-015, PRD-019, PRD-020: to low) | 0 | 15 medium, 3 low |
| low | 2 | 2 (PRD-027, LEAD-017) | 0 | 0 | 2 low |
| **Total** | **25** | **17** | **8** | **0** | **high 2 · medium 18 · low 5** |

**The most important corrections**

1. **PRD-012: the "Line key" column is hidden, not shown.** `boq_import.annotate` hides column I and
   protects the sheet (`engine/ifc_boq/sheets/boq_import.py:38`), and the `_boqlet` sheet is `veryHidden`
   (`:42`). The rest of the finding holds: the visible version-UUID rule chain in BoQ!A2, and the visible
   Log, Questions, Inputs and Calculation sheets. The recommended fix ("hide keys in a hidden sheet") is
   already partly in place.
2. **PRD-008: the workbook already has more aids for non-modelled work than the report says.** Derived
   rules make lines from other lines and elements (formwork, paint, skirting, rebar). A manual line's
   quantity can be a formula over `building.*` and answers (`edit-dialogs.tsx:58-131`), and the Excel
   edits import turns new rows into manual lines (`boqs.json` "New rows (become manual lines)"). What is
   missing is 2D/PDF takeoff and manual-line formulas that refer to other lines. FM-123 is **partial**, not missing.
3. **"Price on request" is configuration, not code.** P57 makes prices the admin's data
   (`V23__plan_admin_and_public_sign_up.sql:7-8`). The seed sets no price, so every plan, Free included,
   shows `noPrice` (`billing-settings.tsx:84-88`). PRD-003, PRD-027, CAS-012 and LEAD-011 stand as product
   findings, but the operator can put prices up today without a code change. The `409 checkout_unavailable`
   and the echoing portal are code (`BillingController.java:52-70`).
4. **Three high findings go down to medium.** PRD-002: the wizard is a forced, value-free step, but its
   fast path takes 28 s, so it slows people down without blocking them. PRD-005: the docs target
   "design-led markets", a list that includes the Balkans, the Middle East and Asia, where Excel BoQs are
   common, and Q12 or roadmap #12 already track GAEB per market; the gap is real for DACH only. CAS-003:
   PDF is an explicit v1 "out", and the print setup is a small fix with a workaround.
5. **Feature-matrix corrections:**
   - **FM-50** goes from "partial (unverified)" to **missing**. `model_version.ready` is sent with
     `category = null` (`worker/Jobs.java:360-380`), and `Notifications.send` returns before the email
     outbox when no module template supplies a category (`realtime/Notifications.java:46-48`). So no email
     is sent for a ready model at all, whatever the parse time.
   - **FM-70** goes to **partial**: the health page already has webhook-failure and email-bounce tiles,
     which show "Not tracked".
   - **FM-19** goes to **partial**: the version page shows the version's note.
   - **FM-123** goes to **partial** (point 2).
   - **FM-11**, "built", should add that the sample is offered only on an empty dashboard (PRD-014).

---

## 2. Findings

| ID | Source report | Title (short) | Original severity | Verdict | Final severity | Final category | Evidence of check | Correction / reason | Duplicates / related |
|---|---|---|---|---|---|---|---|---|---|
| PRD-002 | 02-product | Required wizard gives no value on first run and gates the dashboard | high | adjusted | medium | onboarding / spec-issue | Reproduced. A fresh org's `/verify-prd`, `/projects` and `/library` all redirect to `/setup` (`ui-checks.mjs` output; `01-setup-gate.png`). `setup-gate.tsx:12-18`: every page except setup and settings redirects. The "Model to try it on" select has only "Pick a project…" (`02-model-picker-open.png`). "Start from" lists the ACME/Demo presets. Free `libraryOrgPresets: 1` (API billing). | Facts hold. Severity goes down: the fast path finishes in under 30 s (PRD's own timing), so this is friction and a wasted Free preset slot, not a blocked core job. The spec-issue against P18 stands. | CAS-006, UX-004, UX-035, PRD-014 (same root: the wizard runs before any model or sample exists) |
| PRD-003 | 02-product | Free is the only self-serve entry and cannot sell the product | high | verified | high | monetisation / pricing-and-plans | API: Free `seats:1, activeProjects:1, approvalWorkflow:false, exportWatermark:true`; `POST /billing/checkout` → `409 checkout_unavailable`; `POST /billing/portal` → `200` echoing the return URL. UI shows four "Price on request" cards, and "Choose" shows "…contact us." with no link (`03-billing.png`, `04-billing-choose.png`). `createCheckout` writes nothing before throwing (`BillingController.java:52-56`). No trial mechanism (FM-53). | High for the moment public sign-up opens (P57 lets the admin do that at any time). Today's invite-only pilot works around it by having the operator set plans by hand. Prices are admin data (P57), so "no prices" is unconfigured, not missing code. | PRD-004, PRD-013, PRD-027, CAS-012, LEAD-011, UX-039; FM-52, FM-53, FM-118 |
| PRD-005 | 02-product | Primary market is DACH/CEE, but the only output is Excel | high | adjusted | medium | spec-issue / competitive | `personas.md:5-12`: "design-led markets" = DE, AT, CH, CEE, **the Balkans, much of the Middle East and Asia**; "v1 is designed for design-led markets first (P01)". `known-limitations.md:40` "Excel only"; `open-questions.md:41` Q12 open; `roadmap.md:47-48` GAEB/ÖNORM "per market". The only formats in the export API are `[xlsx]` (`openapi.yaml:1374`). Web check: German public procurers can require GAEB files, and a bid sent as PDF instead of the required GAEB file was excluded (OLG Köln 07.02.2024, 11 U 118/20, via Rödl / Wolters Kluwer search results). No general legal duty to use GAEB was found. | The docs don't name DACH as the first market. The first market is a set of design-led countries, several of which use Excel BoQs, and the product is international by principle. The gap is real for DE and AT and is already an open question (Q12), so this is a market-sequencing decision, not a contradiction that blocks v1. | QS-016 (CSV and dimension-sheet export), CAS-003 (PDF); FM-46 |
| PRD-007 | 02-product | Accuracy never validated against a professional BoQ, while O1 and O3 are "Built" | high | verified | high | launch-readiness / spec-issue | `known-limitations.md:18` ("the biggest open question"); `overview.md:57-59` marks O1 and O3 "Built"; `roadmap.md:30-33` lists reference projects as candidate #3, not scheduled. PRD-001, CAS-001 and QS-001 show a ×1000 slab on a public Revit sample. | Holds as stated: high before any paid pilot. "Built" in the overview describes capability, not proven accuracy. The doc should say so. | PRD-001, CAS-001, QS-001, QS-003, QS-004; FM-83 |
| PRD-008 | 02-product | No takeoff for what is not modelled (2D/PDF) | medium | adjusted | medium | competitive | `rules-language.md:229-262`: derived rules (from lines or elements) and manual items. A manual line in the sheet takes a quantity **or a formula** over `building.*` and answers, checked by the engine (`edit-dialogs.tsx:58-131`). The Excel edits import adds new rows as manual lines (`boqs.json:700`). No 2D/PDF measuring anywhere. | The evidence is partly wrong: "Add line creates a manual line without measurement support" understates what exists. The competitive gap (no 2D/PDF, no manual formula over other lines, no CSV block import outside the round-trip workbook) holds, so medium stays. | FM-123 (partial, not missing) |
| PRD-009 | 02-product | Developer demo presets shown to real customers | medium | verified | medium | launch-readiness | `GET /orgs/{org}/presets?kind=rule_set` on my fresh org lists "ACME Ltd house rules", "Demo: as modelled, two slots changed", "Demo: small custom rule set" as `layer: system`. `V5__Seed_system_presets.java:28` seeds `acme-cost-codes`, `demo-trades`, `uniclass2015-ef`. Every `presets/rules/*.json` and `presets/dictionaries/*.json` (including "Duplex project answers") is seeded by folder glob (`:71`). Wizard screen shows them (`01-setup-gate.png`). | Holds. | CAS-009 (same), UX-036, LEAD-015; FM-121 |
| PRD-012 | 02-product | Excel handed to clients mixes internal working | medium | adjusted | medium | flow / export | `xlsx_check.py` on `_scratch/prd/first-boq.xlsx`: BoQ!A2 = "Rules: Petra Design Studio rules (version-9d493c18-… -> petra-design-studio-rules) …". Visible sheets Cover, BoQ, Calculation, Lines, Log (220 rows), Questions, Inputs. Inputs "Model id (sha256)" is empty. **Column I "Line key" is hidden** (`hidden=True`; `boq_import.py:38`), the sheet is protected, and `_boqlet` is `veryHidden` (`:42`). The export API has no profile option (`openapi.yaml:1366-1375`: `format`, `groupBy` only). | The line-key part is wrong: a client sees it only if they unhide the column. The rest holds: the version-UUID chain in A2 (it also shows the rule chain carries a version id where a preset slug is expected), and the internal sheets (Log, Questions, Inputs) are visible. There is one export profile. | CAS-015 (same), QS-016; FM-120 |
| PRD-014 | 02-product | Sample project only on an empty dashboard, never in the wizard | medium | verified | medium | onboarding / spec-issue | `app/(app)/[org]/page.tsx:85-99`: `try-sample` is rendered only when `projects.data?.length === 0`. `useCreateSample` is used nowhere else (grep). The wizard picker lists projects only, and the gate keeps owners out of the dashboard until setup is done, so the sample can't exist when the wizard runs. `scope-and-acceptance.md:88-89` criterion 12 says "on the sample Duplex". | Holds. Criterion 12 can't be run as written in the UI. | PRD-002, CAS-006, QS-017; FM-11, FM-63, FM-64 |
| PRD-015 | 02-product | "COMPLETE" with unquantified lines; question badge counts non-blocking items | medium | adjusted | low | flow | The badge counts `questionCounts.open` (all open questions) but is drawn in the attention colour only when `blocking > 0`, otherwise muted (`boqs/[boqId]/page.tsx:108-113`). Its screen-reader text says "questions to answer" for non-blocking ones too. "Complete" = no blocking questions by rule (BR-10). The header shows "N to confirm" for flagged lines. `contradiction` questions are always `blocking: False` (`measure.py:527`). | Partly by design: the badge already tells blocking from non-blocking by colour, and flagged lines are counted next to the status. The harmful part, a ×1000 contradiction kept non-blocking under "Complete", is PRD-001's root cause, and "Air" blocking is PRD-006 / FM-98. What's left (labels and the sr-only text) is low. | PRD-001, QS-001, PRD-006; FM-95, FM-98, FM-117 |
| PRD-016 | 02-product | Imperial offered at onboarding and project creation, does nothing | medium | verified | medium | spec-issue / feature-gap | `onboarding/page.tsx:104-108`, `projects/new/page.tsx:90-92`, `general-settings.tsx:100-102` and the rule-set editor (`overview.tsx:66`) all offer Imperial. The engine only copies it into `meta.unitSystem` (`worker.py:198-201`), and nothing reads it (grep of `engine/ifc_boq`). `known-limitations` / FM-14, FM-61. | Holds. Units on lines stay labelled metric, so no number is silently mis-scaled, but the user's choice is silently ignored. | FM-14, FM-61 |
| PRD-017 | 02-product | Pilot success measures mostly not instrumented | medium | verified | medium | spec-issue | `overview.md:167-178`: of six measures, three "No", one approximated by the funnel, one "not aggregated", one person check. The funnel's median is in hours, shown to one decimal (`AdminReports.java:121-129`, `funnel.tsx:20-21`), so any median under 3 min shows "0 h". | Holds. | LEAD-017; FM-84 |
| PRD-018 | 02-product | No in-product help, docs, support contact, terms or privacy | medium | verified | medium | launch-readiness | No `mailto:` or support address in `apps/app/src`, `app` or `messages`. The shell nav has Dashboard, Projects, Library, Settings and the account menu only (`messages/en/shell.json`). `app/(public)` has no terms or privacy route. Sign-up has no acceptance (`auth.json`). | Holds. It becomes a blocker (legal) the day public sign-up opens; medium for the invite-only pilot. | FM-04, FM-119 |
| PRD-019 | 02-product | Pricing model not fit for the market: pay-per-project dropped, minutes unpredictable | medium | adjusted | low | spec-issue / pricing-and-plans | D50 (`decisions.md:83`) status "Open (numbers untested)". `plans-and-limits.md:9-15` says "Commercial model (undecided, P17)… Q18 and Q26 track the decision", and the tiers are "placeholders". The plan cards list `processingMinutesPerMonth` (`billing-settings.tsx:20`). S06 parses in 1.5–9 min (context §8). | "Dropped" is wrong: the commercial model is explicitly undecided and the plans are placeholders the admin edits. The reasoning (minutes are a cost measure, not a value measure; bursty users need a pass) is sound input to Q18 and Q26. It isn't a product gap today, hence low. | PRD-003, CAS-012 (asks for a one-project pass too) |
| PRD-020 | 02-product | Scope ahead of validation (pricing module, vendors, four-eyes, co-editing) | medium | adjusted | low | simplification | F11, F17 and F20 = 382 lines of spec; `openapi-pricing.yaml` 1,199 lines; **none of it is built** (P48, 2026-11-14, defers the module). Co-editing (P31) and approval (P29) are built and work (LEAD W2, W4). `open-questions.md` Q1–Q3 unanswered. | The main recommendation ("freeze the pricing module") is already the decision (P48). What's left is advice to measure use of approval and co-editing in the pilot, which are sunk cost. Low. | PRD-021 |
| PRD-021 | 02-product | No rates at all in the core | medium | verified | medium | feature-gap | No rate or unit-rate field in `packages/types/src` or the sheet (grep). Only manual items carry `amount` (`rules.ts:430-431`). The Excel has an empty yellow Rate column with live Amount formulas (`export_xlsx.py:165,196`). `personas.md:64`: saved versions "at milestones (cost check, …)". Pricing is an optional module (P32, deferred P48). | Holds. The gap follows from P32 and P48, and the Excel Rate column is the workaround, so medium. | PRD-020; FM-72, FM-122 |
| PRD-027 | 02-product | Billing shows "Price on request" even for Free; lists only some limits | low | verified | low | pricing-and-plans | `billing-settings.tsx:84-88`: `p.price ? … : t("noPrice")`, with no "Free" for a zero or default plan. The API returns no `price` for any plan. `LISTED` (`:20`) shows 8 keys. The catalogue has 11 (`EntitlementCatalogue.java:23-28`), so `libraryOrgPresets`, `auditLogRetentionDays` and `shareLinks` never show. | Holds. The admin can set Free's price to 0, which would show "€0.00 per month". | UX-039, CAS-012, PRD-003 |
| CAS-003 | 03-casual-user | No PDF; the Excel prints badly (6 portrait pages, no repeated header) | high | adjusted | medium | export | `xlsx_check.py` on `cas/x1/after-regenerate.xlsx` and `baseline/engine/S05-default/boq.xlsx`: every sheet has `orientation=None`, no fit-to-page, no print titles, no print area and no footer. The engine sets no page setup (grep `page_setup|print_title|fitTo` in `engine/ifc_boq` is empty). BoQ column widths add up to about 184 characters (`export_xlsx.py:165-166`), more than a portrait page. The reviewer's printout `cas/x1/boq-print.pdf` has 6 pages. No PDF export (`openapi.yaml:1374` `enum: [xlsx]`). | Facts hold. PDF is an explicit v1 "out" (`scope-and-acceptance.md:39`). The print problem is a small page-setup fix with a manual workaround (Excel's "fit to page width"), and the share link gives clients a readable view. That makes it a meaningful gap with a workaround: medium. | QS-016 (same print-setup root), PRD-005; FM-46 |
| CAS-009 | 03-casual-user | "Demo:" and "ACME Ltd" presets shown to a real customer | medium | verified | medium | spec-issue | Same evidence as PRD-009, plus "Duplex project answers" as a system dictionary (`presets/dictionaries/project-duplex.json`, seeded by glob). | Holds. | PRD-009 (same), UX-036, LEAD-015; FM-121 |
| CAS-012 | 03-casual-user | No price anywhere; upgrading leads to "contact us" | medium | verified | medium | pricing | Reproduced: four "Price on request" cards, "Choose" → "Plans can't be changed here yet… contact us." (`04-billing-choose.png`). On the billing page, limit bars use `usedOf` "{used} of {max}" with no unit (`settings.json:107`; `billing-settings.tsx:67`). (The usage page itself does say "min": `usage-settings.tsx:69-71`.) | Holds. Prices are unconfigured admin data (P57). The missing unit is on the billing page's limit bars, not the usage page. | PRD-003, PRD-027, LEAD-011, UX-039 |
| CAS-015 | 03-casual-user | Excel is an audit workbook, not something to send a client | medium | verified | medium | export | `xlsx_check.py` on `cas/x1/after-regenerate.xlsx`: 7 visible sheets, Calculation 393 rows, Log 652, Questions 76. A2 holds the version-UUID chain. The Cover rows are fixed (`export_xlsx.py:248-254`): no client and no firm name; "Generated" is a raw ISO timestamp; "Locale en". The Ref column is the classification code; the item number is in J "No." as text (`:207-208`). | Holds. | PRD-012 (same), QS-016; FM-120 |
| LEAD-010 | 05-team-lead | No team or portfolio oversight: "Needs you" is personal | medium | verified | medium | reporting | `org/Attention.java:24-79`: every branch is restricted to the user (`:user = ANY(r.reviewers)`, `submitted_by = :user`, `n.created_by = :user`, `r.created_by = :user`, `j.created_by = :user`). No team view in the app routes. | Holds. | LEAD-017, LEAD-014 |
| LEAD-011 | 05-team-lead | Prices "on request"; read-only and approver seats cost the same | medium | verified | medium | cost / spec-issue | `EntitlementService.seats` (`:139-144`) = every membership plus pending invitations, whatever the role; approver and viewer are project roles on top of an org membership. Team `seats: 25` (API). No prices (as above). | Holds. Tier sizes are placeholder admin data (changeable without code). Role-dependent seat counting would need code. | PRD-003, CAS-012, PRD-019 |
| LEAD-014 | 05-team-lead | Staffing projects is one person at a time | medium | verified | medium | collaboration | `POST /projects/{id}/members` takes one `{userId, role}` (`openapi.yaml:460-475`). The project settings add one email (with an org-member datalist) and one role per submit (`projects/[projectId]/settings/page.tsx:153-212`). An invitation is `{email, role}` only (`openapi.yaml:211-215`). No groups (FM-101). | Holds. | FM-101 |
| LEAD-017 | 05-team-lead | Usage shows only this month, by project | low | verified | low | reporting | `UsageResponse` = `month, processingMinutes, byProject, byKind` (`openapi.yaml:2855-2871`). The usage page calls `useUsage(org.id)` with no month (`usage-settings.tsx:15`). The API does accept `?month=` (`GET …/usage?month=2026-10` → 200 in `api-checks.mjs`). | Holds. Past months can be read through the API but not in the UI. No per-person view, no export. | PRD-017; FM-84 |
| QS-016 | 04-civil-engineer | The Excel BoQ falls short of a professional bill | medium | verified | medium | export | Baseline S05-default BoQ: Ref = classification code repeated on the group row and on each line ("A.01"). "No." is written as text (`export_xlsx.py:208` `data_type = "s"`; `'1'` in the PRD and CAS workbooks). Duplicate descriptions: S05-default "Edge formwork to slabs" ×2; S05-standard "Paint to plasterboard wall surfaces" ×4, "board.plasterboard, 16 mm (normal height)" ×4 and three more pairs (script output). `grep -c itemText` in the three shipped code lists gives 0. No print setup (as CAS-003). A fresh org's BoQ is "Unclassified" (PRD and CAS workbooks row 6). | Holds. | CAS-003, CAS-015, PRD-012; FM-46, FM-120 |

---

## 3. Feature matrix

Every non-built row in §6 and §6a, plus the built rows a report disputes. "Confirmed" means a
grep or read matched the matrix. Rows in other verifiers' areas (engine geometry, viewer, a11y) got
a spot check only, as noted.

| FM | Feature | Matrix status | Checked status | Evidence | Note |
|---|---|---|---|---|---|
| FM-03 | Bot protection for sign-up | partial | partial (confirmed) | `NativeAuthController.java:53-56` honeypot `website` and `elapsedMs < MIN_FILL_MILLIS`; `elapsedMs` comes from the client (`native-links.tsx:122`) | |
| FM-04 | Terms / privacy at sign-up | missing | missing (confirmed) | no terms or privacy route in `app/(public)`, no acceptance in `auth.json` | PRD-018 |
| FM-05 | Invite during onboarding | missing | missing (confirmed) | `orgs.json:15` promises "You can invite colleagues next"; onboarding creates the org only | PRD-024, CAS-021, UX-033 |
| FM-06 | Takeover prompt names the place | missing | missing (confirmed) | `Sessions.java:19,146` reads `place`; nothing in `identity/` writes it | |
| FM-07 | Configurable idle expiry | missing | missing (confirmed) | `Sessions.java:36,102,116` `interval '12 hours'` | |
| FM-08 | `ownedOrgsPerUser` on ownership transfer | diverges | diverges (confirmed) | `checkOwnedOrgs` called only from `Orgs.java:63` (create); the role change (`:162-175`) doesn't check it | `plans-and-limits.md` "Definitions" itself says "checked when someone creates an org", so the specs disagree with each other (F01 vs plans-and-limits) |
| FM-10 | MFA, enterprise SSO/SCIM | missing | missing (confirmed) | no TOTP or WebAuthn; `OidcConfiguration.java` is one optional platform-wide JWT issuer (`BOQLET_OIDC_ISSUER`), not per-org SSO | |
| FM-11 | Projects incl. sample project | built | built, with a gap | sample offered only on an empty dashboard (`[org]/page.tsx:85-99`) | PRD-014 |
| FM-12 | Default-preset pickers | missing | missing (confirmed) | `projects/new/page.tsx` has currency, units and language only; project settings have no preset fields | LEAD-002 |
| FM-13 | Warning on archived default preset | missing | missing (confirmed) | no such check in `features/projects` or `boqs/setup-tab.tsx` | |
| FM-14 | Unit system changes output | missing | missing (confirmed) | `worker.py:198-201` writes `meta.unitSystem`; no reader in `engine/ifc_boq` | PRD-016 |
| FM-16 | Uploads > 100 MB | missing (likely broken) | missing (confirmed in code) | `upload.ts:33` PUTs the whole file to `created.upload.url`, never reads `parts` | not run (shared stack); ENG-002 |
| FM-17 | `.ifczip` upload | diverges | diverges (confirmed) | `upload-button.tsx:60` `accept=".ifc"` | |
| FM-18 | Scope rules editable | missing | missing (confirmed) | `setup-tab.tsx:186-187` "Whole model or the number of scope rules" (read-only) | |
| FM-19 | Version list: used by, note, compare, delete | missing | **partial** | note shown on the version page (`versions/[versionId]/page.tsx`); no `DELETE /model-versions` call in the app, no used-by, no compare | correction: the note exists |
| FM-20 | Coordinate alignment | missing | missing (accepted) | v1 "out", Q11 | not re-checked in code |
| FM-22 | Earlier run read-only | missing | missing (confirmed) | the sheet renders only the current run; no run-id view route | |
| FM-23 | "Generate a BoQ" in model-ready notification | diverges | diverges (confirmed) | the notification links to the version page (`Jobs.java:370`), which has the "Generate a BoQ" button (`models.json:115`) | |
| FM-25 | Questions filtered by model | missing | missing (confirmed) | `questions-tab.tsx:50` filters by state and kind only | |
| FM-26 | AI name suggestions | missing | missing (confirmed) | `dictionary.ts:159-165` settings only; `names.py` has no suggester | |
| FM-27 | Local-language names at scale | missing / spec questionable | missing (confirmed) | `known-limitations.md:20` | PRD-006 |
| FM-29 | Server-side grouping > 20k lines | missing | missing (confirmed) | `hooks/sheet.ts:25` pages `limit: 20000` and groups in the browser | |
| FM-30 | Three-line clamp | missing | missing (confirmed) | no `line-clamp` in `features/boq-sheet` | |
| FM-31 | Global search | missing | missing (confirmed) | no search or command palette in `apps/app/src` | |
| FM-33 | Viewer filter bar | missing | missing (spot check) | `model-viewer.tsx` has a storey filter only | frontend area |
| FM-34 | Viewer at scale | missing | missing (spot check) | per-mesh picking in `scene-view.ts`; no id-buffer | frontend area |
| FM-36 | F08-AC4 timing automated | missing | missing (accepted) | F08 status | not re-checked |
| FM-38 | Audit action names as specified | diverges | diverges (confirmed) | actions in code: `model_version.created`, `run.completed`, `boq.*`; no `edits.imported` anywhere in `services/api` | |
| FM-39 | Changes tab for viewers | diverges | diverges (confirmed) | `boqs/[boqId]/page.tsx:64` shows Changes only with `seeAudit` or `editBoqs` | P54 Q44's list of what viewers see doesn't include Changes either: the spec is inconsistent, not just the code |
| FM-41 | Library rebase, unarchive, rename, diff, keep columns | missing | missing (spot check) | no rebase or unarchive-preset operation in `openapi.yaml` (only `unarchiveProject`) | LEAD-001 |
| FM-42 | "Reads as" sample without preview | partial | partial (confirmed) | `item-text-box.tsx:40-44`: blanks read as their names without a preview line | |
| FM-43 | Pricing module | missing (deferred P48) | missing (confirmed) | contract only (`openapi-pricing.yaml`, 1,199 lines) | |
| FM-45 | Workbooks verified in Excel / LibreOffice | partial | partial | the CAS reviewer opened and printed a workbook in Excel through COM (`cas/x1/boq-print.pdf`); no formal F12-AC1 check | |
| FM-46 | GAEB, ÖNORM, CSV, IfcCostSchedule, PDF | missing | missing (confirmed) | `exportRun` `format: enum [xlsx]` (`openapi.yaml:1374`); CSV only for audit, decisions and admin orgs | PRD-005, CAS-003, QS-016 |
| FM-47 | Client template / previous-BoQ import | missing | missing (confirmed) | only preset Excel templates (`downloadPresetTemplate` / `importPresetTemplate`) and the round-trip edits import | |
| FM-49 | Email language follows the UI | diverges / spec questionable | diverges (confirmed) | `EmailDelivery.java:116-197` English and Serbian; UI catalogues `en`, `en-XA` only | |
| FM-50 | `model_version.ready` email after > 2 min | partial (unverified) | **missing** | `Jobs.java:360-380` sends the notification with `category = null`; `Notifications.java:46-48` returns before the outbox when no module template gives a category. No 2-minute threshold anywhere | correction (medium confidence: code read; MailHog not re-checked) |
| FM-51 | Plans and entitlements | built | built (confirmed) | API `402`s seen by the reviewers; admin plans editable | no prices seeded: every card shows "Price on request" (PRD-027) |
| FM-52 | Billing provider adapter, checkout, portal, webhooks | missing | missing (confirmed) | `BillingController.java:52-75` `409 checkout_unavailable`; portal echoes the return URL (reproduced `200 {"url":…}`); webhook `400` | |
| FM-53 | Trial from plan config + expiry job | missing | missing (confirmed) | no `trialPlanId` or `trialDays` anywhere in Java; `AdminOrganisations.java:137` sets `trial_ends_at` and status only | PRD-004 |
| FM-54 | Downgrade handling | missing | missing (confirmed) | no read-only-excess logic in `billing/` or `project/` (only `project_archived`) | |
| FM-55 | Admin revenue | missing | missing (confirmed) | `AdminReports.java:85` `tiles.put("revenue", snapshot(null))` | |
| FM-56 | Plan versions / grandfathering | missing | missing (confirmed) | P57: a change applies to every org at once | |
| FM-57 | Usage minutes = wall-clock | diverges | diverges (confirmed) | `Jobs.java:333` prefers the engine's `durationMs`, falls back to wall-clock | |
| FM-59 | Languages other than English | missing | missing (confirmed) | `apps/app/messages`: `en`, `en-XA` | |
| FM-60 | Engine log entries translatable | partial | partial (confirmed) | `messages/en/engine.json` has no `log` keys | |
| FM-61 | Imperial output | missing | missing (confirmed) | as FM-14 | |
| FM-62 | Setup wizard | built (simplified) | built (simplified) | works end to end (reproduced the gate and start screen) | runs before any model exists (PRD-002) |
| FM-63 | Wizard as specified | missing | missing (confirmed) | no "Suggest codes", "in progress by" or "Start separately" in `setup.json` or `features/setup` | |
| FM-64 | First setup < 15 min (v1-12) | partial (unverified) | partial (unverified) | the criterion names the sample Duplex, which the wizard can't use (PRD-014) | spec-issue: the criterion can't be run as written |
| FM-65 | Vendors | missing (deferred) | missing (confirmed) | contract only | |
| FM-67 | Share sheet virtualised | missing | missing (spot check) | no `useVirtualizer` in `app/(public)/s` or `features/shares` | |
| FM-68 | Share rate limit 60/min | diverges | diverges (confirmed) | `ShareController.java:36` default 300 | |
| FM-70 | Admin vendors, ops links, webhook failures and bounces in health | missing | **partial** | `health.tsx:29-34` has "billing webhook failures" and "email bounces" tiles; the API doesn't send them, so they show "Not tracked" (`:21-22`); vendors and ops links are missing | correction |
| FM-71 | Suspended org: write buttons hidden | partial | partial (confirmed) | the only `suspended` UI is in the admin `org-detail.tsx`; customer pages have no suspended state | |
| FM-72 | Pricebooks / estimate | missing (deferred) | missing (confirmed) | contract only | PRD-021 |
| FM-73 | Full CSP | missing | missing (confirmed) | `next.config.ts:41` `frame-ancestors 'none'` only | |
| FM-74 | Scoped worker storage, shared secret | missing (accepted) | missing (confirmed) | no token or secret check in `worker_http.py` (grep) | |
| FM-75 | Org data export, account deletion | missing | missing (confirmed) | `/me` has `get` and `patch` only; no org export operation | |
| FM-76 | Audit rows for failed permission checks and webhooks | missing | missing (spot check) | nothing in `audit/` writes denied checks | |
| FM-77 | `Retry-After` on `auth_throttled`; one 429 code | diverges | diverges (confirmed) | `NativeCredentials.java:56,221` `auth_throttled` without `Retry-After`; `RateLimits.java:41-47` `rate_limited` with it | |
| FM-78 | Staging | missing | missing (accepted) | P51 | |
| FM-79 | Pilot ops | missing | missing (accepted) | `roadmap.md` "Now" | not checkable locally |
| FM-80 | Shared suites against the local stack | missing | missing (accepted) | context §4 | |
| FM-81 | Browser coverage (Library, viewer, admin, wizard, axe, pseudo-locale) | missing | missing (confirmed) | `apps/app/e2e-java` has 14 specs; no axe or `en-XA` use; the wizard covers the suggested-answers path only (`accounts.spec.ts:9`) | |
| FM-82 | Medium-model parse ≤ 5 min | missing | missing (accepted) | context §8 | |
| FM-83 | Accuracy validated against a professional BoQ | missing | missing (confirmed) | `known-limitations.md:18` | PRD-007 |
| FM-84 | Pilot measures instrumented | partial | partial (confirmed) | `overview.md:171-178`; funnel only, medians in hours | PRD-017, LEAD-017 |
| FM-85 | Recess detection from geometry | missing | missing (confirmed) | `measure.py:143-148`: recess only when typed (`RECESS` / ObjectType) | engine area |
| FM-86 | Steel section table | missing | missing (spot check) | `engine/ifc_boq/data` has `families.json` and `quantity_sources.json` only | engine area |
| FM-87 | Contradiction thresholds as settings | missing | missing (confirmed) | `measure.py:63-64` constants | |
| FM-88 | Location for infrastructure parts | missing | missing (spot check) | `parse.py:56-58` maps `IfcFacilityPart` as spatial; known-limitations says lines get no location | engine area |
| FM-89 | Terrain / planting by area or volume | missing | missing (confirmed) | `families.json:38` `IfcGeographicElement: countable` | |
| FM-90 | Spatial index for overlaps | missing | missing (confirmed) | `federation.py:126` boxes sorted by min x | |
| FM-91 | Per-face embedded intersection | missing | missing (accepted) | known-limitations | engine area |
| FM-92 | Building gross volume from envelope | missing | missing (accepted) | `rules-language.md:204-209` | engine area |
| FM-93 | Opening placement on faces; 2nd-level space boundaries | missing | missing (confirmed) | `parse.py:773-783` keeps space-boundary topology only (space, element, physical, external), no geometry | |
| FM-94 | ArchiCAD quantity names verified | partial | partial (accepted) | `quantity_sources.json` | engine area |
| FM-95 | More contradiction kinds | missing | missing (confirmed) | `measure.py` asks `thickness` and `volume` only (`:301,318`) | |
| FM-96 | Cancellation inside native calls | partial | partial (confirmed) | `worker.py:41,132,400` `JobCancelled` between stages | |
| FM-97 | Design options, phases | partial | partial (accepted) | `measure.py:66-68` phase and status maps | |
| FM-98 | Placeholder material names non-blocking | missing | missing (confirmed) | `known-limitations.md` "Placeholder material names" | PRD-006 |
| FM-99 | IDS checks | missing | missing (accepted) | v1 "out" | |
| FM-100 | CDE pull | missing | missing (accepted) | v1 "out" | |
| FM-101 | Teams, custom roles | missing | missing (confirmed) | org roles owner, admin, library_editor, member only | LEAD-014 |
| FM-102 | Admin support inbox, announcements | missing | missing (accepted) | F19 "Later" | |
| FM-103 | Wizard "start from your last BoQ" | missing | missing (accepted) | Q23 | |
| FM-104 | Read-only ≥ 768 px; mobile | partial | not re-checked | UX verifier's area | |
| FM-109 | On-premise | missing (later) | missing (accepted) | P09 | |
| FM-110 | WCAG 2.2 AA | partial (unverified) | not re-checked | UX verifier's area; no axe in `e2e-java` (FM-81) | |
| FM-111 | Engine result invariants | missing | missing (spot check) | no uniqueness or sum assertions in `pipeline.py` or `rules.py` (grep) | engine verifier |
| FM-112 | Stale-edit detection on overrides | missing | missing (confirmed) | `overrides.py:25-28` records the current engine quantity when it applies the edit; nothing stores or compares the quantity at edit time | |
| FM-113 | Safe regex engine and timeouts | missing | missing (confirmed) | `names.py:15` stdlib `re`; no timeout | |
| FM-114 | Locale-aware number parsing on import | missing | missing (confirmed) | `boq_import.py:45-53` replaces "," with "." (so "1,234" reads as 1.234) | ENG-018 |
| FM-115 | Unit registry with dimensions | missing | missing (spot check) | no shared unit module in `packages/types/src` | engine verifier |
| FM-116 | Dependency scanning in CI | missing | missing (confirmed) | `.github/workflows/ci.yml` has no audit, CodeQL or Dependabot step (grep); no `dependabot.yml` | |
| FM-117 | Unit-scale sanity check that blocks | missing | missing (confirmed) | contradictions are always `blocking: False` (`measure.py:527`) | PRD-001 |
| FM-118 | Upgrade request that reaches the operator | missing | missing (confirmed) | `createCheckout` throws with no record (`BillingController.java:52-56`); the message has no link | PRD-003 |
| FM-119 | In-product help, docs, support | missing | missing (confirmed) | see PRD-018 | |
| FM-120 | Client "issue" export profile | missing | missing (confirmed) | `exportRun` takes `format` and `groupBy` only | line keys are already hidden (PRD-012) |
| FM-121 | System presets without ACME/Demo | diverges | diverges (confirmed) | `V5__Seed_system_presets.java:28,71`; live API list on a fresh org | |
| FM-122 | Simple firm rate library | missing | missing (confirmed) | no rate in `packages/types/src` | |
| FM-123 | Aids for non-modelled work | missing | **partial** | derived rules (`rules-language.md:229-244`); manual-line formula over `building.*` and answers (`edit-dialogs.tsx:58-131`); Excel import adds new rows as manual lines (`boqs.json:700`); no 2D/PDF, no formula over other lines in the sheet | correction (PRD-008) |

Matrix corrections in short: **FM-19 → partial, FM-50 → missing, FM-70 → partial, FM-123 → partial**. Notes
added to **FM-08** (the specs disagree with each other), **FM-11** (sample only on an empty dashboard),
**FM-39** (P54 Q44 agrees with the code), **FM-64** (criterion not runnable as written) and **FM-120**
(keys already hidden).

---

## 4. Details

**PRD-002 (high → medium, adjusted).** Reproduced on my fresh org. After sign-in the app lands on
`/verify-prd/setup`, and `/verify-prd`, `/verify-prd/projects` and `/verify-prd/library` all redirect there.
The start screen offers "Model to try it on: Pick a project…" with no options, and lists five rule sets,
three of them ACME/Demo. The code sends every org page except setup and settings to the wizard for people
who can finish it (`setup-gate.tsx:12-18`). The wizard can only preview on a project's model
(`ModelVersionPicker`), and the sample can only be created from the empty dashboard, which the gate hides.
So on a first run the wizard can't show a single line. Why medium: the reviewer's own timing is 28 s for the
fast path, and the result is a usable (if As-modelled) rule set. This is friction and a wasted Free
`libraryOrgPresets` slot, not a blocked core job. The spec-issue against P18 stands: the decision assumed
value before the first BoQ that the build can't deliver.

**PRD-003 (high, verified).** Reproduced through the API and the UI. Free: 1 seat, 1 active project, no
approval, watermark. Checkout returns `409 checkout_unavailable` and the portal echoes the return URL. All
four cards say "Price on request". "Choose" shows "Plans can't be changed here yet. The boqlet team changes
your plan: contact us." with no link or address. `createCheckout` throws before writing anything, so the
operator never sees the intent (unlike `limit_events`). No trial exists (FM-53). Correction to the
evidence: the prices are not missing from the code. P57 makes them admin data, and none are seeded
(V23 adds nullable `price_amount` and `price_period`). High holds for any self-serve launch, which the
admin can open at any time (public sign-up is a platform setting). During the invite-only pilot the
operator works around it by setting plans by hand.

**PRD-005 (high → medium, adjusted).** The factual basis holds for Germany and Austria: Excel is the only
export, and GAEB is the expected exchange format in German public tenders. A web search found that a
procurer may require GAEB files and that a bid sent as PDF instead of the required GAEB file was excluded
(OLG Köln, 07.02.2024, 11 U 118/20, cited by Rödl & Partner and Wolters Kluwer). I found no statute that
requires GAEB everywhere, so "cannot use" is too strong as a legal claim. Treat the ÖNORM A 2063 practice
in Austria as plausible but not independently verified. The framing is the main problem: `personas.md`
doesn't pick DACH as the first market. It names a class of design-led markets (DACH, CEE, the Balkans, much
of the Middle East and Asia), and the overview makes the product international by principle (P35).
Several of those markets commonly use Excel BoQs, and the email templates already include Serbian
(`EmailDelivery.java`). Q12 and roadmap #12 track GAEB/ÖNORM "per market". So this is a known, open
market-sequencing question with a recommendation attached. Medium, spec-issue.

**PRD-007 (high, verified).** `known-limitations.md:18` says accuracy on real projects is unknown, "the
biggest open question". `overview.md:57-59` marks O1 ("in minutes") and O3 ("Trust every number") as
"Built". The roadmap lists reference projects as unscheduled candidate #3. PRD-001, CAS-001 and QS-001
show a public Revit sample with a ×1000 slab marked "measured" and "COMPLETE", so the risk is not
hypothetical. High holds for paid use. The overview should separate "the capability is built" from "the
outcome is validated".

**PRD-008 (medium, adjusted: evidence).** The report says "Add line" creates a manual line "without
measurement support". In fact the manual-line dialog takes a quantity or a **formula**, checked by the
engine through a temporary slot (`edit-dialogs.tsx:58-67, 106-131`). The formula context is building values
and answers (`rules-language.md:210-211`). Derived rules already produce lines from other lines or elements
(the 12 derived rules in As modelled), and the Excel edits import adds new rows as manual lines. What
holds: no 2D/PDF measuring, no manual-line formula over other lines from the sheet, no item templates as
such (only rule-set manual items), and no CSV block import outside the round-trip workbook. The
competitive point (two tools for a full tender BoQ) is sound, so medium stays.

**PRD-012 (medium, adjusted: evidence).** Checked in `first-boq.xlsx` and `cas/x1/after-regenerate.xlsx`.
BoQ!I5 "Line key" exists but column I has `hidden=True`, the sheet is protected, and the `_boqlet`
snapshot sheet is `veryHidden` (`boq_import.py:21-42`). A recipient sees the keys only by unhiding the
column. Everything else holds:
- A2 shows "(version-9d493c18-… -> petra-design-studio-rules)". The chain also carries a version id
  where the parent's slug would be expected, which is worth a look by the engine verifier.
- The Log, Questions, Inputs and Calculation sheets are visible.
- Inputs "Model id (sha256)" is empty.
- There is no export profile in the API.

**PRD-015 (medium → low, adjusted).** The tab badge does count every open question, including
non-blocking ones. But it already looks different: the attention fill when anything blocks, a muted outline
otherwise (`boqs/[boqId]/page.tsx:110`). Only the screen-reader text ("questions to answer") doesn't tell
them apart. "Complete" means "no blocking questions" by business rule BR-10, and the header shows flagged
lines as "N to confirm". What is really wrong comes from other findings:
- A ×1000 magnitude contradiction is non-blocking (every `contradiction` is `blocking: False`,
  `measure.py:527`). That is PRD-001 / QS-001.
- "Air" as a blocking name question is PRD-006 / FM-98.

Without those, the rest is wording. Low.

**PRD-019 (medium → low, adjusted).** "Pay-per-project entry point dropped" isn't what the docs say.
D50's status is "Open (numbers untested)". `plans-and-limits.md` calls the commercial model "undecided
(P17)", with Q18 and Q26 tracking it, and all tiers "placeholders to tune" by the admin. The reasoning
holds: processing minutes are a cost measure, they are on the plan cards, and S06 alone takes 1.5–9 min
of parse. Two points carry over to Q18 and Q26: a time-boxed single-project pass needs a mechanism plans
can't express today (no expiry, FM-53), and minutes should be a fair-use note. That is decision input,
not a gap. Low.

**PRD-020 (medium → low, adjusted).** The pricing module, vendors and offer requests are specified
(382 lines) and have a contract (1,199 lines), but nothing is built: P48 deferred them on 2026-11-14, which
is already the "freeze" the report recommends. Approval and co-editing are built and work well (LEAD W2,
W4), so the "built before validation" point is about sunk cost. What's left, measuring their use in the
pilot, is fair but minor. Low.

**CAS-003 (high → medium, adjusted).** Confirmed:
- No sheet in any exported workbook has orientation, fit-to-page, print titles, a print area or a footer,
  and the engine never sets them.
- The BoQ columns add up to about 184 characters of width, far wider than a portrait page.
- The reviewer's Excel printout has 6 pages (`cas/x1/boq-print.pdf`).
- There is no PDF export.

Why medium: PDF is an explicit v1 "out" ("Excel first; add per market", `scope-and-acceptance.md:39`). The
print problem has a manual workaround (Excel's fit-to-width) and a cheap code fix (landscape, fit to one
page wide, print titles row 5, footer). Clients can also get the read-only share link instead of a
printout. It hurts every send-out, but it doesn't block the core job.

---

## 5. Judgement calls

1. **Configuration versus code.** Where a shortfall is admin data under P57 (prices, tier sizes, seat
   counts per plan), I kept the product finding (the shipped state is what a customer sees) but say in
   the correction that no code change is needed. I didn't set any price or plan to prove it, per the
   shared-stack rules.
2. **Pilot versus public launch.** "High" for PRD-003 assumes public sign-up can open at any time (P57
   makes it a platform switch). PRD-018 stays medium because the pilot is invite-only today. It becomes
   high, for legal reasons, before public sign-up opens.
3. **Market claims.** The GAEB practice claim is backed by one WebSearch (court case and practice
   documents, no full page fetched). The ÖNORM A 2063 practice in Austria and competitor prices or trials
   (PRD-003 §4) were **not independently verified**. I didn't re-run the PRD reviewer's competitor table.
4. **FM-50 correction** comes from reading the code path (category `null` → no outbox row). I didn't
   wait for a parse and look in MailHog. Medium confidence.
5. **Duplicates.** I counted CAS-009 = PRD-009, CAS-015 = PRD-012, CAS-012 ⊂ PRD-003 + PRD-027 as the
   same root causes and kept every row verified, so each report stays consistent. The final blueprint
   should merge them.
6. **Matrix rows in other verifiers' areas** (engine geometry FM-85–98, viewer FM-33/34, a11y FM-104/110,
   ENG-proposed FM-111/115) got a grep-level spot check or were accepted as written. They are marked
   "spot check", "accepted" or "not re-checked".
7. I left my org "Verify PRD" with setup unfinished on purpose (to reproduce the gate). It holds no
   projects or models.
