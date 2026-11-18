# Boqlet sign-in and GitHub deployments

## Sign-in

The Boqlet frontend uses the Java API at `/api/v1` for product data. The production image builds with `NEXT_PUBLIC_AUTH_ADAPTER=native`. Users enter their email and password on the Boqlet domain. The API verifies Argon2id password hashes and issues an opaque Secure, HttpOnly session cookie. State-changing API requests must come from the exact Boqlet origin. The existing one-active-session rule still applies and takeover requires confirmation. The mock adapter and Mock API are used by developer and test commands.

An invitee opens their existing organisation invitation and chooses **Set up your invited account**. The API takes the email address from the valid invitation and the user sets a password. After sign-in they return to the invitation to accept the membership. An existing account signs in with its password.

The invite gate controls account creation. Once signed in, a pilot can create a separate organisation under the existing [F01 rules](../plan/01-features/F01-accounts-and-orgs.md). Whether to restrict pilot organisation creation to explicitly approved owners remains a product decision.

For the first owner or an assisted password reset, verify the address independently, then run `bash issue-setup-link.sh EMAIL setup` or `bash issue-setup-link.sh EMAIL reset` privately on the server. The command returns a bearer link that expires after one hour. Share it only via the verified recipient's approved private channel. The database stores a hash, and successful password setup consumes the link. A reset ends the account's active sessions. The app rejects resetting an unknown or legacy-only account. SMTP configuration for general invitations is still required. This flow does not give the recipient platform administrator access.

The original Keycloak database and image can be retained for rollback. The native profile starts without its Keycloak container and does not need any Keycloak issuer or credentials.

On 2026-11-18, Contabo switched to `82258a96b1faa5a245e52fe8c825d43e90c75ad8` from the local `v_1` branch and stopped Boqlet's Keycloak container. A synthetic account completed password setup, sign-in, signed upload, queue processing of 218 IFC elements and a complete BoQ through the production URLs. A separate Chromium session completed setup, signed in through the Java API and reached onboarding. Both public frontends and APIs passed their separate route probes. The Boqlet database dump taken immediately before V15 is under the private pilot state directory. The shared Traefik and DNS configuration still carries the original auth hostname for rollback.

## CI and deployment

GitHub Actions runs the repository checks for pull requests and pushes to `main` or `v_1`. The deployment job runs only for a successful push to `v_1`. It builds the three first-party images under the full commit SHA, checks that the SHA is still the branch head, and transfers the image archive to Contabo. The deployment environment serializes rollout jobs. The host script independently takes a lock and accepts only the three expected image tags. It changes only the application containers for Boqlet and verifies private readiness, both public app routes and the native authentication endpoint before saving the new revision. Previous images remain available for a compatible rollback. Database migrations must support the previous app image for automatic rollback.

The Java worker integration suite uses the same SeaweedFS release as Contabo alongside PostgreSQL, MailHog and the actual Python worker.

One-time repository and host setup requires access to `dobrosav22/boqlet` on GitHub. Protect `v_1`, including workflow changes, and restrict the `boqlet-pilot` GitHub environment to that branch. Set these environment values.

| Name | Type | Value |
| --- | --- | --- |
| `BOQLET_DEPLOY_KEY` | Secret | Dedicated deployment SSH private key |
| `BOQLET_KNOWN_HOSTS` | Variable | Verified Contabo host-key line for the configured target |
| `BOQLET_DEPLOY_TARGET` | Variable | SSH login and hostname for the approved Contabo deployment target |

On the host, install `deploy-release.sh` as root-owned at `/usr/local/sbin/boqlet-deploy-release`. Install only its matching public key with the OpenSSH restrictions `restrict,command="/usr/local/sbin/boqlet-deploy-release"`. Keep the ordinary operator key separate. The command takes a compressed Docker image archive on stdin. It uses the trusted, root-owned Compose configuration under `/srv/boqlet/current/ops/pilot`. Changes to Compose, Traefik, DNS, secrets or persistent services remain explicit operator tasks.

For the initial native cutover, retain the original Compose and images, deploy migration V15 and the new native web/API together, and run the authenticated smoke before stopping Keycloak. Point `/srv/boqlet/current` at the verified native release's product root. For subsequent authorized manual promotions, the same host script supports `--local FULL_SHA` when the matching three images are already loaded.

GitHub reported pull access only for the signed-in account during setup. The workflow cannot be installed or tested end to end until an authorized repository maintainer pushes these changes and sets the environment secret and variables.

The root-owned receiver is installed on Contabo. Its dedicated SSH public key and GitHub environment secret still need to be paired. The manual initial deployment used the same Docker image layout as the workflow. The first end-to-end Actions run is pending repository access.
