"""
plausibility.py - warnings about what an element is and how big it is (review WP-A2, A-07, A-08).

A BoQ can be "complete" and still hold an element that is not what its class says (topography or piles exported
as slabs) or a door no wall knows about. These checks never change a number and never block: they are run
warnings (`implausible`, `unhosted_opening`) shown in the sheet's warnings, the review summary and the Excel's
Questions sheet. Thresholds and name words come from the resolution settings (`plausibility`, see
packages/types/src/dictionary.ts); none of them is a measuring rule.

  slab_thickness  an IfcSlab thicker than its plan width (a pile or column exported as a slab), or thicker than
                  `maxSlabThickness` (default 1.5 m)
  slab_name       an IfcSlab whose name or type has one of `slabNameWords` as a whole word (default: pile, pad and
                  cap in several languages): an element type a slab rule should not price as a floor
  line_area       a line of floor slabs (not roof or landing slabs: a pitched roof's true area exceeds its plan)
                  with more m2 than the building's footprint x storeys
  storey_area     a storey whose floor slabs cover more than `storeySlabAreaFactor` (default 3) x the footprint
  unhosted        a door or window that fills no opening and is not part of an aggregate: no wall is reduced by
                  it (any model; the federation has its own `federation_unhosted` for hosts left to another model)
"""
from __future__ import annotations

import re
from collections import defaultdict

from .expr import fmt

MAX_SLAB_THICKNESS = 1.5          # m
STOREY_SLAB_AREA_FACTOR = 3.0
# Whole words, any case, in a slab's name or type: elements a slab rule should not price as floors. Several
# languages (the product is international, CLAUDE.md rule 10); a firm adds its own in the resolution settings.
SLAB_NAME_WORDS = (
    "pile", "piles", "pad", "pads", "cap", "caps",                # en
    "pfahl", "pfähle", "pfahlkopf", "fundamentplatte",           # de
    "pieu", "pieux", "semelle",                                  # fr
    "pilote", "pilotes", "palo", "pali", "encepado",             # es, it
    "paal", "palen", "poer",                                     # nl
    "šip", "šipovi", "naglavnica",                               # sr
)
FLOOR_SLAB_EXCLUDE = ("ROOF", "LANDING")
HOSTED = ("IfcDoor", "IfcWindow")
WALLS = ("IfcWall", "IfcWallStandardCase", "IfcCurtainWall")


def settings_of(resolution: dict | None) -> tuple[float, float, set[str]]:
    p = (resolution or {}).get("plausibility") or {}
    words = p.get("slabNameWords")
    return (float(p.get("maxSlabThickness", MAX_SLAB_THICKNESS)), float(p.get("storeySlabAreaFactor", STOREY_SLAB_AREA_FACTOR)),
            {w.lower() for w in (SLAB_NAME_WORDS if words is None else words)})


def floor_slab(e: dict) -> bool:
    return e["ifc_class"] == "IfcSlab" and (e.get("predefined_type") or "").upper() not in FLOOR_SLAB_EXCLUDE


def _words(*texts) -> set[str]:
    return {w.lower() for t in texts if t for w in re.findall(r"[^\W\d_]+", str(t))}


def element_warnings(elements: list[dict], geometry: dict[str, dict], measured: set[str], resolution: dict | None) -> list[dict]:
    """Per element type: slabs thicker than wide or than the limit, slabs named like piles, pads or caps.
    `geometry`: GlobalId -> the parser's geometry block (oriented box); `measured`: elements a rule measures."""
    max_t, _, words = settings_of(resolution)
    groups: dict[tuple, dict] = {}

    def add(check: str, e: dict, **params):
        key = (check, e["ifc_class"], e.get("type_name") or e.get("name"))
        g = groups.setdefault(key, {"check": check, "ifcClass": e["ifc_class"], "typeName": key[2], "guids": [], **params})
        g["guids"].append(e["guid"])

    for e in elements:
        if e["ifc_class"] != "IfcSlab" or e["guid"] not in measured:
            continue
        t = e.get("thickness")
        obb = (geometry.get(e["guid"]) or {}).get("obbExtents")
        width = sorted(obb, reverse=True)[1] if obb and len(obb) == 3 else None
        if t and ((width and t > width * 1.05) or t > max_t):
            add("slab_thickness", e, thickness=round(t, 3), width=round(width, 3) if width else None, max=max_t)
        hit = sorted(_words(e.get("name"), e.get("type_name")) & words)
        if hit:
            add("slab_name", e, word=hit[0])
    out = []
    for g in groups.values():
        n = len(g["guids"])
        if g["check"] == "slab_thickness":
            why = (f"{fmt(g['thickness'])} m thick but {fmt(g['width'])} m wide" if g.get("width") and g["thickness"] > g["width"]
                   else f"{fmt(g['thickness'])} m thick, more than {fmt(g['max'])} m")
            msg = f"{n} x {g['ifcClass']} '{g['typeName']}': {why}. Is it a slab? Check the class before pricing it as one."
        else:
            msg = f"{n} x {g['ifcClass']} '{g['typeName']}': the name says '{g['word']}'. Is it a slab? Check the class before pricing it as one."
        params = {k: v for k, v in g.items() if k != "guids"}
        out.append({"code": "implausible", "message": msg, "guids": g["guids"], "params": {**params, "count": n}})
    return out


