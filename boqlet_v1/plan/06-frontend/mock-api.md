# Mock API (`apps/mock-api`)

A Node service that implements `openapi.yaml` well enough to build and test the whole frontend
before the Java backend exists (P11). CRUD state lives in a JSON file. Computation goes to the
**real Python engine**: in phase 1 through the existing proof-of-concept engine API
(`engine/ifc_boq/api.py`, port 8787), with the engine features that don't exist yet **faked**
(table below, P39); from phase 2 (milestone ME) through the worker contract's HTTP transport
(`04-architecture/engine-worker.md`). When Java is ready, the frontend points at it and the
mock stays as a test double for frontend e2e tests.

**It is a test double, not a prototype of the backend.** Keep it simple and readable. It
doesn't need to scale, persist safely or be secure. It must be **behaviourally faithful** to
the contract: the same status codes, error codes, state machines, permissions and limits,
because the frontend is built against it.

## Tech

| Concern | Choice |
|---|---|
| Server | Node 20+, **Hono** + `@hono/node-server`, TypeScript |
| Contract | Request/response validation against `packages/api/openapi.yaml` (e.g. `openapi-backend` or Ajv over the bundled spec). In dev, a response that fails validation is a 500 with the validation error, to catch drift early |
| Types | The same generated `schema.d.ts` as the frontend |
| Store | In-memory object, persisted to `apps/mock-api/.data/db.json` (debounced). `npm run mock:reset` reseeds |
| Blobs | `apps/mock-api/.data/blobs/` with the storage key layout of `storage-jobs-realtime.md`. Signed URLs become `http://localhost:4010/_blobs/<key>?sig=…` (PUT/GET) |
| Engine | One `engine` interface with two implementations. **Phase 1:** `PocEngine` over the proof-of-concept API (`POST /api/models`, `GET /api/models/{id}/scene`, `/geometry.glb`, `POST /api/models/{id}/names`, `POST /api/runs`, `GET /api/runs/{id}/boq.xlsx`, `POST /api/presets/{kind}/check`, `PUT /api/presets/{kind}/{id}`, `POST /api/codelists/read`, `/build`), plus the fakes below. **Phase 2:** `WorkerEngine` over the HTTP transport (`POST {ENGINE_URL}/jobs/{type}` with NDJSON progress → SSE `job.progress`, `POST {ENGINE_URL}/rpc/{op}`; storage root = the mock's blob folder) |
| SSE | In-process event bus → `GET /api/v1/events` |
| Email | Written to `.data/outbox/*.html` and listed at `GET /_dev/outbox` (dev page) |
| Clock | `GET/POST /_dev/clock` to move time forward (invitation and session expiry; module deadlines) |
| Port | 4010 |

## Engine fakes (phase 1 only, P39)

Engine features the plan needs but the proof-of-concept engine doesn't have yet. Each fake lives
in `apps/mock-api/src/engine/fakes/<name>.ts`, is behind the `engine` interface, and is deleted
when its task lands in phase 2 (FE-042 checks the table is empty). Fakes **never measure**
(BR-01): they only rearrange, relabel or apply values a person entered. Criteria that depend on
a fake are marked "(fake)" in phase-1 test runs and re-checked in phase 3.

| Fake | What the mock does in phase 1 | Known gap until the real task | Replaced by |
|---|---|---|---|
| Trace steps | Native runs provide structured steps from the calculation. The adapter adds edit author metadata. | The optional legacy engine still uses the approximate trace step adapter. | EN-013 |
| Pricing workbooks (MP1) | SheetJS for offer request and pricebook workbooks | Simplified layouts | EN-P1 |

## What it implements

Everything in `openapi.yaml`, with these simplifications:

| Area | Mock behaviour |
|---|---|
| Auth | `Bearer mock:<userId>`, or `mock:<userId>:<sessionId>` once the app has opened its session (F01 §10: every request with a session id is checked against the account's active session; tokens without one are test clients' and skip that check, FE-012); `GET /_dev/users` lists seeded users for the mock sign-in page; `POST /_dev/users {name, email}` signs up a new person (F01, FE-005) |
| Permissions | Full (same matrix, `03-domain/permissions.md`). This is where frontend gating gets tested |
| Entitlements | Full checks and `402` errors from the seeded plans |
| Billing | `manual` adapter: checkout returns `/_dev/checkout?org=…&plan=…&returnUrl=…`, which switches the plan immediately and goes back; the portal returns to `returnUrl` (nothing to manage). Entitlements are the plan's with the platform admin's overrides on top (FE-038); a trial set by an admin shows as `trialing` until it ends; usage rows are written per parse and run with their project (FE-019) |
| Jobs | Executed immediately, one at a time per type, via the engine HTTP transport. Progress relayed. Cancel closes the stream |
| Ingestion | Lines, questions, log kept as arrays per run (no DB). Paging and filters done in memory |
| Engine messages | EN-004 passes engine codes and structured params through to the client. Saved pre-EN-004 runs and messages without a translation still use the English `message` fallback. |
| Line edits | EN-003 sends edits to the engine as `override:{lineKey}` decisions. The engine applies quantities before derived rules, emits orphan questions and records original line values. The mock owns display ordering (`sortAfter` and `sortHint`). |
| Manual codes | EN-007 sends manual items inline with the run. The engine uses each item's chosen code first and falls back to the classification map for other systems. |
| Item texts | EN-010 fills the selected code's template in the engine with the shared rule expression evaluator. The exporter uses the selected grouping text and carries the measured description alongside it. |
| Setup | EN-011 ships the setup steps in the As modelled preset and validates the flattened rule data. The frontend reads the steps from the engine result. |
| Preset workbooks | EN-012 downloads and imports preset templates through the worker RPC. Import runs the normal preset check and returns a proposed draft, workbook cell problems and a change list. Complex classification rules remain unchanged when editing the simpler Codes per line sheet. |
| Decisions | Kept per project with history (`supersededAt`). A run's request keeps the decisions it was sent, each with the question it answers, and the run keeps the ids of the questions it asked; `GET /runs/{id}/questions` lists the asked ones plus the ones the run was answered out of, joined with the current decisions (FE-010). "Used by latest runs" means sent with a BoQ's current run with the same answer: the PoC engine doesn't say which answers it applied, so a decision whose question no longer arises still counts as used (EN-002 reports applied decisions) |
| Library | Presets per org, kind and layer (FE-021): create empty (the PoC Library's blank documents; federation and resolution start from the system default's), as a copy of any readable version (document renamed to the new slug), or as a patch on a rule-set version (`extends` = the parent's document id, `extendsVersionId` = the version). Slugs are unique per org and kind, system slugs included. A draft's ETag is `"<versionId>.<rev>"`; `PUT /presets/{id}/draft` with a different `If-Match` answers `409 draft_conflict`, without one it overwrites ("restore as draft"); every save runs the engine's check (rule sets with their org parents passed as `library` documents under `mock-<versionId>`). Archive is one-way (the contract has no unarchive). "Used by" counts BoQ revisions in projects the caller can see. New projects' defaults come from the org's starred presets (F02 §2) |
| Setup | `GET/PUT /orgs/{orgId}/setup` keep `Org.setup` (FE-028): `204` until someone starts; writing is for owners, admins and library editors (`finishSetup`); `done` sets `completedAt` (audit `org.setup_done`) and an `entity.changed` on the org refreshes `GET /me`. Orgs created through `POST /orgs` have no setup (the app sends their owner to the wizard); the seeded orgs are done. A preview of a rule-set patch with nothing published compares with the version it is based on (`compare.presetName`), so the wizard shows what its answers change against "As modelled" |
| Viewer | Geometry and scene index fetched from the PoC engine per model version once and kept in the blob folder (`orgs/<org>/model-versions/<id>/geometry.glb`, `scene.json`); the geometry's signed URL stays the same for a day so the browser caches it. Coverage per run (FE-016): *measured* = in a line's trace (or a derived per-line line's source line), *unmatched* = in an `unmatched` question, *covered by parent* = an aggregate parent is measured, *excluded* = every other element of the scene (spaces and openings left out); the PoC result doesn't say why an element was excluded |
| Notifications | One helper (`src/notify.ts`) writes the row, pushes `notification.created` and sends an email to the outbox when F13 emails the kind and the recipient's category is on (preferences per user, all on by default). Every core kind of F13 "Events" is sent: `model_version.ready`, `run.needs_input`, `job.succeeded` / `job.failed` (run, export; with `params.jobId` so the tab that started it can skip a second toast, FE-018), `boq.new_version_available` (FE-029), `version.saved`, `boq.confirmed`, `boq.reopened`, `revision.review_requested`, `revision.changes_requested`, `revision.approved`, `revision.review_withdrawn` (FE-031), `project_member.added`, `limit.near` (80 %) and `limit.reached` to owners and admins for seats, active projects, company presets and processing minutes, once per org and limit a month for minutes and 30 days for the others (`src/limits.ts`, FE-034) |
| Needs you | F02 §5 (`GET /orgs/{orgId}/attention`, `src/attention.ts`): computed per request for the caller in the org's active projects they're in: `review_requested` (in review, I'm a reviewer, not the submitter), `changes_requested` (back in draft after changes requested, I submitted), `needs_input` (the current run is mine and needs input), `new_model_version` (a newer ready version for a BoQ I created), `job_failed` (mine, last 7 days); English titles as fallback, `params` for the app's text |
| Co-editing | F06 §13–14 (FE-040): `positionNo` on every run line, in the `groupBy` system or the run's first classification (`src/positions.ts`: section code, the code list's separator, running number in line order with the run's moves, excluded lines without one, `0` for no code); a run never changes, so a saved version's numbers stay. Presence in memory (`src/presence.ts`): `PUT /boqs/{id}/presence` every 20 s, out after 45 s (`MOCK_PRESENCE_TTL_MS`) or on `DELETE`, every change as `boq.presence` to those in the BoQ; every saved line edit or manual line as `boq.line_edited {boqId, lineKeys, by, at}` to them and the editor. A saved version's `frozen.adjustments` carries its line edits and manual lines |
| Platform admin | F19 (FE-038): `/admin/*` answers only users with `platformRole: "admin"` (Pat), `404` to everyone else. Computed from the store on each request (no nightly table): the funnel from the records themselves (org created, `setup.completedAt`, first succeeded parse job, first complete run, first saved version, first export or share link), not from audit events; share-link views count on the day a link was last opened. Every `402` is a limit event (`limitEvents`, with the refused operation's id from the router's request context). Org status, tags, overrides, trial and plan history live beside the org (`orgOps`); a suspended org's writes answer `409 org_suspended` (the router resolves the org from the path parameters). Actions are audited with `actorKind: "platform_admin"`: plan, trial, overrides, suspend and reactivate in the org's log; detail views, notes, tags and ended sessions in the platform's (`orgId: null`). No billing webhooks or email bounces (always 0) |
| Share links | F18 (FE-036): the token (32 random bytes, base64url) is kept only as its sha256; status is computed (revoked, then suspended while the org's `publicLinksAllowed` is off, then expired); every public endpoint answers `404` for anything but an active link. Public lines leave out excluded lines, `overridden` and an edit step's author and reason; the line detail has the log only when included. The Excel is the saved version's frozen file, else one written for the link per run. Views are counted on `GET /public/shares/{token}`. No rate limiting in the mock. "Made with" badge: plans with `exportWatermark` (Free) |
| Scheduler | Core tasks and module-registered tasks every 10 s against the mock clock |
| Search, audit | Audit events appended. Filters in memory |
| Email | Outbox files |

## Legacy mock data

The mock starts with the worker by default. For local mock data containing models parsed
before EN-001, start the PoC engine with `npm run dev:engine` and set `POC_ENGINE_URL` in
the mock's environment. For a fresh worker-backed mock, use an empty `MOCK_DATA_DIR`
and set it for both the mock and the worker.

If the worker HTTP transport is not ready yet, the mock can call the PoC dev API
(`engine/ifc_boq/api.py`, port 8787):
- parse: `POST /api/models` (multipart, synchronous). Simulate progress stages on a timer.
- run: write the resolved preset docs with `PUT /api/presets/{kind}/{id}` under ids
  `mock-<presetVersionId>` (saved in `presets/user/`), then `POST /api/runs` with those ids
  and the decisions. A rule-set patch on an org or project version saves that parent (and its parents)
  the same way first, under its own `mock-` id (FE-021). Overrides and manual items are not supported on this path. Shipped system presets
  (version 1, seeded from `presets/`) are passed by their own id, not saved again; the project
  dictionary's latest published version is appended as the last dictionary; the full `BoqResult` is
  kept gzipped at `orgs/<orgId>/runs/<runId>/result.json.gz` in the blob folder (FE-008). The suites'
  private engine saves these presets in the suite's temp folder (`IFC_BOQ_USER_PRESETS`), not
  `presets/user`.
- names, check, code lists: the matching PoC endpoints.
- check details (F03 §5, the elements of each verification check): the PoC API has no endpoint for
  them, so `PocEngine.checks` reads `verification.checks` from the engine's cache
  (`engine/.cache/models/<sha256>/parsed.json`, or `IFC_BOQ_CACHE`) on the same machine (FE-007).
- names: the PoC sends `null` for the optional `layer`, `dictionary`, `entryId` of unresolved names;
  `PocEngine.names` drops them so responses match `NameUse` and the contract (FE-007).
Drop this path as soon as EN-001 is merged.

## Seed data (`npm run mock:seed`)

| Kind | Seed |
|---|---|
| Plans | free, professional, team, enterprise (values from 00-product/05) |
| Orgs | **Studio Demo** (`studio-demo`, team plan), **Small Firm** (`small-firm`, free plan, at its project limit, for limit testing) |
| Users | Olivia (owner), Ivana (library_editor), Marko (member → estimator), Ana (member → approver), Victor (member → viewer), vendors (pricing module plugin): Bob (Alfa Bau), Bea (Beton d.o.o.), Cem (CityBuild), Dana (linked to both orgs), Pat (platform admin) |
| Vendor links | Studio Demo: Bob, Bea, Cem, Dana active, one pending invitation; Small Firm: Dana active |
| Share links | Duplex "Tender BoQ": one pinned link (active), one revoked, one expired |
| Sessions | Marko has an active session on "Firefox on macOS" so the takeover screen can be tested |
| System presets | Everything in `presets/` (rule sets, classifications, dictionaries, settings) as system-layer presets, version 1 |
| Org presets | "Studio rules" (patch on as-modelled, 3 settings changed, v1 published + a draft), "Studio trades" classification (copy of demo-trades), "Studio names" dictionary (copy of acme-company) |
| Project 1 | **Duplex** (`fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc`): Architecture model v1 and v2 (v2 = modified fixture from EN-008), BoQ "Tender BoQ" with version A saved (on v1) and a working version (on v2) with a few decisions and line edits (a quantity, a text, a move, an exclusion); a second BoQ "Cost check" confirmed. Pricing plugin: an org pricebook (200 items), Bob's and Bea's pricebooks shared with Studio Demo, an estimate on "Tender BoQ" with 10 remembered matches, one open offer request to two vendors (one offer in) |
| Project 2 | **Office (federated)**: architecture + structure pair downloaded by `npm run mock:fetch-fixtures` (NBU office pair from `fixtures/corpus/catalogue.json` URLs, not committed); BoQ working version in `needs_input` |
| Project 3 | **Empty project** (for empty states) |

Seeding runs the real engine (parse + runs), so the seeded numbers are real. It takes a few
minutes once and the result is cached in `.data/`.

## Scripts (product root `package.json`)

| Script | Does |
|---|---|
| `npm run dev:app` | engine (the PoC engine API in phase 1, the worker's HTTP transport from EN-001) + mock API + Next app, concurrently |
| `npm run mock:seed` / `mock:reset` | seed / wipe and reseed |
| `npm run mock:fetch-fixtures` | download the federated pair (optional) |
| `npm run test:contract:mock` | run the contract test suite against the mock |

## Unplugging

1. Java implements the same `openapi.yaml` and passes the same contract suite
   (`08-delivery/testing.md`).
2. Point `NEXT_PUBLIC_API_BASE_URL` (or the dev rewrite) at Java, and switch
   `NEXT_PUBLIC_AUTH_ADAPTER` to the real provider.
3. The mock stays for frontend e2e tests in CI (fast, deterministic) and for demos without a
   backend.

The pricing module is a mock **plugin** (`apps/mock-api/plugins/pricing`), registered only when
`MODULE_PRICING=1`. Its seed data and handlers live there; the core mock runs without it.
