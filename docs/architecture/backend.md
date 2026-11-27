# Backend architecture (Java)

Location: `services/api`. Implements `packages/api/openapi.yaml` (every one of its 162
operations) and passes the shared contract and scenario suites (`tests/`, run by
`NativeWorkerTest`; docs/testing/README.md). Java 21, Spring Boot 3.5 (web, validation,
security, oauth2-resource-server, actuator, mail), **Spring JDBC (`JdbcTemplate`) only** (no jOOQ,
no Spring Data), Flyway, PostgreSQL 16, AWS SDK v2 for S3, BouncyCastle (Argon2), Micrometer
(Prometheus, OpenTelemetry bridge), virtual threads. The backend decisions behind this are the
BE-000 answers in `docs/decisions.md`. Build, run and configuration: `services/api/README.md`.

## Shape: a modular monolith

One deployable. Packages under `com.boqlet.api` own their tables and talk through Java classes;
the ArchUnit test `CoreArchitectureTest` keeps the core free of module dependencies.

| Package | Owns (tables) | Main responsibilities (main classes) |
|---|---|---|
| `identity` | users, sessions, native_credentials, native_setup_links, native_auth_limits, provider_session_revocations | Native sign-in and setup links (`NativeAuthController`, `NativeCredentials`, `NativeIdentityFilter`), the one active session and takeover (`SessionController`, `Sessions`, `SessionConflict`), `GET /me` (`MeController`, `IdentityService`); OIDC rollback (`OidcConfiguration`, `IdentityFilter`, `ProviderSessionRevocations`) |
| `org` | orgs, memberships, org_invitations | Orgs, members, invitations, settings, setup progress, the "Needs you" attention list (`OrgController`, `Orgs`, `Invitations`, `Attention`, `OrgAccess`) |
| `billing` | plans, subscriptions, limit_events, limit_notifications | Plans, effective entitlements and limit checks (`EntitlementService`, `LimitReached` → `402`), limit alerts, billing endpoints with manual billing only (`BillingController`) |
| `project` | projects, project_members, sample_projects | Projects, membership, defaults, archive, the sample Duplex project (`ProjectController`, `Projects`, `ProjectAccess`, `ProjectPresets`, `SampleProjects`) |
| `model` | models, model_versions | Upload instructions, complete, dedupe by sha256, version lifecycle, scene and geometry URLs, names rpc (`ModelController`, `Models`, `ParseJob`) |
| `library` | presets, preset_versions | CRUD, drafts with ETag, publish, check (rpc), preview job, templates, code-list import (`LibraryController`, `Library`, `LibraryPreview`, `PreviewJob`, `LibraryFiles`, `PresetCatalog`) |
| `boq` | boqs, boq_revisions, review_comments, decisions, line_overrides, manual_items, boq_presence, runs, run_lines, run_line_elements, run_questions, run_warnings, run_log_entries, run_diffs, diff_lines, diff_elements, exports, edits_import_reports, share_links | BoQ and version state machines, inputs, save version, review/approval, confirm/reopen (`BoqController`, `Boqs`, `BoqInputs`, `BoqAccess`); runs and their index (`RunController`, `Runs`, `RunJob`, `RunIndex`, `RunReads`); decisions and line edits (`DecisionController`, `Decisions`, `AdjustmentController`, `Adjustments`); diffs (`DiffController`, `DiffJob`, `Diffs`); exports and edits import (`ExportController`, `BoqExports`, `ExportJob`, `ImportEdits`, `ImportEditsJob`); share links and public shares (`ShareController`, `ShareLinks`, `PublicShares`); read interfaces for modules (`BoqReadService`, `ExportDataService`) |
| `worker` | jobs | Enqueue, dispatch over HTTP or ingest from the queue, retries, cancel, lost-job re-queue, rpc client, metrics (`Jobs`, `JobDispatcher`, `WorkerClient`, `QueueWakeup`, `JobController`, `JobMetrics`) |
| `realtime` | realtime_events, notifications | SSE (`EventController`, `Realtime`, `EventWakeup`), in-app notifications (`NotificationController`, `Notifications`) |
| `mail` | email_outbox | SMTP outbox sender with retries, English and Serbian templates (`EmailDelivery`) |
| `audit` | audit_events | Append-only writer used by all packages, queries and CSV (`AuditWriter`, `AuditReader`) |
| `admin` | admin_notes (views admin_org_rows, admin_org_milestones) | Platform admin console API: overview, orgs, users, reports, CSV (`AdminController`, `AdminReports`) |
| `maintenance` | org_milestone_history | Scheduled expiry, retention, purge (`Maintenance`), alerts as log lines (`AlertMonitor`) |
| `storage` | — | S3 client, signed URLs, multipart, key layout (`ObjectStorage`) |
| `extension` | — | Core extension SPI for modules: `CoreModule`, `CoreModules`, `CoreEvents`, `ModuleTasks` (modules.md); no module registered |
| `http` | idempotency_keys | Errors, idempotency, request context and id, `SecurityConfiguration`, the one CSV writer (`Csv`: BOM, RFC 4180, formulas defused; review B-15) |
| `db` | — | Ids, Postgres COPY, stored JSON helpers |
| **`pricing`** (module, removable) | schema `pricing` | **Planned, not built** (P48): vendors, pricebooks, estimates, offer requests, vendor endpoints; to depend on the core only through `extension` and the read services (P36) |

