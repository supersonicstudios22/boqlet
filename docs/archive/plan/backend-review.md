# BE-000 review

> **Archived (history, not current).** The backend agent's review of the backend plan before BE-000.


The owner approved the proposed defaults and the backend plan on 2026-11-16. The actual choices and deferrals are in [decisions.md](../../decisions.md). The handoff commit is `13aebc3` on `v_1`. It contains the Next.js app, OpenAPI contracts, mock, and shared suites. The proof-of-concept code on `main` is a separate baseline.

## Open choices

| ID | Recommendation and impact |
|---|---|
| D1 | Keycloak-hosted OIDC with email verification and an application session bound to the verified identity. The frontend already has an auth adapter and exercises takeover. Keep session revocation in the app request path for immediate enforcement. A hosted provider would reduce maintenance but still need that app session. BE-002, BE-027, FE-043. |
| D2 | Spring Boot on Java 21 fits the Java plan and its JDBC and OpenAPI tooling. Quarkus or Micronaut would change the skeleton and test wiring without changing the contract. BE-001. |
| D3 | Spring JDBC and Flyway permit explicit tenant predicates, COPY ingestion, and cursor queries. jOOQ would add schema code generation and typed query construction. BE-001, BE-011. |
| D4 | A PostgreSQL queue keeps enqueue and subject updates in one transaction. A broker would require an outbox dispatcher. Use a claim identity to prevent a late worker whose claim expired from committing stale output. EN-009, BE-007, BE-013. |
| D5 | PostgreSQL notifications can wake SSE listeners. Event ids and replay state need a durable source across instances. Redis would add a service while retaining the replay problem. BE-014. |
| D6 | SMTP through an adapter. The mock already supplies an inspectable outbox for invitation tests; the backend equivalent can use a local SMTP catcher. Select an external relay with hosting. BE-003, BE-020. |
| D7 | Manual billing covers pilot entitlements. The phase-1 suites exercise the manual adapter and omit live billing webhooks. Implement Paddle before paid self-service. BE-004, BE-021. |
| D8 | Defer provider and region. Preserve the documented PostgreSQL and S3-compatible interfaces so local work can proceed. BE-032. |
| D9 | Keep workbooks in Python. Phase 1 already calls openpyxl for exports and imports. Using POI would duplicate workbook behavior and round-trip fixtures. EN-006, EN-012. |
| D10 | Use the NFR figures for benchmarks and record actual pilot demand before buying capacity. The Duplex helps verify correctness but cannot size federated models. BE-025, BE-032. |
| D11 | Expose model size, concurrency, per-tenant admission and timeout settings. Benchmark before setting pool sizes. A static large pool would reserve memory before demand is known. EN-009, BE-013. |
| D12 | Bound bytes before parsing and use isolated job processes for hard resource limits. Give the transport access to storage and the queue, and keep parsers isolated from external services. The mock exercises corrupted files and the supported IFC and Excel paths. EN-001, EN-009, BE-006. |
| D13 | Use invite-only access for pilots and require verified email for uploads. Validate invitation acceptance against that email. Public registration and bot protection become launch decisions. BE-002, BE-003, BE-006. |
| D14 | Generate with the current engine on explicit request and keep saved results. Re-parse lazily when artifacts use a different format. A batch rewrite would spend compute on unused models. EN-009, BE-011. |
| D15 | Keep test and build CI on `v_1`. Choose provisioning, secrets storage and deployment access with the deployment environment. BE-032. |
| D16 | Retain structured logs and telemetry interfaces. Choose hosted monitoring and alert destinations with deployment. Keep pilot usage in the existing usage records. BE-025. |
| D17 | Use the schema's personal-data inventory for deletion and export, and carry backup and residency decisions into deployment. BE-024, BE-032. |
| D18 | Preserve the phase-1 contract. Its suites may change through the contract change process. Test support can supply production-shaped identities without changing behavior assertions. The current shared user helpers explicitly require a Java token strategy. BE-001, BE-002, FE-041. |

## Confirmed plan choices

| ID | Rationale and implementation impact |
|---|---|
| B1 | Java matches the service plan. The shared HTTP suites remain independent of the server language. |
| B2 | One modular API keeps transactional workflows in one service. Separate services would require additional consistency and deployment work. |
| B3 | PostgreSQL covers transactional data, jobs and search. Check indexes and pagination with representative run sizes before introducing partitioning. |
| B4 | Store run artifacts and index their queryable results in relational tables. The mock already drives paging, grouping and cross-element lookups. |
| B5 | Keep measurement in Python. The Duplex acceptance fixture protects the engine boundary. |
| B6 | Start with HTTP and add PostgreSQL queue transport for longer-running jobs. Reuse the same executor and artifact contract. |
| B7 | Use object storage for IFC and output artifacts. The mock already exercises signed upload and download. Keep provider-specific configuration out of the job envelope. |
| B8 | Keep the frontend's SSE interface and replay semantics. Reconnection should refetch current state if replay is unavailable. |
| B9 | Apply last-write-wins per line and emit a committed change event. The co-editing suites cover both browsers' resulting state. |
| B10 | Scope repositories by tenant and verify cross-tenant isolation with shared scenarios and the backend isolation suite. RLS would add a second layer and require careful transaction context for jobs. |
| B11 | Store one active session per user and check it on protected requests. A provider session alone would move takeover behavior outside the app's transaction. |
| B12 | Generate Java interfaces and DTOs from the contract. Keep engine documents opaque where the backend only stores and forwards them. |
| B13 | Preserve the core extension boundary. Pricing stays in its later phase under P48. |
| B14 | Keep the documented service boundaries and postpone actual infrastructure provisioning. |
| B15 | Carry request and job identifiers across service boundaries using the planned telemetry. Defer the hosted telemetry sink. |
| B16 | Engine transport and behavior first, then the API and queue. This lets the mock validate real engine outputs ahead of Java integration. |
| B17 | Keep the NFRs as test targets. Confirm pilot capacity and recovery in the deployment session. |
| B18 | Use PostgreSQL for full-text and trigram search. The project can evaluate a dedicated index once search load warrants one. |
| B19 | Preserve saved artifacts, prune old run indexes, and retain audit and org deletion policies. Coordinate expiration with backup and restore. |
| B20 | Keep the shared behavior specs and add backend integration tests for database and storage. Run seeded auth and clock controls only in the test configuration. |
