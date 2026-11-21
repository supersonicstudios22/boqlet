"""Engine timing on reference files (TS-002, nfr.md "Model processing").

Runs the worker's own jobs (`ifc_boq.worker.execute`: parse with geometry, meshes and GLB, then a
run with As modelled, ACME cost codes, the global dictionary and federation) on local storage, and
prints one JSON line per measurement. The NFR table in docs/architecture/nfr.md records them.

    engine/.venv/Scripts/python tests/perf/engine_timing.py fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc
    engine/.venv/Scripts/python tests/perf/engine_timing.py --federated ARCH.ifc STRUCT.ifc

`--federated` parses the models in parallel (as two workers would) and runs them as one BoQ. Each
measurement is the median of `--repeat` runs (default 1); the run is measured on the cached parse.
The medium reference files are downloads (docs/testing/ifc-corpus-catalogue.md), not in the repository.
"""
import argparse
import json
import statistics
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))
from ifc_boq import presets  # noqa: E402
from ifc_boq.storage import LocalStorage  # noqa: E402
from ifc_boq.worker import execute  # noqa: E402


def envelope(kind, data, prefix):
    return {"jobId": f"{kind}-perf", "type": kind, "orgId": "perf", "attempt": 1, "contract": "1",
            "input": data, "outputPrefix": prefix}


def parse(root: str, ifc: str, name: str):
    storage = LocalStorage(Path(root))
    storage.put_file(f"uploads/{name}.ifc", Path(ifc))
    start = time.monotonic()
    result = execute(envelope("parse", {"modelVersionId": name, "sourceKey": f"uploads/{name}.ifc",
                                        "fileName": Path(ifc).name}, f"parsed/{name}/"), storage)
    seconds = time.monotonic() - start
    if result["status"] != "succeeded":
        raise SystemExit(f"parse of {ifc} failed: {result.get('error')}")
    return seconds, result["output"]["artifacts"], result["output"]["summary"]["elementCount"]


def run(root: str, models: list[tuple[str, dict]]):
    storage = LocalStorage(Path(root))
    code_list, mapping = presets.load_classification("acme-cost-codes")
    rules, library = presets.load_rule_set("as-modelled")
    job = envelope("run", {
        "models": [{"id": name, **artifacts} for name, artifacts in models],
        "ruleSet": {"doc": rules, "library": list((library or {}).values()) if isinstance(library, dict) else (library or [])},
        "classifications": [{"codeList": code_list, "map": mapping}],
        "dictionaries": [presets.load_dictionary("global-seed")],
        "resolution": presets.resolution(), "federation": presets.federation(),
    }, "runs/perf/")
    start = time.monotonic()
    result = execute(job, storage)
    seconds = time.monotonic() - start
    if result["status"] != "succeeded":
        raise SystemExit(f"run failed: {result.get('error')}")
    return seconds, result["output"]["counts"]["lines"]


def emit(**fields):
    print(json.dumps(fields), flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("models", nargs="+")
    ap.add_argument("--federated", action="store_true", help="parse in parallel and run the models as one BoQ")
    ap.add_argument("--repeat", type=int, default=1)
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as root:
        names = [f"m{i}" for i in range(len(args.models))]
        parses, runs = [], []
        for _ in range(args.repeat):
            start = time.monotonic()
            if args.federated:
                with ProcessPoolExecutor(len(args.models)) as pool:
                    done = list(pool.map(parse, [root] * len(args.models), args.models, names))
            else:
                done = [parse(root, ifc, name) for ifc, name in zip(args.models, names)]
            parses.append((time.monotonic() - start, done))
            seconds, lines = run(root, [(n, d[1]) for n, d in zip(names, done)])
            runs.append((seconds, lines))
        files = [Path(m).name for m in args.models]
        elements = sum(d[2] for d in parses[0][1])
        mb = round(sum(Path(m).stat().st_size for m in args.models) / 1e6, 1)
        label = " + ".join(files)
        emit(name=f"parse ({'parallel' if args.federated else 'sequential'})", models=label, elements=elements, mb=mb,
             seconds=round(statistics.median(p[0] for p in parses), 1),
             perModel=[round(d[0], 1) for d in parses[0][1]])
        emit(name="run (cached parse)", models=label, lines=runs[0][1], seconds=round(statistics.median(r[0] for r in runs), 1))


if __name__ == "__main__":
    main()
