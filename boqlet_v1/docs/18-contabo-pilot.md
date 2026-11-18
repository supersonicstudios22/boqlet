# Boqlet invited pilot on Contabo

The [native sign-in and GitHub rollout runbook](19-native-auth-and-cd.md) supersedes the original Keycloak sign-in and manual image release procedure below.

## Live deployment

The v1 stack went live on 2026-11-16 on Contabo host `vmi3709447` (IPv4 `212.47.65.124`) using branch `v_1`, application baseline `e184cf6`, and the pilot packaging and internal JWKS configuration under [ops/pilot](../ops/pilot). The host has eight shared vCPUs, 24 GB RAM and a 450 GB virtual disk. The deployed Linux amd64 image IDs and upstream registry digests are in [images.lock](../ops/pilot/images.lock).

| Endpoint | Handler |
| --- | --- |
| [booqlet.com](https://booqlet.com/) | Next.js web with same-origin Java requests under `/api/v1` |
| [auth.booqlet.com](https://auth.booqlet.com/realms/boqlet/.well-known/openid-configuration) | Keycloak realm `boqlet` resources and authorization endpoints |
| `files.booqlet.com` | SeaweedFS path-style presigned GET and PUT for the `boqlet-pilot` bucket, plus CORS preflight |

Traefik terminates TLS with the existing HTTP ACME resolver. The only shared container is the edge proxy. The `boqlet-pilot` Compose project has its own database, engine/storage and outbound networks and an internal `boqlet-pilot-ingress` bridge to the edge. Boqlet containers have no published host ports or membership in Narudzbe application networks. Narudzbe's edge still publishes TCP 80 and 443 using its original egress network and firewall rules. Boqlet data sits in its own Postgres and SeaweedFS volumes. The API owns the `boqlet` database, Keycloak owns `boqlet_identity`, and the queue login can execute only the three queue functions in that database. Management and Keycloak admin paths are private. The Java API validates the public token issuer and audience while resolving signing keys through the internal Keycloak endpoint. [Traefik file provider](https://doc.traefik.io/traefik/reference/dynamic-configuration/file/) · [Keycloak release](https://www.keycloak.org/2026/11/keycloak-2682-released) · [SeaweedFS release](https://github.com/seaweedfs/seaweedfs/releases/tag/4.53)

The `corvus` Route 53 profile owns zone `Z069621532Y34GLCPNQXE`. Change `C00922063NL8NL9T6EIRZ` reached `INSYNC`. It replaced the apex A record to `65.109.104.52` and created the auth and files A records, all with TTL 300. The test record still resolves to `65.109.104.52`. The exact prior-value-checked [cutover](../ops/pilot/dns-cutover.json) and [rollback](../ops/pilot/dns-rollback.json) batches can be reviewed separately. [Route 53 change semantics](https://docs.aws.amazon.com/cli/latest/reference/route53/change-resource-record-sets.html)

## Operator commands

Use the pinned Narudzbe SSH host key and the existing authorized operator access. The live Boqlet release source has its entry point under `/srv/boqlet/releases/e184cf6/boqlet_v1/ops/pilot`. Compose uses `/srv/boqlet/state/pilot.env`, mode 0600 inside a root-only directory. It holds per-project credentials and deployment settings. Keep it out of source archives, shell output and support logs.

```sh
cd /srv/boqlet/releases/e184cf6/boqlet_v1/ops/pilot
docker compose --env-file /srv/boqlet/state/pilot.env ps
sh check-private.sh
python3 check-public-edge.py
```

The first boot used [prepare-state.sh](../ops/pilot/prepare-state.sh), a Docker network created with `docker network create --internal boqlet-pilot-ingress`, and [compose.yaml](../ops/pilot/compose.yaml). Start `db storage identity boqlet-web api engine` and check API readiness after Flyway. Run the following before starting the queue.

```sh
docker exec -i boqlet-pilot-db-1 psql -v ON_ERROR_STOP=1 -U boqlet_admin -d boqlet < queue-grants.sql
docker compose --env-file /srv/boqlet/state/pilot.env exec -T engine python - < configure-storage.py
docker compose --env-file /srv/boqlet/state/pilot.env up -d queue
sh check-private.sh
```

For an application release, build the three first-party images from the product root with one new immutable release tag. Use `services/api/Dockerfile`, `ops/pilot/web.Dockerfile` and `ops/pilot/engine.Dockerfile` as the Dockerfile paths, and the product root as each context. Keep the API, engine and web versions aligned. Review the migration for forward and backward compatibility, snapshot before promotion, and keep the former images. Change `PILOT_RELEASE` in the private env file, recreate affected services and re-run the checks. Use the recorded upstream digests when restoring infrastructure images. Rebuilding tags from a changed runtime or dependency index may differ from the deployed binaries.

## Worker capacity

| Setting | Initial value |
| --- | --- |
| `ENGINE_QUEUE_CONCURRENCY` | 1 job slot |
| `ENGINE_QUEUE_CPUS`, `ENGINE_QUEUE_MEMORY` | 2 CPUs, 4 GiB |
| `ENGINE_QUEUE_POOL`, `ENGINE_QUEUE_JOB_TIMEOUT_SECONDS` | `default`, 1,800 seconds |
| `ENGINE_HTTP_CONCURRENCY`, `ENGINE_HTTP_CPUS`, `ENGINE_HTTP_MEMORY` | 1, 1 CPU, 1.5 GiB |
| `MAX_UPLOAD_MIB` | 512 MiB |

Set values in `pilot.env`. On a drained queue, apply slot, CPU or memory changes with `docker compose --env-file /srv/boqlet/state/pilot.env up -d --no-deps queue`. Pool, timeout and maximum upload size must be kept in sync with the API and relevant engine services. Review queue wait time, job duration, peak memory and host headroom with actual pilot IFCs before increasing parallelism. The proxy has a 60-second read timeout and a 120-second write timeout. The upload API uses a single PUT through 100 MiB and 16 MiB parts above that, so check slow connections with actual pilot models before promising supported transfer times.

## Pilot enrollment

Keycloak registration and password reset start disabled. Keep `PILOT_EMAILS` limited to verified bootstrap owners. Those addresses bypass the requirement for a pending organisation invitation. With the address confirmed, create the owner in the Boqlet realm through private admin access and use a verified password setup flow. Enable Keycloak registration with mandatory email verification only after configuring the realm SMTP settings. Configure the same Boqlet-scoped sender in the Java API via `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `SMTP_FROM`. Verify delivered mail to an authorized test recipient before sending real invitations. With mail enabled, additional pilots join using a pending matching invitation. Keep public Keycloak administration blocked.

## Shared proxy and rollback

The live proxy reads a merged dynamic route file at `/srv/boqlet/edge/routes.json` and uses the overlay at `/srv/boqlet/edge/compose.yaml`. The original Narudzbe release Compose and route files remain the source for Narudzbe settings. A future release that recreates the proxy must include the overlay last and regenerate the merged route file from the new Narudzbe source and [Boqlet routes](../ops/pilot/traefik-routes.json). Test the merge with [check-edge-candidate.sh](../ops/pilot/check-edge-candidate.sh) before modifying the shared container. Scope proxy operations to the proxy service. The Boqlet stack stays on its own Compose project.

[edge.sh](../ops/pilot/edge.sh) captures the exact baseline Compose files and arms a four-minute rollback before applying ingress. Confirm that both applications answer over public HTTPS and that the Docker DNAT destination matches the firewall's expected proxy-egress IP before confirming. An observed initial parser error caused a brief Narudzbe 404; baseline rollback restored HTTPS, and the corrected schema passed the exact-image candidate test before the successful retry.

Both frontends initially registered the Compose service name `web` on separate networks that Traefik could see. Docker DNS resolved Traefik's Narudzbe upstream to the Boqlet frontend. The Boqlet service now uses `boqlet-web`, and [check-private.sh](../ops/pilot/check-private.sh) rejects aliases shared by the projects on their proxy-facing networks. [check-public-edge.py](../ops/pilot/check-public-edge.py) verifies the distinct frontend titles, canonical Narudzbe redirect, both APIs and the Boqlet OIDC issuer. Proxy confirmation runs it before disarming rollback.

For a Boqlet-only app rollback, restore the last compatible image set and run the authenticated smoke check. For a full cutoff, use `bash edge.sh rollback` with the recorded baseline and verify the Narudzbe apex and API bootstrap. Apply the DNS rollback batch from the Boqlet zone if returning the apex to its former server. Keep the Boqlet volumes. Do not use `docker compose down -v` to roll back an image or routing change.

## Verification and current limits

- Public TLS and endpoints passed for app and OIDC. Unsigned object requests and the Keycloak admin path are blocked. The Narudzbe apex returned HTTP 200 and its correct-origin API bootstrap returned 200 after the proxy rollout.
- A verified synthetic Keycloak account outside the allowlist returned `invitation_required`. The same account on the temporary allowlist authenticated through PKCE and used the Secure/HttpOnly app cookie. The live API signed a browser-origin upload, the queue parsed 218 IFC elements, the API served a signed GLB, and a separate bundled sample produced a complete BoQ. The account and temporary allowlist entry were removed and the test organisation went through ordinary deletion.
- Private readiness, queue grants and configured worker limits passed with Postgres migration v14. Run [verify-live.sh](../ops/pilot/verify-live.sh) only from a controlled verification window. It briefly recreates the API to add and remove its synthetic allowlist entry.
- Initial owner enrollment, external SMTP delivery, provider-side session revocation and independent off-host Boqlet backup/restore still require qualification. Boqlet backups and recovery are separate from Narudzbe's. Preserve the Postgres databases, object volume and private runtime configuration together. Use a distinct backup destination and restore onto disposable volumes before relying on recovery for real pilot data.
