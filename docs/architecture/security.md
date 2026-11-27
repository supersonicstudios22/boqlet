# Security and privacy

What is enforced today, with the code that does it. Items marked **planned** or **gap** are not
built; they are also listed in `docs/product/known-limitations.md`.

## Authentication

**Native sign-in, decided (P50; this closes P10's "provider undecided").** Users sign in with
email and password on the boqlet domain; the Java API owns the credentials:
- `POST /api/v1/auth/sign-in`, `POST /api/v1/auth/set-password`, `GET`/`POST /api/v1/auth/sign-up`
  and `POST /api/v1/auth/password-reset` (`identity/NativeAuthController.java`), enabled by
  `BOQLET_NATIVE_AUTH=true` (local stack and pilot). Without it they answer `404 native_auth_disabled`.
- Passwords are Argon2id hashes in `native_credentials` (`identity/NativeCredentials.java`,
  Spring `Argon2PasswordEncoder`).
- **Setup and reset links** are one-hour tokens in `native_setup_links` (only the token's sha256 is
  stored, one link per address: a new one replaces the last). Operators issue them on the server
  (`ops/pilot/issue-setup-link.sh`; locally `npm run local:user`). Invited users set their password
  from the invitation. Runbook: `docs/operations/auth-and-deploys.md`.
- **Public sign-up and self-service reset** (P57): `POST /auth/sign-up` (only while the platform
  setting `public_sign_up` is on, else `403 sign_up_closed`) and `POST /auth/password-reset` email a
  link; its token is an HMAC of the link's nonce with `BOQLET_INVITATION_SECRET` (`identity/LinkTokens.java`),
  so neither the outbox nor the database holds a usable token, and a newer link or a used one makes
  an older email's link dead. Both answer `202` whatever the address (no account enumeration); an
  address with an account that asks to sign up gets an "you already have an account" email without
  a token. Basic bot protection: a hidden `website` field filled in, or `elapsedMs` under 3 s (as the
  browser measured it), is accepted and sends nothing. Every request counts, 20 per source address
  and 3 per email in 15 minutes (`LINK_REQUESTS_PER_*`, `429 auth_throttled`). Not built: a captcha
  or proof of work.
- Rate limits on sign-in and set-password (`native_auth_limits`, 15-minute windows; Q56, P54,
  TF-122): only failures count, 45 failed sign-ins and password setups per source address and 12
  failed sign-ins per email; successes count separately against a generous cap of 600 per address,
  so an office behind one address isn't locked out by its own sign-ins (`NativeAuthController`).
  Over a limit the API answers `429 auth_throttled`, without a `Retry-After` header.
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
- Cross-tenant access returns `404`, not `403` (`docs/domain/permissions.md`), with the same body as an id that
  doesn't exist: every `not_found` says "The resource was not found." (`ApiException.NOT_FOUND_MESSAGE`), so the
  message no longer tells which scope check failed (ENG-014, D99; the specific text stays in the server log).
- **Pricing module endpoints** (`/pricing/*`, P36) are **planned, not built** (P48). They are to
  be a separate module with its own Policy; vendor endpoints (`/pricing/vendor/*`) would read only
  the vendor's own pricebooks, matches, links and the lines of requests sent to them; with the
  module off for an org, its endpoints answer `404` for that org.
- **Public share endpoints** (`/public/shares/{token}/*`, F18) need no authentication. They
  resolve the token hash, check expiry, revocation and the org's `publicLinksAllowed`, and
  return only what the link includes (BR-56). The app sends `X-Robots-Tag: noindex, nofollow`
  and `Referrer-Policy: no-referrer` for `/s/*` (`apps/app/next.config.ts`). The API rate-limits
  public share requests per client address and token on each instance, default 300/min
  (`BOQLET_PUBLIC_SHARE_REQUESTS_PER_MINUTE`, `boq/ShareController.java`), and 50 different tokens
  per address a minute; over it `429 rate_limited` with `Retry-After` (TF-087). Signed
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
- **Engine workers: a shared secret and the network boundary (P54 Q47, TF-045, D98).** The HTTP
  worker (`engine`, port 8788 on all its interfaces) takes jobs and rpc calls only with
  `Authorization: Bearer <BOQLET_WORKER_TOKEN>` (`worker_http.py`, constant-time compare; `401`
  otherwise; `WorkerClient.java` sends it), once the token is set on the API and the engine
  (`ops/local` sets a fixed local value, `ops/pilot` `WORKER_TOKEN` from `pilot.env`); without one it
  accepts every call and logs a warning. An rpc such as `codelist-read` still reads whatever storage
  key it is given. The `engine`, `queue` and
  `queue-interactive` containers hold the same full-bucket storage key as the API
  (`x-engine-environment` in `ops/pilot/compose.yaml`). What keeps them apart from callers is the
  Compose networks: `backend` and `database` are `internal: true`, no Boqlet container publishes a
  host port, and of the backend containers only the API and the storage also sit on the ingress
  network. The edge (`ops/pilot/traefik-routes.json`) routes `/api/v1` to the API and only signed
  GET/PUT requests under the bucket on `files.booqlet.com` to the storage; nothing reaches a worker. A parser exploit or a foothold on the backend network could therefore
  read, write or delete every org's files. Before a wider rollout the workers get a storage identity
  limited to model sources and job output prefixes (D-50; a known limitation,
  `docs/product/known-limitations.md`).
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
- Regular expressions from users (dictionary `regex` entries, extractors, `matches` selectors) run
  only on RE2 (`google-re2`, `engine/ifc_boq/user_regex.py`; D97): matching takes time linear in
  the name, so no pattern can stall the shared engine (ENG-006). Patterns RE2 refuses
  (look-arounds, back-references) and patterns over 500 characters are refused by the preset check
  and fail a run with the entry's id. The names preview (`POST /model-versions/{id}/names`) takes
  unsaved dictionaries (`draftDictionaries`) only from someone who may edit presets: an org
  library editor, or a lead or estimator of the model's project (`ProjectAccess.presetEditor`;
  others `403`, `required: estimator`); with saved dictionaries it stays open to every project role.
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

