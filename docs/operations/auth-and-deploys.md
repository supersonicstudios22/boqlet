# Boqlet sign-in and GitHub deployments

Persistent pilot testing accounts and their operator setup are documented in [Pilot test users](test-users.md).

The runbook for the one deployed environment (booqlet.com, P51): how people get accounts, and how
a push to `main` reaches the host. Dated paragraphs ("On 2026-11-…") are the record of what was
done and stay as written. The architecture behind sign-in: `docs/architecture/security.md`.

## Sign-in

The Boqlet frontend uses the Java API at `/api/v1` for product data. The production image builds with `NEXT_PUBLIC_AUTH_ADAPTER=native`. Users enter their email and password on the Boqlet domain. The API verifies Argon2id password hashes and issues an opaque Secure, HttpOnly session cookie. State-changing API requests must come from the exact Boqlet origin. The existing one-active-session rule still applies and takeover requires confirmation. The app defaults to the native adapter everywhere; locally it runs against the same Java API in Docker (`docs/development/local-setup.md`). The mock adapter and the mock API were removed (P53).

An invitee opens their existing organisation invitation and chooses **Set up your invited account**. The API takes the email address from the valid invitation and the user sets a password. After sign-in they return to the invitation to accept the membership. An existing account signs in with its password.

The invite gate controls account creation. Once signed in, a pilot can create a separate organisation under the existing [F01 rules](../product/features/F01-accounts-and-orgs.md). Whether to restrict pilot organisation creation to explicitly approved owners remains a product decision.

**Public sign-up and self-service reset (P57).** A platform admin opens or closes public sign-up in the admin console (Settings, with a reason; audited). While it is open anyone can ask for a sign-up link at `/sign-up`; people with an account reset their own password from "Forgot your password?" on the sign-in page, open or not. Both send their link by email, so SMTP (`BOQLET_SMTP_*`) and `BOQLET_INVITATION_SECRET` (at least 32 bytes; it also signs these links) must be set; without the secret both answer `503 link_unavailable`. Check the default plan's limits (Admin › Plans) before opening sign-up: every new person's first org starts on it.

For the first owner or an assisted password reset, verify the address independently, then run `bash issue-setup-link.sh EMAIL setup` or `bash issue-setup-link.sh EMAIL reset` privately on the server. The command returns a bearer link that expires after one hour. Share it only via the verified recipient's approved private channel. The database stores a hash, and successful password setup consumes the link. A reset ends the account's active sessions. The app rejects resetting an unknown or legacy-only account. SMTP configuration for general invitations is still required. This flow does not give the recipient platform administrator access.

The original Keycloak database and image can be retained for rollback: the `identity` service is in the compose profile `legacy-identity` (`ops/pilot/compose.yaml`) and is not started by default. The native profile starts without it and does not need any Keycloak issuer or credentials.

Locally the same flow runs without the host scripts: `npm run local:user -- <email>` writes a one-hour setup (or reset) link into `native_setup_links` and prints it; `npm run local:admin -- <email>` makes an account a platform admin (`docs/development/local-setup.md`). On the pilot a platform admin is set the same way, with `users.platform_role = 'admin'` in the database.

On 2026-11-18, Contabo switched to `82258a96b1faa5a245e52fe8c825d43e90c75ad8` from the local `v_1` branch and stopped Boqlet's Keycloak container. A synthetic account completed password setup, sign-in, signed upload, queue processing of 218 IFC elements and a complete BoQ through the production URLs. A separate Chromium session completed setup, signed in through the Java API and reached onboarding. Both public frontends and APIs passed their separate route probes. The Boqlet database dump taken immediately before V15 is under the private pilot state directory. The shared Traefik and DNS configuration still carries the original auth hostname for rollback.

## CI and deployment

