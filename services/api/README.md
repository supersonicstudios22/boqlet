# Boqlet API

The service uses Java 21, Spring Boot 3.5, Spring JDBC, Flyway, and PostgreSQL.
Run the build and its temporary PostgreSQL integration tests from the product root
with `mvn -f services/api/pom.xml verify`. The tests require a running Docker daemon.

The Maven build generates the HTTP interfaces and DTOs from `packages/api/openapi.yaml`.
It prepares a copy under `target/contract` so Java can forward recursive engine documents
as JSON. It simplifies the unit union to a string, adds Java validation for the review
confirmation, and preserves omitted arrays in revision PATCH bodies.
The checked-in HTTP contract and worker schemas remain authoritative.

To run the built jar locally, set `BOQLET_JDBC_URL`, `BOQLET_DB_USER`, and
`BOQLET_DB_PASSWORD`; set `BOQLET_API_PORT` to override port 8080.
Health endpoints are `/actuator/health/liveness` and `/actuator/health/readiness`.
Readiness includes PostgreSQL. The API binds its generated routes under `/api/v1`.

To run the whole backend locally, use `npm run local:up` from the product root: it builds
this service's image (`Dockerfile`, Maven inside Docker) and starts it with native sign-in,
PostgreSQL, object storage, MailHog and the engine worker (`ops/local/compose.yaml`,
`docs/development/local-setup.md`). Its `api` service lists every variable a local run needs; to run
your own jar instead, stop that container and start the jar with the same variables pointed at
the published ports. Select the engine transport in the API and add the queue workers when
using PostgreSQL dispatch.

`mvn verify` runs the shared suites against Java when Node is available: set
`BOQLET_NATIVE_WORKER_PYTHON` (a Python with the engine installed), `BOQLET_NATIVE_NODE`,
`BOQLET_NATIVE_SCENARIOS=1` for the scenarios and `BOQLET_BROWSER_SMOKE=1` for the browser smoke
(`apps/app/e2e-java`, Chromium installed for `apps/app`), as CI's `api` job does.

## Sign-in

The pilot and the local stack use native sign-in (P50): set `BOQLET_NATIVE_AUTH=true`; the
first owner gets a one-hour setup link (`ops/pilot/issue-setup-link.sh`, locally
`npm run local:user`). Runbook: `docs/operations/auth-and-deploys.md`. The OIDC settings below are
kept for the Keycloak rollback.

Set `BOQLET_OIDC_ISSUER` and `BOQLET_OIDC_AUDIENCE` to enable OIDC authentication.
The access token must contain `sub`, `sid`, `email`, and `email_verified=true`.
Set `BOQLET_PILOT_EMAILS` to the comma-separated verified addresses of initial pilot leads.
A pending organisation invitation also grants access when the verified address matches.

After obtaining the access token, call `POST /api/v1/sessions` to establish the application
session. Retain the returned HttpOnly cookie and send it with the bearer token on authenticated
requests. A second provider session gets a conflict with the active session's details.
The client can retry with `takeover: true` after confirmation. A replaced session is immediately
rejected on subsequent API requests. Sessions expire after twelve hours of inactivity.
Use `BOQLET_SECURE_COOKIE=false` for local development over HTTP. The default is secure.

For Keycloak the frontend uses `NEXT_PUBLIC_AUTH_ADAPTER=keycloak` and the public
`NEXT_PUBLIC_KEYCLOAK_URL`, `NEXT_PUBLIC_KEYCLOAK_REALM`, and `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID`
build settings. The Keycloak client is public with standard flow, PKCE S256,
an exact application web origin and redirects to the app. Include the API
audience in access tokens and configure verified email in the realm. The frontend
uses same-origin `/api/v1`. In local development `API_PROXY_TARGET` can point to
the Java API. Wait for OIDC discovery before starting Java.

To remove provider sessions on takeover, logout, administration or expiry set
`BOQLET_OIDC_REVOCATION_CLIENT_ID` and `BOQLET_OIDC_REVOCATION_CLIENT_SECRET` in
the API only. The confidential client needs a Keycloak service account authorised
to remove sessions in that realm. The outbox retries through provider downtime.
The PostgreSQL session is invalidated immediately and retired provider session
IDs cannot open another app session.

## Invitations

