"""Execute the engine job contract independently of its transport."""
from __future__ import annotations

import json
import logging
import os
import shutil
import time
import zipfile
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory

import jsonschema

from . import __version__, presets, service
from .export_xlsx import export
from .geometry import load_meshes, save_meshes
from .parse import PARSE_FORMAT, parse_file, sha256
from .pipeline import get_boq
from .storage import Storage, read_json_gzip, validate_key, write_json_gzip

CONTRACT = "1"
JOB_TYPES = {"parse", "run"}
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


def validate(doc, name: str):
    try:
        _validator(name).validate(doc)
    except jsonschema.ValidationError as exc:
        path = "/".join(map(str, exc.absolute_path))
        raise ValueError(f"{name}: invalid at '{path}': {exc.message[:300]}") from exc


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
                    raise JobError("model_too_large", "The model exceeds the worker upload limit")
                dst.write(chunk)

        if suffix == ".ifczip":
            try:
                with zipfile.ZipFile(source) as archive:
                    entries = [entry for entry in archive.infolist() if not entry.is_dir()]
                    if len(entries) != 1 or Path(entries[0].filename).suffix.lower() != ".ifc":
                        raise JobError("not_ifc", "Expected one IFC file in the archive")
                    if entries[0].file_size > limit:
                        raise JobError("model_too_large", "The expanded model exceeds the worker upload limit")
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
        except Exception as exc:
            import ifcopenshell

            if isinstance(exc, ifcopenshell.SchemaError):
                raise JobError("unsupported_schema", "Unsupported IFC schema") from exc
            raise JobError("parse_error", "Could not parse IFC model") from exc

        parsed["header"]["source"].update(fileName=filename, sizeBytes=size)
        if source != ifc:
            parsed["header"]["source"]["sha256"] = sha256(source)
        validate(parsed, "parsed-model")
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


def _run(job, storage, prefix, progress):
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
    result = get_boq(models, flat, classifications, dictionaries, job.get("resolution"), decisions,
                     federation=job.get("federation"), progress=progress)
    validate(result, "boq-result")
    progress("export", 95, "Writing BoQ artifacts")
    output = {
        "resultKey": prefix + "result.json.gz", "status": result["status"], "stats": result["stats"],
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
    return output, {}


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
        operation = _parse if kind == "parse" else _run
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