## Cross-cutting

- **Request context:** `(userId, sessionId, orgId?, projectRole?)` (the pricing module adds its own vendor context), resolved once per
  request. Repository methods take the context. A query helper adds `org_id = :orgId` (BR-50).
  Endpoints for another org's resource return `404`.
- **Permission checks:** `OrgAccess` (org roles) and `ProjectAccess` (project roles and the
  `permissions` keys returned with projects and BoQs) implement `docs/domain/permissions.md`, so
  the UI and enforcement never drift. Archived projects keep only read keys; writes answer
  `409 project_archived`.
- **State machines:** explicit transition tables per entity (`state-machines.md`). Invalid
  transitions → `409 invalid_transition`.
- **Transactions:** one per request. Jobs are enqueued in the same transaction as the subject
  change (outbox-style), so a failed request never leaves an orphan job.
- **Audit:** `AuditWriter.record(ctx, action, entity, data)` inside the same transaction.
- **Idempotency:** `idempotency_keys(key, user_id, endpoint, response, created_at)` for
  POSTs that start jobs or send emails.
- **Errors:** an exception hierarchy mapped to `{code, message, details}` (conventions.md).
- **Generated contract:** openapi-generator 7.19 (`spring`, `interfaceOnly=true`) in the Maven
  build generates the interfaces and DTOs from `openapi.yaml`; controllers implement the
  generated `*Api` interfaces (diffs, events and native auth use explicit mappings). Engine
  documents (preset docs, traces, results) are kept as `JsonNode`: the backend never interprets
  rules (BR-01).

## Key flows inside the backend

### Generate a run (`POST /revisions/{id}/runs`)
1. Policy: estimator or lead, and the revision is `draft`. Revisions in review or approved
   are not regenerated; reviewers look at the existing run.
2. Entitlements: `processingMinutesPerMonth` not exceeded.
3. Resolve inputs: model versions must be `ready` (else `409 model_not_ready`); load preset
   version docs; for rule-set patches, load the parent chain (exact versions); order
   dictionaries (global → company → project, with the project dictionary's latest published
   version last); load decisions (project), overrides and manual items (BoQ).
4. Build `RunJobInput` (engine-worker.md), insert `runs` (queued, `request` JSON,
   `snapshot_versions`) and `jobs` in one transaction. Audit `run.created`.
5. On `job_finished`: stream `result.json.gz` from storage, validate the top-level shape, bulk
   insert rows (COPY), compute `status`, set `revision.current_run_id` if newer than the
   current one, usage event, notifications, SSE `entity.changed`.

### Pending changes (`BoqRevision.pendingChanges`)
Computed on read by comparing the current run's `request` fingerprint parts (inputs,
decisions hash over the questions the run asked + any new decisions for those ids,
overrides hash, manual-items hash) with current state. Cache per revision, invalidated by
writes to those tables.

### Save version
Transaction: check policy (and, with approval on, state `approved` and four-eyes), no pending
changes → set `issued`, freeze (`frozen_run_id`, copy of line edits and manual lines as JSON,
position numbers), create the next `draft` revision (unless confirming), enqueue `export_xlsx`
with the version's meta → on finish, attach the export id to `frozen.exportIds`. Audit, notify,
publish the core event `version.saved` after commit.

### Live co-editing
Line edits are single-row upserts on `line_overrides` (one row per line key) with
`updated_at`; last write wins per line (BR-29). After commit the backend publishes
`boq.line_edited {boqId, lineKeys, by}` on the BoQ's SSE channel. Presence is stored in the
`boq_presence` table with an expiry (the app renews it while the BoQ is open; expired rows are
deleted by `Maintenance`) and fanned out as `boq.presence` events, so it works across
instances.

## Testing (backend)

As built (details and commands in `docs/testing/README.md`):
- `services/api/src/test`: `ApiFoundationTest`, `NativeAuthTest`, `BackupRestoreTest`,
  `AlertMonitorTest`, the ArchUnit `CoreArchitectureTest`, and `NativeWorkerTest`.
- `NativeWorkerTest` runs Testcontainers (PostgreSQL 16, SeaweedFS, MailHog) with the **real
  Python worker** (no fake worker, no recorded outputs) on every CI run: the Duplex end to end,
  then the shared contract and scenario suites and the Java browser smoke against this service,
  using the test-only routes in `com.boqlet.suite.SuiteSupport`.
- **Gaps:** no unit tests per policy or state machine (the plan's role × state × action tables);
  most packages are covered only through the integration flows. No core-only build (no module
  exists yet; P36 needs one once pricing is built).
