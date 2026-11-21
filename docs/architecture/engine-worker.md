# Engine worker contract

The engine (`engine/ifc_boq`) runs as a worker with a fixed JSON contract, which the Java
backend uses (phases 1–3 also used it from a mock API, removed by P53;
`docs/archive/plan/mock-api.md`). The worker is: `engine/ifc_boq/worker.py` (job
execution, `JOB_TYPES`, `CONTRACT = "1"`), `engine/ifc_boq/rpc.py` (quick calls),
`engine/ifc_boq/storage.py` (local folder or S3), `engine/ifc_boq/worker_http.py` (HTTP
transport), `engine/ifc_boq/worker_queue.py` (PostgreSQL queue transport) and
`engine/ifc_boq/sheets/` (core workbooks: `boq_import.py`, `diff_export.py`, `templates.py`).
The pricing module's workbooks (`sheets/pricing/`, EN-P1) are **not built** (P48;
`docs/architecture/modules.md`). Tasks: EN-001…EN-013.

Public engine functions the worker wraps (docs/architecture/engine.md): `parse.parse_file`, `pipeline.get_boq`,
`export_xlsx.export`, `pipeline.names_in_model`, `presets.check`, `presets.flattened`,
`codelist_import`. **No engine logic in the worker.** It only maps JSON to calls.

## Job envelope

```json
{
  "jobId": "uuid",
  "type": "parse | run | preview | diff | export_xlsx | import_boq_edits",
  "orgId": "uuid",
  "input": { "...per type..." },
  "outputPrefix": "orgs/{orgId}/…/",
  "attempt": 1
}
```

Result:
```json
{ "jobId": "uuid", "status": "succeeded | failed | cancelled",
  "output": { "...per type..." },
  "error": { "code": "parse_error", "message": "…", "retryable": false },
  "durationMs": 5120, "metrics": { "elementCount": 218, "modelBytes": 2400000 } }
```

Progress events (any number, before the result):
`{ "jobId": "uuid", "stage": "geometry", "pct": 42, "message": "Meshing 180 of 218 elements" }`

All storage references are **keys** relative to the configured bucket/root. The worker reads
inputs from keys and writes outputs under `outputPrefix`. Writing is idempotent: a retried
job overwrites its own outputs.

## Job types

### parse
Input:
```json
{ "modelVersionId": "uuid", "sourceKey": "orgs/o/uploads/v/source.ifc", "fileName": "Duplex_A.ifc",
  "options": { "overlaps": true } }
```
Output:
```json
{ "summary": "ModelSummary without modelId/cached (packages/types/src/api.ts)",
  "artifacts": { "parsedKey": "…/parsed.json.gz", "geometryKey": "…/geometry.glb",
                 "meshesKey": "…/meshes.npz", "sceneKey": "…/scene.json" },
  "sha256": "…" }
```
Stages: `download`, `read`, `geometry`, `verify`, `write`. Errors: `not_ifc`,
`unsupported_schema`, `corrupt_file`, `parse_timeout` (retryable once), `parse_error`.

### run
Input (everything resolved by the API, so the worker never looks anything up):
```json
{
  "runId": "uuid",
  "models": [ { "id": "modelVersionId", "fileName": "…", "discipline": "architecture",
                "scope": { "exclude": [] }, "parsedKey": "…", "meshesKey": "…" } ],
  "ruleSet": { "doc": "RuleSet | RuleSetPatch", "library": ["parent docs, exact versions"] },
  "classifications": [ { "codeList": "CodeList", "map": "ClassificationMap" } ],
  "dictionaries": ["Dictionary (global → company → project order)"],
  "resolution": "ResolutionSettings",
  "federation": "FederationSettings",
  "decisions": ["Decision (incl. override:{lineKey} decisions, EN-003)"],
  "manualItems": ["ManualItem (appended to the rule set, EN-007)"],
  "unitSystem": "metric | imperial",
  "export": { "xlsx": true, "meta": { "project": "…", "boq": "…", "revision": "A", "status": "draft",
              "groupBy": "classification id", "locale": "en", "watermark": "DRAFT" } }
}
```
Output:
```json
{ "resultKey": "…/result.json.gz", "xlsxKey": "…/boq.xlsx",
  "status": "complete | needs_input", "stats": "BoqResult.stats",
  "counts": { "lines": 41, "questions": 3, "blockingQuestions": 0, "warnings": 2 } }
```
`result.json.gz` is a full engine `BoqResult` (schema `packages/types/schema/boq-result.schema.json`),
validated by the worker before writing. Stages: `load`, `names`, `measure`, `federate`,
`rules`, `classify`, `export`.

