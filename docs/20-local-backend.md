# 20 Running the backend locally

The product runs on one machine the same way the pilot does: the Java API with native sign-in,
the Python engine worker, PostgreSQL, S3-compatible object storage and a mail catcher, in Docker.
The app runs on the host with hot reload and passes `/api/v1` through to the API. There is no
other backend: the mock API was removed (P53).

## Requirements

- Docker with Compose v2 (Docker Desktop on Windows and macOS). Nothing else for the backend:
  the images build the Java service with Maven and install the engine inside Docker, so Java,
  Maven and Python are not needed on the host for this.
- Node.js 22 for the app (`npm install` as usual).

## Start

```bash
npm install
npm run dev:app                          # starts the backend (local:up), then the app on :3000
npm run local:user -- you@example.com    # prints a sign-up link; open it, set a password
```

Open the link, choose a password of 15 characters or more, sign in at http://localhost:3000.
A new account makes its organisation in onboarding; the sample project gives a Duplex BoQ.

The first `local:up` builds the images and takes several minutes (Maven and the engine's
dependencies download). Later starts take seconds; they rebuild only what changed.

## Commands

| Command | What it does |
|---|---|
| `npm run local:up` | Build and start the backend, wait until the API is ready. Rebuilds the API and engine images from the working tree, so run it again after changing `services/api` or `engine`. |
| `npm run dev:app` | `local:up`, then the app (`npm run dev -w @ifc-boq/app`) on http://localhost:3000. |
| `npm run local:user -- <email>` | A one-hour sign-up link for a new account, or a password-reset link for an existing one (as `ops/pilot/issue-setup-link.sh` does on the pilot). |
| `npm run local:admin -- <email>` | Make an existing account a platform admin (`/admin`). |
| `npm run local:check` | End-to-end check through the API: sign-up, sign-in, org, project, the Duplex uploaded to object storage, parsed by the engine, a BoQ run with its lines. CI runs it too. |
| `npm run local:status` | The containers and whether the API is ready. |
| `npm run local:logs -- [service]` | Follow the logs (`api`, `engine`, `db`, `storage`, `mail`). |
| `npm run local:down` | Stop; the data is kept. |
| `npm run local:reset` | Stop and delete all data (database, stored files). |

## What runs where

| Service | Address on the host | Notes |
|---|---|---|
| App (host, `next dev`) | http://localhost:3000 | Native sign-in. `/api/v1` is rewritten to `API_PROXY_TARGET`, default http://localhost:8080. |
| `api` (Java) | http://localhost:8080 | `BOQLET_NATIVE_AUTH=true`, cookies without `Secure` (plain HTTP), the app's origin `http://localhost:3000`. Health: `/actuator/health/readiness`. |
| `engine` | not published | The HTTP worker the API calls (`BOQLET_ENGINE_TRANSPORT=http`). |
| `db` (PostgreSQL 16) | `localhost:55432`, user and database `boqlet`, password `boqlet-local` | Flyway creates the schema when the API starts. |
| `storage` (SeaweedFS, S3) | http://localhost:8333 | The browser uploads and downloads here directly with signed URLs; `storage-init` creates the bucket and allows the app's origin (CORS). |
| `mail` (MailHog) | http://localhost:8025 | Every email the API sends: invitations, notifications. |

Everything is in `ops/local/compose.yaml` (project name `boqlet-local`); the helper is
`scripts/local.mjs`. The secrets in it are fixed local-only values. Ports can be moved with
`LOCAL_APP_PORT`, `LOCAL_API_PORT`, `LOCAL_S3_PORT`, `LOCAL_DB_PORT`, `LOCAL_MAIL_UI_PORT`; set the
same values for every `local:*` command and for the app (`API_PROXY_TARGET`, `--port`).

## Working on one part

- **Engine only.** `npm run dev:engine-worker` runs a standalone worker on 8788 with its files in
  `engine/.cache/blobs`; `npm run test:engine` and `npm run boq` need no backend at all.
- **Java with your own build.** Stop the `api` container (`docker compose -f ops/local/compose.yaml
  stop api`) and run the jar against the same services with the variables in the `api` service
  of `ops/local/compose.yaml`, replacing the service names with `localhost` and the published
  ports. The engine is not published; run `npm run dev:engine-worker` with
  `ENGINE_STORAGE=s3://boqlet-local`, `ENGINE_S3_ENDPOINT=http://localhost:8333` and the
  storage credentials from the Compose file.
- **The app against the pilot or another API.** `API_PROXY_TARGET=<api origin> npm run dev -w @ifc-boq/app`.
  Java accepts changes only from its configured app origin (`BOQLET_APP_URL`).

## Tests

The local stack runs the product, not the test-only routes: the shared contract and scenario
suites (`tests/`) and the browser smoke (`apps/app/e2e-java`) need the clock, user and setup-link
routes of `SuiteSupport`, which exist only in the Java test sources. They run through
`NativeWorkerTest` (`services/api`, `mvn verify` with `BOQLET_NATIVE_WORKER_PYTHON`,
`BOQLET_NATIVE_NODE`, `BOQLET_NATIVE_SCENARIOS=1`, `BOQLET_BROWSER_SMOKE=1`), as CI's `api` job does.
`npm run local:check` checks the local stack itself.
