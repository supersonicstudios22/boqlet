# Feature specs

One spec per feature: what the product should do (the intent). Each file opens with a
**Status** block that says what is built and what differs from the spec, checked against the code
on 2026-11-21. Where the spec and the code disagree, the status block lists it. Scope and the v1
acceptance criteria are in [`docs/product/scope-and-acceptance.md`](../scope-and-acceptance.md).

| ID | Feature | Purpose | Status | Part |
|---|---|---|---|---|
| [F01](F01-accounts-and-orgs.md) | Accounts, organisations, members | Sign-in, orgs, invitations, roles, one active session | Partly built (no public sign-up) | core |
| [F02](F02-projects.md) | Projects | Projects with settings, members, archive, dashboard | Partly built (no default-preset pickers) | core |
| [F03](F03-models-and-versions.md) | Models and versions | Upload IFC as versions of discipline models, parse, input-check report | Partly built (large uploads, scope editing) | core |
| [F04](F04-boq-and-runs.md) | BoQs and runs | BoQs with inputs, runs as background jobs, needs-input state | Built | core |
| [F05](F05-questions-and-decisions.md) | Questions and decisions | Answer the engine's questions once; carry answers across versions | Built | core |
| [F06](F06-boq-sheet.md) | BoQ sheet | The editable, traceable sheet: grouping, line detail, edits, co-editing | Built | core |
| [F07](F07-viewer.md) | 3D viewer | Lines ↔ elements in 3D, colour modes, shared filters | Built | core |
| [F08](F08-revisions-and-changes.md) | Revisions and change report | What changed between runs and model versions, line by line | Built | core |
| [F09](F09-review-approve-issue.md) | Versions, confirmation, approval, audit | Save locked versions, confirm, optional review and approval | Built | core |
| [F10](F10-library.md) | Library | Rule sets, classifications, dictionaries: versions, preview, import | Built (gaps) | core |
| [F11](F11-offer-requests.md) | Offer requests and offers | Send a BoQ or part to vendors, compare offers | Not built (P48) | pricing module |
| [F12](F12-exports.md) | Exports | Excel BoQ, frozen version exports, edits import, change report | Built | core |
| [F13](F13-notifications.md) | Notifications | In-app (live) and email notifications | Built (core kinds) | core |
| [F14](F14-entitlements-and-billing.md) | Entitlements, usage, billing | Plans, limits, usage; billing provider adapter | Partly built (manual billing) | core |
| [F15](F15-i18n-units-locale.md) | i18n, units, locale, currency | Every string translatable; org formats | Partly built (English only) | core |
| [F16](F16-setup-wizard.md) | Setup wizard | A new org's first rule set, classification and names in minutes | Built (simplified) | core |
| [F17](F17-vendors.md) | Vendors | Vendor accounts linked to firms | Not built (P48) | pricing module |
| [F18](F18-share-links.md) | Public share links | Read-only links to BoQ versions, revocable, with expiry | Built | core |
| [F19](F19-platform-admin.md) | Platform admin console | Operator view of orgs, users, usage; metadata only | Built (gaps) | core |
| [F20](F20-pricebooks-and-pricing.md) | Pricebooks and pricing | Firm and vendor pricebooks, the firm's estimate | Not built (P48) | pricing module |

**The pricing module (F11, F17, F20)** is optional and removable (P36) and deferred to a later
phase (P48). Only its contract (`packages/pricing-api/openapi-pricing.yaml`) and the core's
extension points (`apps/app/src/extensions`, Java `extension/`) exist. The boundary rules are in
[`docs/architecture/modules.md`](../../architecture/modules.md).

Acceptance criteria are numbered by position inside each spec: `F06-AC3` is the third criterion
of F06. Test coverage per criterion: [`docs/testing/README.md`](../../testing/README.md).