def line_warnings(lines: list[dict], elements: list[dict], building: dict, resolution: dict | None) -> list[dict]:
    """Lines of floor slabs larger than footprint x storeys; storeys whose floor slabs exceed factor x footprint."""
    _, factor, _ = settings_of(resolution)
    by_guid = {e["guid"]: e for e in elements}
    footprint, storeys = building.get("footprint_area"), building.get("storeys")
    out = []
    if footprint and storeys:
        limit = footprint * storeys
        for l in lines:
            els = [by_guid.get(x["guid"]) for x in l["trace"]["elements"]]
            # 1 % margin: a derived footprint is the largest storey's slab area, so slabs = footprint x storeys
            # is the normal case for one storey, and the line is rounded while the limit is not (S10)
            if (l.get("unit") == "m2" and l.get("quantity") and l["quantity"] > limit * 1.01 and els
                    and all(e and floor_slab(e) for e in els)):
                out.append({"code": "implausible", "guids": [e["guid"] for e in els],
                            "message": f"'{l['description']}': {fmt(round(l['quantity'], 2))} m2, more than the building's "
                                       f"footprint x storeys ({fmt(round(limit, 2))} m2).",
                            "params": {"check": "line_area", "description": l["description"], "area": l["quantity"],
                                       "limit": round(limit, 3), "lineKey": l["key"]}})
    if footprint:
        plan: dict[str, list] = defaultdict(list)
        for e in elements:
            if floor_slab(e) and e.get("storey") is not None and (e.get("footprint_area") or e.get("net_area")):
                plan[e["storey"]].append(e)
        for storey, els in sorted(plan.items()):
            area = sum(e.get("footprint_area") or e.get("net_area") for e in els)
            if area > factor * footprint:
                out.append({"code": "implausible", "guids": [e["guid"] for e in els],
                            "message": f"Storey '{storey}': {fmt(round(area, 2))} m2 of floor slabs, more than {fmt(factor)} x "
                                       f"the footprint ({fmt(round(footprint, 2))} m2).",
                            "params": {"check": "storey_area", "storey": storey, "area": round(area, 3), "factor": factor,
                                       "footprint": round(footprint, 3)}})
    return out

def _gap(a: tuple, b: tuple) -> float:
    """Distance between two boxes (0 when they touch or overlap)."""
    return sum(max(0.0, max(a[0][i], b[0][i]) - min(a[1][i], b[1][i])) ** 2 for i in range(3)) ** 0.5


def unhosted_warnings(elements: list[dict], boxes: dict[str, tuple]) -> list[dict]:
    """A door or window that fills no opening and is not part of an aggregate (a curtain wall's doors are): no wall
    is reduced by it. Names the nearest wall by bounding box (A-08)."""
    walls = [e for e in elements if e["ifc_class"] in WALLS and e["guid"] in boxes]
    out = []
    for d in elements:
        if d["ifc_class"] not in HOSTED or d.get("host_guid") or d.get("parent_guid") or d["guid"] not in boxes:
            continue
        near = min(walls, key=lambda w: _gap(boxes[d["guid"]], boxes[w["guid"]]), default=None)
        wall = (near.get("name") or near["guid"]) if near else None
        msg = (f"{d['ifc_class']} '{d.get('name') or d['guid']}' fills no opening: no wall is reduced by it"
               + (f" (nearest wall: '{wall}')." if wall else "."))
        out.append({"code": "unhosted_opening", "message": msg, "guids": [d["guid"]] + ([near["guid"]] if near else []),
                    "params": {"ifcClass": d["ifc_class"], "name": d.get("name") or d["guid"], "wall": wall}})
    return out
