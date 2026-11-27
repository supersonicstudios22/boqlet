"""Execute the engine job contract independently of its transport."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import threading
import time
import zipfile
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory

import jsonschema

from . import __version__, presets, service
from .diff import compare
from .export_xlsx import export
from .geometry import load_meshes, save_meshes
from .invariants import InvariantError
from .parse import PARSE_FORMAT, IfcFileError, parse_file, sha256
from .pipeline import get_boq
from .preview import compare_lines, sample
from .sheets import boq_import, diff_export
from .storage import Storage, read_json_gzip, validate_key, write_json_gzip

CONTRACT = "1"
JOB_TYPES = {"parse", "run", "preview", "diff", "export_xlsx", "import_boq_edits"}
logger = logging.getLogger(__name__)


class JobError(ValueError):
    def __init__(self, code: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class JobCancelled(Exception):
    pass


def health() -> dict:
    return {"ok": True, "version": __version__, "contract": CONTRACT, "parseFormat": PARSE_FORMAT}


@lru_cache
def _validator(name: str):
    schema = presets._schema(name)
    if schema is None:
        raise RuntimeError(f"Missing engine contract schema {name}")
    return jsonschema.validators.validator_for(schema)(schema)


# Input documents that passed, by content: a preview validates the same rule-set library for both of its
# runs and again for every wizard click, and that alone took ~0.5 s of a Duplex preview (TF-134).
_VALID: OrderedDict = OrderedDict()
_VALID_LOCK = threading.Lock()
_VALID_MAX = 512


def validate(doc, name: str, *, remember: bool = True):
    """Raise ValueError when `doc` doesn't match the engine contract schema `name`. A document that passed
    once is not checked again (`remember=False` for one-off documents: parsed models, results)."""
    key = None
    if remember:
        text = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
        key = (name, hashlib.sha256(text.encode("utf-8")).hexdigest())
        with _VALID_LOCK:
            if key in _VALID:
                _VALID.move_to_end(key)
                return
    try:
        _validator(name).validate(doc)
    except jsonschema.ValidationError as exc:
        path = "/".join(map(str, exc.absolute_path))
        raise ValueError(f"{name}: invalid at '{path}': {exc.message[:300]}") from exc
    if key:
        with _VALID_LOCK:
            _VALID[key] = None
            while len(_VALID) > _VALID_MAX:
                _VALID.popitem(last=False)


def _copy_in(storage: Storage, key: str, target: Path) -> None:
    with storage.open(key) as src, target.open("wb") as dst:
        shutil.copyfileobj(src, dst)


def _parse(job, storage, prefix, progress):
    filename = job["fileName"]
    suffix = Path(filename).suffix.lower()
    if suffix not in {".ifc", ".ifczip"}:
        raise JobError("not_ifc", "Expected an IFC or IFCZIP file")
    limit = int(os.environ.get("ENGINE_MAX_MODEL_MB", "1024")) * (1 << 20)
    with TemporaryDirectory() as directory:
        path = Path(directory)
        source = path / ("model" + suffix)
        progress("download", 0, "Downloading model")
        size = 0
        with storage.open(job["sourceKey"]) as src, source.open("wb") as dst:
            while chunk := src.read(1 << 20):
                size += len(chunk)
                if size > limit:
                    raise JobError("too_large", "The model exceeds the worker upload limit")
                dst.write(chunk)

        if suffix == ".ifczip":
            try:
                with zipfile.ZipFile(source) as archive:
                    entries = [entry for entry in archive.infolist() if not entry.is_dir()]
                    if len(entries) != 1 or Path(entries[0].filename).suffix.lower() != ".ifc":
                        raise JobError("not_ifc", "Expected one IFC file in the archive")
                    if entries[0].file_size > limit:
                        raise JobError("too_large", "The expanded model exceeds the worker upload limit")
                    ifc = path / "model.ifc"
                    with archive.open(entries[0]) as src, ifc.open("wb") as dst:
                        shutil.copyfileobj(src, dst)
            except (zipfile.BadZipFile, RuntimeError) as exc:
                raise JobError("corrupt_file", "Could not read IFCZIP") from exc
        else:
            ifc = source
        with ifc.open("rb") as stream:
            if not stream.read(4096).lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"ISO-10303-21;"):
                raise JobError("not_ifc", "Missing IFC STEP header")

        try:
            parsed, parser = parse_file(str(ifc), overlaps=job.get("options", {}).get("overlaps", True),
                                        progress=progress)
        except JobCancelled:
            raise
        except IfcFileError as exc:                   # not_ifc / truncated_file / no_project (A-32), too_complex (B-22)
            raise JobError(exc.code, str(exc)) from exc
        except Exception as exc:
            import ifcopenshell

            if isinstance(exc, ifcopenshell.SchemaError):
                raise JobError("unsupported_schema", "Unsupported IFC schema") from exc
            raise JobError("parse_error", "Could not parse IFC model") from exc

        parsed["header"]["source"].update(fileName=filename, sizeBytes=size)
        if source != ifc:
            parsed["header"]["source"]["sha256"] = sha256(source)
        validate(parsed, "parsed-model", remember=False)
        progress("write", 90, "Writing model artifacts")
        artifacts = {"parsedKey": prefix + "parsed.json.gz", "meshesKey": prefix + "meshes.npz",
                     "geometryKey": prefix + "geometry.glb", "sceneKey": prefix + "scene.json"}
        geometry, meshes = path / "geometry.glb", path / "meshes.npz"
        parser.export_glb(str(geometry))
        save_meshes(parser.meshes, meshes)
        write_json_gzip(storage, artifacts["parsedKey"], parsed)
        storage.put_file(artifacts["geometryKey"], geometry)
        storage.put_file(artifacts["meshesKey"], meshes)
        scene = service.model_scene(parsed, set(parser.meshes))
        storage.put_bytes(artifacts["sceneKey"], json.dumps(scene, ensure_ascii=False).encode("utf-8"))
        digest = parsed["header"]["source"]["sha256"]
        summary = service.model_summary(job["modelVersionId"], parsed, False)
        del summary["modelId"], summary["cached"]
        return {"summary": summary, "artifacts": artifacts, "sha256": digest}, {
            "elementCount": summary["elementCount"], "modelBytes": size,
        }


def _load_models(job, storage):
    models = []
    for model in job["models"]:
        parsed = read_json_gzip(storage, model["parsedKey"])
        if parsed["header"]["parse"].get("format") != PARSE_FORMAT:
            raise JobError("parse_format_mismatch", "Re-parse the model with the current engine")
        meshes = None
        if model.get("meshesKey"):
            with TemporaryDirectory() as directory:
                path = Path(directory) / "meshes.npz"
                _copy_in(storage, model["meshesKey"], path)
                meshes = load_meshes(path)
        models.append({**model, "parsed": parsed, "meshes": meshes})
    if not models:
        raise JobError("invalid_input", "At least one model is required")
    return models


def _run(job, storage, prefix, progress):
    output, _ = _run_result(job, storage, prefix, progress)
    return output, {}


def _run_result(job, storage, prefix, progress, *, check_result=True, models=None):
    """A run's output and its result. A preview passes the models it already loaded (get_boq leaves them
    as they are) and skips the result's schema check (TF-134)."""
    progress("load", 0, "Loading models and presets")
    rules = job["ruleSet"]
    validate(rules["doc"], "rule-set")
    for doc in rules.get("library", []):
        validate(doc, "rule-set")
    flat = presets.flattened(rules["doc"], rules.get("library"), include_local=False)
    if flat is None:
        raise JobError("invalid_input", "Could not flatten the rule set")
    unit_system = job.get("unitSystem", "metric")
    if unit_system not in {"metric", "imperial"}:
        raise JobError("invalid_input", "Invalid unit system")
    flat = {**flat, "meta": {**flat.get("meta", {}), "unitSystem": unit_system}}
    dictionaries = job.get("dictionaries", [])
    classifications = [(item["codeList"], item["map"]) for item in job.get("classifications", [])]
    for doc in dictionaries:
        validate(doc, "dictionary")
    for codes, mapping in classifications:
        validate(codes, "codelist")
        validate(mapping, "classification-map")
    for field in ("resolution", "federation"):
        if field in job:
            validate(job[field], field + "-settings")
    decisions = job.get("decisions", [])
    for doc in decisions:
        validate(doc, "decision")
    manual_items = job.get("manualItems", [])
    for doc in manual_items:
        validate(doc, "manual-item")

    for model in job["models"]:
        if problems := presets.scope_problems(model.get("scope") or {}):
            raise JobError("invalid_input", f"The scope of model {model.get('name') or model.get('id')}: {problems[0]}")
    if models is None:
        models = _load_models(job, storage)
    try:
        result = get_boq(models, flat, classifications, dictionaries, job.get("resolution"), decisions,
                         federation=job.get("federation"), progress=progress, manual_items=manual_items)
    except InvariantError as exc:            # review B-01: the result can't be stored; running again gives the same
        raise JobError("result_invalid", f"The engine's result breaks its own rules: {exc}") from exc
    if check_result:
        # A preview's results are read only by its own report, never ingested as a run: their schema check
        # (~0.3 s each on the Duplex, two per preview) is left to runs and the engine tests (TF-134).
        validate(result, "boq-result", remember=False)
    progress("export", 95, "Writing BoQ artifacts")
    output = {
        "resultKey": prefix + "result.json.gz", "status": result["status"], "stats": result["stats"],
        "engineVersion": __version__,
        "counts": {"lines": len(result["lines"]), "questions": len(result["questions"]),
                   "blockingQuestions": sum(q["blocking"] for q in result["questions"]),
                   "warnings": len(result["warnings"])},
    }
    config = job.get("export", {})
    if config.get("xlsx"):
        meta = {
            "modelName": " + ".join(m["parsed"]["header"]["source"]["fileName"] for m in models),
            "dictionaries": [f"{d['name']} ({d['layer']})" for d in dictionaries],
            "classifications": [{"id": code["id"], "name": code["name"]} for code, _ in classifications],
            "decisions": decisions,
            **config.get("meta", {}),
        }
        output["xlsxKey"] = prefix + "boq.xlsx"
        storage.put_bytes(output["xlsxKey"], export(result, meta))
    write_json_gzip(storage, output["resultKey"], result)
    return output, result


