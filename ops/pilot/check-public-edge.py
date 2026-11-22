"""Verify frontend identity, canonical redirect and API routing on the shared edge."""
import json
import sys
from html.parser import HTMLParser
from urllib.error import HTTPError
from urllib.request import Request, urlopen

# A Windows console's code page (cp1252) can't print the site titles (TF-084).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


class Title(HTMLParser):
    reading_title = False
    title = ""

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.reading_title = True

    def handle_endtag(self, tag):
        if tag == "title":
            self.reading_title = False

    def handle_data(self, text):
        if self.reading_title:
            self.title += text


def check_frontend(url, expected_url, expected_title):
    with urlopen(url, timeout=10) as response:
        page = Title()
        page.feed(response.read().decode("utf-8"))
        if response.url != expected_url or not page.title.startswith(expected_title):
            raise RuntimeError(f"{url} resolved to {response.url} with title {page.title!r}")
    print(f"{url} -> {page.title}")


def check_apis():
    narudzbe = Request(
        "https://api.narudzbe.com/api/v1/auth/bootstrap",
        headers={"Origin": "https://narudzbe.com"},
    )
    with urlopen(narudzbe, timeout=10) as response:
        cookie = response.headers.get("Set-Cookie", "")
        if response.status != 200 or not cookie.startswith("__Host-narudzbine_preauth="):
            raise RuntimeError("Narudzbe did not issue its pre-authentication cookie")

    try:
        with urlopen("https://booqlet.com/api/v1/me", timeout=10):
            raise RuntimeError("Boqlet accepted an anonymous API request")
    except HTTPError as response:
        if response.status != 401 or response.headers.get_content_type() != "application/json":
            raise

    sign_in = Request("https://booqlet.com/api/v1/auth/sign-in", data=b"{}",
                      headers={"Origin": "https://booqlet.com", "Content-Type": "application/json"})
    try:
        with urlopen(sign_in, timeout=10):
            raise RuntimeError("Boqlet accepted an empty sign-in request")
    except HTTPError as response:
        if response.status != 400 or json.load(response)["code"] != "invalid_body":
            raise

    print("Narudzbe and Boqlet API routing passed.")


if __name__ == "__main__":
    check_frontend("https://narudzbe.com/", "https://narudzbe.com/", "Narudžbe")
    check_frontend("https://www.narudzbe.com/", "https://narudzbe.com/", "Narudžbe")
    check_frontend("https://booqlet.com/", "https://booqlet.com/", "boqlet")
    check_apis()
