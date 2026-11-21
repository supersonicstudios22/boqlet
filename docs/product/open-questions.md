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

## Planning (history)

Release 1 was built in three sequential phases by two agent roles (P37, P38) on the branch `v_1`
(P40, P46) and released as v1.0.0 on 2026-11-21 (`docs/archive/plan/milestones.md`,
`docs/archive/build-log.md`). Since then work goes straight to `main`, and nothing is scheduled
until the owner sets it (`docs/product/roadmap.md`).
