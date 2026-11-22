# Security and privacy

What is enforced today, with the code that does it. Items marked **planned** or **gap** are not
built; they are also listed in `docs/product/known-limitations.md`.

## Authentication

**Native sign-in, decided (P50; this closes P10's "provider undecided").** Users sign in with
email and password on the boqlet domain; the Java API owns the credentials:
- `POST /api/v1/auth/sign-in` and `POST /api/v1/auth/set-password`
  (`identity/NativeAuthController.java`), enabled by `BOQLET_NATIVE_AUTH=true` (local stack and
  pilot). Without it both answer `404 native_auth_disabled`.
- Passwords are Argon2id hashes in `native_credentials` (`identity/NativeCredentials.java`,
  Spring `Argon2PasswordEncoder`).
- No public sign-up and no self-service reset: the first owner and assisted resets get a one-hour
  **setup link** (`native_setup_links`, only the token's sha256 is stored), issued on the server
  (`ops/pilot/issue-setup-link.sh`; locally `npm run local:user`). Invited users set their
  password from the invitation. Runbook: `docs/operations/auth-and-deploys.md`.
- Rate limits on sign-in and set-password (`native_auth_limits`, 15-minute windows): 45 per
  source address for both, and 12 per email for sign-in (`NativeAuthController`); over the limit
  the API answers `429 auth_throttled`, without a `Retry-After` header.
- The session is an opaque cookie `boqlet_session`: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1`,
  `Secure` unless `BOQLET_SECURE_COOKIE=false` (local plain HTTP only). `NativeIdentityFilter`
  refuses bearer tokens and requires the exact app origin (`BOQLET_APP_URL`) on state-changing
  requests.
- Not built: MFA (also for platform admins), enterprise SSO (SAML/OIDC per org), vendor sign-up
  (pricing module).
- **Rollback only:** an OIDC path (Keycloak) stays in the code: `identity/OidcConfiguration.java`
  and `IdentityFilter` when `BOQLET_OIDC_ISSUER` is set, the app's `keycloak` adapter
  (`NEXT_PUBLIC_AUTH_ADAPTER=keycloak`) and the pilot's `legacy-identity` compose profile
  (`services/api/README.md`). The shared test suites authenticate through a test-only JWT
  decoder on this path (`docs/testing/README.md`).

**One active session per account** (BR-54) is enforced by the backend: a `sessions` row is
created at sign-in, its id travels in the `boqlet_session` cookie, and every request checks it is
the user's active session. A second sign-in gets `409 session_active` with the active session's
details and may retry with `takeover: true`; takeover marks the old row `replaced` and publishes
`session.revoked` on that user's SSE channel. Sessions expire after 12 hours idle (hard-coded in
`identity/Sessions.java`, expired by `maintenance/Maintenance.java`). With the OIDC rollback,
provider sessions are also revoked through `ProviderSessionRevocations` when configured.

## Authorisation

- Every request resolves `(user, org)` context. Repository queries filter by `org_id` (and
  project membership where needed) through `OrgAccess` and `ProjectAccess` (BR-50).
- Cross-tenant access returns `404`, not `403` (`docs/domain/permissions.md`).
- **Pricing module endpoints** (`/pricing/*`, P36) are **planned, not built** (P48). They are to
  be a separate module with its own Policy; vendor endpoints (`/pricing/vendor/*`) would read only
  the vendor's own pricebooks, matches, links and the lines of requests sent to them; with the
  module off for an org, its endpoints answer `404` for that org.
- **Public share endpoints** (`/public/shares/{token}/*`, F18) need no authentication. They
  resolve the token hash, check expiry, revocation and the org's `publicLinksAllowed`, and
  return only what the link includes (BR-56). The app sends `X-Robots-Tag: noindex, nofollow`
  and `Referrer-Policy: no-referrer` for `/s/*` (`apps/app/next.config.ts`). The API rate-limits
  public share requests per client address and instance, default 300/min
  (`BOQLET_PUBLIC_SHARE_REQUESTS_PER_MINUTE`, `boq/ShareController.java`; `429` over it). Signed
  URLs are issued per request for geometry and Excel.
- **Admin endpoints** (`/admin/*`, F19) check `platformRole` on every request and answer `404`
  otherwise. They read org metadata through dedicated queries that never select content
  columns (BR-57). Admin views and actions are audited (`admin.*` events).
- Signed URLs are issued only after the same checks. They are short-lived (5 min GET, 1 h PUT;
  `UPLOAD_TTL` and `DOWNLOAD_TTL` in `storage/ObjectStorage.java`) and scoped to one key.
- **Isolation tests** (v1 acceptance 8): `tests/scenarios/isolation.test.ts` (another org's user
  gets `404`), `tests/contract/auth.test.ts` (every secured operation answers `401` to an
  anonymous caller), `tests/contract/admin.test.ts`, `NativeWorkerTest`'s tenant checks, and the
  role matrix `tests/scenarios/permissions.test.ts` (every row of permissions.md's two tables called
  as eleven personas, with approval off, on and the project archived; cells waiting for an open
  finding are `it.fails`). Vendor cases wait for the pricing module.

## Input handling

- IFC uploads: size limit per plan (`maxModelVersionMb`) and `BOQLET_MAX_UPLOAD_MIB`. The first
  bytes must be `ISO-10303-21;`, checked when the upload completes (`ObjectStorage.java`) and again
  by the worker (`worker.py`). Files are parsed only in the worker, a separate container. The
  queue worker's database role may only execute the queue functions
  (`docs/architecture/engine-worker.md`). Job timeouts: `BOQLET_ENGINE_JOB_TIMEOUT` (default
  30 min) for HTTP jobs and `ENGINE_QUEUE_JOB_TIMEOUT_SECONDS` (default 1800 s) for queue jobs.
  Container CPU and memory limits are set in `ops/pilot/compose.yaml`.
- Spreadsheets (code lists, preset templates, BoQ edits; in the planned module also offers and
  pricebooks): parsed only in the worker or rpc, with openpyxl in read-only, data-only mode (no
  formulas evaluated, no macros: `.xlsm` rejected). Size ≤ 20 MB. Before openpyxl reads anything,
  `engine/ifc_boq/sheets/xlsx_guard.py` checks the zip directory: at most 4096 parts, at most 64 MB
  expanded for code lists and templates (rpc) and 256 MB for BoQ edits (a job), and no part over
  1 MB that expands more than 100 times. The rpc engine reads at most two workbooks at once; a third
  waits up to 5 s, then gets `503` (the API answers `engine_unavailable`, try again).
- Attachments (planned for the pricing module; the core has no attachment upload): any type,
  stored as-is, served with `Content-Disposition: attachment`, with the content type replaced by
  `application/octet-stream` for non-PDF/image types; virus scanning optional.
- Formulas from users are evaluated only by the engine's safe evaluator (`expr.py`, never
  `eval`, D21).
- JSON inputs are validated against the OpenAPI schemas by Java's generated interfaces and bean
  validation: `400 unknown_field`, `invalid_body` (`tests/contract/validation.test.ts`). Every
  free-text request field has a `maxLength` and every request array a `maxItems` (the families are
  listed in the contract's `info.description`); the fields the generated DTOs can't reach are
  checked in code: a decision's text answer (`Decisions`), a manual line (`Adjustments`), the native
  sign-in and set-password bodies (`NativeCredentials`, `Sessions`), a provider's name claim
  (`IdentityService`, cut to 120). The database refuses a person's name over 254 characters (V17).
- Request bodies other than multipart uploads are capped by `RequestSizeFilter`: 1 MiB, 32 MiB for
  the operations that carry engine documents or batches; larger answers `413 too_large` before
  anything parses them (TF-174).

## Data protection

- TLS everywhere (Traefik on the pilot). **Gap:** HSTS is not set by the app, the API or the
  checked-in Traefik configuration.
- Encryption at rest: storage and database encryption are the host's (provider-managed).
- Secrets via environment or a secret manager, never in the repo. The values in
  `ops/local/compose.yaml` are fixed local-only values; never reuse them on the pilot.
- PII held: user name, email, IP-derived data in audit events; vendor company and contact once
  the pricing module exists. The data map lives in `docs/architecture/database.md`.
- GDPR basics: data processing agreement template for customers (legal, outside this repo);
  deletion per BR-52 (org status `deleting`, purge after `BOQLET_ORG_PURGE_HOURS`). **Planned:**
  data export per org (a zip of projects, BoQs, decisions and exports), user account deletion
  that keeps audit references as "deleted user".
- Region: cloud-neutral (P09). The deployment chooses the region. EU hosting is recommended for
  European customers.

## Web security

- **Gap: no CSP is set** (no `Content-Security-Policy` in `apps/app/next.config.ts`, in Java or
  in `ops/pilot`). Intended policy: `default-src 'self'`; `connect-src` the API, the SSE endpoint
  and the storage domain; `img-src 'self' data: blob:` and the storage domain; `worker-src blob:`
  for the viewer.
- Cookies: `boqlet_session` as above. No tokens in `localStorage`.
- CSRF: `SameSite=Lax` plus the exact-Origin check on state-changing requests.
- Rate limits **implemented**: native sign-in and set-password, public shares (see above).
  **Planned, not implemented:** invitations (20/h per org), rpc calls (60/min per user), vendor
  offer submissions (module). Uploads are bounded by plan limits.
- Webhooks: `POST /webhooks/billing/{provider}` answers `400 unsupported_provider`, since there is
  no billing provider (manual billing, D7). Signature verification, a 5 min replay window and
  idempotency by event id are required once a provider is added.

## Audit

Append-only audit events for every write (BR-51) in `audit_events` (`audit/AuditWriter.java`),
kept for the plan's `auditLogRetentionDays`. The action names are the ones the Java code writes
(for example `model_version.created`, `run.completed`, `line.edited`), which differ in places
from the list in F09. **Planned:** audit of failed permission
checks on sensitive actions, of webhook signature failures (no provider yet) and of sign-in from
new places (`sessions.place` exists but is never written).
