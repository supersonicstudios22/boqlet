# Plans and limits

Plans are data the platform admin configures in the admin console (P57, F19 §9): this page
gives the shape and the seeded starting values, not the live ones. Billing is provider-agnostic (P08). The backend owns **plans → entitlements → enforcement**
and records **usage events**. A payment provider (Paddle likely) only tells the backend which
plan an org is on, through an adapter (F14). All numbers below are **placeholders to tune**.
Code must read them from the plan table, never hard-code them.

## Commercial model (undecided, P17)

A new org starts on the **default tier** (`Plan.default = true`; "Free" in the placeholders).
The paid tiers and what they are priced on are not decided: levels by number of **active
projects**, by **seats**, or both. The entitlement engine (F14) must support any of these
without code changes: every limit is a row in the plan table, a missing limit means
unlimited, and a tier may limit only seats, only active projects, or both. Q18 and Q26 track
the decision.

## Principles (from docs/archive/platform-design-2026-10.md, D50)

- **Never charge per BoQ generated.** Trying presets and comparing runs is a core strength.
- Charge for what tracks value and cost: **seats**, **active projects**, **processing** (big
  files cost real compute).
- Vendors and public-link visitors are always free and never count as seats.
- Record a usage event for every parse, run and preview from day one, even on the free plan. The sample
  project's jobs record one with zero minutes (P54).
- Regional price levels later. Prices are not in the product spec, only limits.

## Plans (placeholder limits)

| Entitlement | Free | Professional | Team | Enterprise |
|---|---|---|---|---|
| `seats` | 1 (P57: one person) | 5 | 25 | custom |
| `ownedOrgsPerUser` (orgs on the plan one person may own, P57) | 1 | unlimited | unlimited | unlimited |
| `activeProjects` | 1 | 10 | 50 | custom |
| `maxModelVersionMb` | 50 | 300 | 300 | custom |
| `maxModelsPerBoq` | 2 | 6 | 12 | custom |
| `processingMinutesPerMonth` | 60 | 1,000 | 5,000 | custom |
| `libraryOrgPresets` (per kind) | 1 | unlimited | unlimited | unlimited |
| `pricingModule` (feature, P32) | off | on | on | on |
| `vendorsPerRequest` (pricing module) | — | unlimited | unlimited | unlimited |
| `openOfferRequests` (pricing module) | — | 20 | unlimited | unlimited |
| `shareLinks` (feature) | yes, with "Made with" badge | yes | yes | yes |
| `approvalWorkflow` (feature: review, approval, four-eyes) | no | yes | yes | yes |
| `exportWatermark` (setting: yes = exports and share pages carry the watermark) | yes | no | no | no |
| `auditLogRetentionDays` | 30 | 365 | 365 | custom |

Definitions:

- **Owned orgs per person** (`ownedOrgsPerUser`): orgs on this plan where the person is an owner
  (an org being deleted doesn't count). Checked when someone creates an org, which starts on the
  default plan; being invited to others' orgs doesn't count. An org override doesn't lift it (the
  org doesn't exist yet); moving an org to another plan does.

- **Active project**: status `active`. Archived projects stay readable and don't count.
- **Processing minute**: wall-clock minutes of parse, run and preview jobs, summed per calendar
  month (UTC). Export and diff jobs are not counted.
- A **limit check** happens before the action. Over a limit the API answers
  `402 Payment Required` with `{"code":"limit_reached","limit":"activeProjects","current":1,"max":1}`.
- Exceeding `processingMinutesPerMonth` blocks new parse/run/preview jobs, never reading,
  exporting, answering questions or acting on open offer requests.
- Downgrading never deletes data: excess projects become read-only until archived or upgraded;
  excess members keep access but no new invites can be sent.

## Trial

A new org starts on **Free**. A 14-day **trial of Team** may be switched on by plan
configuration (`trialPlanId`, `trialDays`). When it ends, the org drops to Free with the rules
above.

## Usage events

Every parse, run and preview job writes one `UsageEvent` when it ends:
`{orgId, projectId, jobId, kind, startedAt, durationMs, modelBytes, elementCount, outcome}`.
The org settings show usage for the current month against limits (F14).

## As built (2026-11-21)

- **Plans are configured by the platform admin** (P57): `GET/POST /admin/plans`,
  `PUT/DELETE /admin/plans/{planId}`, `POST /admin/plans/{planId}/impact` and the console's Plans
  page. A plan holds a name, description, price (amount and month or year, in the one platform
  currency, `platform_settings.currency`; shown on the billing page, not charged), order
  (`position`), whether customers see it (`public`), whether new orgs start on it (`default_plan`,
  exactly one), and entitlements: only the keys of `EntitlementCatalogue` (Java), a number a
  whole number of zero or more, left out for unlimited, a feature true or false. A change
  applies to every org on the plan at once and deletes nothing; the impact preview counts the
  orgs over a lowered metered limit (seats, active projects, processing minutes) or losing a
  feature. Org overrides accept the same keys and values. Changes are audited.
- **Plans** were seeded by `services/api/src/main/resources/db/migration/V3__plans_and_invitation_outbox.sql`
  (and V23: Free has 1 seat and `ownedOrgsPerUser` 1, P57) with the placeholder limits above: `free` (default), `professional`, `team`, `enterprise` (no
  limits, so unlimited). There is no `pricingModule`, `vendorsPerRequest` or `openOfferRequests`
  key (the pricing module isn't built, P48). Professional and Team have no `libraryOrgPresets`
  row, so unlimited.
- **Billing is manual** (D7): no provider and no adapter. Checkout answers
  `409 checkout_unavailable`, the webhook `400 unsupported_provider`; a platform admin sets an
  org's plan (`PUT /admin/orgs/{id}/subscription`, F19). `subscriptions.provider` is `manual`.
- **Enforced** (`402 limit_reached`, `services/api/src/main/java/com/boqlet/api/billing/EntitlementService.java`
  and callers): `ownedOrgsPerUser` at org create (P57); `seats` at invite; `activeProjects` at create and unarchive (sample projects
  excluded); `maxModelVersionMb` at upload; `maxModelsPerBoq` at BoQ inputs; `libraryOrgPresets`
  at preset create; `processingMinutesPerMonth` at job enqueue (`worker/Jobs.java`); the features
  `shareLinks` and `approvalWorkflow`. `exportWatermark` and `auditLogRetentionDays` are applied
  (exports and share pages; maintenance purge). `exportWatermark` is named by its effect everywhere
  ("Watermark on exports"; the admin plan editor's switch reads "On", not "Included", review A-42).
- **Not built:** the trial by plan configuration (`trialPlanId`, `trialDays`; an admin can set
  `trialEndsAt` by hand, but no job drops the org to Free when it ends) and downgrade handling
  (excess projects read-only, invites blocked).
