# boqlet

Drop a building model (IFC), choose how to measure and how to code the result, and get a Bill
of Quantities in Excel. Every quantity shows its formula, the values used and the elements behind it.

The product: a Next.js app (`apps/app`), a Java backend (`services/api`) and the Python engine
(`engine/`) as its worker, specified in `plan/` (where the build stands: `plan/10-build-log.md`).
The invite-only pilot runs at booqlet.com (`docs/18-contabo-pilot.md`).

## Requirements

- Node.js 22 (20 works)
- Python 3.10, 3.11, 3.12 or 3.13 on your PATH (`python3`, or `py` on Windows).
  To use a specific one: `IFC_BOQ_PYTHON=/path/to/python npm install`
- Docker with Compose v2 for the backend (`docs/20-local-backend.md`); Java 21 and Maven only to
  build and test `services/api` outside Docker (`services/api/README.md`)

## Start

```bash
npm install
npm run dev:app                          # the backend in Docker, then the app
npm run local:user -- you@example.com    # prints a sign-up link
```

Open the link, set a password and sign in at http://localhost:3000. The app runs against the
Java backend with the real engine worker, PostgreSQL, object storage and a mail catcher
(http://localhost:8025), all in Docker (`docs/20-local-backend.md`). The first start builds the
images and takes several minutes. The sample project gives a BoQ generated from
`fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc`.

`npm install` creates a Python virtual environment in `engine/.venv` and installs the engine
(ifcopenshell, trimesh and friends). The first time takes a minute or two. If Python is missing,
npm still installs and prints what to do; run `npm run setup:engine` afterwards.

## Other commands

```bash
npm run test                         # typecheck, lint, app unit tests, engine tests
npm run local:check                  # the local backend end to end: sign-up, upload, parse, BoQ run
npm run local:down                   # stop the backend (local:reset also deletes its data)
npm run boq -- model.ifc --out boq.xlsx --rules demo-tweaked
npm run codegen                      # after editing packages/types/src
```

The full list is in `CLAUDE.md`.

## Documentation

Start with `CLAUDE.md`, then `docs/README.md` (the engine) and `plan/README.md` (the product).
