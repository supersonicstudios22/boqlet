# F18 Public share links

> **Status (2026-11-22):** Built. Public read-only links (`apps/app/app/(public)/s/[token]`, Java `boq/ShareController`, `PublicShares`): revoke, expiry, "follow latest saved", `publicLinksAllowed`, noindex and `Referrer-Policy: no-referrer`, the "Made with" badge. Line detail opens on a share link (TF-085), from the keyboard too (TF-158); an edited quantity shows as edited with the engine's value and no reason (P54 Q52, TF-086); numbers follow the firm's format (TF-021); an expired link is revived by editing its expiry, and a past expiry is refused (Q46, TF-038).
> **Not built / differs:**
> - The public sheet is a plain grouped table (no virtualisation; search only).
> - The footer's sign-up link leads to the sign-up form only while public sign-up is open (P57); closed, the page says accounts come by invitation.
> - The rate limit defaults to 300 requests per minute per address and token on each instance, with at most 50 tokens per address a minute (`BOQLET_PUBLIC_SHARE_REQUESTS_PER_MINUTE`; `429` with `Retry-After`, TF-087), not 60.

## Purpose

Send a BoQ to anyone, such as a client, a colleague outside the firm or a permit office, as a
link they open without an account. Read-only, revocable, with the same sheet, line
explanations and 3D view the firm sees (P26).

## Behaviour

1. **Create** (BoQ workspace › Share): a dialog with:
   - **What:** "This version as it is now" (pins the working or saved version's current run;
     default) or "Always the latest saved version of this BoQ" (follows each newly saved version; shows
     nothing until one is saved).
   - **Includes:** the sheet (always), grouped by the chosen classification with its item texts
     (P14); line detail with **How it is calculated** (F06 §5, default on); the **3D view**
     (F07, default on); the calculation log (default off); **Excel download** (default off).
   - **Expires:** never, 7, 30 (default) or 90 days.
   - Optional **label** for the firm's own list ("For the client, permit set").
   The dialog shows the link with a copy button.
2. **The public page** (`/s/{token}`): firm name, project name, BoQ name, revision label and
   status (a "WORKING" watermark unless it is a saved version), date of the run. The sheet
   read-only with grouping, search and filters (F06 §4), the line detail, the 3D view, as
   included. No questions, decisions, edits history, reviewers, member names, vendor or price
   information. A small footer names the product (link to the sign-up page).
3. **Manage:** BoQ workspace › Share lists the BoQ's links: label, what, includes, created by,
   expires, views (count), last viewed, status. **Revoke** ends a link at once: the page then
   says "This link is no longer available" (`404`). Editing a link changes its includes and
   expiry, never its token.
4. **Org setting** `publicLinksAllowed` (owner, admin; default on). When turned off, every
   existing link stops working until it is turned on again.
5. **Plans:** `shareLinks` (feature) and the free plan's links carry the product footer with a
   "Made with" badge (05-plans-and-limits).

## Permissions

| Action | lead | estimator | approver | viewer |
|---|---|---|---|---|
| Create, edit a share link | ✓ | ✓ | ✓ | |
| Revoke any link of the project | ✓ | | ✓ | |
| Revoke a link one created | ✓ | ✓ | ✓ | |

Owners and admins may revoke any link in the org (org settings › Share links lists them all).

## Security (BR-56)

- Token: 32 random bytes, base64url, stored only as a hash. The link is the only secret, as
  with any "anyone with the link" share. Users are told so in the dialog.
- Public endpoints are read-only, rate-limited per token and IP, and return `404` for unknown,
  expired or revoked tokens and when `publicLinksAllowed` is off.
- Pages carry `noindex, nofollow` and `Referrer-Policy: no-referrer`.
- Geometry and Excel files are served through short-lived signed URLs issued per request.
- Every view writes a lightweight view record (count, last viewed; no IP stored beyond the rate
  limiter's memory). Create, edit and revoke are audited.

## Edge cases

- The pinned run's working version is later saved: the link keeps showing that run, now
  labelled with the saved version. A "follow latest saved" link moves to each newly saved version.
- The project is archived: links keep working (read-only data). Deleting the org ends them.
- The BoQ uses several models: the viewer loads all of them, as in F07.

## API

`GET /boqs/{boqId}/share-links`, `POST /boqs/{boqId}/share-links`,
`PATCH /share-links/{shareLinkId}`, `DELETE /share-links/{shareLinkId}`,
`GET /orgs/{orgId}/share-links`. Public, no authentication: `GET /public/shares/{token}`,
`GET /public/shares/{token}/lines`, `GET /public/shares/{token}/lines/by-key`,
`GET /public/shares/{token}/scene`, `GET /public/shares/{token}/geometry/{versionId}`,
`GET /public/shares/{token}/export`.

## Acceptance criteria

- [ ] A link created on the Duplex BoQ opens in a private browser window with no account, shows the sheet, the line explanation and the 3D view, and nothing that is not included.
- [ ] Revoking a link makes it return `404` within a second; turning `publicLinksAllowed` off does the same for every link of the org.
- [ ] A "follow latest saved" link shows version A, then version B as soon as B is saved, with no change to the link.
- [ ] The public endpoints never return member names, decisions, questions, vendor data or prices (automated check over every public endpoint).
