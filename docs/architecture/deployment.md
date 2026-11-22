# Deployment (cloud-neutral)

The [Contabo pilot runbook](../operations/pilot.md) covers the live v1 topology, DNS, worker controls, verification and rollback.

Everything runs as containers. Any provider with containers, Postgres and S3-compatible storage
works (P09): AWS, GCP, Azure, Hetzner, Fly.io, Render. Today there is **one deployed
environment**, the invite-only pilot on a Contabo host (booqlet.com, P51), and the local Docker
stack for development. There is no staging environment (BE-032 is a future todo).

## Services (as deployed on the pilot, `ops/pilot/compose.yaml`)

| Service | Image / command | Pilot resources | Notes |
|---|---|---|---|
| `boqlet-web` | Next.js (`apps/app`, standalone output; `ops/pilot/web.Dockerfile`) | 768 MB | stateless; no business logic |
| `api` | Java (`services/api/Dockerfile`) | 2 CPU, 1.5 GB | stateless; native sign-in; `BOQLET_ENGINE_TRANSPORT=postgres`; runs the `@Scheduled` tasks itself (advisory locks, no separate scheduler) |
| `engine` | `ops/pilot/engine.Dockerfile`, HTTP worker (`uvicorn ifc_boq.worker_http:app`) | `ENGINE_HTTP_CPUS` (1), `ENGINE_HTTP_MEMORY` (1.5 GB) | internal only: rpc (`/rpc/{op}`) and the public share's synchronous Excel |
| `queue` | same image, `boqlet-worker` (`worker_queue.py`) | `ENGINE_QUEUE_CPUS` (2), `ENGINE_QUEUE_MEMORY` (4 GB) | claims jobs from Postgres as role `boqlet_queue`; not serverless (D61); scale by adding workers per pool |
| `db` | `postgres:16-alpine` | — | a container on the pilot (not managed); `ops/pilot/backup.sh` dumps instead of PITR (written and restore-tested, not yet installed on the host) |
| `storage` | SeaweedFS (S3 API) | — | browser uploads and downloads through signed URLs at `files.booqlet.com` |
| `identity` | Keycloak, compose profile `legacy-identity` | — | **rollback only**; not started by default (native sign-in, P50) |
| `ingress` | Traefik (shared edge, `ops/pilot/traefik-routes.json`) | — | TLS, routing |
| Email | SMTP through the API's outbox (`BOQLET_SMTP_*`) | — | provider credentials are the operator's |
| Billing | none | — | manual billing for pilots (D7); the webhook answers `400 unsupported_provider` |

Development runs the whole backend locally in Docker (`ops/local/compose.yaml`: `db`, `storage`,
`storage-init`, `mail` (MailHog), `engine` (HTTP worker), `api`; `docs/development/local-setup.md`).
`npm run dev:app` starts it, then the app on the host. (Phases 1–3 used a mock API instead,
removed by P53.)

## Configuration (environment)

Every variable is in `docs/development/environment.md`; the Java service's are explained in
`services/api/README.md`, and `ops/pilot/compose.yaml` / `ops/local/compose.yaml` show working
sets. The main ones per service:

| Service | Variables |
|---|---|
| web | `API_PROXY_TARGET` (where the app forwards `/api/v1` in development), `NEXT_PUBLIC_API_BASE_URL` (default `/api/v1`), `NEXT_PUBLIC_AUTH_ADAPTER` (`native` default, `keycloak` rollback) |
| api | `BOQLET_JDBC_URL`, `BOQLET_DB_USER`, `BOQLET_DB_PASSWORD`; `BOQLET_NATIVE_AUTH`, `BOQLET_APP_URL`, `BOQLET_SECURE_COOKIE`; `BOQLET_S3_*` and `AWS_*`; `BOQLET_ENGINE_TRANSPORT`, `BOQLET_ENGINE_HTTP_URL`, `BOQLET_ENGINE_MODEL_POOL`, `BOQLET_ENGINE_GENERAL_POOL`, `BOQLET_ENGINE_JOB_TIMEOUT`; `BOQLET_SMTP_*`; `BOQLET_INVITATION_SECRET`; `BOQLET_LOG_FORMAT`, `BOQLET_MANAGEMENT_*` |
| engine / queue | `ENGINE_STORAGE`, `ENGINE_S3_ENDPOINT`, `ENGINE_HTTP_CONCURRENCY`, `ENGINE_MAX_MODEL_MB`; queue: `ENGINE_QUEUE_DSN`, `ENGINE_QUEUE_POOL`, `ENGINE_QUEUE_TYPES`, `ENGINE_QUEUE_CONCURRENCY`, `ENGINE_QUEUE_JOB_TIMEOUT_SECONDS`, `ENGINE_LOG_FORMAT` |

## Environments

`local` (developer machine, `ops/local`) and the pilot (booqlet.com, `ops/pilot`), which since
the v1 release is production and still counts as development (no real users yet, P51). Wherever
older docs say "staging", read the pilot or the local stack. Flyway migrations run when the API
starts, before it takes traffic. Expand-and-contract for breaking schema changes, so the
automatic rollback to the previous image keeps working (`docs/operations/auth-and-deploys.md`).

## Routing

One public domain, `booqlet.com`, serves `boqlet-web`; Traefik routes `/api/v1` to `api`, so
cookies stay same-origin. Storage has its own domain (`files.booqlet.com`) with signed URLs; its
CORS allows PUT/GET from the app origin only (`ops/pilot/configure-storage.py`). `auth.booqlet.com`
is routed for the Keycloak rollback only.

## Observability

- Structured JSON logs with `requestId`, `orgId`, `userId`, `jobId`.
- Traces in the API only (OpenTelemetry through Micrometer, exported when an OTLP endpoint is set);
  the app and the engine have none. A job is followed across the API and the worker by its `jobId`,
  which the worker's log lines carry.
- Metrics: request rate/latency/errors per endpoint, queue depth and wait time per pool, job
  duration per type and size class, ingestion time, SSE connections, limit hits.
- Alerts: queue wait > 5 min (standard pool), job failure rate > 5%/h, API 5xx > 1%,
  DB connections > 80%, storage errors.
- Error tracking (Sentry or equivalent) for web and API: not set up (needs an account).

Built in BE-025 (2026-11-21): the logs, metrics, alerts and API traces above, with alerts as log lines
until a destination is chosen and no error tracking yet (both need an account); operator view in
`docs/operations/pilot.md` "Observability and backups".

## Backups and recovery

- Target: Postgres point-in-time recovery, 14 days, with a regular restore test (no staging; the
  pilot uses dumps, below).
- Storage: versioning on the bucket for `uploads/`, `runs/`, `exports/`. Parse artifacts can be
  recomputed from `uploads/`.
- RPO 1 h, RTO 4 h for v1 (nfr.md).
- Pilot (P51): `ops/pilot/backup.sh` (database dump, roles, object volume; 14 days; off-host copy
  with `BACKUP_REMOTE`) and `ops/pilot/restore-check.sh`; the restore is tested in CI
  (`BackupRestoreTest`). The pilot's Postgres is a container, so point-in-time recovery is
  replaced by hourly dumps until a managed database is used.
