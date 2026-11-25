# Environment variables

Every variable the parts read, by component. Canonical sources: `apps/app/src/config.ts` and
`apps/app/next.config.ts` (app), `services/api/src/main/resources/application.yml` (Java),
`engine/ifc_boq/*.py` and `scripts/*.mjs` (engine), `ops/local/compose.yaml` (the values used
locally) and `ops/pilot/compose.yaml` (the pilot). The local stack sets everything for you; you
need these only to run a part on its own, or to deploy.

## App (`apps/app`)

| Variable | Default | Purpose |
|---|---|---|
| `API_PROXY_TARGET` | `http://localhost:8080` in development | Where `next dev` forwards `/api/v1` (the route handler `app/api/v1/[...path]/route.ts`). In production nothing is forwarded unless it is set (on the pilot Traefik routes `/api/v1`) |
| `NEXT_PUBLIC_API_BASE_URL` | `/api/v1` | Base URL of the API client |
| `NEXT_PUBLIC_AUTH_ADAPTER` | `native` | `native` (P50) or `keycloak` (rollback only) |
| `NEXT_PUBLIC_KEYCLOAK_URL`, `_REALM`, `_CLIENT_ID` | — | Only with the `keycloak` adapter |
| `NEXT_DIST_DIR` | `.next` | Separate build folder (the browser smoke uses `.next-java`) |
| `MODULE_PRICING` | unset | Setting it to `1` fails the build on purpose: there is no pricing module (P48) |

## Java API (`services/api`)

Full reference with what each does: [services/api/README.md](../../services/api/README.md).

| Group | Variables |
|---|---|
| Database, server | `BOQLET_JDBC_URL`, `BOQLET_DB_USER`, `BOQLET_DB_PASSWORD`, `BOQLET_API_PORT` (8080), `BOQLET_FORWARD_HEADERS_STRATEGY` |
| Sign-in and sessions | `BOQLET_NATIVE_AUTH` (`true` for native sign-in), `BOQLET_SECURE_COOKIE` (`false` only over plain HTTP), `BOQLET_APP_URL` (the one allowed Origin), `BOQLET_INVITATION_SECRET` (≥ 32 bytes); OIDC rollback: `BOQLET_OIDC_ISSUER`, `_AUDIENCE`, `_JWKS_URL`, `_REVOCATION_CLIENT_ID`, `_REVOCATION_CLIENT_SECRET`, `BOQLET_PILOT_EMAILS` |
| Mail | `BOQLET_SMTP_HOST`, `_PORT` (587), `_USERNAME`, `_PASSWORD`, `_AUTH`, `_STARTTLS`, `_FROM`, `_POLL_MS` |
| Object storage | `BOQLET_S3_BUCKET`, `BOQLET_S3_REGION`, `BOQLET_S3_ENDPOINT`, `BOQLET_S3_PUBLIC_ENDPOINT` (the address browsers use for signed URLs), plus `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| Engine | `BOQLET_ENGINE_TRANSPORT` (`http` default, or `postgres` for the queue), `BOQLET_ENGINE_HTTP_URL`, `BOQLET_WORKER_TOKEN` (the HTTP worker's shared secret, sent as a bearer token; the worker must have the same value), `BOQLET_ENGINE_HTTP_CONCURRENCY`, `BOQLET_ENGINE_JOB_TIMEOUT`, `BOQLET_ENGINE_MODEL_POOL`, `BOQLET_ENGINE_GENERAL_POOL`, `BOQLET_MAX_UPLOAD_MIB` |
| Observability | `BOQLET_LOG_FORMAT`, `BOQLET_TRACING_SAMPLING`, `BOQLET_MANAGEMENT_PORT`, `BOQLET_MANAGEMENT_ENDPOINTS` (OTLP endpoint through the standard OpenTelemetry settings) |
| Limits and retention | `BOQLET_PUBLIC_SHARE_REQUESTS_PER_MINUTE` (300), `BOQLET_ORG_PURGE_HOURS` (24), `BOQLET_RUN_INDEX_DAYS` |
| Scheduled-task intervals | `BOQLET_MAINTENANCE_POLL_MS`, `BOQLET_RETENTION_POLL_MS`, `BOQLET_SAMPLE_POLL_MS`, `BOQLET_ALERT_POLL_MS`, `BOQLET_LIMIT_ALERT_POLL_MS`, `BOQLET_JOB_METRICS_POLL_MS`, `BOQLET_OIDC_REVOCATION_POLL_MS` |

## Engine worker (`engine/ifc_boq`)

| Variable | Purpose |
|---|---|
| `ENGINE_STORAGE` | `file://<folder>` or `s3://<bucket>` for job inputs and outputs (`npm run dev:engine-worker` defaults to `engine/.cache/blobs`) |
| `ENGINE_S3_ENDPOINT` | S3 endpoint (with the `AWS_*` credentials) |
| `ENGINE_WORKER_PORT` | HTTP worker port (8788) |
| `BOQLET_WORKER_TOKEN` | The HTTP worker's shared secret: when set, `/jobs` and `/rpc` answer `401` without `Authorization: Bearer <token>` (constant-time compare; `/health` is open). Unset, the worker accepts every call and logs a warning (`npm run dev:engine-worker`). The API gets the same value (review A-36) |
| `ENGINE_HTTP_CONCURRENCY`, `ENGINE_MAX_MODEL_MB` | HTTP worker concurrency and model size cap |
| `ENGINE_QUEUE_DSN`, `ENGINE_QUEUE_POOL`, `ENGINE_QUEUE_TYPES`, `ENGINE_QUEUE_CONCURRENCY`, `ENGINE_QUEUE_JOB_TIMEOUT_SECONDS`, `ENGINE_QUEUE_POLL_SECONDS` | The Postgres queue worker (`boqlet-worker`, used on the pilot) |
| `ENGINE_LOG_FORMAT` | `json` for structured logs |
| `IFC_BOQ_CACHE`, `IFC_BOQ_PRESETS`, `IFC_BOQ_SCHEMAS`, `IFC_BOQ_USER_PRESETS` | Cache folder, presets, schemas, the user preset folder (read only when set: `presets/user/` is no longer read by default, review A-31) |

## Setup and local stack

| Variable | Purpose |
|---|---|
| `IFC_BOQ_PYTHON` | The Python `npm install` uses for `engine/.venv` |
| `IFC_BOQ_SKIP_ENGINE_SETUP=1` | Skip the engine setup in `npm install` |
| `LOCAL_APP_PORT`, `LOCAL_API_PORT`, `LOCAL_S3_PORT`, `LOCAL_DB_PORT`, `LOCAL_MAIL_UI_PORT` | Move the local stack's ports (3000, 8080, 8333, 55432, 8025); set the same values for every `local:*` command and the app |

## Test harness

The variables that switch on the shared suites, the browser smoke and the performance suite inside
`mvn verify` (`BOQLET_NATIVE_WORKER_PYTHON`, `BOQLET_NATIVE_NODE`, `BOQLET_NATIVE_SCENARIOS`,
`BOQLET_BROWSER_SMOKE`, `BOQLET_NATIVE_QUEUE_TEST`, `BOQLET_NATIVE_RESILIENCE`, `BOQLET_API_PERF`, the filters, `API_URL`,
`PERF_OUT`) are listed in [../testing/README.md](../testing/README.md#how-to-run-each-layer).
