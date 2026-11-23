"""
compare_baseline.py - capture and compare the review baseline (docs/review/baseline/).

Two layers, each re-running the review's samples (docs/review/tools/fetch-samples.sh):

  engine  the Python engine in-process, exactly as the CLI / worker call it: parse_file -> get_boq
          -> export. No Docker needed. Every (sample, config) in RUNS below.
  stack   the full product through the Java API on the local Docker stack (npm run local:up):
          sign-up, org, project, model, upload to object storage, parse job, BoQ, run job, lines,
          questions, warnings, log, the stored result and the run's Excel export.

Usage (from the repository root; the wrapper picks engine/.venv's Python):

  docs/review/tools/compare-baseline                       # compare both layers against the baseline
  docs/review/tools/compare-baseline --layer engine        # engine only (no Docker)
  docs/review/tools/compare-baseline --only S05-default F01-default
  docs/review/tools/compare-baseline --capture             # write a new baseline (intended changes only!)
  docs/review/tools/compare-baseline --rel-tol 1e-6 --abs-tol 1e-6

By default every sample is parsed afresh in-process, exactly as the CLI does (the engine layer takes ~30 min
on a 12-core Windows machine, mostly S06). --parse-cache reuses parses stored in docs/review/_scratch/parse-cache/,
keyed by the sample's bytes and a hash of the whole engine source + ifcopenshell + Python version (any engine
change re-parses). A cached parse goes through JSON, as the worker's parsed.json does, so it reproduces the
product's path rather than the CLI's: on the current code S12-default then succeeds instead of crashing
(the in-memory ParsedModel holds a value JSON turns into a string). Use --parse-cache for quick iterations and
the default for the exit check.

Exit code: 0 no differences, 1 differences found, 3 a layer could not run (e.g. the stack is down).
Quantities and every other number are compared within tolerance (|a-b| <= abs + rel*max(|a|,|b|));
strings, units, codes, statuses, question ids and element ids are compared exactly. Volatile values
(durations, timestamps, uuids, signed URLs) are normalised away before saving and before comparing.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
REVIEW = HERE.parent
ROOT = REVIEW.parents[1]
SAMPLES = REVIEW / "_samples"
BASELINE = REVIEW / "baseline"
SCRATCH = REVIEW / "_scratch"

# Presets are read from the repository; the git-ignored presets/user folder (Library saves of the
# old dev build) is replaced by an empty folder so a developer's local files can't change results.
EMPTY_USER = SCRATCH / "empty-user-presets"
os.environ["IFC_BOQ_USER_PRESETS"] = str(EMPTY_USER)
for sub in ("rules", "dictionaries", "classifications"):
    (EMPTY_USER / sub).mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / "engine"))

S = {
    "S01": "S01-wall-with-opening-and-window.ifc",
    "S02": "S02-column-straight-rectangle-tessellation.ifc",
    "S03": "S03-simple-scene-architecture-ifc2x3.ifc",
    "S04": "S04-simple-scene-structural-ifc4x3.ifc",
    "S05": "S05-duplex-architecture-ifc2x3.ifc",
    "S06": "S06-duplex-mep-ifc2x3.ifc",
    "S07": "S07-revit-arc-ifc4.ifc",
    "S08": "S08-revit-str-ifc4.ifc",
    "S09": "S09-samplehouse-ifc4.ifc",
    "S10": "S10-schependomlaan-planning-ifc2x3-65mb.ifc",
    "S11": "S11-ios-1948-wall-wrong-geometry.ifc",
    "S12": "S12-ios-478-walls-missing-subtractions.ifc",
    "S13": "S13-truncated-duplex.ifc",
    "S14": "S14-not-an-ifc.ifc",
}

# Configurations: the CLI/worker defaults, and non-default rule sets, dictionaries and classifications.
CONFIGS = {
    "default": {"rules": "as-modelled", "dicts": ["global-seed"], "classes": ["acme-cost-codes"]},
    "house": {"rules": "acme-house-rules", "dicts": ["global-seed", "acme-company"],
              "classes": ["acme-cost-codes", "demo-trades"]},
    "standard": {"rules": "standard-style-example", "dicts": ["global-seed"], "classes": ["demo-trades"]},
    "tweaked": {"rules": "demo-tweaked", "dicts": ["global-seed"], "classes": ["demo-trades"]},
    "duplexproject": {"rules": "acme-house-rules", "dicts": ["global-seed", "acme-company", "project-duplex"],
                      "classes": ["acme-cost-codes"]},
    "noclass": {"rules": "as-modelled", "dicts": ["global-seed"], "classes": []},
}

# Engine runs: id -> (samples with disciplines, config). One sample = single model; several = federation.
RUNS: dict[str, tuple[list[tuple[str, str | None]], str]] = {}
for sid in ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12", "S13", "S14"]:
    RUNS[f"{sid}-default"] = ([(sid, None)], "default")
for sid in ["S03", "S05", "S07", "S09"]:
    for cfg in ["house", "standard", "tweaked"]:
        RUNS[f"{sid}-{cfg}"] = ([(sid, None)], cfg)
RUNS["S05-duplexproject"] = ([("S05", None)], "duplexproject")
RUNS["S05-noclass"] = ([("S05", None)], "noclass")
RUNS["F01-default"] = ([("S07", "architecture"), ("S08", "structure")], "default")
RUNS["F02-default"] = ([("S05", "architecture"), ("S06", "mep")], "default")
RUNS["F01-house"] = ([("S07", "architecture"), ("S08", "structure")], "house")

# Stack runs (through the Java API): every sample once with the org's defaults, one federation,
# and one non-default rule set + classification chosen from the system Library.
STACK_RUNS: dict[str, tuple[list[tuple[str, str]], str]] = {
    **{f"{sid}-default": ([(sid, "detect")], "default") for sid in
       ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12", "S13", "S14"]},
    "F01-default": ([("S07", "architecture"), ("S08", "structure")], "default"),
    "S05-house": ([("S05", "architecture")], "house"),
}

VOLATILE_KEYS = {"durationMs", "parseMs", "seconds", "generatedAt", "createdAt", "updatedAt", "startedAt",
                 "finishedAt", "queuedAt", "completedAt", "expiresAt", "at", "lastActiveAt", "savedAt",
                 "heartbeatAt", "url", "downloadUrl", "etag", "leaseUntil", "attempt", "progress", "workerId"}
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
ISO_TS = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?")
VOLATILE_LABEL = re.compile(r"time \(ms\)|generated|exported at|run time|duration|saved at|date", re.I)
REVIEW_ACCOUNT = re.compile(r"review-[0-9a-f]{8,}")
TIMING = re.compile(r"\b\d+(\.\d+)? ?(ms|s)\b")


def scrub(v, key: str | None = None):
    """Remove values that change from run to run without the code changing."""
    if isinstance(v, dict):
        return {k: scrub(x, k) for k, x in v.items() if k not in VOLATILE_KEYS}
    if isinstance(v, list):
        return [scrub(x) for x in v]
    if isinstance(v, str):
        v = UUID.sub("<uuid>", v)
        v = ISO_TS.sub("<ts>", v)
        v = REVIEW_ACCOUNT.sub("review-<stamp>", v)   # the per-run baseline account, org slug and email
        if key in ("message", "text") and ("took" in v or " in " in v):
            v = TIMING.sub("<t>", v)
        return v
    return v


def write_json_gz(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False).encode("utf-8")
    with open(path, "wb") as f:                       # mtime=0: the same content gives the same bytes
        with gzip.GzipFile(fileobj=f, mode="wb", mtime=0, filename="") as g:
            g.write(raw)


def read_json_gz(path: Path):
    with gzip.open(path, "rb") as g:
        return json.loads(g.read().decode("utf-8"))


def xlsx_cells(data: bytes) -> dict:
    """Every non-empty cell value per sheet (formulas as text), for comparing exports."""
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(data), data_only=False)
    out = {}
    for ws in wb.worksheets:
        cells = {}
        for row in ws.iter_rows():
            for c in row:
                if c.value is None:
                    continue
                v = c.value
                if hasattr(v, "isoformat"):
                    v = "<date>"
                elif not isinstance(v, (int, float, str, bool)):
                    v = str(v)
                cells[c.coordinate] = scrub(v, "text") if isinstance(v, str) else v
        # A row labelled as a time or date (cover / Inputs sheets: "Engine time (ms)", "Generated") is volatile.
        for coord, v in list(cells.items()):
            if coord.startswith("A") and isinstance(v, str) and VOLATILE_LABEL.search(v):
                row = coord[1:]
                for c2 in list(cells):
                    if c2 != coord and re.sub(r"^[A-Z]+", "", c2) == row:
                        cells[c2] = "<volatile>"
        out[ws.title] = cells
    return out


def lines_table(result: dict) -> list[dict]:
    """A flat, human-diffable view of the lines (also saved as lines.json for reading)."""
    rows = []
    for l in result.get("lines", []):
        rows.append({"key": l.get("key"), "ruleId": l.get("ruleId"), "description": l.get("description"),
                     "unit": l.get("unit"), "quantity": l.get("quantity"), "source": l.get("source"),
                     "codes": {s: c.get("code") for s, c in (l.get("codes") or {}).items()},
                     "elements": len((l.get("trace") or {}).get("elements") or [])})
    return rows


def keyed(result: dict) -> dict:
    """The result with its lists keyed, so a difference names the line or question it is in."""
    r = dict(result)
    if isinstance(r.get("lines"), list):
        r["lines"] = {l.get("key", f"#{i}"): l for i, l in enumerate(r["lines"])}
    if isinstance(r.get("questions"), list):
        r["questions"] = {q.get("id", f"#{i}"): q for i, q in enumerate(r["questions"])}
    for k in ("log", "warnings", "checks", "answeredQuestionIds"):
        if isinstance(r.get(k), list):
            r[k] = sorted(r[k], key=lambda x: json.dumps(x, sort_keys=True))
    return r


def diff(a, b, path: str, tol: tuple[float, float], out: list[str], limit: int = 400) -> None:
    if len(out) >= limit:
        return
    rel, ab = tol
    if isinstance(a, bool) or isinstance(b, bool):
        if a != b:
            out.append(f"{path}: {a!r} -> {b!r}")
        return
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if abs(a - b) > ab + rel * max(abs(a), abs(b)):
            out.append(f"{path}: {a!r} -> {b!r} (delta {b - a:+.6g})")
        return
    if type(a) is not type(b):
        out.append(f"{path}: {short(a)} -> {short(b)}")
        return
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b), key=str):
            if k not in a:
                out.append(f"{path}.{k}: added {short(b[k])}")
            elif k not in b:
                out.append(f"{path}.{k}: removed (was {short(a[k])})")
            else:
                diff(a[k], b[k], f"{path}.{k}", tol, out, limit)
        return
    if isinstance(a, list):
        if len(a) != len(b):
            out.append(f"{path}: list length {len(a)} -> {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f"{path}[{i}]", tol, out, limit)
        return
    if a != b:
        out.append(f"{path}: {short(a)} -> {short(b)}")


def short(v, n: int = 160) -> str:
    s = json.dumps(v, ensure_ascii=False, sort_keys=True) if not isinstance(v, str) else repr(v)
    return s if len(s) <= n else s[:n] + "..."


def peak_memory_mb() -> float | None:
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            class PMC(ctypes.Structure):
                _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                            ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                            ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]
            pmc = PMC()
            pmc.cb = ctypes.sizeof(PMC)
            k32 = ctypes.WinDLL("kernel32", use_last_error=True)
            k32.GetCurrentProcess.restype = wintypes.HANDLE
            k32.K32GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
            k32.K32GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
            return round(pmc.PeakWorkingSetSize / 2**20, 1)
        import resource
        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    except Exception:
        return None


# ----------------------------------------------------------------------------------------- engine


def engine_fingerprint() -> str:
    """Hash of every engine source file, the ifcopenshell version and the Python version: any change to
    the engine (parse.py, geometry.py, ...) or its kernel invalidates the parse cache."""
    import ifcopenshell
    h = hashlib.sha256(f"{ifcopenshell.version}|{sys.version}".encode())
    for f in sorted((ROOT / "engine" / "ifc_boq").rglob("*")):
        if f.is_file() and f.suffix in (".py", ".json"):
            h.update(f.relative_to(ROOT).as_posix().encode())
            h.update(f.read_bytes())
    return h.hexdigest()[:16]


def cached_parse(f: Path):
    """parse_file, cached per (sample bytes, engine fingerprint) unless BASELINE_NO_PARSE_CACHE=1.
    Only parsing is cached; names, measure, rules, classify and export always run."""
    from ifc_boq.geometry import load_meshes, save_meshes
    from ifc_boq.parse import parse_file
    if os.environ.get("BASELINE_NO_PARSE_CACHE") == "1":
        parsed, parser = parse_file(str(f))
        return parsed, parser.meshes
    key = hashlib.sha256(f.read_bytes()).hexdigest()[:16] + "-" + engine_fingerprint()
    d = SCRATCH / "parse-cache" / key
    if (d / "parsed.json").exists() and (d / "meshes.npz").exists():
        return json.loads((d / "parsed.json").read_text(encoding="utf-8")), load_meshes(d / "meshes.npz")
    parsed, parser = parse_file(str(f))
    d.mkdir(parents=True, exist_ok=True)
    (d / "parsed.json").write_text(json.dumps(parsed), encoding="utf-8")
    save_meshes(parser.meshes, d / "meshes.npz")
    return parsed, parser.meshes


def engine_child(run_id: str, out_dir: str) -> int:
    """Runs one engine run in this (fresh) process and writes its artefacts to out_dir."""
    from ifc_boq import presets
    from ifc_boq.export_xlsx import export
    from ifc_boq.parse import parse_file
    from ifc_boq.pipeline import get_boq

    members, cfg_name = RUNS[run_id]
    cfg = CONFIGS[cfg_name]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    meta = {"run": run_id, "config": cfg_name, "presets": cfg, "samples": []}
    t0 = time.perf_counter()
    try:
        models, parse_s = [], {}
        for sid, disc in members:
            f = SAMPLES / S[sid]
            meta["samples"].append({"id": sid, "file": S[sid], "sha256": hashlib.sha256(f.read_bytes()).hexdigest(),
                                    "discipline": disc})
            tp = time.perf_counter()
            parsed, meshes = cached_parse(f)
            parse_s[sid] = round(time.perf_counter() - tp, 2)
            models.append({"id": f.stem, "parsed": parsed, "meshes": meshes,
                           **({"discipline": disc} if disc else {})})
        if len(models) == 1 and not members[0][1]:
            models[0].pop("id")
        rule_set, lib = presets.load_rule_set(cfg["rules"])
        dicts = [presets.load_dictionary(d) for d in cfg["dicts"]]
        systems = [presets.load_classification(c) for c in cfg["classes"]]
        tr = time.perf_counter()
        result = get_boq(models, rule_set, systems, dicts, presets.resolution(), [], lib,
                         federation=presets.federation())
        meta["timing"] = {"parseSeconds": parse_s, "runSeconds": round(time.perf_counter() - tr, 2)}
        xmeta = {"modelName": " + ".join(m["parsed"]["header"]["source"]["fileName"] for m in models),
                 "modelId": ", ".join(m["parsed"]["header"]["source"]["sha256"] for m in models),
                 "dictionaries": [f"{d['name']} ({d['layer']})" for d in dicts],
                 "classifications": [{"id": cl["id"], "name": cl["name"]} for cl, _ in systems], "decisions": []}
        xlsx = export(result, xmeta)
        (out / "boq.xlsx").write_bytes(xlsx)
        clean = scrub(result)
        clean.pop("ruleSet", None)  # the preset itself, not output; its id/version stay in meta
        meta["outcome"] = "result"
        meta["status"] = result["status"]
        meta["ruleSet"] = {"id": result["ruleSet"].get("id"), "version": result["ruleSet"].get("version")}
        meta["counts"] = {k: v for k, v in result["stats"].items() if k != "durationMs"}
        meta["counts"]["questions"] = len(result["questions"])
        meta["counts"]["blockingQuestions"] = sum(1 for q in result["questions"] if q.get("blocking"))
        meta["counts"]["warnings"] = len(result["warnings"])
        write_json_gz(out / "result.json.gz", clean)
        write_json_gz(out / "xlsx-cells.json.gz", xlsx_cells(xlsx))
        (out / "lines.json").write_text(json.dumps(lines_table(result), indent=1, ensure_ascii=False), encoding="utf-8")
        (out / "questions.json").write_text(json.dumps(scrub(result["questions"]), indent=1, ensure_ascii=False),
                                            encoding="utf-8")
    except Exception as e:  # malformed inputs: the error is the baseline
        meta["outcome"] = "error"
        meta["error"] = {"type": type(e).__name__, "message": scrub(str(e))[:2000]}
        (out / "traceback.txt").write_text(traceback.format_exc(), encoding="utf-8")
    meta.setdefault("timing", {})["totalSeconds"] = round(time.perf_counter() - t0, 2)
    meta["peakMemoryMB"] = peak_memory_mb()
    import ifcopenshell
    meta["versions"] = {"python": sys.version.split()[0], "ifcopenshell": ifcopenshell.version}
    (out / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    return 0


def run_engine(run_id: str, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for p in out_dir.iterdir():
        if p.is_file():
            p.unlink()
    env = {**os.environ, "PYTHONUTF8": "1"}
    r = subprocess.run([sys.executable, str(Path(__file__)), "--child", run_id, str(out_dir)], env=env,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        (out_dir / "child-stderr.txt").write_text(r.stdout + "\n" + r.stderr, encoding="utf-8")
        meta = {"run": run_id, "outcome": "crash", "returncode": r.returncode, "stderrTail": r.stderr[-2000:]}
        (out_dir / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")


STABLE_META = ("run", "config", "presets", "samples", "outcome", "status", "ruleSet", "counts", "error")


def compare_dirs(base: Path, new: Path, tol, label: str) -> list[str]:
    out: list[str] = []
    if not (base / "meta.json").exists():
        return [f"{label}: no baseline (run --capture to add it)"]
    bm = json.loads((base / "meta.json").read_text(encoding="utf-8"))
    nm = json.loads((new / "meta.json").read_text(encoding="utf-8"))
    diff({k: bm.get(k) for k in STABLE_META}, {k: nm.get(k) for k in STABLE_META}, f"{label}.meta", tol, out)
    for name in sorted(p.name for p in base.glob("*.json.gz")):
        if not (new / name).exists():
            out.append(f"{label}: {name} missing in the new run")
            continue
        a, b = read_json_gz(base / name), read_json_gz(new / name)
        if name.startswith("result") or name.startswith("stack-result"):
            a, b = keyed(a), keyed(b)
        elif name.startswith("lines"):
            a = {l.get("key", f"#{i}"): l for i, l in enumerate(a)} if isinstance(a, list) else a
            b = {l.get("key", f"#{i}"): l for i, l in enumerate(b)} if isinstance(b, list) else b
        elif name.startswith("questions"):
            a = {q.get("id", f"#{i}"): q for i, q in enumerate(a)} if isinstance(a, list) else a
            b = {q.get("id", f"#{i}"): q for i, q in enumerate(b)} if isinstance(b, list) else b
        diff(a, b, f"{label}/{name.removesuffix('.json.gz')}", tol, out)
    return out


# ------------------------------------------------------------------------------------------ stack


class Api:
    def __init__(self, port: int, app_port: int):
        self.base = f"http://127.0.0.1:{port}/api/v1"
        self.origin = f"http://localhost:{app_port}"
        self.cookie = ""

    def call(self, method: str, path: str, body=None, expect=(200,), raw=False):
        import urllib.request
        import urllib.error
        url = path if path.startswith("http") else self.base + path
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Origin", self.origin)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        if self.cookie and not path.startswith("http"):
            req.add_header("Cookie", f"boqlet_session={self.cookie}")
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                status, payload, headers = res.status, res.read(), res.headers
        except urllib.error.HTTPError as e:
            status, payload, headers = e.code, e.read(), e.headers
        if status not in expect:
            raise RuntimeError(f"{method} {path} answered {status}: {payload[:500]!r}")
        for c in headers.get_all("Set-Cookie") or []:
            if c.startswith("boqlet_session="):
                self.cookie = c.split(";")[0].split("=", 1)[1]
        if raw:
            return payload
        return json.loads(payload) if payload else None

    def put(self, url: str, data: bytes, headers: dict):
        import urllib.request
        req = urllib.request.Request(url, data=data, method="PUT")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        req.add_header("Origin", self.origin)
        with urllib.request.urlopen(req, timeout=600) as res:
            if res.status >= 300:
                raise RuntimeError(f"upload answered {res.status}")

    def get_url(self, url: str) -> bytes:
        import urllib.request
        with urllib.request.urlopen(url, timeout=600) as res:
            return res.read()


def sql(query: str) -> str:
    r = subprocess.run(["docker", "compose", "-f", str(ROOT / "ops/local/compose.yaml"), "-p", "boqlet-local",
                        "exec", "-T", "db", "psql", "-U", "boqlet", "-d", "boqlet", "-tAc", query],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"psql failed: {r.stderr}")
    return r.stdout.strip()


def wait_job(api: Api, job_id: str, timeout: int = 3600) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        job = api.call("GET", f"/jobs/{job_id}")
        if job["status"] in ("succeeded", "failed", "cancelled"):
            return job
        time.sleep(1.5)
    raise RuntimeError(f"job {job_id} did not finish in {timeout}s")


def stack_session(api: Api) -> dict:
    """A fresh account and org for this compare run (local data only; npm run local:reset clears it)."""
    stamp = hex(int(time.time() * 1000))[2:]
    email, password = f"review-{stamp}@example.test", "a long review baseline password"
    import base64
    token = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()  # as scripts/local.mjs
    digest = hashlib.sha256(token.encode()).hexdigest()
    sql("INSERT INTO native_setup_links (email, token_hash, expires_at, purpose) VALUES "
        f"('{email}', '{digest}', now() + interval '1 hour', 'setup')")
    api.call("POST", "/auth/set-password", {"token": token, "password": password, "name": "Review Baseline"},
             expect=(204,))
    api.call("POST", "/auth/sign-in", {"email": email, "password": password, "takeover": True,
                                       "deviceLabel": "review baseline"}, expect=(201,))
    org = api.call("POST", "/orgs", {"name": "Review baseline", "slug": f"review-{stamp}"}, expect=(201,))
    # Lift the plan limits for this local org only, so 14 samples and their minutes fit.
    # (enterprise: no seat, project, size or minutes limits and no export watermark).
    sql(f"UPDATE subscriptions SET plan_id = 'enterprise' WHERE org_id = '{org['id']}'")
    return org


def pick_versions(api: Api, org_id: str, cfg_name: str) -> dict | None:
    """RevisionInputsPartial for a config, from the system Library presets, by their slug or name."""
    if cfg_name == "default":
        return None
    cfg = CONFIGS[cfg_name]
    presets = api.call("GET", f"/orgs/{org_id}/presets")

    def find(kind: str, ident: str):
        for p in presets:
            if p.get("kind") != kind:
                continue
            if p.get("slug") == ident:
                vid = (p.get("latestPublishedVersion") or {}).get("id")
                if not vid:
                    vs = api.call("GET", f"/presets/{p['id']}/versions")
                    vid = vs[0]["id"] if vs else None
                return vid
        raise RuntimeError(f"no system preset {kind} {ident!r}; presets: "
                           f"{[(p.get('kind'), p.get('name')) for p in presets]}")
    return {"ruleSetVersionId": find("rule_set", cfg["rules"]),
            "dictionaryVersionIds": [find("dictionary", d) for d in cfg["dicts"]],
            "classificationVersionIds": [find("classification", c) for c in cfg["classes"]]}


def all_pages(api: Api, path: str, key: str = "items", limit: int = 5000) -> list:
    items, cursor = [], None
    while True:
        sep = "&" if "?" in path else "?"
        page = api.call("GET", f"{path}{sep}limit={limit}" + (f"&cursor={cursor}" if cursor else ""))
        if isinstance(page, list):
            return page
        items += page.get(key) or page.get("lines") or page.get("data") or []
        cursor = page.get("nextCursor")
        if not cursor:
            return items


def stack_run(api: Api, org: dict, run_id: str, out: Path) -> None:
    members, cfg_name = STACK_RUNS[run_id]
    out.mkdir(parents=True, exist_ok=True)
    for p in out.iterdir():
        if p.is_file():
            p.unlink()
    meta = {"run": run_id, "config": cfg_name, "samples": [], "layer": "stack"}
    t0 = time.perf_counter()
    try:
        project = api.call("POST", f"/orgs/{org['id']}/projects", {"name": f"{run_id}"}, expect=(201,))
        version_ids, parses = [], {}
        for sid, disc in members:
            f = SAMPLES / S[sid]
            data = f.read_bytes()
            meta["samples"].append({"id": sid, "file": S[sid], "sha256": hashlib.sha256(data).hexdigest(),
                                    "discipline": disc})
            model = api.call("POST", f"/projects/{project['id']}/models", {"name": sid, "discipline": disc},
                             expect=(201,))
            staged = api.call("POST", f"/models/{model['id']}/versions", {"fileName": S[sid], "sizeBytes": len(data)},
                              expect=(201,))
            up = staged["upload"]
            if up.get("parts"):
                raise RuntimeError("multipart upload requested; this tool PUTs single files only")
            api.put(up["url"], data, up.get("headers") or {})
            tp = time.perf_counter()
            queued = api.call("POST", f"/model-versions/{staged['version']['id']}/complete", {}, expect=(200,))
            job = wait_job(api, queued["parseJobId"]) if queued.get("parseJobId") else {"status": "deduplicated"}
            parses[sid] = round(time.perf_counter() - tp, 1)
            version = api.call("GET", f"/model-versions/{staged['version']['id']}")
            meta.setdefault("parse", {})[sid] = {"job": job.get("status"), "versionStatus": version.get("status"),
                                                 "error": scrub(job.get("error"))}
            if version.get("status") != "ready":
                meta["outcome"] = "parse_failed"
                (out / f"parse-{sid}.json").write_text(json.dumps(scrub({"job": job, "version": version}), indent=1,
                                                                  sort_keys=True), encoding="utf-8")
                write_json_gz(out / f"parse-{sid}.json.gz", scrub({"job": {k: job.get(k) for k in ("status", "error",
                              "kind")}, "version": {k: version.get(k) for k in ("status", "error", "summary")}}))
                raise StopIteration
            write_json_gz(out / f"model-summary-{sid}.json.gz", scrub(version.get("summary")))
            version_ids.append((staged["version"]["id"], disc))
        # A new BoQ takes every model of the project at its latest version (BoqInputs.defaults) and the
        # org's default presets; a non-default config then patches only the presets.
        boq = api.call("POST", f"/projects/{project['id']}/boqs", {"name": run_id}, expect=(201,))
        inputs = pick_versions(api, org["id"], cfg_name)
        if inputs:
            api.call("PATCH", f"/revisions/{boq['currentRevision']['id']}", {"inputs": inputs}, expect=(200,))
        rev = api.call("GET", f"/revisions/{boq['currentRevision']['id']}")
        meta["inputs"] = {"models": [{"discipline": m.get("discipline")} for m in rev["inputs"]["models"]],
                          "presetVersions": len(rev["inputs"].get("classificationVersionIds") or [])
                          + len(rev["inputs"].get("dictionaryVersionIds") or []) + 1}
        if len(rev["inputs"]["models"]) != len(version_ids):
            raise RuntimeError(f"the BoQ has {len(rev['inputs']['models'])} models, expected {len(version_ids)}")
        tr = time.perf_counter()
        started = api.call("POST", f"/revisions/{boq['currentRevision']['id']}/runs", None, expect=(202,))
        job = wait_job(api, started["job"]["id"])
        run = api.call("GET", f"/runs/{started['run']['id']}")
        meta["timing"] = {"parseSeconds": parses, "runSeconds": round(time.perf_counter() - tr, 1)}
        meta["runJob"] = job.get("status")
        meta["status"] = run.get("status")
        rid = started["run"]["id"]
        write_json_gz(out / "run.json.gz", scrub(run))
        lines = all_pages(api, f"/runs/{rid}/lines")
        write_json_gz(out / "lines.json.gz", scrub(lines))
        write_json_gz(out / "questions.json.gz", scrub(all_pages(api, f"/runs/{rid}/questions")))
        write_json_gz(out / "warnings.json.gz", scrub(all_pages(api, f"/runs/{rid}/warnings")))
        log = all_pages(api, f"/runs/{rid}/log", limit=1000)
        write_json_gz(out / "log.json.gz", sorted(scrub(log), key=lambda x: json.dumps(x, sort_keys=True)))
        blob = api.call("GET", f"/runs/{rid}/result", raw=True)   # 302 to a signed URL; urllib follows it
        if blob:
            try:
                blob = gzip.decompress(blob)
            except OSError:
                pass
            result = json.loads(blob)
            result.pop("ruleSet", None)
            write_json_gz(out / "stack-result.json.gz", scrub(result))
        ex = api.call("POST", f"/runs/{rid}/exports", {}, expect=(202,))
        ex = wait_job(api, ex["id"])
        export_id = (ex.get("output") or {}).get("exportId")
        if not export_id:
            raise RuntimeError(f"export job gave no exportId: {ex}")
        xlsx = api.call("GET", f"/exports/{export_id}/download", raw=True)  # 302 to a signed URL
        (out / "export.xlsx").write_bytes(xlsx)
        write_json_gz(out / "xlsx-cells.json.gz", xlsx_cells(xlsx))
        meta["outcome"] = "result"
        meta["counts"] = {"lines": len(lines)}
    except StopIteration:
        pass
    except Exception as e:
        meta["outcome"] = "error"
        meta["error"] = {"type": type(e).__name__, "message": scrub(str(e))[:2000]}
        (out / "traceback.txt").write_text(traceback.format_exc(), encoding="utf-8")
    meta.setdefault("timing", {})["totalSeconds"] = round(time.perf_counter() - t0, 1)
    (out / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")


# ------------------------------------------------------------------------------------------- main


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--capture", action="store_true", help="write the baseline instead of comparing")
    ap.add_argument("--layer", choices=["engine", "stack", "all"], default="all")
    ap.add_argument("--only", nargs="*", help="run ids (e.g. S05-default F01-default)")
    ap.add_argument("--rel-tol", type=float, default=1e-6)
    ap.add_argument("--abs-tol", type=float, default=1e-6)
    ap.add_argument("--api-port", type=int, default=int(os.environ.get("LOCAL_API_PORT", 8080)))
    ap.add_argument("--app-port", type=int, default=int(os.environ.get("LOCAL_APP_PORT", 3000)))
    ap.add_argument("--parse-cache", action="store_true",
                    help="reuse parses (JSON round trip, like the worker) when the sample and engine source are unchanged; "
                         "faster, but S12-default then differs (see the module docstring)")
    ap.add_argument("--child", nargs=2, help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if a.child:
        return engine_child(*a.child)
    if a.capture or not a.parse_cache:
        os.environ["BASELINE_NO_PARSE_CACHE"] = "1"

    missing = [n for n in S.values() if not (SAMPLES / n).exists()]
    if missing:
        print(f"samples missing: {missing}; run docs/review/tools/fetch-samples.sh first", file=sys.stderr)
        return 3
    tol = (a.rel_tol, a.abs_tol)
    total_diffs, report, failed_layer = 0, [], False
    stamp = time.strftime("%Y%m%d-%H%M%S")
    work = SCRATCH / "compare" / stamp

    if a.layer in ("engine", "all"):
        ids = [r for r in RUNS if not a.only or r in a.only]
        for rid in ids:
            dest = (BASELINE / "engine" / rid) if a.capture else (work / "engine" / rid)
            t = time.perf_counter()
            run_engine(rid, dest)
            m = json.loads((dest / "meta.json").read_text(encoding="utf-8"))
            line = f"engine {rid:22s} {m.get('outcome'):7s} {m.get('status') or (m.get('error') or {}).get('type') or '':14s} {time.perf_counter() - t:7.1f}s"
            if not a.capture:
                d = compare_dirs(BASELINE / "engine" / rid, dest, tol, f"engine/{rid}")
                total_diffs += len(d)
                line += f"  {len(d)} difference(s)"
                report += d
            print(line, flush=True)

    if a.layer in ("stack", "all"):
        api = Api(a.api_port, a.app_port)
        try:
            api.call("GET", "/me", expect=(200, 401))
        except Exception as e:
            print(f"stack: the API at {api.base} is not reachable ({e}); start it with npm run local:up, "
                  "or use --layer engine", file=sys.stderr)
            failed_layer = True
        else:
            org = stack_session(api)
            ids = [r for r in STACK_RUNS if not a.only or r in a.only]
            for rid in ids:
                dest = (BASELINE / "stack" / rid) if a.capture else (work / "stack" / rid)
                t = time.perf_counter()
                stack_run(api, org, rid, dest)
                m = json.loads((dest / "meta.json").read_text(encoding="utf-8"))
                line = f"stack  {rid:22s} {m.get('outcome'):12s} {m.get('status') or (m.get('error') or {}).get('type') or '':14s} {time.perf_counter() - t:7.1f}s"
                if not a.capture:
                    d = compare_dirs(BASELINE / "stack" / rid, dest, tol, f"stack/{rid}")
                    total_diffs += len(d)
                    line += f"  {len(d)} difference(s)"
                    report += d
                print(line, flush=True)

    if a.capture:
        print(f"baseline written to {BASELINE}")
        return 3 if failed_layer else 0
    work.mkdir(parents=True, exist_ok=True)
    (work / "differences.txt").write_text("\n".join(report), encoding="utf-8")
    for r in report[:200]:
        print("  " + r)
    if len(report) > 200:
        print(f"  ... {len(report) - 200} more in {work / 'differences.txt'}")
    print(f"compare-baseline: {total_diffs} difference(s); details in {work / 'differences.txt'}")
    if failed_layer:
        return 3
    return 1 if total_diffs else 0


if __name__ == "__main__":
    sys.exit(main())
