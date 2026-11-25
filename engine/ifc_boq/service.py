"""
service.py - preset ids -> get_boq, and the model summary and scene index the worker writes. Shared by the worker, the CLI and the corpus run.
"""
from __future__ import annotations

from datetime import datetime

from . import presets
from .pipeline import get_boq


def model_scene(parsed: dict, mesh_ids: set[str]) -> dict:
    """What the 3D viewer needs to connect geometry.glb to BoQ lines (SceneIndex in api.ts).

    `parts` are the mesh nodes that draw an element: itself, or for aggregates without their own
    body (a roof, a stair) the meshes of their parts, recursively."""
    els = {e["id"]: e for e in parsed["elements"]}
    storeys = {s["id"]: s.get("name") for s in parsed["spatial"] if s["kind"] == "storey"}

    def parts(eid: str, depth: int = 0) -> list[str]:
        if eid in mesh_ids:
            return [eid]
        if depth > 10:
            return []
        return [p for c in els.get(eid, {}).get("childIds", []) for p in parts(c, depth + 1)]

    return {
        "elements": {i: {k: v for k, v in {
            "ifcClass": e["ifcClassBase"], "name": e.get("name"), "type": e.get("objectType"),
            "storey": storeys.get(e.get("storeyId")), "parent": e.get("parentId"), "parts": parts(i),
        }.items() if v not in (None, [])} for i, e in els.items()},
        "spaces": [s["id"] for s in parsed["spatial"] if s["kind"] == "space" and s["id"] in mesh_ids],
        "openings": [o["id"] for o in parsed.get("openings", []) if o["id"] in mesh_ids],
    }


CHECK_DETAILS_PER_CODE = 200  # keeps the stored summary small on big models; `checks` keeps the whole count


def check_details(checks: list[dict]) -> list[dict]:
    """The checks with their elements, for the input-check report's "Show in 3D" (F03-AC5), without `data`."""
    taken: dict[str, int] = {}
    details = []
    for check in checks:
        taken[check["code"]] = taken.get(check["code"], 0) + 1
        if taken[check["code"]] <= CHECK_DETAILS_PER_CODE:
            details.append({k: check[k] for k in ("id", "code", "severity", "elementIds", "message")})
    return details


def model_summary(model_id: str, parsed: dict, cached: bool) -> dict:
    h, st = parsed["header"], parsed["stats"]
    return {
        "modelId": model_id, "fileName": h["source"]["fileName"], "sizeBytes": h["source"]["sizeBytes"],
        "ifcSchema": h["ifcSchema"], "authoringApp": (h.get("authoringApp") or {}).get("fullName"),
        "disciplineGuess": h.get("disciplineGuess"),
        # Name and elevation are optional in IFC and in the contract (absent, never null: api.ts).
        "storeys": sorted(({k: v for k, v in (("name", s.get("name")), ("elevation", s.get("elevation"))) if v is not None}
                           for s in parsed["spatial"] if s["kind"] == "storey"),
                          key=lambda s: s.get("elevation") or 0),
        "elementCount": st["elementCount"], "openingCount": st["openingCount"], "spaceCount": st["spaceCount"],
        "byClass": st["byClass"], "checks": parsed["verification"]["summary"],
        "checkDetails": check_details(parsed["verification"]["checks"]), "parseMs": h["parse"]["durationMs"],
        "cached": cached,
    }


def run(models, request: dict) -> tuple[dict, dict]:
    """models: one ParsedModel, or [{"id", "parsed", "meshes"?, "discipline"?, "scope"?}] (federation).
    request = RunRequest (preset ids). Returns (BoqResult, export meta)."""
    rule_set, lib = presets.load_rule_set(request.get("ruleSet") or presets.DEFAULTS["ruleSet"])
    dicts = [presets.load_dictionary(d) for d in (request.get("dictionaries") or presets.DEFAULTS["dictionaries"])]
    systems = [presets.load_classification(c) for c in (request.get("classifications") or [])]
    result = get_boq(models, rule_set, systems, dicts, presets.resolution(), request.get("decisions") or [], lib,
                     federation=presets.federation(), manual_items=request.get("manualItems"))
    parsed_list = [models] if isinstance(models, dict) else [m["parsed"] for m in models]
    meta = {
        "modelName": " + ".join(p["header"]["source"]["fileName"] for p in parsed_list),
        "modelId": ", ".join(p["header"]["source"]["sha256"] for p in parsed_list),
        "dictionaries": [f"{d['name']} ({d['layer']})" for d in dicts],
        "classifications": [{"id": cl["id"], "name": cl["name"]} for cl, _ in systems],
        "decisions": request.get("decisions") or [],
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
    }
    return result, meta


