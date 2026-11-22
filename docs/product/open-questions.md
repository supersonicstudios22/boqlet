# Open questions and assumptions to validate

What the product assumes but nobody has confirmed, and the questions still open. The owner
decides when each is closed. The "Needed by" list says which ones block a later step. Settled
decisions are in `docs/decisions.md` (P01–P53, D01–D70). A question that blocks work is added
here first (with "Blocks: <task>") and then asked (`docs/development/workflow.md`).

## Needed by (what blocks what)

| When | Must be answered | Who |
|---|---|---|
| Open | The boqlet wordmark as SVG (light and dark) and a favicon; until then it is set in the display face | Owner |
| ~~Start of phase 2 (BE-000)~~ *Done 2026-11-16: answers in `docs/decisions.md` (backend decisions).* | Every item in `docs/archive/plan/backend-decisions-to-make.md`: the open ones D1–D18 (budget, auth, hosting, compute, uploads, abuse, engine upgrades, delivery, operations, data protection, contract changes; Q16 and Q17 among them) and the decisions already in the plan B1–B20, to confirm or change, after the agent's analysis (P47) | The backend owner (whoever runs phase 2), asked by the backend agent; product-behaviour changes (including how users are told about engine upgrades, D14) go to the product owner |
| When the owner schedules BE-032 (a future todo, P51) | A hosting account for a separate staging environment, with credentials the agent can use | Owner |
| ~~Before FE-047 (release)~~ | Confirm the pilot host becomes production (P51), the domain, and the provider secrets for email (D6) and billing (D7) (auth is native, P50); whether the pricing module is on at launch; the go to merge `v_1` into `main`. *Answered 2026-11-21, the owner: email and billing stay as the pilot has them (no new provider for the release). The go to merge: given 2026-11-21; merged and released as v1.0.0.* | Owner |
| Open (since the v1 release) | Remove or repoint the Vercel demo project; the PoC stays reachable as the git tag `poc-final` | Owner |
| Open (test campaign, 2026-11-22) | Q42–Q61: product behaviour the specs leave open or contradict, found by the test campaign; each blocks its finding in `docs/testing/test-findings.md` | Owner |
| Before public launch | Q18 and Q26 (tiers, limits, prices), Q19 and Q20 (legal) | Owner (+ lawyer) |
| After pilots | Q1–Q3, Q7, Q8, Q10–Q15, Q23, Q24, Q27–Q30, Q32–Q39 | Owner, with pilot firms |

## Users and market (highest risk)

| # | Assumption | How to validate | If wrong |
|---|---|---|---|
| Q1 | Design and engineering firms in design-led markets produce tender BoQs themselves and would pay per seat for this (P01) | Interview 5–10 firms (architects, structural/MEP engineers) in 2–3 countries; show the Duplex demo | Lead with QS firms; onboarding and wording change, flows don't |
| Q2 | Their models are good enough that most quantities come from them | Run pilot firms' real models through `npm run corpus` before selling; measure % of lines measured/derived vs flagged | Invest in question UX and dictionaries (Q8) before features |
| Q3 | (Pricing module) Vendors will keep a pricebook in the app and answer offer requests from it, instead of their own sheets | Ask pilot firms' usual vendors; test the vendor pages with 3 contractors | Make Excel the primary vendor path; the portal becomes a viewer + upload |
| Q4 | ~~Firms want one BoQ split into packages~~ | Closed by P34: no packages; offer requests on any selection | — |
| Q5 | ~~Sealed bids by default~~ | Closed by P34: no sealed bids | — |
| Q6 | ~~Clients approve in the app~~ | Closed by P28: clients get share links, no accounts | — |
| Q7 | (Pricing module) Vendors' clarification questions can stay in email | Pilot | Add a message thread per offer request |

## Product and engine

