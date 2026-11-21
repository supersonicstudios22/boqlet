# BE-000 decisions

> **Archived (history, not current).** The BE-000 answers, now in [../../decisions.md](../../decisions.md#backend-decisions-be-000) as BE-D1 … BE-D18 and BE-B1 … BE-B20.


The owner confirmed the backend plan and proposed defaults on 2026-11-16. Implement on `v_1`. The first rollout is invite-only. The owner deferred server deployment to a separate session and has no pilot load or IFC size estimates yet.

| ID | Answer |
|---|---|
| D1 | Keycloak-hosted OIDC sign-in and verified email. PostgreSQL owns the single active Boqlet session. Use a same-origin HttpOnly app session cookie and bind it to the authenticated identity. Defer vendor sign-in to the pricing phase. *Refined 2026-11-18 by P50: native email and password sign-in in the Java API replaced Keycloak; the session cookie and one-session rule stay.* |
| D2–D5 | Java 21 and Spring Boot, Spring JDBC and Flyway, a PostgreSQL job queue and `LISTEN/NOTIFY` for SSE fan-out. |
| D6–D7 | SMTP adapter and a local mail catcher. Manual billing for pilots. Defer Paddle until paid self-service. |
| D8, D15–D16 | Defer hosting, region, deployment tooling, and hosted monitoring choices to the deployment session. Keep local tests and configuration provider-neutral. *The deployment session chose Contabo for the invited pilot (`docs/operations/pilot.md`) with GitHub Actions rollout (`docs/operations/auth-and-deploys.md`); on 2026-11-20 the owner kept that as the only deployed environment and deferred staging (P51).* |
| D9 | Excel I/O belongs in the Python worker. |
| D10–D11 | Pilot load and model sizes are unknown. Keep pool sizes, size routing, per-org concurrency, and job limits configurable. Use the documented performance targets for local benchmarking. |
| D12–D13 | Invite-only initial rollout. Require verified email before uploads and validate type and size. Isolate parsing with CPU, memory, and time limits. The transport retains access to its storage and queue. Decide public registration bot protection before enabling public signup. |
| D14 | Use the new engine on the next Generate and preserve saved results. Keep engine and parse format versions on job results. Any UI notice follows the frontend integration phase. |
| D17 | Keep data export and deletion, encryption, and backup controls in the backend and deployment plan. Confirm residency, subprocessors, and backup configuration with the deployment environment. |
| D18 | Use the phase 1 contract as the baseline. Record any necessary changes following `docs/development/contract-changes.md`. |
| B1–B20 | Retain the handoff defaults for the backend structure, engine and storage, tenant isolation, sessions, tests, and delivery order. Deployment validation moves to the separate deployment session. Pricing stays deferred under P48. |