An `override:{lineKey}` decision carries the edited fields as its answer object. Line-scope
derived formulas consume the edited source quantity. For element-scope formulas the worker
scales the source line's derived contributions by the ratio of edited to measured quantity.
If the original quantity is zero or missing, the calculation trace records that no ratio is
available. A flag-to-confirm edit clears the affected quantities. The API owns line order.

Inline manual items are snapshotted as rules under `boq.` IDs. Their result line keys keep the
submitted item IDs for compatibility with existing line edits and sort hints. The namespaced ID
is used as the line key if an existing rule-set manual line has the same key. Codes supplied on
the item take precedence over map assignment and are reported with source `item`.

### preview
Same input as `run` with no workbook export. Optional `compareWith` can supply either a second
rule-set document or alternate preset IDs and documents for one or more input roles.
The worker stores the results and a line comparison under `previews/` for the configured
7-day storage lifecycle. Output is `{resultKey, compareResultKey?, diffKey?}`.

### diff (EN-002)
Input: `{ "fromResultKey": "…", "toResultKey": "…", "fromLabel": "A", "toLabel": "Working" }`.
Output: `{ "diffKey": "…/diff.json.gz", "summary": { "linesAdded": 2, "linesRemoved": 1, "linesChanged": 7, "elementsAdded": 3, "elementsRemoved": 1, "elementsChanged": 4, "questionsNew": 2, "questionsResolved": 0 } }`.
`diff.json.gz` follows `packages/types/src/diff.ts` and is validated against the generated
schema. Run inputs include a model manifest with logical model ID, version ID, trace ID, and
parsed artifact key. The worker compares parsed fields and material references only for changed
model versions. Line causes use version snapshots, element links, rule and parameter changes,
edits, and decision snapshots with question GlobalIds when available.

### export_xlsx
Input: `{ "resultKey": "…", "diffKey": null, "meta": { …as run.export.meta…, "issuedBy": "…", "issuedAt": "…", "issueNote": "…" } }`.
Output: `{ "xlsxKey": "…", "sizeBytes": 123 }`. With `diffKey` the worker writes the change report.
BoQ exports can carry project and issue metadata, grouping, position numbers and a plan watermark.
A supplied `boqId` enables round-trip metadata and protects the line-key column.

### import_boq_edits (EN-006, F12)

Input includes `fileKey`, `boqId` and `resultKey`; a caller may also send its current projected
lines as `currentLines`. Output includes `reportKey` for the gzipped `EditsImportReport` and proposal
counts. The engine reads the original grouping from the workbook and checks proposed edits
against the current lines. It treats an absent keyed row or a cleared keyed row as an exclusion.
The visible data cells are editable under sheet protection. Excel may require unprotecting the
sheet to move or physically delete rows containing a locked key.

### pricing.* (module jobs, EN-P1) — planned, not built

