# Storage, jobs and realtime

## Object storage

S3-compatible API (AWS S3, Cloudflare R2, MinIO, Hetzner, GCS interop), through
`storage/ObjectStorage.java` (AWS SDK v2) in Java and `engine/ifc_boq/storage.py` in the engine.
One bucket per environment, private. Every environment today runs **SeaweedFS** (S3 API): the
local stack (`ops/local`, bucket and CORS made by `ops/local/init-storage.py`), the pilot and the
Java tests. A standalone engine worker can use a local folder with the same key layout
(`ENGINE_STORAGE=file://…`). (Phases 1–3 used a mock API with a local blob folder, removed by P53.)

### Key layout

Every job writes under its output prefix plus `attempt-N/` (`Jobs.java`), so a retried attempt never
overwrites another. `{id}` is a fresh id where the table names none.

| Key | Written by | Lifetime |
|---|---|---|
| `orgs/{orgId}/uploads/{modelVersionId}/incoming`, then `source.ifc` or `source.ifczip` | browser (signed PUT or multipart parts to `incoming`); the API seals it as `source.*` on `complete` (`Models.java`, `ObjectStorage.seal`) | while the version exists; an upload never completed is deleted after 24 h (`Maintenance`) |
| `orgs/{orgId}/models/{modelVersionId}/{id}/attempt-N/parsed.json.gz`, `geometry.glb`, `meshes.npz`, `scene.json` | parse job | while the version exists. A second upload of the same file reuses the first version's keys (BR-08: a database lookup by sha256, `ParseJob`), so nothing is written for it |
| `orgs/{orgId}/runs/{runId}/attempt-N/result.json.gz` (and `boq.xlsx` when the run asks for one) | run job | while the run exists |
| `orgs/{orgId}/diffs/{diffId}/{id}/attempt-N/diff.json.gz` | diff job | cache, may be recomputed |
| `orgs/{orgId}/previews/{id}/attempt-N/result.json.gz`, `compare/…`, `diff.json.gz`, `preview.json` | preview job | 7 days after the job ended (`Maintenance`) |
| `orgs/{orgId}/exports/{exportId}/attempt-N/export.xlsx` | export jobs (BoQ, saved version, change report) | saved versions: while the version exists; others: 90 days (`Maintenance`). The download's file name is the export's `fileName`, not the key |
| `orgs/{orgId}/share-links/{shareLinkId}/{runId}/{variant}/export.xlsx` | the API, through the worker, on a share link's first download (`PublicShares`) | with the link's data |
| `orgs/{orgId}/imports/{id}/source.xlsx` | the API, from the multipart upload (`ImportEdits`) | 7 days after the import job ended (`Maintenance`) |
| `orgs/{orgId}/imports/{id}/attempt-N/edits.json.gz` | import_boq_edits job | 7 days after the job ended |
| `orgs/{orgId}/templates/{id}/{slug}.xlsx`; `system/templates/{id}/{slug}.xlsx` for system presets | the API (a preset's Excel template, `LibraryFiles`) | not cleaned up |
| `internal/code-lists/{userId}/{id}` | the API, for the code-list read (`LibraryFiles`) | deleted when the read answers |
| `orgs/{orgId}/pricing/…` | pricing module (planned, not built, P48) | the module's own rules; deleted with the module's data |

Deleting an org deletes everything under `orgs/{orgId}/` (BR-52, `Maintenance`).

Signed URLs: PUT valid 1 h, GET valid 5 min (`UPLOAD_TTL`, `DOWNLOAD_TTL` in `ObjectStorage.java`). `geometry.glb` and `scene.json` are served with
`Cache-Control: private, max-age=31536000, immutable` (their content never changes for a key).

### Upload flow (model version)

```text
UI ──POST /models/{m}/versions {fileName,sizeBytes}──► API: create version(awaiting_upload),
                                                          check limits, return signed PUT
UI ──PUT file (multipart for >100 MB, progress)──────► storage
UI ──POST /model-versions/{v}/complete──────────────► API: HEAD object (size), read first bytes
                                                          (ISO-10303-21), sha256 (from client or
                                                          computed by the parse job), dedupe or
                                                          enqueue parse
```
Multipart: the API returns `upload.parts[]` (one URL per 16 MiB part) when `sizeBytes > 100 MiB`
(`ObjectStorage.java`), and `complete` takes the ETags. **Gap:** the app's uploader
(`apps/app/src/features/models/upload.ts`) ignores `parts` and PUTs the whole file to
`upload.url`, so uploads above 100 MiB from the browser are not handled as designed; it also
accepts only `.ifc` although the API accepts `.ifczip`.

## Jobs

Lifecycle in `docs/domain/state-machines.md`. Contract in `engine-worker.md`.

API side of a job:
1. **Create:** insert a `jobs` row (`queued`) in the same transaction as the subject change
   (e.g. `Run(queued)`), with `transport`, `pool` (by job type, `engine-worker.md`) and
   `priority` (`worker/Jobs.java`; claimed by `priority, created_at`).
2. **Watch:** with the HTTP transport `worker/JobDispatcher.java` dispatches and streams the
   NDJSON; with the queue transport `QueueWakeup` listens on `job_finished`. Progress is
   relayed to SSE subscribers of the org/project.
3. **Ingest** on success, in one transaction per job type:
   - parse → update `ModelVersion` (summary, artifacts, `ready`), model `latestVersionId`,
     notifications;
   - run → read `result.json.gz`, bulk insert `run_lines`, `run_line_elements`,
     `run_questions`, `run_warnings`, `run_log_entries`, set run status, move
     `revision.current_run_id`, notifications;
   - diff → `run_diffs` row with summary and key;
   - exports → `exports` row;
   - import_boq_edits → `edits_import_reports` row.
   (`import_offer`, for the pricing module, is not built.)
4. **Usage event** for parse/run/preview (BR-62), any outcome.
5. **Failure:** a result with `error.retryable = true`, a lost lease (no heartbeat for 30 s) or
   an ingestion failure is re-queued while `attempts < max_attempts` (3). Others mark the subject
   failed and notify.

Run ingestion target: 50k lines + 500k line-element rows in under 10 s (COPY/batch insert).

## Realtime: Server-Sent Events

`GET /api/v1/events` (`text/event-stream`, `realtime/EventController.java`, `Realtime.java`
with `SseEmitter`) uses the app session cookie (`boqlet_session`). The frontend uses fetch-based
SSE (`@microsoft/fetch-event-source`, `apps/app/src/realtime/sse.ts`). Each browser tab has its
own stream; a stream lives 5 minutes and the client reconnects.

Events (`event:` name, `data:` JSON):

| Event | Data | Sent to |
|---|---|---|
| `job.progress` | `{jobId, type, subjectType, subjectId, projectId, stage, pct, message}` | users with access to the project (throttled 1/s per job) |
| `job.finished` | `{jobId, type, status, subjectType, subjectId, projectId, error?}` | same |
| `notification.created` | `Notification` | the recipient |
| `entity.changed` | `{entityType, entityId, projectId?, change: "created" \| "updated" \| "deleted"}` | users with access |
| `boq.line_edited` | `{boqId, lineKeys, by, at}` | users with the BoQ open (P31) |
| `boq.presence` | `{boqId, users: [{userId, name, lineKey?}]}` | users with the BoQ open |
| `session.revoked` | `{sessionId}` | the replaced session only (BR-54) |
| `module.*` | defined by modules (none built; pricing planned) | per module |

- Database triggers (`V8__realtime_and_notifications.sql`) and the API write events to the
  `realtime_events` table and `pg_notify('boqlet_events')`; `EventWakeup` on every instance
  listens and wakes the streams, which check the receiver's current access before sending.
- Each event has an `id:` (the journal sequence). On reconnect the client sends
  `Last-Event-ID` and the instance replays the last five minutes from `realtime_events`
  (rows are deleted after 10 minutes).
- Heartbeat comment every 25 s.
- The frontend maps `entity.changed` and `job.finished` to TanStack Query invalidations (see
  `docs/architecture/frontend.md`). SSE is a hint to refetch. Correctness never depends on
  receiving an event.

## Scheduled work (system actor)

Spring `@Scheduled` tasks; tasks that must run once across instances take a Postgres advisory
lock (`maintenance/Maintenance.java` `leader(...)`). There is no separate scheduler service.

| Task | Every (default) | Action | Where |
|---|---|---|---|
| Expire sessions, invitations, journals | 15 min (`BOQLET_MAINTENANCE_POLL_MS`) | sessions idle > 12 h → `expired` (BR-54); pending invitations past `expires_at` → `expired`; delete old `realtime_events` (10 min), `boq_presence`, `idempotency_keys` (24 h) and old limit notifications | `Maintenance.expire` |
| Retention | 1 h (`BOQLET_RETENTION_POLL_MS`) | audit events past the plan's `auditLogRetentionDays`; run indexes older than `BOQLET_RUN_INDEX_DAYS`; abandoned `awaiting_upload` versions older than 24 h; exports older than 90 days; finished preview and edits-import jobs; org purge after `BOQLET_ORG_PURGE_HOURS` | `Maintenance.retain` |
| Re-queue lost jobs | with the dispatcher | heartbeat older than 30 s | `worker/Jobs.java` |
| Usage near limit | 1 h (`BOQLET_LIMIT_ALERT_POLL_MS`) | limit notifications | `billing/LimitAlerts.java` |
| Email outbox | 3 s (`BOQLET_SMTP_POLL_MS`) | send pending email | `mail/EmailDelivery.java` |
| Sample projects | 2 s (`BOQLET_SAMPLE_POLL_MS`) | provision the sample Duplex BoQ once its model is ready | `project/SampleProjects.java` |
| Alerts | 1 min (`BOQLET_ALERT_POLL_MS`) | alert thresholds as log lines | `maintenance/AlertMonitor.java` |
| Job metrics | 30 s | queue gauges | `worker/JobMetrics.java` |
| Module tasks | per module | none registered (pricing planned) | `extension/` |

Not built: billing sync (billing is manual for pilots, D7).
