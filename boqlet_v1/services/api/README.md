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