| # | Question | Notes |
|---|---|---|
| Q8 | How should unknown local-language names be handled at scale: per-language seed dictionaries, bSDD, or AI suggestions with confirmation? | docs/product/known-limitations.md marks this as the main blocker on real files. AI suggestions are out of v1 (03-v1-scope) but may need to come early if Q2 shows many names |
| Q9 | ~~Which first rulebook preset ships beside "As modelled"?~~ | Closed by P35: no market is built in; firms build theirs with the setup wizard and the Library |
| Q10 | Are MEP models in scope for the first pilots? | Federation runs on MEP untested (docs/product/known-limitations.md); affects ownership defaults |
| Q11 | Is coordinate alignment needed for v1 pilots (models exported with different origins)? | Out of v1; check pilots' export practice |
| Q12 | Do firms need GAEB / ÖNORM export at launch in DACH? | Excel only in v1 |
| Q13 | (Pricing module) Should offers a firm receives feed its own pricebook ("save these rates as our prices")? | Pricebooks are the core (P33); offers already flow into estimates |
| Q14 | (Pricing module) Should vendors be able to propose alternative items or quantities? | Today: notes per line + qualifications |
| Q15 | Is the line key stable enough across rule-set edits for change reports that users trust? | Rule-set changes show as remove + add; may need a key-mapping table on rule renames |
| Q22 | ~~Which rule-set questions does the setup wizard ask?~~ | Closed by P42: derived from the rule set's data (switches and their follow-ups) plus six marked measuring screens; F16 "Wizard content for As modelled" |
| Q23 | How should "start from your last BoQ" (F16, after v1) match a past BoQ's items to kinds of line: name matching, rules on units, or AI suggestions with confirmation? | Same family as Q8. Only the firm's own documents (BR-53) |
| Q24 | Do firms need item texts in two languages in one BoQ (bilingual tenders)? | P14 stores one text per code; `CodeList.locale` gives its language. A second text would be `Code.titles`-style translations, later |
| Q25 | ~~Reminder or checklist for work not in the models?~~ | Closed: a plain reminder (P15, BR-12); firms add the rest as manual lines |
| Q26 | What are the paid tiers priced on: active projects, seats, or both (P17)? And what does the default tier include? | Entitlements support any combination; decide before public launch, with Q18 |
| Q27 | Single session (P22): is 12 h idle the right expiry, and should one person be allowed a phone and a laptop at once later (a "same person, second device" allowance)? | v1: strictly one; watch support requests |
| Q28 | Should platform admins ever see project content for support, and how is it granted (owner grants time-limited access, audited)? | v1: metadata only (BR-57) |
| Q29 | (Pricing module) Do vendors need company accounts (several people pricing for one vendor, shared offers)? | v1: one person per vendor account; the firm can invite colleagues of a vendor separately |
| Q30 | Should a share link be able to carry the estimate (pricing module) for a client? | v1: never prices (BR-56); would be a module extension of the share page |
| Q32 | (Pricing module) Should vendors' remembered matches be keyed by the firm's item numbers (as planned) or by the line text, when firms renumber their code lists? | Planned: item number + unit, text when no number (F20 §3) |
| Q31 | ~~Is one monospace font readable enough for long texts?~~ | Closed by P43: prose in JetBrains Mono at 14 px / 1.6 with ~72-character lines, Inter Tight for display |

## Platform

| # | Question | Owner of the answer |
|---|---|---|
| Q16 | ~~Authentication provider~~ | *Answered: Keycloak at BE-000, then native email and password sign-in in Java (P50, 2026-11-18).* |
| Q17 | Hosting provider and region | *Answered for the pilot: Contabo, the only deployed environment (P51, `docs/operations/pilot.md`). Open for a separate staging environment (BE-032) and for production at scale.* |
| Q18 | Plan limits and prices | Owner, before public launch (`docs/product/plans-and-limits.md`) |
| Q19 | Legal: terms of service, DPA, vendor terms (vendors are not customers) | Owner + lawyer |
| Q20 | Data retention for vendors' offers after org deletion (BR-52) | Owner + lawyer |
| Q21 | Support model for custom presets (service revenue with a QS partner, `docs/archive/platform-design-2026-10.md`) | Owner |
| Q40 | When does public sign-up come (P08, P17, F01, FL-1 step 1)? It needs bot protection (BE-D12), self-service password reset, a payment provider (BE-D7) and Q18 / Q26 first. Today accounts come only from setup links and invitations (P50) | Owner, before public launch |
| Q41 | Emails are sent in English and Serbian (`mail/EmailDelivery.java`) while the UI has English only (P07, P35). Intended (a pilot market), or should emails follow the UI's languages? | Owner |

## Engine, sourcing and validation

Carried over from the engine's open-question list (formerly in `docs/11`). Related: Q8 (names at
scale), Q10 (MEP), `docs/domain/sourcing-and-licensing.md`.

| # | Question | Notes |
|---|---|---|
| Q33 | Which QS or civil-engineer partner translates rulebooks into presets and reviews the logic? | Also reviews the rule template's questions and formula choices (`docs/product/roadmap.md`) |
| Q34 | Legal check per standard: does encoding NRM, VOB, CESMM or ÖNORM rules as parameters need a licence? | `docs/domain/sourcing-and-licensing.md`; no licensed content in the repo (CLAUDE.md rule 8) |
| Q35 | CSI licence (MasterFormat, OmniClass, UniFormat) | Only if North America is targeted |
| Q36 | Where do messy real files and professional reference BoQs (the answer key for accuracy) come from? | Accuracy on real projects is the biggest open question (`docs/product/known-limitations.md`, `docs/testing/engine-validation.md`) |
| Q37 | How is AI used for name resolution, and with which confidence thresholds? | Same family as Q8; dictionary settings exist (`packages/types/src/dictionary.ts`), nothing implemented |
| Q38 | Pricing validation and regional price levels | Pricing module only (P32–P36, deferred P48) |
| Q39 | MEP and infrastructure (IFC4.3): in scope, and when? | Pilot scope is Q10; no MEP model federated yet, infrastructure exports as proxies |

## Test campaign (2026-11-22)

Found by the test campaign (`docs/testing/test-findings.md`); each blocks the finding named. Product behaviour the specs leave open or contradict, so the owner decides.