Planned for the pricing module (P48 defers it): `pricing.export_request` (offer request workbook
for vendors), `pricing.import_offer` (vendor's filled workbook → rates and a report),
`pricing.export_comparison`, `pricing.export_estimate` (priced BoQ in the core BoQ layout),
`pricing.import_pricebook` (template → proposed items and problems), to be registered by
`engine/ifc_boq/sheets/pricing/`. Neither the folder nor these job types exist today;
`worker.JOB_TYPES` lists only the six core types.

## RPC (quick, synchronous)

`POST {BOQLET_ENGINE_HTTP_URL}/rpc/{op}` (served by the HTTP worker, `worker_http.py`), JSON in
and out, stateless. Java (`worker/WorkerClient.java`) uses a 15 s request timeout (10 s connect).
RPC always goes over HTTP, also when jobs use the queue transport.

| op | Input | Output | Engine function |
|---|---|---|---|
| `check` | `{kind, doc, library?}` | `CheckPresetResponse` (problems, flattened) | `presets.check`, `presets.flattened` |
| `names` | `{parsedKey, dictionaries[]}` | `NamesResponse` | `pipeline.names_in_model` |
| `codelist-read` | `{fileKey}` (uploaded by the API) | `TableReadResponse` | `codelist_import` |
| `codelist-build` | `CodeListBuildRequest` | `CodeListBuildResponse` | `codelist_import` |
| `template-export` | `{kind, doc, library}` | xlsx bytes (base64) | `sheets/templates.py` (EN-012) |
| `template-import` | `{kind, doc, file}` | `TemplateImportResult` (openapi) | `sheets/templates.py` (EN-012) |
| `expr-check` | `{expr, context: "line" \| "element" \| "building"}` | `{ok, problems, readable}` | `expr.py` parser |

## Transports

The API picks the job transport with `BOQLET_ENGINE_TRANSPORT` = `http` (default) or `postgres`
(`worker/Jobs.java`). The local stack (`ops/local`) uses `http`; the pilot (`ops/pilot`) uses
`postgres` for jobs plus an HTTP `engine` service for rpc and the public share's synchronous
Excel (`boq/PublicShares.java`).

### HTTP transport (`worker_http.py`, FastAPI)
- Started by `uvicorn ifc_boq.worker_http:app` (`npm run dev:engine-worker`, port
  `ENGINE_WORKER_PORT`, default 8788). Java calls it at `BOQLET_ENGINE_HTTP_URL` (default
  `http://127.0.0.1:8788`); in the local stack the engine port is not published.
- `POST {url}/jobs/{type}` with the envelope → response `application/x-ndjson`:
  progress events, one per line, then the result as the last line. Closing the connection
  cancels the job. Java waits 45 s for the first byte (`WorkerClient`); `BOQLET_ENGINE_JOB_TIMEOUT`
  (default `PT30M`) bounds a job; `BOQLET_ENGINE_HTTP_CONCURRENCY` (default 1) caps the API's
  simultaneous HTTP jobs (`worker/JobDispatcher.java`).
- `POST {url}/rpc/{op}`, `GET {url}/health`.
- Storage: `ENGINE_STORAGE=file://…` (default `engine/.cache/worker`; `npm run dev:engine-worker`
  uses `engine/.cache/blobs`) or `s3://bucket` with `ENGINE_S3_ENDPOINT`.
- `ENGINE_HTTP_CONCURRENCY` sets simultaneous jobs per HTTP process (default 1).
  `ENGINE_MAX_MODEL_MB` caps input IFC bytes and expanded IFCZIP bytes (default 1024).
  The HTTP transport checks for cancellation between engine stages.

### Queue transport (`worker_queue.py`, console script `boqlet-worker`)
- Table `jobs` (see `docs/architecture/database.md`), claimed through `SECURITY DEFINER`
  functions from `V12__postgres_worker_queue.sql`: `queue_claim(worker, pool, types)`,
  `queue_renew(worker, job, attempt, report)` (heartbeat and progress) and
  `queue_finish(worker, job, attempt, result)`, which runs `pg_notify('job_finished', id)`.
  The worker's DB role (`boqlet_queue` on the pilot, `ops/pilot/queue-grants.sql`) may only
  EXECUTE these functions; it touches no other table.
- Each lease runs the IFC work in a child process. **Heartbeat** every 3 s
  (`HEARTBEAT_SECONDS`). The API treats a `running` job whose heartbeat is older than 30 s as
  lost and re-queues it, up to `max_attempts` = 3 (`Jobs.java`); a result for a lease the worker
  no longer owns is dropped.
- **Cancel:** the API sets `cancel_requested=true`; the next renew reports it and the job ends
  `cancelled`.
- **Pools** are chosen by job type, not file size: metered jobs (`parse`, `run`, `preview`) and
  `diff` go to `BOQLET_ENGINE_MODEL_POOL`, the rest to `BOQLET_ENGINE_GENERAL_POOL` (both default
  `default`). Workers start with `--pool` / `ENGINE_QUEUE_POOL`, `--types` / `ENGINE_QUEUE_TYPES`
  (default all six), `--concurrency`, `--timeout-seconds` (default 1800) and `--poll-seconds`;
  `ENGINE_QUEUE_DSN` is required.
- The API ingests results (`JobDispatcher.ingestQueue`, woken by `QueueWakeup` on `LISTEN job_finished`).

## Versioning and validation

- The envelope carries `"contract": "1"`. The worker refuses unknown major versions
  (`error.code = "contract_mismatch"`).
- The worker validates inputs (engine docs) against `packages/types/schema` and its outputs
  against the same schemas before writing (the engine already validates results: docs/architecture/engine.md).
- A `GET /health` on both transports reports engine version, contract version and parse format
  (`PARSE_FORMAT` in `parse.py`). The API stores `engineVersion` on every run for
  reproducibility.

## History: what the worker replaced

The proof of concept (removed in FE-046, tag `poc-final`) called the engine synchronously. Its
routes map onto the worker as follows; `service.py` is still the shared wiring for the worker,
the CLI and the corpus run, but the API now resolves preset **versions** and sends them inline.

| PoC (removed) | Worker |
|---|---|
| `store.py` (`engine/.cache`) | `storage.py` (local folder or S3) keyed by the API |
| `POST /api/models` parses synchronously | `parse` job |
| `POST /api/runs` with `RunRequest` | `run` job |
| `export_xlsx.export(result, meta)` | `export_xlsx` job; meta extended (EN-006) |
| `POST /api/models/{id}/names` | rpc `names` |
| `POST /api/presets/{kind}/check` | rpc `check` |
| `POST /api/codelists/read` / `build` | rpc `codelist-read` / `codelist-build` |
