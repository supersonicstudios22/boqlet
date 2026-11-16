# Boqlet API

The service uses Java 21, Spring Boot 3.5, Spring JDBC, Flyway, and PostgreSQL.
Run the build and its temporary PostgreSQL integration tests from the product root
with `mvn -f services/api/pom.xml verify`. The tests require a running Docker daemon.

The Maven build generates the HTTP interfaces and DTOs from `packages/api/openapi.yaml`.
It prepares a copy under `target/contract` so Java can forward recursive engine documents
as JSON. The copy simplifies the unit union to a string and adds Java bean validation for the
review confirmation. The checked-in HTTP contract and worker schemas remain authoritative.

To run the built jar locally, set `BOQLET_JDBC_URL`, `BOQLET_DB_USER`, and
`BOQLET_DB_PASSWORD`; set `BOQLET_API_PORT` to override port 8080.
Health endpoints are `/actuator/health/liveness` and `/actuator/health/readiness`.
Readiness includes PostgreSQL. The API binds its generated routes under `/api/v1`.

## Pilot sign-in

Set `BOQLET_OIDC_ISSUER` and `BOQLET_OIDC_AUDIENCE` to enable OIDC authentication.
The access token must contain `sub`, `sid`, `email`, and `email_verified=true`.
Set `BOQLET_PILOT_EMAILS` to the comma-separated verified addresses of initial pilot leads.
A pending organisation invitation also grants access when the verified address matches.

After obtaining the access token, call `POST /api/v1/sessions` to establish the application
session. Retain the returned HttpOnly cookie and send it with the bearer token on authenticated
requests. A second provider session gets a conflict with the active session's details.
The client can retry with `takeover: true` after confirmation. A replaced session is immediately
rejected on subsequent API requests. Sessions expire after twelve hours of inactivity.
Use `BOQLET_SECURE_COOKIE=false` for local development over HTTP. The default is secure.

The integration tests use a test-only JWT decoder with PostgreSQL in Docker. Real OIDC
provider configuration and browser sign-in are verified separately.

## Invitations

Set `BOQLET_INVITATION_SECRET` to a randomly generated secret of at least 32 bytes.
Use the same value across API processes and the mail sender. Invitation creation,
resend, and revocation commit with their audit and outbox changes. The link is valid
for fourteen days. Resending rotates the token and cancels undelivered messages for
the old link. SMTP delivery is tracked in BE-020.

## Pilot plans and projects

Flyway seeds the plans and the built-in Library. New organisations get the plan
marked default and new projects get the current published defaults plus an empty
project dictionary. Pilot subscriptions use the manual provider. The API checks
the stored plan and overrides, records limit denials, and counts usage by UTC
calendar month. Only non-sample active projects use an active-project slot.

## Model uploads and worker jobs

Set `BOQLET_S3_BUCKET` and `BOQLET_S3_REGION` for both API and worker access to the same
private bucket. For a local S3-compatible server set `BOQLET_S3_ENDPOINT` and optionally
`BOQLET_S3_PUBLIC_ENDPOINT` if the browser reaches storage at a different address.
The Java SDK uses its default credential chain. The Python worker needs
`ENGINE_STORAGE=s3://<bucket>` and the same storage region and endpoint if applicable.
Allow the web origin to PUT and GET signed objects and expose the ETag for part uploads.

The API sends jobs to `BOQLET_ENGINE_HTTP_URL` (default `http://127.0.0.1:8788`).
Set `BOQLET_ENGINE_HTTP_CONCURRENCY` (default 1), `BOQLET_ENGINE_JOB_TIMEOUT` (default
`PT30M`), and `BOQLET_MAX_UPLOAD_MIB` (default 1024) to size the API side of the worker
flow. The worker independently uses `ENGINE_HTTP_CONCURRENCY` and `ENGINE_MAX_MODEL_MB`.
The plan can apply a lower upload limit. Uploads above 100 MiB use multipart.

To include the native integration test in Maven `verify`, install the engine Python
dependencies and set `BOQLET_NATIVE_WORKER_PYTHON` to the interpreter's absolute path,
`AWS_ACCESS_KEY_ID=boqlet-test` and `AWS_SECRET_ACCESS_KEY=boqlet-local-test-only` in
the test process. The suite starts temporary PostgreSQL and MinIO containers and its
own Python HTTP worker. It uploads the bundled Duplex IFC and checks the resulting
job, scene, geometry, names and usage.
