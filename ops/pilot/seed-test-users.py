"""Create persistent pilot test users through native auth and a shared sample project.

Run explicitly as an operator on Contabo. Credentials stay in the root-only state
directory and are never printed. Re-running preserves passwords and existing work.
"""
import fcntl
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

APP = "https://booqlet.com"
STATE = Path("/srv/boqlet/state/test-users.json")
PEOPLE = (
    ("owner", "Boqlet Test Owner", "owner", "lead"),
    ("estimator", "Boqlet Test Estimator", "member", "estimator"),
    ("approver", "Boqlet Test Approver", "member", "approver"),
    ("viewer", "Boqlet Test Viewer", "member", "viewer"),
)


def sql(query, **params):
    command = ["docker", "exec", "-i", "boqlet-pilot-db-1", "psql", "-XqAt",
               "-v", "ON_ERROR_STOP=1", "-U", "boqlet_admin", "-d", "boqlet"]
    command.extend("--set=" + key + "=" + value for key, value in params.items())
    result = subprocess.run(command, input=query, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError("Test seed database operation failed")
    return result.stdout.strip()


def save(state):
    with tempfile.NamedTemporaryFile(mode="w", dir=STATE.parent, prefix=".test-users-", delete=False) as target:
        temporary = Path(target.name)
        json.dump(state, target, indent=2)
        target.write("\n")
        target.flush()
        os.fsync(target.fileno())
    try:
        temporary.replace(STATE)
    finally:
        temporary.unlink(missing_ok=True)


class Client:
    def __init__(self):
        self.browser = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def api(self, path, method="GET", body=None, status=200):
        request = Request(APP + "/api/v1" + path,
                          data=None if body is None else json.dumps(body).encode(),
                          headers={"Origin": APP, "Content-Type": "application/json"}, method=method)
        try:
            response = self.browser.open(request, timeout=30)
        except HTTPError as error:
            response = error
        with response:
            if response.status != status:
                raise RuntimeError(f"Test seed {method} {path}: expected {status}, got {response.status}")
            data = response.read()
            return json.loads(data) if data else None

    def login(self, account):
        return self.api("/auth/sign-in", "POST", {
            "email": account["email"], "password": account["password"],
            "deviceLabel": "Pilot test-user seed", "takeover": True,
        }, status=201)

    def logout(self):
        self.api("/sessions/current", "DELETE", status=204)


def seed():
    if STATE.exists():
        state = json.loads(STATE.read_text())
        if state.get("version") != 1:
            raise RuntimeError("Unknown test credential file version")
    else:
        accounts = []
        for key, name, org_role, project_role in PEOPLE:
            email = key + "@test.booqlet.invalid"
            if sql("SELECT count(*) FROM users WHERE lower(email) = :'email';", email=email) != "0":
                raise RuntimeError("A reserved test email already exists. Reconcile before seeding.")
            accounts.append(dict(email=email, name=name, role=key, orgRole=org_role,
                                 projectRole=project_role, password=secrets.token_urlsafe(24)))
        state = dict(version=1, signIn=APP + "/sign-in", accounts=accounts)
        save(state)

    for account in state["accounts"]:
        email = account["email"]
        exists = sql("""
            SELECT count(*) FROM users u JOIN native_credentials c ON c.user_id = u.id
            WHERE u.email = :'email' AND u.name = :'name' AND u.deleted_at IS NULL;
            """, email=email, name=account["name"])
        client = Client()
        if exists == "0":
            token = secrets.token_urlsafe(32)
            digest = hashlib.sha256(token.encode()).hexdigest()
            sql("""
                INSERT INTO native_setup_links (email, token_hash, expires_at, purpose)
                VALUES (:'email', :'digest', now() + interval '1 hour', 'setup')
                ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash,
                    expires_at = excluded.expires_at, purpose = 'setup', nonce = NULL;
                """, email=email, digest=digest)
            client.api("/auth/set-password", "POST", {
                "token": token, "name": account["name"], "password": account["password"],
            }, status=204)
        client.login(account)
        account["id"] = client.api("/me")["user"]["id"]
        client.logout()
        save(state)

    owner = Client()
    owner.login(state["accounts"][0])
    try:
        orgs = owner.api("/orgs")
        org = next((item for item in orgs if item["slug"] == "pilot-test"), None)
        if org is None:
            org = owner.api("/orgs", "POST", {"name": "Boqlet Pilot Test", "slug": "pilot-test"}, status=201)
        org_id = org["id"]
        # The shared fixture needs seats and approval access. Change only this test org.
        sql("""
            BEGIN;
            UPDATE subscriptions SET overrides = overrides || '{"seats":4,"approvalWorkflow":true}'::jsonb,
                updated_at = now() WHERE org_id = :'org'::uuid;
            COMMIT;
            """, org=org_id)
        for account in state["accounts"][1:]:
            sql("""
                INSERT INTO memberships (org_id, user_id, role)
                VALUES (:'org'::uuid, :'user'::uuid, 'member') ON CONFLICT DO NOTHING;
                """, org=org_id, user=account["id"])
        projects = owner.api("/orgs/" + org_id + "/projects")
        project = next((item for item in projects if item["name"] == "Pilot Test Duplex"), None)
        if project is None:
            project = owner.api("/orgs/" + org_id + "/projects", "POST",
                                {"name": "Pilot Test Duplex", "sample": "duplex"}, status=201)
        project_id = project["id"]
        members = owner.api("/projects/" + project_id + "/members")
        member_ids = {item["user"]["id"] for item in members}
        for account in state["accounts"][1:]:
            if account["id"] not in member_ids:
                owner.api("/projects/" + project_id + "/members", "POST", {
                    "userId": account["id"], "role": account["projectRole"],
                }, status=201)
        state.update(orgId=org_id, projectId=project_id,
                     projectUrl=APP + "/pilot-test/projects/" + project_id)
        save(state)
        for _ in range(180):
            boqs = owner.api("/projects/" + project_id + "/boqs")
            if boqs:
                run = (boqs[0].get("currentRevision") or {}).get("currentRun") or {}
                if run.get("status") in ("complete", "needs_input"):
                    break
            time.sleep(1)
        else:
            raise RuntimeError("The test sample BoQ did not finish")
    finally:
        owner.logout()

    for account in state["accounts"]:
        client = Client()
        client.login(account)
        try:
            client.api("/projects/" + state["projectId"])
            if account["projectRole"] == "viewer":
                client.api("/projects/" + state["projectId"], "PATCH",
                           {"name": "Pilot Test Duplex"}, status=403)
        finally:
            client.logout()
    print("Four persistent test users can sign in and open the shared Duplex sample.")
    print("Passwords are stored only in " + str(STATE))


if __name__ == "__main__":
    os.umask(0o077)
    with STATE.with_suffix(".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        seed()
