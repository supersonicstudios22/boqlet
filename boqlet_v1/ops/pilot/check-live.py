"""Run a synthetic Boqlet sign-in, signed upload, PostgreSQL job and BoQ through HTTPS."""
import http.cookiejar
import json
import os
import secrets
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, HTTPCookieProcessor, Request, build_opener

APP = "https://booqlet.com"
COOKIES = http.cookiejar.CookieJar()


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urlparse(req.full_url).netloc != urlparse(newurl).netloc:
            redirected.remove_header("Authorization")
        return redirected


BROWSER = build_opener(HTTPCookieProcessor(COOKIES), SafeRedirect())


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


def api(path, method="GET", data=None, expected=200):
    headers = {"Origin": APP, "Content-Type": "application/json"}
    body, _, _ = fetch(APP + "/api/v1" + path, method, None if data is None else json.dumps(data).encode(), headers, expected)
    return json.loads(body) if body else None


def verify(fixture, email, password, setup_token):
    session = {"email": email, "password": password, "deviceLabel": "Pilot qualification"}
    api("/auth/sign-in", "POST", session, 401)
    setup = {"token": setup_token, "password": password, "name": "Boqlet verification"}
    api("/auth/set-password", "POST", setup, 204)
    api("/auth/set-password", "POST", setup, 400)
    api("/auth/sign-in", "POST", session, 201)
    cookie = next(item for item in COOKIES if item.name == "boqlet_session")
    assert cookie.secure and cookie.has_nonstandard_attr("HttpOnly")
    api("/me")
    print("Single-use setup, Boqlet password sign-in and Secure/HttpOnly cookie passed.", flush=True)
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
        geometry, _, _ = fetch(APP + "/api/v1" + version + "/geometry")
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
        api("/sessions/current", "DELETE", expected=204)
        print("Synthetic organisation scheduled for ordinary retention cleanup.")


if __name__ == "__main__":
    verify(Path(sys.argv[1]), sys.argv[2], os.environ.pop("SMOKE_PASSWORD"), os.environ.pop("SETUP_TOKEN"))
