# Commands

Every npm script, run from the repository root (`package.json`). The most used ones are also in
[CLAUDE.md](../../CLAUDE.md). How to test: [../testing/README.md](../testing/README.md).

## Run the product

| Command | What it does |
|---|---|
| `npm install` | Installs the workspaces; `postinstall` creates `engine/.venv` and installs the engine (Python 3.10–3.13). Never fails if Python is missing; it prints what to do |
| `npm run dev:app` | `local:up`, then the app (`npm run dev -w @ifc-boq/app`) on http://localhost:3000 with `/api/v1` proxied to the Java API on 8080 |
| `npm run local:up` / `local:down` / `local:reset` | Build and start the backend in Docker (Java, engine worker, PostgreSQL, SeaweedFS, MailHog) and wait until the API is ready / stop, keep the data / stop and delete the data. Run `local:up` again after changing `services/api` or `engine` |
| `npm run local:demo` | One command to a running boqlet: `local:up`, an account (`demo@example.test`, a generated password) set up through `POST /auth/set-password`, an org with setup finished and the Duplex sample, the app on http://localhost:3000; prints the sign-in URL, email and password. Again: resets the password, reuses the org. Flags `--email`, `--password`, `--no-org`, `--port` ([local-setup.md](local-setup.md#start)). Ctrl+C stops the app, not the backend |
| `npm run local:user -- <email>` | A one-hour sign-up link (or a password-reset link if the account exists) |
| `npm run local:admin -- <email>` | Make an existing account a platform admin (`/admin`) |
| `npm run local:check` | End to end through the API on the local stack: sign-up, sign-in, org, project, Duplex upload, parse, BoQ run with its lines |
| `npm run local:status` / `npm run local:logs -- [service]` | Containers and API readiness / follow logs (`api`, `engine`, `db`, `storage`, `mail`) |
| `npm run dev:engine-worker` | A standalone engine worker on 8788 with files in `engine/.cache/blobs` (`ENGINE_WORKER_PORT`, `ENGINE_STORAGE`, `ENGINE_HTTP_CONCURRENCY`, `ENGINE_MAX_MODEL_MB`) |
| `npm run build:app` | Production build of the app |

## Check and test

| Command | What it does |
|---|---|
| `npm run test` | `typecheck` + `lint` + `test:app` + `test:engine` |
| `npm run typecheck` | `tsc` in every workspace (app, packages, tests) |
| `npm run lint` | The app's ESLint (includes the no-literal-UI-strings rule, F15) |
| `npm run test:app` | The app's Vitest unit tests |
| `npm run test:engine` | pytest in `engine/tests`, including the Duplex acceptance test |
| `mvn -f services/api/pom.xml verify` | The Java build and its tests (Docker needed); with the `BOQLET_NATIVE_*` variables also the shared suites and the browser smoke ([../testing/README.md](../testing/README.md)) |
| `npm run test:contract` / `npm run test:scenarios` | The shared suites against `API_URL`. They only work inside `NativeWorkerTest` (they need its test-only routes and seeded sessions); run outside it they stop at once with a message saying so (`tests/run.mjs` checks for `BOQLET_JAVA_SUITE_USERS`) |
| `npm run perf -w @ifc-boq/tests` | The shared performance suite (TS-002 API latency); inside `NativeWorkerTest` only, with `BOQLET_API_PERF=1` ([../testing/README.md](../testing/README.md)) |
| `npm run e2e:java -w @ifc-boq/app` | The browser smoke (`apps/app/e2e-java`); needs `BOQLET_JAVA_API` and the test-only routes, so it is started by `NativeWorkerTest` |
| `npm run bundle:check -w @ifc-boq/app` | Per-route bundle budgets after `build:app` (`--write` resets them with 10 % headroom) |
| `npm run api:lint` | Lint both HTTP contracts |
| `npm run api:gen` / `npm run api:check` | Regenerate the clients' types from the contracts / fail if they are out of date |
| `npm run codegen` | Regenerate the JSON Schemas from `packages/types/src` |

## Engine tools

| Command | What it does |
|---|---|
| `npm run boq -- <file.ifc> [more.ifc] --out boq.xlsx` | Command-line run, no backend. Several files are federated. `--rules`, `--dict`, `--class`, `--decisions`, `--disciplines`, `--json`, `--save-parsed`, `--quiet`; `--help` for all |
| `npm run corpus -- <folder>` | Run every IFC in a folder; one summary row per file, schema-validated. Use before adding fixtures |
| `npm run catalogue` | Regenerate `docs/testing/ifc-corpus-catalogue.md` from `fixtures/corpus/catalogue.json` |
| `npm run setup:engine` | Recreate the Python venv (after editing `engine/requirements.txt`) |
| `npm run import:uniclass` | Download Uniclass 2015 EF into `presets/classifications/uniclass2015-ef/codelist.json` |
| `npm run i18n:pseudo -w @ifc-boq/app` | Write the pseudo-locale (`apps/app/messages/en-XA`) from the English messages (F15) |
| `npm run start -w @ifc-boq/app` | Serve a production build of the app (`build:app` first) on port 3000 |
| `npm run ui:add -w @ifc-boq/app -- <name>` | Add a shadcn/ui component (style base-mira); never `npx shadcn add` |