- TLS everywhere (Traefik on the pilot). HSTS (`max-age=31536000; includeSubDomains`) is sent by the
  app's production build on every page (`apps/app/next.config.ts`, TF-046) and by the API on every
  answer when `BOQLET_APP_URL` is https (`http/SecurityConfiguration`; TLS ends at Traefik, so Spring's
  default of secure requests only never sent it), with `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` and `Cache-Control: no-cache` (Spring defaults). The Traefik routers name a
  `private-headers` middleware that comes from the Narudzbe route file, outside this repo
  (`docs/operations/pilot.md` "Shared proxy and rollback"); neither the app nor the API depends on it.
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

- App response headers (`apps/app/next.config.ts`, TF-046): every page sends
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` with `Content-Security-Policy:
  frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, and no `X-Powered-By`.
- **Content-Security-Policy** (review A-38, D101): `apps/app/proxy.ts` sends it on every page with a fresh
  nonce (`src/lib/csp.ts`): `default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'` (no
  `'unsafe-inline'`, no `'unsafe-eval'` outside `next dev`; Next puts the nonce on its scripts, the root layout
  on the theme script); `style-src 'self' 'unsafe-inline'` (React's `style` attributes); `img-src` and
  `connect-src` `'self'` plus the storage origin (`BOQLET_STORAGE_ORIGIN`; signed URLs for uploads, geometry and
  Excel); `worker-src 'self' blob:`; `object-src 'none'`; `base-uri` and `form-action 'self'`; `frame-ancestors
  'none'`; `report-uri /csp-report`, which logs each violation as one `csp.violation` line (tokens masked, 60 a
  minute). Every page renders dynamically (the root layout reads the request), so every page gets a nonce. A
  production build sends it as `Content-Security-Policy-Report-Only` until `BOQLET_CSP=enforce` (the pilot:
  `docs/operations/pilot.md`); `next dev` and the browser smoke enforce it, and `main-flow.spec.ts` fails on any
  violation (upload, 3D view, sheet, Excel, share page).
  The bearer links (`/s/*`, `/invite/*`, `/sign-up`) send `Referrer-Policy: no-referrer`; `/s/*` and
  `/invite/*` also `X-Robots-Tag: noindex, nofollow`.
- Cookies: `boqlet_session` as above. No tokens in `localStorage`.
- CSRF: `SameSite=Lax` plus the exact-Origin check on state-changing requests.
- Rate limits **implemented**: native sign-in and set-password, public shares (see above), and
  invitation mail: invitations and resends together, 20 an hour per org
  (`BOQLET_INVITATIONS_PER_HOUR`, `http/RateLimits` over `native_auth_limits`; `429 rate_limited`
  with `Retry-After`, TF-043), and engine rpc calls from the library (check, template export and
  import, code-list read and build, slot rename): 60 a minute per user (`library/LibraryController`);
  item-text samples, one call per page of codes, have their own 240 a minute per user. **Planned,
  not implemented:** the model names rpc, vendor offer submissions (module). Uploads are bounded by plan limits.
- Text input (TF-176, `http/TextInput`): no string in a request body may hold NUL or an unpaired
  surrogate; names and labels (`name`, `label`, `deviceLabel`) also refuse control characters and
  text-direction formatting characters (`400 invalid_body`), as model file names do.
- Logs: the access log masks share and invitation tokens in paths (`/api/v1/public/shares/***`,
  TF-042).
- Webhooks: `POST /webhooks/billing/{provider}` answers `400 unsupported_provider`, since there is
  no billing provider (manual billing, D7). Signature verification, a 5 min replay window and
  idempotency by event id are required once a provider is added.

## Audit

Append-only audit events for every write (BR-51) in `audit_events` (`audit/AuditWriter.java`),
kept for the plan's `auditLogRetentionDays`. The action names are the ones the Java code writes
(for example `model_version.created`, `run.completed`, `line.edited`), which differ in places
from the list in F09. Account events have no org: `user.password_set`, `user.password_reset`,
`session.opened`, `session.ended`, `auth.sign_in_failed` (no actor; the account as the entity
when the address has one); a takeover (`session.replaced`, both device labels) is written into each
of the user's orgs so an owner sees it (TF-044, TF-114). **Planned:** audit of failed permission
checks on sensitive actions, of webhook signature failures (no provider yet) and of sign-in from
new places (`sessions.place` exists but is never written).
