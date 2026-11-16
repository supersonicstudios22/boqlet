"""Run a synthetic PKCE sign-in, signed upload, PostgreSQL job and BoQ through HTTPS."""
import base64
import hashlib
import http.cookiejar
import json
import os
import secrets
import sys
import time
from functools import partial
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from urllib.request import HTTPRedirectHandler, HTTPCookieProcessor, Request, build_opener

APP = "https://booqlet.com"
ISSUER = "https://auth.booqlet.com/realms/boqlet"
CLIENT = "boqlet-web"
COOKIES = http.cookiejar.CookieJar()


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urlparse(req.full_url).netloc != urlparse(newurl).netloc:
            redirected.remove_header("Authorization")
        return redirected


BROWSER = build_opener(HTTPCookieProcessor(COOKIES), SafeRedirect())


class LoginForm(HTMLParser):
    action = ""

    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        if tag == "form" and fields.get("id") == "kc-form-login":
            self.action = fields["action"]


def fetch(url, method="GET", data=None, headers=None, expected=200):
    try:
        response = BROWSER.open(Request(url, data, headers or {}, method=method), timeout=25)
    except HTTPError as error:
        response = error
    with response:
        if response.status != expected:
            path = urlparse(url).path
            raise RuntimeError(f"{method} {path}: expected {expected}, got {response.status}")
        return response.read(), response.headers, response.url


def sign_in(email, password):
    verifier = secrets.token_urlsafe(48)
    state = secrets.token_urlsafe(24)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    redirect = APP + "/"
    query = urlencode(dict(
        client_id=CLIENT, redirect_uri=redirect, response_type="code", scope="openid email",
        code_challenge=challenge, code_challenge_method="S256", state=state, response_mode="query",
    ))
    form = LoginForm()
    body, _, form_url = fetch(ISSUER + "/protocol/openid-connect/auth?" + query)
    form.feed(body.decode())
    assert form.action, "Keycloak login form missing"
    action = urljoin(form_url, form.action)
    assert action.startswith(ISSUER + "/login-actions/")
    _, _, callback = fetch(action, "POST", urlencode(dict(username=email, password=password)).encode())
    assert callback.startswith(redirect)
    parameters = parse_qs(urlparse(callback).query)
    assert parameters.get("state") == [state] and parameters.get("code"), "Missing PKCE callback"
    data = urlencode(dict(
        grant_type="authorization_code", client_id=CLIENT, redirect_uri=redirect,
        code=parameters["code"][0], code_verifier=verifier,
    )).encode()
    tokens, _, _ = fetch(ISSUER + "/protocol/openid-connect/token", "POST", data)
    return json.loads(tokens)["access_token"]


def request_api(path, method="GET", data=None, expected=200, *, token):
    headers = {"Origin": APP, "Content-Type": "application/json"}
    headers["Authorization"] = "Bearer " + token
    body, _, _ = fetch(APP + "/api/v1" + path, method, None if data is None else json.dumps(data).encode(), headers, expected)
    return json.loads(body) if body else None


def verify(fixture, email, password, denied):
    token = sign_in(email, password)
    api = partial(request_api, token=token)
    session = {"deviceLabel": "Pilot qualification"}
    if denied:
        result = api("/sessions", "POST", session, 403)
        assert result["code"] == "invitation_required"
        print("A verified account outside the pilot received invitation_required.")
        return
    api("/sessions", "POST", session, 201)
    cookie = next(item for item in COOKIES if item.name == "boqlet_session")
    assert cookie.secure and cookie.has_nonstandard_attr("HttpOnly")
    api("/me")
    print("OIDC PKCE, app session and Secure/HttpOnly cookie passed.", flush=True)
    title = "Boqlet pilot verification"
    org = api("/orgs", "POST", {"name": title, "slug": "pilot-check-" + secrets.token_hex(4)}, 201)["id"]
    org_path = "/orgs/" + org
    try:
        project = api(org_path + "/projects", "POST", {"name": "Duplex upload"}, 201)["id"]
        model = api("/projects/" + project + "/models", "POST", {"name": "Architecture", "discipline": "architecture"}, 201)["id"]
        upload = api("/models/" + model + "/versions", "POST", {"fileName": fixture.name, "sizeBytes": fixture.stat().st_size}, 201)
        url = upload["upload"]["url"]
        assert url.startswith("https://files.booqlet.com/boqlet-pilot/")
        _, cors, _ = fetch(url, "OPTIONS", headers={
            "Origin": APP, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type",
        })
        assert cors["Access-Control-Allow-Origin"] == APP
        _, signed, _ = fetch(url, "PUT", fixture.read_bytes(), {"Origin": APP, "Content-Type": "application/octet-stream"})
        assert signed["ETag"] and signed["Access-Control-Allow-Origin"] == APP
        fetch(url.split("?")[0], expected=404)
        version = "/model-versions/" + upload["version"]["id"]
        job = api(version + "/complete", "POST")["parseJobId"]
        for _ in range(120):
            status = api("/jobs/" + job)["status"]
            if status == "succeeded":
                break
            if status in ("failed", "cancelled"):
                raise RuntimeError(f"Duplex parse ended in {status}")
            time.sleep(1)
        else:
            raise RuntimeError("Duplex parse timed out")
        model_version = api(version)
        assert model_version["status"] == "ready"
        elements = len(api(version + "/scene")["elements"])
        assert elements > 100
        geometry, _, _ = fetch(APP + "/api/v1" + version + "/geometry", headers={"Authorization": "Bearer " + token})
        assert geometry.startswith(b"glTF")
        print(f"Public signed PUT, CORS, queued IFC parse and signed GLB passed ({elements} elements).", flush=True)
        sample = api(org_path + "/projects", "POST", {"name": "Sample Duplex", "sample": "duplex"}, 201)["id"]
        for _ in range(120):
            boqs = api("/projects/" + sample + "/boqs")
            if boqs:
                run = (boqs[0].get("currentRevision") or {}).get("currentRun") or {}
                if run.get("status") in ("complete", "needs_input"):
                    print(f"Sample BoQ generation passed ({run['status']}).", flush=True)
                    break
            time.sleep(1)
        else:
            raise RuntimeError("Sample BoQ generation timed out")
    finally:
        api(org_path, "DELETE", {"confirmName": title}, 202)
        print("Synthetic organisation scheduled for ordinary retention cleanup.")


if __name__ == "__main__":
    verify(Path(sys.argv[1]), sys.argv[2], os.environ.pop("SMOKE_PASSWORD"), "--denied" in sys.argv)