Set `BOQLET_INVITATION_SECRET` to a randomly generated secret of at least 32 bytes.
Use the same value across API processes and the mail sender. Invitation creation,
resend, and revocation commit with their audit and outbox changes. The link is valid
for fourteen days. Resending rotates the token and cancels undelivered messages for
the old link. Set `BOQLET_APP_URL`, `BOQLET_SMTP_HOST`, `BOQLET_SMTP_FROM`, and
the provider credentials `BOQLET_SMTP_USERNAME` and `BOQLET_SMTP_PASSWORD`. The
port defaults to 587 with auth and required STARTTLS. Set `BOQLET_SMTP_PORT`,
`BOQLET_SMTP_AUTH`, and `BOQLET_SMTP_STARTTLS` to match a local test catcher.
`BOQLET_SMTP_POLL_MS` controls the outbox poll interval.
Pending email is rechecked against invitation status, membership, and category
preferences before sending. The outbox uses bounded backoff and has at-least-once
delivery semantics. The account screen manages email preferences.

## Pilot plans and projects

Flyway seeds the plans and the built-in Library. New organisations get the plan
marked default and new projects get the current published defaults plus an empty
project dictionary. Pilot subscriptions use the manual provider. The API checks
the stored plan and overrides, records limit denials, and counts usage by UTC
calendar month. Only non-sample active projects use an active-project slot.
The sample creates a tenant-owned copy of the bundled Duplex IFC, parses it and
generates its first BoQ with the built-in presets and two example decisions.
The seeded parse and run are unmetered.
Subsequent uploads and user-requested calculations on the sample follow normal
usage limits.

## Model uploads and worker jobs

Set `BOQLET_S3_BUCKET` and `BOQLET_S3_REGION` for both API and worker access to the same
private bucket. For a local S3-compatible server set `BOQLET_S3_ENDPOINT` and optionally
`BOQLET_S3_PUBLIC_ENDPOINT` if the browser reaches storage at a different address.
The Java SDK uses its default credential chain. The Python worker needs
`ENGINE_STORAGE=s3://<bucket>` and the same storage region and endpoint if applicable.
Allow the web origin to PUT and GET signed objects and expose the ETag for part uploads.

For an HTTP-only local run the API sends jobs to `BOQLET_ENGINE_HTTP_URL`
(default `http://127.0.0.1:8788`).
Set `BOQLET_ENGINE_HTTP_CONCURRENCY` (default 1), `BOQLET_ENGINE_JOB_TIMEOUT` (default
`PT30M`), and `BOQLET_MAX_UPLOAD_MIB` (default 1024) to size the API side of the worker
flow. The worker independently uses `ENGINE_HTTP_CONCURRENCY` and `ENGINE_MAX_MODEL_MB`.
The plan can apply a lower upload limit. Uploads above 100 MiB use multipart.

For separate workers set `BOQLET_ENGINE_TRANSPORT=postgres`. Models, runs, previews and
comparisons use `BOQLET_ENGINE_MODEL_POOL`. Excel and import jobs use
`BOQLET_ENGINE_GENERAL_POOL`. Both pools default to `default`. Run one or more
`boqlet-worker --pool <name>` processes and set `ENGINE_QUEUE_DSN` and the storage
credentials for each. Worker settings also include `ENGINE_QUEUE_TYPES`,
`ENGINE_QUEUE_CONCURRENCY`, `ENGINE_QUEUE_JOB_TIMEOUT_SECONDS`,
`ENGINE_QUEUE_POLL_SECONDS`, and `ENGINE_MAX_MODEL_MB`.
An active worker slot starts a dedicated child process for the IFC task. The slot
renews its lease, discards results from a lost attempt, and terminates children
on cancellation, timeout or shutdown.

Run migrations before granting the queue service account its privileges. Grant
database connection and schema usage as needed, then only these function grants
to the worker role. The API owns ingestion and tenant data.

```sql
GRANT EXECUTE ON FUNCTION public.queue_claim(uuid,text,text[]) TO boqlet_queue;
GRANT EXECUTE ON FUNCTION public.queue_renew(uuid,uuid,integer,jsonb) TO boqlet_queue;
GRANT EXECUTE ON FUNCTION public.queue_finish(uuid,uuid,integer,jsonb) TO boqlet_queue;
```

`boqlet_queue` is the worker role's name on the pilot (`ops/pilot/queue-grants.sql`); use your
own role name elsewhere. The local stack (`ops/local`) uses the HTTP transport and needs no
queue role.

