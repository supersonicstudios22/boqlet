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
- Java 21 and Docker for the backend and its tests (`services/api/README.md`)

## Start

```bash
npm install
npm run dev:app
```

Open http://localhost:3000 and sign in as one of the seeded users. The app runs against the mock
API (`apps/mock-api`), which computes through the real engine worker. The sample project
"Duplex" shows a BoQ generated from `fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc`.

`npm install` creates a Python virtual environment in `engine/.venv` and installs the engine
(ifcopenshell, trimesh and friends). The first time takes a minute or two. If Python is missing,
npm still installs and prints what to do; run `npm run setup:engine` afterwards.

## Other commands

```bash
npm run test                         # typecheck, lint, app and mock tests, shared suites, engine tests
npm run e2e:app                      # browser tests (Playwright) against the mock
npm run boq -- model.ifc --out boq.xlsx --rules demo-tweaked
npm run codegen                      # after editing packages/types/src
```

The full list is in `CLAUDE.md`.

## Documentation

Start with `CLAUDE.md`, then `docs/README.md` (the engine) and `plan/README.md` (the product).