def _preview(job, storage, prefix, progress):
    compare = job.get("compareWith")
    request = {**job, "export": {}}
    if compare is None:
        output, after = _run_result(request, storage, prefix, progress, check_result=False)
        result = {"resultKey": output["resultKey"]}
        if job.get("previewReport"):
            result.update(_preview_report(storage, prefix, after))
        return result, {}
    if not isinstance(compare, dict):
        raise JobError("invalid_input", "Invalid comparison preset")
    if "schemaVersion" in compare:
        compare = {"ruleSet": {"doc": compare, "library": request["ruleSet"].get("library", [])}}
    elif "doc" in compare:
        compare = {"ruleSet": compare}
    if not compare.keys() <= {"ruleSet", "classifications", "dictionaries"}:
        raise JobError("invalid_input", "Only presets can change in a preview comparison")

    # Both runs share one load of the models, and the comparison uses the results in memory (TF-134).
    models = _load_models(request, storage)
    output, after = _run_result(request, storage, prefix, lambda stage, pct, message: progress(stage, pct // 2, message),
                                check_result=False, models=models)
    other, before = _run_result({**request, **compare}, storage, prefix + "compare/",
                                lambda stage, pct, message: progress(stage, 50 + pct // 2, message),
                                check_result=False, models=models)
    progress("compare", 99, "Comparing preview lines")
    key = prefix + "diff.json.gz"
    changes = compare_lines(before, after)
    write_json_gzip(storage, key, {"changes": changes})
    result = {"resultKey": output["resultKey"], "compareResultKey": other["resultKey"], "diffKey": key}
    if metadata := job.get("previewReport"):
        result.update(_preview_report(storage, prefix, after, metadata.get("compare"), changes))
    return result, {}


def _preview_report(storage, prefix, result, comparison=None, changes=()):
    comparison = ({**comparison, **{kind: sum(change["change"] == kind for change in changes)
                                   for kind in ("added", "removed", "changed")}} if comparison else None)
    report = {"lines": [sample(line) for line in result["lines"]], "questions": len(result["questions"]),
              "blockingQuestions": sum(q["blocking"] for q in result["questions"]), "warnings": len(result["warnings"]),
              "compare": comparison, "changes": list(changes)}
    key = prefix + "preview.json"
    storage.put_bytes(key, json.dumps(report, ensure_ascii=False).encode("utf-8"))
    return {"previewKey": key, "lineCount": len(report["lines"]), "compare": comparison}


def _diff(job, storage, prefix, progress):
    progress("load", 10, "Loading runs")
    before = read_json_gzip(storage, job["fromResultKey"])
    after = read_json_gzip(storage, job["toResultKey"])
    first, second = job.get("fromModels", []), job.get("toModels", [])

    def models(side, other):
        versions = {model["modelId"]: model["versionId"] for model in other}
        return [{**model, "parsed": read_json_gzip(storage, model["parsedKey"])
                 if model["versionId"] != versions.get(model["modelId"]) else None}
                for model in side]

    progress("diff", 55, "Comparing lines and elements")
    result = compare(before, after, models(first, second), models(second, first),
                     inputs_changed=job.get("inputsChanged", []),
                     from_decisions=job.get("fromDecisions", []), to_decisions=job.get("toDecisions", []))
    validate(result, "run-diff", remember=False)
    key = prefix + "diff.json.gz"
    progress("write", 90, "Writing change report")
    write_json_gzip(storage, key, result)
    return {"diffKey": key, "summary": result["summary"]}, {}


def _export_xlsx(job, storage, prefix, progress):
    progress("export", 25, "Rendering workbook")
    meta = job.get("meta", {})
    if diff_key := job.get("diffKey"):
        data = read_json_gzip(storage, diff_key)
        validate(data, "run-diff", remember=False)
        contents = diff_export.render(data, meta)
    else:
        data = read_json_gzip(storage, job["resultKey"])
        if meta.get("publicShare"):
            data = _public_workbook_result(data, meta.get("publicLog", False))
        contents = export(data, meta)
    key = prefix + "export.xlsx"
    storage.put_bytes(key, contents)
    return {"xlsxKey": key, "sizeBytes": len(contents)}, {}


def _public_workbook_result(result, include_log):
    lines = [line for line in result["lines"] if not line.get("excluded")]
    for line in lines:
        line.pop("notes", None)
        line.pop("overridden", None)
        for step in line["trace"].get("steps", []):
            for name in ("by", "reason", "note"):
                step.get("params", {}).pop(name, None)
        for element in line["trace"]["elements"]:
            element.pop("note", None)
    result.update(lines=lines, checks=[], warnings=[], questions=[], log=[
        entry for entry in result["log"]
        if include_log and entry["stage"] in {"rule", "quantity", "deduction"}
    ])
    return result


def _group_codes(job):
    """The grouping code list's codes for the workbook's own grouping (`groupBy`), else the default one's."""
    by_system = job.get("groupCodesBySystem") or {}
    return by_system.get(job.get("groupBy"), job.get("groupCodes"))


def _import_boq_edits(job, storage, prefix, progress):
    progress("import", 25, "Reading workbook edits")
    with storage.open(job["fileKey"]) as stream:
        maximum = 32 << 20
        workbook = stream.read(maximum + 1)
    if len(workbook) > maximum:
        raise JobError("file_too_large", "The edits workbook exceeds the 32 MiB import limit.")
    lines = job.get("currentLines")
    if lines is None:
        lines = read_json_gzip(storage, job["resultKey"])["lines"]
    report = boq_import.read(workbook, {"boqId": str(job["boqId"]), "primary": job.get("groupBy"), "lines": lines,
                                        "codes": _group_codes(job), "numberFormat": job.get("numberFormat")})
    key = prefix + "edits.json.gz"
    write_json_gzip(storage, key, report)
    return {"reportKey": key, "counts": {field: len(values) for field, values in report.items()}}, {}


OPERATIONS = {"parse": _parse, "run": _run, "preview": _preview, "diff": _diff,
              "export_xlsx": _export_xlsx, "import_boq_edits": _import_boq_edits}


def execute(envelope: dict, storage: Storage, progress=None) -> dict:
    """Run a validated job and return its terminal event."""
    started = time.monotonic()
    result = {"jobId": envelope.get("jobId")}
    try:
        if not isinstance(envelope.get("contract"), str) or envelope["contract"].split(".")[0] != CONTRACT:
            raise JobError("contract_mismatch", "Unsupported worker contract version")
        kind = envelope["type"]
        if kind not in JOB_TYPES:
            raise JobError("invalid_input", "Unsupported job type")
        prefix = envelope["outputPrefix"].rstrip("/")
        validate_key(prefix)
        job = envelope["input"]
        callback = progress or (lambda stage, pct, message: None)
        operation = OPERATIONS[kind]
        output, metrics = operation(job, storage, prefix + "/", callback)
        result.update(status="succeeded", output=output, metrics=metrics)
    except JobCancelled:
        result.update(status="cancelled")
    except JobError as exc:
        result.update(status="failed", error={"code": exc.code, "message": str(exc), "retryable": exc.retryable})
    except (KeyError, ValueError, AttributeError, TypeError) as exc:
        result.update(status="failed", error={"code": "invalid_input", "message": str(exc), "retryable": False})
    except Exception:
        logger.exception("Engine job %s failed", result["jobId"])
        result.update(status="failed", error={"code": "engine_error", "message": "Engine job failed",
                                             "retryable": True})
    result["durationMs"] = int((time.monotonic() - started) * 1000)
    return result
