# Pilot test users

The deployed native-login app has four persistent test accounts in **Boqlet Pilot Test**
(`pilot-test`), with a shared **Pilot Test Duplex** sample project.

| Email | Organisation role | Project role |
| --- | --- | --- |
| `owner@test.booqlet.invalid` | Owner | Lead |
| `estimator@test.booqlet.invalid` | Member | Estimator |
| `approver@test.booqlet.invalid` | Member | Approver |
| `viewer@test.booqlet.invalid` | Member | Viewer |

Sign in at [booqlet.com/sign-in](https://booqlet.com/sign-in). Each account has a different
random password. The operator keeps the passwords and direct project link in
`/srv/boqlet/state/test-users.json`, mode 0600 in the root-only state directory. Deliver
that file to testers through the operator's private channel. The reserved `.invalid`
addresses receive no email, so password recovery for these accounts is operator-assisted.
The accounts have the normal single-active-session behavior.

The seed was installed and run on 2026-11-23 against the deployed app. All four logins and
project access passed, the viewer's project update returned 403, the Duplex BoQ completed,
and a repeat seed preserved the credential file byte for byte. This task deploys test data
and its operator script directly; it requires no new application image.

The explicit operator command is `python3 ops/pilot/seed-test-users.py` on the server.
It sets passwords through the public native-auth API, creates the organisation and sample
through the product API, provisions the three test memberships in Postgres, and assigns
their project roles through the API. Only this test organisation receives overrides for
four seats and access to the approval workflow. No platform administrator account is created.

Run it again to verify setup or finish an interrupted seed. It keeps the existing passwords,
organisation and project. It signs each test account in and out while checking access, so
run it outside an active test session. The sample project is created once and its parsed
model and BoQ remain available for manual testing.

This is an explicit data setup, independent of app startup and automatic image rollouts.
For a fresh host, install the script from the repository and run it after API readiness.
Preserve the private credential file with the test database so retries use the same accounts.