The API continues to use the separate HTTP engine endpoint for small synchronous
RPCs such as names and workbook templates, and for first-time public workbook
rendering. Serve this endpoint on the internal network. Database job results are
ingested on `LISTEN job_finished` with one-second polling as fallback.

## Shares, administration and maintenance

- Share tokens contain 32 cryptographically generated bytes, and the database
  stores only their hashes. A create request with an `Idempotency-Key` derives
  the same token on retry from the link identifier, key and invitation signing
  secret. The response cache excludes the public URL.
  The public route checks the current link and organisation state on every request.
  Geometry and public Excel downloads are signed for five minutes. Public Excel
  is generated from the measured run with internal notes, checks, questions and
  review information removed. `BOQLET_PUBLIC_SHARE_REQUESTS_PER_MINUTE` sets the
  per-address, per-API-instance limit.
- Platform admin access requires the database role flag on a verified pilot login.
  Grant `users.platform_role='admin'` to a specific enrolled account through
  database administration (locally: `npm run local:admin -- <email>`). Native sign-in has
  no MFA yet, for admins included (`docs/architecture/security.md`); with the Keycloak
  rollback, configure MFA for the admin identity there.
  Admin views use account metadata and counts. App permissions remain tied to
  organisation and project memberships.
- Scheduled maintenance keeps the live replay window bounded, expires idle
  sessions and invitations, and clears stale presence and idempotency keys.
  `BOQLET_RUN_INDEX_DAYS` defaults to 30. Old superseded row indexes can be
  reconstructed from their immutable worker artifact. Current, saved and pinned
  runs keep their indexes. The org plan controls audit retention.
- `BOQLET_ORG_PURGE_HOURS` defaults to 24. Deletion first closes access and
  cancels pending work. The purger erases live database data and the org storage
  prefix after the grace period and job shutdown. A versioned bucket requires the
  API storage role to list and delete object versions and delete markers as well
  as abort multipart uploads. Keep backup expiration consistent with the removal
  requirement when deployment is configured.

## Verification

To include the native integration test in Maven `verify`, install the engine Python
dependencies and set `BOQLET_NATIVE_WORKER_PYTHON` to the interpreter's absolute path,
`AWS_ACCESS_KEY_ID=boqlet-test` and `AWS_SECRET_ACCESS_KEY=boqlet-local-test-only` in
the test process. The suite starts PostgreSQL 16, SeaweedFS (the S3 server the pilot
runs) and MailHog in temporary containers and runs its own Python workers. Set `BOQLET_NATIVE_QUEUE_TEST=1` to
run it against PostgreSQL job delivery with a restricted worker login.
The integration flow covers the Duplex upload, Library preview and workbook,
BoQ versions, comparison, public sharing, sample provisioning, mail and SSE.
It also checks cross-tenant paths, idempotent requests, old-run restoration,
metadata-only administration, and live database and storage deletion.
Set `BOQLET_NATIVE_NODE` to the absolute Node interpreter path after `npm ci`
to run the shared HTTP contract suite against that same temporary Java API; add
`BOQLET_NATIVE_SCENARIOS=1` for the scenario suite (`BOQLET_SCENARIO_FILTER` narrows it),
`BOQLET_BROWSER_SMOKE=1` for the browser smoke (`BOQLET_BROWSER_SMOKE_FILTER`) and
`BOQLET_API_PERF=1` for the API performance suite. The test JWT decoder, the test-only routes
(`com.boqlet.suite.SuiteSupport`: users, clock, mail settle, setup links) and fixtures live in
the test sources, so these suites cannot run against the local Docker stack
(`docs/testing/README.md`).

## Modules and monitoring

Core runs with no installed modules. A module supplies a Spring `CoreModule`
bean for its profile fields, account kind, entitlement keys, audit actions,
metrics, email templates, and scheduled work. For measurements it can use
`BoqReadService` and `ExportDataService`, which require an actor and apply project
visibility. Spring listeners receive `CoreEvents.Event` on a separate task
after the producing transaction commits.

Use `BOQLET_LOG_FORMAT=ecs` for structured API logs.
Set `BOQLET_MANAGEMENT_ENDPOINTS=health,prometheus` to enable metrics scraping.
`BOQLET_MANAGEMENT_PORT` can place the management endpoints on an internal port.
Queue gauges track queued and running jobs and the oldest claimable job by pool.
The Admin Health API reports job failures and processing duration percentiles.