| # | Question | Blocks | Options |
|---|---|---|---|
| Q42 | On an archived project, may a share link still be revoked, and may a name decision still be promoted to the org dictionary? (The code allows both; `permissions.md` says every write is refused while archived.) | TF-012 (c, d) | Allow both (safety, org-level knowledge) and say so in permissions.md; or refuse with `409 project_archived` |
| Q43 | Library preview on a project's model: is seeing the project enough (F10 §6 "a project the user can access"), or are edit rights needed (the code requires lead or estimator)? | TF-014 | View rights (F10 as written), or edit rights written into F10 and permissions.md, with the picker filtered |
| Q44 | Should viewers see the Questions, Log and Setup tabs and the Decisions, Library and Settings entries read-only (as the app does), or not at all (screens.md "Who")? | TF-028 | Read-only for every project role (change screens.md), or hide them |
| Q45 | Audit retention by plan (`auditLogRetentionDays`): delete old audit events (the code does; BR-51 says they're never deleted except with the org), or only hide them from the audit pages? | TF-035 | Delete (add the exception to BR-51), or keep and filter |
| Q46 | May an expired share link be revived by editing its expiry, and may a link be created already expired? | TF-038 | Allow revival (F18 §3 "editing changes its expiry") and refuse past dates on create; or forbid `expired → active` |
| Q47 | Engine workers hold the same full-bucket storage key as the API, and the HTTP worker takes requests without a credential: is the network boundary the accepted control, or should the workers get scoped storage and an authenticated channel? | TF-045 | Accept and document in security.md; or scope (separate storage identity, shared secret) |
| Q48 | When a source line of a derived rule is excluded, should the derived line drop it (as a quantity edit to 0 does), or keep counting it (as now)? | TF-056 | Exclusions feed derived lines (engine change, Duplex numbers unchanged unless excluded); or document the current rule in F06 §6 |
| Q49 | If a saved version's frozen Excel fails to build, what then: retry it automatically from the immutable run, or refuse the save until the export succeeds? | TF-057 | Automatic retry (re-enqueue with the stored metadata), or block the save |
| Q50 | No screen removes a model (`archiveModel` exists in the API); four other operations are unused by the app. Add "remove model" to the UI, and retire or mark the unused operations API-only? | TF-080 | Add the UI action (or list it as a limitation); mark the rest API-only |
| Q51 | An unauthenticated or expired session on `/admin/*`: `404` (native mode now) or `401` / `session_expired` (OIDC mode, the contract suite)? | TF-081 | 404 only for signed-in non-admins, 401 otherwise; or 404 always and the suite aligned |
| Q52 | On a share link, is a hand-edited quantity shown as edited, with the engine's value (BR-09), or as a plain quantity without edit history (F18 §2, BR-56)? | TF-086 | Show it as edited without the reason; or plain (BR-09 amended) |
| Q53 | An archived project keeps `permissions.archive: true` so that it can be restored, though `permissions.md` says every write key is false while archived: document the exception, or split `archive` and `restore`? | TF-090 | Document the exception; or split the key |
| Q54 | May a confirmed BoQ be archived and restored? (Both answer 200 now; every other write answers `409 boq_confirmed`.) | TF-096 | Allow (and say so in F09); or refuse with `boq_confirmed` |
| Q55 | The "not in the models" notice's collapse is remembered per user per browser; F06-AC8 says per user. Store it with the user's preferences, or change the spec to "in this browser"? | TF-109 | Server-side preference; or spec change |
| Q56 | Do successful sign-ins and password setups count towards the per-address limit (45 per 15 min)? An office behind one address hits it. | TF-122 | Count failures only (plus a generous cap on successes); or keep counting all |
| Q57 | Before setup is finished only the dashboard redirects to the wizard; projects, Library and settings stay reachable. Gate every org page, or only the dashboard? | TF-139 | Gate everything but settings and the wizard; or keep dashboard-only and update F16 |
| Q58 | A "Based on it" clone follows the original's new version only when its own draft is next saved. Should publishing the original update its clones' drafts at once? | TF-140 | Follow at once (a new draft for each clone); or keep and document |
| Q59 | Which platform-admin reads are audited? Now only the org detail view; the orgs list, its CSV (with every owner's email), the users list and the reports are not. | TF-156 | Audit every admin read; or only those that show personal data (CSV, users) |
| Q60 | Clicking a suggested answer that is already preselected saves nothing, and the question stays open. Should a click on the preselected answer accept it? | TF-173 | Yes (one click accepts); or show an explicit Accept button |
| Q61 | Parses and runs share one engine slot locally and on the pilot, so a run waits behind a parse (5.4 s seen; a medium model would block runs for minutes). Add a second slot or a separate queue for interactive runs on the pilot? | TF-180 | A run-only worker or priority (memory on the pilot host permitting); or accept for the pilot |

## Planning (history)

Release 1 was built in three sequential phases by two agent roles (P37, P38) on the branch `v_1`
(P40, P46) and released as v1.0.0 on 2026-11-21 (`docs/archive/plan/milestones.md`,
`docs/archive/build-log.md`). Since then work goes straight to `main`, and nothing is scheduled
until the owner sets it (`docs/product/roadmap.md`).