GitHub Actions (`.github/workflows/ci.yml`) runs the repository checks for pull requests and pushes to `main` or `v_1`. **Since the v1 release (FE-047) the deployment job runs only for a push to `main`** (`if: github.ref == 'refs/heads/main'`), after every other job passes: `api`, `contract`, `typecheck`, `engine` (on Python 3.10, 3.12 and 3.13), `audit` (npm and pip vulnerabilities), `local` (the Docker stack end to end) and `rollback` (review B-09; [CI](../testing/README.md#ci)). `v_1` is kept as it was and no longer deploys. Every green push to `main` deploys. The job builds the three first-party images under the full commit SHA, checks that the SHA is still the branch head, and transfers the image archive to Contabo. The deployment environment serializes rollout jobs. The host script independently takes a lock and accepts only the three expected image tags. It changes only the application containers for Boqlet and verifies private readiness, both public app routes and the native authentication endpoint before saving the new revision. Previous images remain available for a compatible rollback. Database migrations must support the previous app image for automatic rollback.

The Java worker integration suite uses the same SeaweedFS release as Contabo alongside PostgreSQL, MailHog and the actual Python worker.

One-time repository and host setup requires access to `supersonicstudios22/boqlet` on GitHub. Protect `main`, including workflow changes, and restrict the `boqlet-pilot` GitHub environment to that branch (it allowed `v_1` until FE-047; the environment now allows `main`). Set these environment values.

| Name | Type | Value |
| --- | --- | --- |
| `BOQLET_DEPLOY_KEY` | Secret | Dedicated deployment SSH private key |
| `BOQLET_KNOWN_HOSTS` | Variable | Verified Contabo host-key line for the configured target |
| `BOQLET_DEPLOY_TARGET` | Variable | SSH login and hostname for the approved Contabo deployment target |

On the host, install `deploy-release.sh` as root-owned at `/usr/local/sbin/boqlet-deploy-release`. Install only its matching public key with the OpenSSH restrictions `restrict,command="/usr/local/sbin/boqlet-deploy-release"`. Keep the ordinary operator key separate. The command takes a compressed Docker image archive on stdin. It uses the trusted, root-owned Compose configuration under `/srv/boqlet/current/ops/pilot`. Changes to Compose, Traefik, DNS, secrets or persistent services remain explicit operator tasks.

For the initial native cutover, retain the original Compose and images, deploy migration V15 and the new native web/API together, and run the authenticated smoke before stopping Keycloak. Point `/srv/boqlet/current` at the verified native release's product root. For subsequent authorized manual promotions, the same host script supports `--local FULL_SHA` when the matching three images are already loaded.

On 2026-11-19, the owner granted write and administrator access. The repository now belongs to supersonicstudios22/boqlet. The v_1 branch has been published, and the boqlet-pilot GitHub environment allowed deployment only from v_1 (moved to `main` at the release, FE-047; the deploy guard was fixed to compare with `main` in TF-001). Its deployment secret and pinned-host variables are configured.

The root-owned receiver is installed on Contabo. A dedicated Ed25519 public key is installed with a forced deployment command and OpenSSH restrict options. Its private key is stored only in the GitHub environment secret after setup. The ordinary operator SSH key remains separate.

The [first successful automatic rollout](https://github.com/supersonicstudios22/boqlet/actions/runs/44603537363) deployed `605cdd26c192d9356b63a3f7b837f1fbd508d96f` on 2026-11-19 at 20:10 UTC. All six prerequisite CI jobs of that time passed, including 106 browser tests and nine Java integration/architecture tests (the mock-only browser tests and their CI jobs were removed in P53; since review B-09 every CI job gates a deploy). A post-deployment synthetic account completed native password setup, signed upload, queue processing of 218 IFC elements, GLB download and complete sample BoQ generation. Both applications' public routes passed and the worker retained one slot, two CPUs and 4 GiB RAM. The temporary account credentials were removed.

The preceding browser run correctly blocked deployment. It exposed a manual-row mapping defect after regeneration, which was fixed, and assertions based on the previous export and derivation behavior, which were updated and verified. The final workflow reached success through GitHub's deployment SSH key and the installed receiver. The rollout record is a documentation-only commit with `[skip ci]` to avoid rebuilding the same application merely to record its result.
