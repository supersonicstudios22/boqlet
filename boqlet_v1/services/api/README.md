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
