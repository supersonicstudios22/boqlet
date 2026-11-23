"""
measure.py - ParsedModel + dictionaries -> MeasuredElement[]  (packages/types/src/measured.ts)

This is where the engine decides WHICH number to trust for each element. It never
looks at rules. Rules only consume what is measured here.

Adoption policy (v0, constants below; documented in docs/architecture/engine.md):
  volume      reported (IFC BaseQuantities, then authoring-tool sets, see
              data/quantity_sources.json) when present, else geometry. If both exist and
              differ beyond TOLERANCE the reported value is still used (it is usually
              join-aware, see the Duplex party wall) and a warning is logged.
              Geometry volume is used only from a closed mesh (watertight, or closed with
              T-junctions, see parse.closed_surface).
  unit errors a stated volume, area or length within UNIT_SCALE_TOL of 10^±3 / 10^±6 times
              a closed mesh's value is an exporter unit error (D71): the geometry is used, the
              contradiction question recommends it, `unit_scale` records the factor.
  thickness   material layer set total, else reported, else smallest extent of the
              oriented bounding box (world axes would give a rotated wall's diagonal).
  contradictions  reported volume vs a closed mesh, a reported area vs a clear plate's sides, or a
              layer-set / reported thickness vs the geometry (volume over the mean side area),
              differing by more than contradictionWarnPct (resolution settings, default 10 %): a
              `contradiction` question asks, per class and type, which to use; above
              contradictionBlockPct (default 50 %) it blocks, unless a unit error (D73). Unanswered,
              the reported value is kept, except where it is implausible (outside 0.5-2x a closed
              mesh, D73) and for a horizontal plate's stated Width quantity (D72): there the geometry
              is used. A net area larger than its set's gross area is never read.
  wall area   net_volume / thickness  (keeps area, volume and layers consistent;
              authoring-tool "Area" is often inconsistent), else reported area.
  other area  reported area, else net_volume / thickness (never from a reported volume the
              geometry contradicts: then a clear plate's mean side area), else (open surface
              models such as road markings) the one-sided mesh area.
  gross       net + area of the openings hosted by the element.
  length      reported, else the oriented box: columns and piles along the most vertical
              axis, other linear elements the longest extent (sloped and rotated members),
              others the longest horizontal extent.
  aggregates  an element without its own body (a roof made of slabs) takes the sum of
              its parts' adopted volume and planar area.
  class       IFC2x3 generic distribution occurrences take the class their type names
              (IfcFlowSegment + IfcDuctSegmentType -> IfcDuctSegment).
  family      the nearest listed class up the schema's supertypes (families.ts).
  discipline  "mep" for distribution elements, else the model's discipline guess.
  height      door/window OverallHeight, else reported, else vertical geometry extent.
  faces       real sides from geometry with the rooms lying on them (side_faces), else
              side a and b (walls) / top and bottom (slabs) each = main area.
  embedded    linear elements (columns, beams, members) sharing solid volume with a planar
              element (parse's overlap check): volume, and volume / thickness as area.
  layers      one per material layer: area = main net area, volume = area x thickness.
  steel mass  nominal kg/m parsed from the profile name (metric W shapes), see
              nominal_mass_per_length(); otherwise rules use volume x density.
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
from collections import defaultdict
from functools import lru_cache

import ifcopenshell.ifcopenshell_wrapper as ifc_schema

from .expr import fmt
from .geometry import CONTACT_TOL
from .log import CalcLog
from .names import Resolver

HERE = os.path.dirname(os.path.abspath(__file__))
FAMILIES = json.load(open(os.path.join(HERE, "data", "families.json"), encoding="utf-8"))["IFC_FAMILIES"]
SOURCES = json.load(open(os.path.join(HERE, "data", "quantity_sources.json"), encoding="utf-8"))
TOLERANCE = 0.01
CONTRADICTION = 0.10     # default contradictionWarnPct: reported vs geometry beyond this (and THICKNESS_MIN): ask
CONTRADICTION_BLOCK = 0.50   # default contradictionBlockPct: beyond this the question blocks (unless a unit error)
THICKNESS_MIN = 0.005    # m
# a stated value this many times the closed mesh's (within UNIT_SCALE_TOL) is an exporter unit error
# (mm3 or litres written as m3, mm2 as m2, mm as m): the geometry is used (DEC-31)
UNIT_SCALES = (1e3, 1e-3, 1e6, 1e-6)
UNIT_SCALE_TOL = 0.02
QUANTITY_UNIT = {"volume": "m3", "area": "m2", "length": "m", "thickness": "m"}
PLANAR_VERTICAL = ("IfcWall", "IfcCurtainWall", "IfcPlate")
LINEAR_VERTICAL = ("IfcColumn", "IfcPile")
PHASE_MAP = {"new construction": "new", "new": "new", "existing": "existing"}
# IFC Pset_<Element>Common.Status (PEnum_ElementStatus); other values (OTHER, NOTKNOWN, UNSET) count as new
STATUS_MAP = {"NEW": "new", "EXISTING": "existing", "DEMOLISH": "demolish", "TEMPORARY": "temporary"}
ROOM_COLUMNS = ("IfcColumn",)   # standing in a room they take floor and ceiling area (beams do not)
# IFC2x3 distribution occurrences are generic; the specific class is on the type (IfcDuctSegmentType)
GENERIC_2X3 = {"IfcFlowSegment", "IfcFlowFitting", "IfcFlowTerminal", "IfcFlowController", "IfcFlowMovingDevice",
               "IfcFlowStorageDevice", "IfcFlowTreatmentDevice", "IfcEnergyConversionDevice",
               "IfcDistributionControlElement", "IfcDistributionFlowElement", "IfcDistributionElement"}


@lru_cache(maxsize=None)
def ancestry(cls: str, schema: str = "IFC4X3_ADD2") -> tuple[str, ...]:
    """cls and its supertypes, nearest first. Looks in the model's schema, then IFC4.3
    (an IFC2x3 type can name an IFC4 class). Just (cls,) if no schema knows it."""
    for name in (schema, {"IFC4X3": "IFC4X3_ADD2"}.get(schema), "IFC4X3_ADD2"):
        if not name:
            continue
        try:
            d = ifc_schema.schema_by_name(name).declaration_by_name(cls)
        except Exception:
            continue
        out = []
        while d is not None:
            out.append(d.name())
            d = d.supertype()
        return tuple(out)
    return (cls,)


def family_of(cls: str, schema: str = "IFC4X3_ADD2") -> str:
    return next((FAMILIES[c] for c in ancestry(cls, schema) if c in FAMILIES), "countable")


def nominal_mass_per_length(profile: str | None) -> float | None:
    """kg/m from a section designation, where the designation itself states it.
    Metric W shapes (W310X60 = 60 kg/m). Other families (IPE, HEA, ...) need a
    section table, which is not bundled; rules fall back to volume x density."""
    if not profile:
        return None
    m = re.match(r"^\s*W\s?\d+\s?[xX×]\s?(\d+(?:\.\d+)?)\s*$", profile)
    return float(m.group(1)) if m else None


# The sources' set-name patterns, compiled once: fnmatch.fnmatch per set and pattern was most of a
# Duplex run (~0.4 s of 0.6, TF-134). Case-sensitive, as fnmatch is on Linux where the engine runs.
_SOURCE_PATTERNS = {kind: [(re.compile(fnmatch.translate(set_glob)).match, prop) for set_glob, prop in sources]
                    for kind, sources in SOURCES.items() if isinstance(sources, list)}


def _number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0


def find_reported(el: dict, kind: str, skipped: list | None = None):
    """First reported value for a quantity kind: (value, "Set.Prop") or (None, None).
    A net value larger than the gross one of the same set (NetArea > GrossArea, NetSideArea >
    GrossSideArea) is impossible by definition and skipped; Revit 2021 IFC4 writes the whole surface
    as Qto_SlabBaseQuantities.NetArea (QS-003). Areas only: for volumes it is not known which one is wrong
    (S08's GrossVolume is the x1000 one). `skipped` collects (source, net, gross) of those."""
    for matches, prop in _SOURCE_PATTERNS.get(kind, []):
        for bucket in (el["quantities"]["reported"], el["psets"]):
            for set_name, props in bucket.items():
                if matches(set_name):
                    v = props.get(prop)
                    if _number(v):
                        gross = props.get("Gross" + prop[3:]) if kind == "area" and prop.startswith("Net") else None
                        if _number(gross) and v > gross * (1 + TOLERANCE):
                            if skipped is not None:
                                skipped.append((f"{set_name}.{prop}", float(v), float(gross)))
                            continue
                        return float(v), f"{set_name}.{prop}"
    return None, None


def common_pset(el: dict) -> dict:
    for name, props in el["psets"].items():
        if name.startswith("Pset_") and name.endswith("Common"):
            return props
    for name, props in el.get("typePsets", {}).items():
        if name.startswith("Pset_") and name.endswith("Common"):
            return props
    return {}


def contradiction_id(what: str, cls: str, type_name: str | None) -> str:
    return f"contradiction:{what}:{cls}:{type_name or ''}"


def unit_scale(stated: float | None, measured: float | None) -> float | None:
    """The factor (stated / measured) when it is within UNIT_SCALE_TOL of 10^±3 or 10^±6: an exporter
    unit error, not a modelling difference. None otherwise."""
    if not stated or not measured or stated <= 0 or measured <= 0:
        return None
    r = stated / measured
    return next((f for f in UNIT_SCALES if abs(r / f - 1) <= UNIT_SCALE_TOL), None)


def contradiction_thresholds(settings: dict | None) -> tuple[float, float]:
    """(warn, block) as fractions from the resolution settings (percentages; defaults 10 and 50). The block
    threshold is never below the warn threshold."""
    settings = settings or {}
    warn = float(settings.get("contradictionWarnPct", CONTRADICTION * 100)) / 100
    block = float(settings.get("contradictionBlockPct", CONTRADICTION_BLOCK * 100)) / 100
    return warn, max(block, warn)


def implausible(stated: float, measured: float) -> bool:
    """A stated value outside 0.5-2x the closed mesh's: the geometry is the likelier one (DEC-31)."""
    return not 0.5 <= stated / measured <= 2.0


def scale_label(factor: float) -> str:
    """1000 -> "1000", 0.001 -> "1/1000"."""
    return f"{factor:.0f}" if factor >= 1 else f"1/{1 / factor:.0f}"


def _unit_error(log: CalcLog, el: dict, what: str, stated: float, measured: float, factor: float, source) -> str:
    """Log a stated value taken as a unit error; returns the note for the element."""
    name = el.get("name") or el["id"]
    unit = QUANTITY_UNIT[what]
    note = (f"stated {what} {fmt(round(stated, 3))} {unit} ({source}) looks like a unit error "
            f"(x{scale_label(factor)} the geometry): geometry {fmt(round(measured, 4))} {unit} used")
    log.detail("measure", f"{name}: {note}", guid=el["id"], code="log.measure.unit_scale",
               params=dict(name=name, quantity=what, stated=stated, geometry=measured, scale=scale_label(factor),
                           source=source, unit=unit))
    return note


def opening_kind(o: dict) -> str:
    """door / window by filling; recess when marked so (IFC4 RECESS, IFC2x3 ObjectType "Recess"); else void."""
    kind = {"IfcDoor": "door", "IfcWindow": "window"}.get(o.get("fillingClass") or "")
    if kind:
        return kind
    if str(o.get("predefinedType") or "").upper() == "RECESS" or "recess" in str(o.get("objectType") or "").lower():
        return "recess"
    return "void"


def opening_record(o: dict, depth: float | None = None) -> dict:
    """Parsed opening -> MeasuredElement opening."""
    kind = opening_kind(o)
    w, h = o.get("width"), o.get("height")
    return {"guid": o["id"], "kind": kind, "width": w, "height": h, "area": o.get("area"),
            "depth": o.get("depth") or depth, "perimeter": 2 * ((w or 0) + (h or 0)),
            "filling_guid": o.get("fillingId"), "filling_class": o.get("fillingClass")}


def build(parsed: dict, rv: Resolver, log: CalcLog, model_id: str | None = None,
          discipline: str | None = None, answers: dict | None = None,
          questions: list | None = None, settings: dict | None = None) -> tuple[list[dict], list[dict]]:
    """Returns (MeasuredElement dicts, name resolutions for questions).
    model_id / discipline: set by federation (the run's id for this model, the user's tag);
    default to the file hash and the parser's discipline guess. `answers` to earlier
    `contradiction` questions are applied; new ones are appended to `questions`. `settings`: the
    resolution settings (contradictionWarnPct, contradictionBlockPct; defaults 10 and 50)."""
    answers = answers or {}
    asked: dict[str, dict] = {}
    warn, block = contradiction_thresholds(settings)

    def ask(*args, **kw):
        _ask(asked, *args, block=block, **kw)
    mats = {m["id"]: m["name"] for m in parsed["catalogues"]["materials"]}
    lsets = {l["id"]: l for l in parsed["catalogues"]["layerSets"]}
    types = {t["id"]: t for t in parsed["catalogues"]["types"]}
    profiles = {p["id"]: p for p in parsed["catalogues"]["profiles"]}
    classifications = {c["id"]: c for c in parsed["catalogues"]["classifications"]}
    spatial = {s["id"]: s for s in parsed["spatial"]}
    openings_by_host = defaultdict(list)
    for o in parsed["openings"]:
        if o.get("hostId"):
            openings_by_host[o["hostId"]].append(o)
    spaces_of = defaultdict(set)
    for r in parsed["relationships"]:
        if r["kind"] == "space_boundary":
            spaces_of[r["elementId"]].add(r["spaceId"])
    by_id = {e["id"]: e for e in parsed["elements"]}
    model_discipline = discipline or parsed["header"].get("disciplineGuess", "unknown")
    model_id = model_id or parsed["header"]["source"]["sha256"][:12]
    schema = parsed["header"].get("ifcSchema", "IFC4")
    resolutions: list[dict] = []
    out: list[dict] = []
    rooms = {}                                   # space id -> (name, space_type)
    for sp_ in parsed["spatial"]:
        if sp_["kind"] == "space":
            raw = sp_.get("longName") or sp_.get("name")
            res = rv.resolve("space_name", raw, {"ifc_class": "IfcSpace"}) if raw else None
            if res:
                resolutions.append({**res, "ctx": {"ifc_class": "IfcSpace"}, "guid": sp_["id"]})
            rooms[sp_["id"]] = (raw, res["term"] if res else None)

    for el in parsed["elements"]:
        cls = el["ifcClassBase"]
        notes: list[str] = []
        prov: dict[str, str] = {}
        type_cls = types.get(el.get("typeId"), {}).get("ifcClass", "")
        cls_note = None
        if cls in GENERIC_2X3 and type_cls.endswith("Type") and type_cls[:-4] != cls:
            cls_note = f"class {cls} taken as {type_cls[:-4]} (from its type {type_cls})"
            cls = type_cls[:-4]
        fam = family_of(cls, schema)
        discipline = "mep" if "IfcDistributionElement" in ancestry(cls, schema) else model_discipline
        ctx = {"ifc_class": cls, "predefined_type": el.get("predefinedType"), "discipline": discipline}

        # ---------- names (dictionary) ----------
        hints: dict = {}
        for fld, raw in (("name", el.get("name")), ("object_type", el.get("objectType"))):
            for k, v in rv.extract(fld, raw, ctx).items():
                hints.setdefault(k, v["value"])
        type_name = hints.pop("type_name", None) or types.get(el.get("typeId"), {}).get("name") or el.get("objectType")
        family_name = hints.pop("family", None)
        if type_name:
            for k, v in rv.extract("type_name", type_name, ctx).items():
                hints.setdefault(k, v["value"])
        layer_res, main_raw, materials_raw = [], None, []
        ref = el.get("materialRef")
        layer_set = None
        if ref:
            if ref["kind"] == "single":
                main_raw = mats.get(ref["materialId"])
            elif ref["kind"] == "list":
                materials_raw = [mats.get(i) for i in ref["materialIds"] if mats.get(i)]
                main_raw = materials_raw[0] if materials_raw else None
            elif ref["kind"] == "layerSet":
                layer_set = lsets.get(ref["layerSetId"])
                for i, layer in enumerate((layer_set or {"layers": []})["layers"]):
                    raw = mats.get(layer.get("materialId"))
                    r = rv.resolve("layer_material", raw, ctx)
                    resolutions.append({**r, "ctx": ctx, "guid": el["id"]})
                    for k, v in rv.extract("layer_material", raw, ctx).items():
                        hints.setdefault(k, v["value"])
                    layer_res.append({"index": i, "term": r["term"], "raw": raw, "thickness": layer["thickness"]})
                solid = [l for l in layer_res if not (l["term"] and rv.under(l["term"], "air_gap"))]
                if layer_res:
                    main_raw = max(solid or layer_res, key=lambda l: l["thickness"])["raw"]
            elif ref["kind"] in ("profileSet", "constituentSet"):
                items = ref.get("items", [])
                main_raw = next((mats.get(i["materialId"]) for i in items if i.get("materialId")), None)
        mat = rv.resolve("material", main_raw, ctx) if main_raw else None
        if mat:
            resolutions.append({**mat, "ctx": ctx, "guid": el["id"]})
            for k, v in rv.extract("material", main_raw, ctx).items():
                hints.setdefault(k, v["value"])
        typ = rv.resolve("type_name", type_name, ctx) if type_name else None
        if typ:
            resolutions.append({**typ, "ctx": ctx, "guid": el["id"]})

        # ---------- geometry & reported values ----------
        g = el["quantities"]["geometry"]
        kids = [by_id[c] for c in el.get("childIds", []) if c in by_id]
        geo_vol = g.get("volume")
        if not geo_vol and kids:
            vols = [k["quantities"]["geometry"].get("volume") for k in kids]
            geo_vol = sum(v for v in vols if v) or None
        bmin, bmax = g.get("bboxMin"), g.get("bboxMax")
        if not bmin and kids:
            ks = [k["quantities"]["geometry"] for k in kids if k["quantities"]["geometry"].get("bboxMin")]
            if ks:
                bmin = [min(k["bboxMin"][i] for k in ks) for i in range(3)]
                bmax = [max(k["bboxMax"][i] for k in ks) for i in range(3)]
        ext = [bmax[i] - bmin[i] for i in range(3)] if bmin and bmax else None
        obb, obb_axes = g.get("obbExtents"), g.get("obbAxes")
        closed = g.get("closed", g.get("watertight", True))

        skipped_areas: list[tuple[str, float, float]] = []
        rep = {k: find_reported(el, k, skipped_areas if k == "area" else None)
               for k in ("volume", "area", "length", "width", "height", "thickness", "perimeter", "mass")}
        for src, net, gross in skipped_areas:
            notes.append(f"{src} {fmt(round(net, 3))} m2 is larger than the gross {fmt(round(gross, 3))} m2: impossible, not used")

        # thickness
        thickness = None
        if layer_set and layer_set.get("totalThickness"):
            thickness, prov["thickness"] = layer_set["totalThickness"], "reported"
            t_note = "material layer set"
        elif fam == "planar" and rep["thickness"][0]:
            thickness, prov["thickness"] = rep["thickness"][0], "reported"
            t_note = rep["thickness"][1]
        elif fam == "planar" and obb:
            thickness, prov["thickness"] = min(obb), "geometry"
            t_note = "smallest oriented-box extent"
        elif fam == "planar" and ext:
            thickness = min(ext[2], min(ext[0], ext[1])) if cls not in PLANAR_VERTICAL else min(ext[0], ext[1])
            prov["thickness"] = "geometry"
            t_note = "smallest geometry extent"
        else:
            t_note = None

        # a clear plate: closed, its thin axis much thinner than its width, both sides about the same
        # size (a wall stub shorter than it is thick has its "sides" at the ends). Only then are the
        # mean side area and volume / mean side area the geometry's own area and thickness.
        sides = g.get("sides")
        plate = bool(fam == "planar" and closed and g.get("volume") and sides and obb and obb[2] <= 0.5 * obb[1]
                     and min(sides["a"], sides["b"]) >= 0.7 * max(sides["a"], sides["b"]) > 0)
        side_mean = (sides["a"] + sides["b"]) / 2 if plate else None

        # a stated thickness the geometry contradicts (volume over the mean side area)
        if prov.get("thickness") == "reported" and plate:
            t_geo = g["volume"] / side_mean
            if abs(t_geo - thickness) > max(warn * thickness, THICKNESS_MIN):
                qid = contradiction_id("thickness", cls, type_name or el.get("name"))
                # a horizontal plate's stated Width (a quantity, not its layer set) is often its plan width
                # (S08 pile cap: Width 3.8 m, 1.0 m thick): its thin axis is trusted unless answered otherwise
                stated_quantity = cls not in PLANAR_VERTICAL and t_note != "material layer set"
                prefer_geometry = stated_quantity or implausible(thickness, t_geo)
                if answers.get(qid) == "geometry":
                    t_note = (f"{fmt(round(t_geo, 4))} m from geometry (volume / mean side area; answer to {qid}); "
                              f"{t_note} said {fmt(thickness)}")
                    thickness, prov["thickness"] = t_geo, "geometry"
                elif answers.get(qid) != "reported" and prefer_geometry:
                    ask(qid, "thickness", cls, type_name or el.get("name"), el["id"], thickness, t_geo, t_note,
                         used="geometry")
                    notes.append(f"thickness {fmt(thickness)} m ({t_note}) but the geometry is {fmt(round(t_geo, 3))} m thick: "
                                 f"geometry used")
                    t_note = (f"{fmt(round(t_geo, 4))} m from geometry (volume / mean side area); {t_note} said "
                              f"{fmt(thickness)}, " + ("contradicted by the thin axis" if stated_quantity else "outside 0.5-2x the geometry"))
                    thickness, prov["thickness"] = t_geo, "geometry"
                elif answers.get(qid) != "reported":
                    ask(qid, "thickness", cls, type_name or el.get("name"), el["id"], thickness, t_geo, t_note)
                    notes.append(f"thickness {fmt(thickness)} m ({t_note}) but the geometry is {fmt(round(t_geo, 3))} m thick")

        # volume
        net_volume, v_note = None, None
        volume_contradicted = False          # a reported volume kept while the geometry disagrees (question open)
        unit_scaled: dict[str, float] = {}   # field -> stated / measured, for stated values taken as unit errors
        if rep["volume"][0]:
            net_volume, prov["net_volume"] = rep["volume"][0], "reported"
            v_note = f"{fmt(net_volume)} m3 from {rep['volume'][1]}"
            if geo_vol:
                diff = (geo_vol - net_volume) / net_volume
                v_note += f"; geometry {fmt(round(geo_vol, 4))} m3 ({diff:+.1%})"
                qid = contradiction_id("volume", cls, type_name or el.get("name"))
                sure = abs(diff) > warn and g.get("hasBody") and closed is not False
                scale = unit_scale(net_volume, geo_vol) if g.get("hasBody") and closed is not False else None
                if sure and answers.get(qid) == "geometry":
                    net_volume, prov["net_volume"] = geo_vol, "geometry"
                    v_note += f"; geometry used (answer to {qid})"
                    if scale:
                        unit_scaled["net_volume"] = scale
                elif scale and answers.get(qid) != "reported":
                    stated = net_volume
                    net_volume, prov["net_volume"] = geo_vol, "geometry"
                    unit_scaled["net_volume"] = scale
                    note = _unit_error(log, el, "volume", stated, geo_vol, scale, rep["volume"][1])
                    v_note += f"; looks like a unit error (x{scale_label(scale)}): geometry used"
                    notes.append(note)
                    ask(qid, "volume", cls, type_name or el.get("name"), el["id"], stated, geo_vol,
                         rep["volume"][1], used="geometry", scale=scale)
                elif sure and answers.get(qid) != "reported" and implausible(net_volume, geo_vol):
                    stated = net_volume
                    net_volume, prov["net_volume"] = geo_vol, "geometry"
                    v_note += "; outside 0.5-2x the geometry: geometry used"
                    notes.append(f"geometry volume differs from reported by {diff:+.1%}; geometry used (implausible)")
                    ask(qid, "volume", cls, type_name or el.get("name"), el["id"], stated, geo_vol, rep["volume"][1],
                        used="geometry")
                elif abs(diff) > TOLERANCE:
                    notes.append(f"geometry volume differs from reported by {diff:+.1%}; reported used")
                    log.warn("measure", f"{el.get('name') or el['id']}: geometry volume {fmt(round(geo_vol, 3))} m3 vs reported "
                             f"{fmt(round(net_volume, 3))} m3 ({diff:+.1%}). Using reported (join-aware).", guid=el["id"],
                        code="log.measure.volume_conflict", params=dict(
                            name=el.get('name') or el['id'], geometry=geo_vol, reported=net_volume,
                            difference=diff,
                        ))
                    if sure and answers.get(qid) != "reported":
                        volume_contradicted = True
                        ask(qid, "volume", cls, type_name or el.get("name"), el["id"], net_volume, geo_vol,
                             rep["volume"][1])
        elif geo_vol and closed is not False:
            net_volume, prov["net_volume"] = geo_vol, "geometry"
            v_note = f"{fmt(round(geo_vol, 4))} m3 from geometry"
            if g.get("watertight") is False:
                v_note += " (closed mesh with T-junctions)"
        elif geo_vol:
            notes.append("mesh not closed: geometric volume unreliable, not used")

        # openings hosted by this element
        ops = [opening_record(o, thickness) for o in openings_by_host.get(el["id"], [])]
        # recesses do not go through: not in the net area; the volume they take is added back
        # when an area is derived from the volume
        open_area = sum(o["area"] or 0 for o in ops if o["kind"] != "recess")
        recess_vol = sum((o["area"] or 0) * (o["depth"] or 0) for o in ops if o["kind"] == "recess")

        # areas
        net_area = gross_area = None
        a_note = None
        if fam in ("planar", "assembly") or cls in ("IfcRoof",):
            if cls in PLANAR_VERTICAL and net_volume and thickness:
                net_area, prov["net_area"] = (net_volume + recess_vol) / thickness, "derived"
                a_note = f"net area = volume / thickness = {fmt(round(net_volume + recess_vol, 4))} / {fmt(thickness)} = {fmt(round(net_area, 3))} m2"
                if recess_vol:
                    a_note += f" (recess volume {fmt(round(recess_vol, 4))} m3 added back)"
                if rep["area"][0] and abs(rep["area"][0] - net_area) / net_area > TOLERANCE:
                    a_note += f" (reported {rep['area'][1]} = {fmt(round(rep['area'][0], 3))} ignored: inconsistent with volume)"
            elif rep["area"][0]:
                net_area, prov["net_area"] = rep["area"][0], "reported"
                a_note = f"net area {fmt(round(net_area, 3))} m2 from {rep['area'][1]}"
                # the geometry's own area: a clear plate's mean side (net of openings; a gross source
                # is compared with the side plus its openings)
                gross_source = rep["area"][1].rsplit(".", 1)[-1].startswith("Gross")
                geo_area = side_mean + (open_area if gross_source else 0.0) if side_mean else None
                qid = contradiction_id("area", cls, type_name or el.get("name"))
                scale = unit_scale(net_area, geo_area)
                if scale and answers.get(qid) != "reported":
                    stated = net_area
                    net_area, prov["net_area"] = side_mean, "geometry"
                    unit_scaled["net_area"] = scale
                    note = _unit_error(log, el, "area", stated, geo_area, scale, rep["area"][1])
                    a_note += f"; looks like a unit error (x{scale_label(scale)}): {fmt(round(net_area, 3))} m2 from geometry used"
                    notes.append(note)
                    if answers.get(qid) != "geometry":
                        ask(qid, "area", cls, type_name or el.get("name"), el["id"], stated, geo_area,
                             rep["area"][1], used="geometry", scale=scale)
                elif geo_area and abs(geo_area - net_area) > warn * net_area:
                    # reported area vs the plate's measured sides: the stated value is kept unless it is
                    # implausible (outside 0.5-2x the geometry; Revit's NetArea = whole surface is > 2x)
                    stated, diff = net_area, (geo_area - net_area) / net_area
                    a_note += f"; geometry {fmt(round(geo_area, 3))} m2 ({diff:+.1%})"
                    use_geo = answers.get(qid) == "geometry" or (answers.get(qid) != "reported" and implausible(stated, geo_area))
                    if use_geo:
                        net_area, prov["net_area"] = side_mean, "geometry"
                        a_note += f": {fmt(round(net_area, 3))} m2 from geometry used"
                    if answers.get(qid) not in ("geometry", "reported"):
                        ask(qid, "area", cls, type_name or el.get("name"), el["id"], stated, geo_area,
                             rep["area"][1], used="geometry" if use_geo else "reported")
                        notes.append(f"area {fmt(round(stated, 3))} m2 ({rep['area'][1]}) but the geometry is "
                                     f"{fmt(round(geo_area, 3))} m2" + (": geometry used" if use_geo else ""))
            elif net_volume and thickness and volume_contradicted and side_mean:
                # never derive an area from a volume the geometry contradicts: the measured sides instead
                net_area, prov["net_area"] = side_mean, "geometry"
                a_note = (f"net area {fmt(round(net_area, 3))} m2 = mean side area from geometry "
                          f"(not volume / thickness: the stated volume is contradicted)")
            elif net_volume and thickness:
                net_area, prov["net_area"] = (net_volume + recess_vol) / thickness, "derived"
                a_note = f"net area = volume / thickness = {fmt(round(net_area, 3))} m2"
            elif closed is False and "SurfaceModel" in g.get("representationTypes", []) and g.get("surfaceArea"):
                net_area, prov["net_area"] = g["surfaceArea"], "geometry"
                a_note = f"net area {fmt(round(net_area, 3))} m2 = one-sided area of the open surface model"
            if net_area is not None:
                gross_area = net_area + open_area
                prov["gross_area"] = "derived"
        gross_volume = None
        if net_volume is not None:
            gross_volume = net_volume + sum((o["area"] or 0) * (thickness or 0) for o in ops if o["kind"] != "recess") + recess_vol

        # linear dimensions
        geo_len = None
        if obb and cls in LINEAR_VERTICAL:                # along the most vertical axis (a squat pier is wider than tall)
            geo_len = max(zip(obb, obb_axes), key=lambda ea: abs(ea[1][2]))[0]
        elif obb and fam == "linear":
            geo_len = max(obb)
        elif obb and any(abs(ax[2]) < 0.5 for ax in obb_axes):
            geo_len = max(e for e, ax in zip(obb, obb_axes) if abs(ax[2]) < 0.5)
        elif ext:
            geo_len = max(ext[0], ext[1])
        length = rep["length"][0]
        if length:
            prov["length"] = "reported"
            qid = contradiction_id("length", cls, type_name or el.get("name"))
            scale = unit_scale(length, geo_len) if g.get("hasBody") and closed is not False else None
            if scale and answers.get(qid) != "reported":
                stated = length
                length, prov["length"] = geo_len, "geometry"
                unit_scaled["length"] = scale
                notes.append(_unit_error(log, el, "length", stated, geo_len, scale, rep["length"][1]))
                if answers.get(qid) != "geometry":
                    ask(qid, "length", cls, type_name or el.get("name"), el["id"], stated, geo_len,
                         rep["length"][1], used="geometry", scale=scale)
        elif geo_len is not None:
            length, prov["length"] = geo_len, "geometry"
        width = el["attributes"].get("OverallWidth") or rep["width"][0]
        height = el["attributes"].get("OverallHeight") or rep["height"][0]
        if height:
            prov["height"] = "reported"
        elif ext:
            height, prov["height"] = ext[2], "geometry"

        # perimeter: reported, else for a closed slab-like prism S = 2V/t + P*t  ->  P = (S - 2V/t) / t
        # (includes the edges of openings, which is what edge formwork needs)
        perimeter, p_note = rep["perimeter"][0], None
        if perimeter:
            prov["perimeter"] = "reported"
        elif (fam == "planar" and cls not in PLANAR_VERTICAL and closed and g.get("volume") and g.get("surfaceArea")
              and thickness and not g.get("bodyCount")):
            p = (g["surfaceArea"] - 2 * g["volume"] / thickness) / thickness
            if p > 0:
                perimeter, prov["perimeter"] = p, "geometry"
                p_note = f"perimeter = (surface {fmt(round(g['surfaceArea'], 3))} - 2 x volume / thickness) / thickness = {fmt(round(p, 3))} m"

        # profile & mass
        profile = hints.pop("profile", None)
        if not profile and el.get("profileId") in profiles:
            profile = profiles[el["profileId"]].get("name")
        nmpl = nominal_mass_per_length(profile)
        density = rv.term_prop(mat["term"] if mat else None, "density_kg_m3")

        # faces: real sides from geometry (with the rooms on them), else both = main area
        faces, f_note = [], None
        sp = sorted(spaces_of.get(el["id"], set()) | {c["spaceId"] for c in g.get("contacts", [])})
        if net_area is not None:
            labels = ("a", "b") if cls in PLANAR_VERTICAL else ("top", "bottom")
            if sides and (sides["a"] or sides["b"]):
                faces = side_faces(sides, g.get("contacts", []), labels, open_area, rooms, common_pset(el).get("IsExternal"))
                f_note = (f"faces {labels[0]} {fmt(round(sides['a'], 3))} / {labels[1]} {fmt(round(sides['b'], 3))} m2 net"
                          + (f", {len({f['space'] for f in faces if f.get('space')})} room(s) on them"
                             if any(f.get("space") for f in faces) else ""))
            else:
                for s in labels:
                    faces.append({"side": s, "gross_area": gross_area, "net_area": net_area})

        # layers
        layers = [{"index": l["index"], "material": l["term"], "material_raw": l["raw"], "thickness": l["thickness"],
                   "area": net_area, "volume": (net_area * l["thickness"]) if net_area is not None else None}
                  for l in layer_res]

        # status
        phase = (el["psets"].get("PSet_Revit_Phasing", {}) or {}).get("Phase Created")
        demolished = (el["psets"].get("PSet_Revit_Phasing", {}) or {}).get("Phase Demolished")
        if demolished and str(demolished).lower() not in ("none", ""):
            status = "demolish"
        elif phase:
            status = PHASE_MAP.get(str(phase).lower(), "new")
        else:
            status = STATUS_MAP.get(str(common_pset(el).get("Status") or "").upper(), "new")

        common = common_pset(el)
        storey = spatial.get(el.get("storeyId"), {})
        props = {}
        for bucket in (el.get("typePsets", {}), el["psets"]):
            for ps, vals in bucket.items():
                for k, v in vals.items():
                    props[f"{ps}.{k}"] = v
        ifc_codes = [classifications[c] for c in el.get("classificationIds", []) if c in classifications]

        m = {
            "guid": el["id"], "model_id": model_id, "discipline": discipline,
            "ifc_class": cls, "ifc_class_raw": el["ifcClass"], "predefined_type": el.get("predefinedType"),
            "family": fam, "name": el.get("name"), "family_name": family_name, "type_name": type_name,
            "material": mat["term"] if mat else None, "material_raw": main_raw,
            "materials": sorted({l["term"] for l in layer_res if l["term"]} | ({mat["term"]} if mat and mat["term"] else set())),
            "element_type": typ["term"] if typ else None,
            "profile": profile, "nominal_size": hints.pop("nominal_size", None),
            "strength_class": hints.pop("strength_class", None),
            "storey": storey.get("name"), "storey_elevation": storey.get("elevation"),
            "spaces": sp, "status": status,
            "is_external": common.get("IsExternal"), "load_bearing": common.get("LoadBearing"),
            "count": 1,
            "length": length, "width": width, "height": height, "thickness": thickness,
            "gross_area": gross_area, "net_area": net_area,
            "footprint_area": net_area if cls not in PLANAR_VERTICAL else None,
            "developed_area": net_area if cls not in PLANAR_VERTICAL else None,
            "faces": faces,
            "gross_volume": gross_volume, "net_volume": net_volume,
            "perimeter": perimeter, "mass": rep["mass"][0],
            "nominal_mass_per_length": nmpl, "density": density,
            "openings": ops, "layers": layers,
            "host_guid": el.get("hostId"), "parent_guid": el.get("parentId"), "child_guids": el.get("childIds", []),
            "props": props, "ifc_classifications": ifc_codes,
            "provenance": prov, "warnings": notes,
        }
        if unit_scaled:
            m["unit_scale"] = unit_scaled
        for k, v in hints.items():                       # name hints only fill gaps (geometry wins)
            if m.get(k) is None:
                m[k] = v
                prov[k] = "derived"
        out.append(m)

        bits = [cls_note or cls]
        if mat:
            bits.append(f"material '{main_raw}' -> {mat['term'] or 'UNRESOLVED'}")
        if t_note:
            bits.append(f"thickness {fmt(thickness)} m ({t_note})")
        if v_note:
            bits.append(f"volume {v_note}")
        if a_note:
            bits.append(a_note)
        if p_note:
            bits.append(p_note)
        if f_note:
            bits.append(f_note)
        if ops:
            bits.append(f"{len(ops)} opening(s) {fmt(round(open_area, 3))} m2 -> gross {fmt(round(gross_area or 0, 3))} m2")
        if nmpl:
            bits.append(f"profile {profile}: {fmt(nmpl)} kg/m")
        log.detail("measure", f"{el.get('name') or el['id']}: " + "; ".join(bits), guid=el["id"],
            code="log.measure.adopted", params=dict(name=el.get('name') or el['id'], quantities=bits))
    roll_up_parts(out, {e["id"] for e in parsed["elements"] if e["quantities"]["geometry"].get("hasBody")}, log)
    measured = {m["guid"]: m for m in out}
    for m in out:
        for x in by_id[m["guid"]]["quantities"]["geometry"].get("intersections", []):
            if x["elementId"] in measured:
                add_embedded(m, measured[x["elementId"]], x["volume"])
        if m.get("embedded"):
            log.detail("measure", f"{m.get('name') or m['guid']}: {len(m['embedded'])} element(s) pass through it, "
                                  f"{fmt(round(sum(x['volume'] for x in m['embedded']), 4))} m3 shared", guid=m["guid"],
                code="log.measure.embedded", params=dict(
                    name=m.get('name') or m['guid'], count=len(m['embedded']),
                    volume=sum(x['volume'] for x in m['embedded']),
                ))
    out += measure_rooms(parsed, rooms, out, model_id, model_discipline, log)
    if questions is not None:
        questions += list(asked.values())            # with their private fields: pipeline merges, then strips
    return out, resolutions


def _ask(asked: dict, qid: str, what: str, cls: str, type_name: str | None, guid: str, stated: float, geo: float, source,
         used: str = "reported", scale: float | None = None, block: float = 0.5):
    """One `contradiction` question per (what, class, type), collecting its elements. `used`: what this
    element takes while nobody answers ("geometry" for a unit error); `scale`: the unit-error factor."""
    q = asked.get(qid)
    diff = (geo - stated) / stated
    if q is None:
        q = asked[qid] = {"id": qid, "kind": "contradiction", "blocking": False, "guids": [], "occurrences": 0,
                          "_range": [diff, diff], "_example": (stated, geo, source), "_what": what, "_cls": cls,
                          "_type": type_name, "_used": set(), "_scale": None}
    q["guids"].append(guid)
    q["occurrences"] += 1
    q["_range"] = [min(q["_range"][0], diff), max(q["_range"][1], diff)]
    q["_used"].add(used)
    q["_scale"] = q["_scale"] or scale
    # a difference above the block threshold blocks (DEC-31), unless it is explained as a unit error
    if scale is None and abs(diff) > block + 1e-9:
        q["blocking"] = True
    render_contradiction(q)


def render_contradiction(q: dict) -> None:
    """Suggestion, options, params and the English message of a contradiction question from what its
    elements collected. The suggestion is what the engine uses while nobody answers: the geometry as
    soon as one of its elements takes the geometry (a unit error), else the stated value."""
    what, cls, type_name = q["_what"], q["_cls"], q["_type"]
    lo, hi = q["_range"]
    unit = QUANTITY_UNIT[what]
    st, ge, src = q["_example"]
    used = "geometry" if "geometry" in q["_used"] else "reported"
    scale = q["_scale"]
    q["suggestion"] = used
    q["answer"] = {"kind": "choice", "options": [
        {"value": "reported", "label": f"Use the {what} stated in the file", "recommended": used == "reported"},
        {"value": "geometry", "label": f"Use the {what} measured from the geometry", "recommended": used == "geometry"}]}
    spread = f"{lo:+.0%}" if abs(hi - lo) < 0.005 else f"{lo:+.0%} to {hi:+.0%}"
    q["code"] = "question.contradiction"
    q["params"] = {"count": q["occurrences"], "ifcClass": cls, "typeName": type_name, "quantity": what,
                   "minDifference": lo, "maxDifference": hi, "reported": st, "geometry": ge, "source": src, "unit": unit,
                   "used": used, "unitError": scale is not None, "scale": scale_label(scale) if scale else None}
    if scale:
        tail = f"The stated value looks like a unit error (x{scale_label(scale)}); the measured value is used. "
    elif used == "geometry":
        tail = "The measured value is used. "
    else:
        tail = "The stated value is used; it usually allows for joins. " if what == "volume" else "The stated value is used. "
    q["message"] = (f"{q['occurrences']} x {cls} '{type_name or ''}': the {what} stated in the file and the geometry "
                    f"disagree by {spread} (e.g. {fmt(round(st, 3))} {unit} from {src} vs {fmt(round(ge, 3))} {unit} measured). "
                    + tail + "Which should be used?")


def merge_question(existing: dict, q: dict) -> None:
    """The same contradiction raised in another model of a federation: one question for both."""
    existing["guids"] += q["guids"]
    existing["occurrences"] += q["occurrences"]
    existing["_range"] = [min(existing["_range"][0], q["_range"][0]), max(existing["_range"][1], q["_range"][1])]
    existing["_used"] |= q["_used"]
    existing["_scale"] = existing["_scale"] or q["_scale"]
    existing["blocking"] = existing["blocking"] or q["blocking"]
    render_contradiction(existing)


def public_question(q: dict) -> dict:
    return {k: v for k, v in q.items() if not k.startswith("_")}


def add_embedded(host: dict, other: dict, volume: float, model: str | None = None) -> bool:
    """A linear element sharing solid volume with a planar one passes through it; a column sharing
    volume with a room stands in it. The area it takes = shared volume / host thickness (rooms: height)."""
    if other["family"] != "linear" or volume <= 0:
        return False
    if host["family"] == "planar":
        size = host.get("thickness")
    elif host["family"] == "space" and other["ifc_class"] in ROOM_COLUMNS:
        size = host.get("height")
    else:
        return False
    if any(x["guid"] == other["guid"] for x in host.get("embedded", [])):
        return False
    rec = {"guid": other["guid"], "ifc_class": other["ifc_class"], "volume": round(volume, 6)}
    if size:
        rec["area"] = round(volume / size, 6)
    if model:
        rec["model"] = model
    host.setdefault("embedded", []).append(rec)
    return True


def side_faces(sides: dict, contacts: list, labels: tuple, open_area: float, rooms: dict, is_external) -> list[dict]:
    """Faces of a planar element from its measured sides: one per room lying on a side (the
    room's contact area, openings shared in proportion) plus what no room covers."""
    axis = sides["axis"]
    faces = []
    for key, label, sign in (("a", labels[0], 1), ("b", labels[1], -1)):
        net = sides[key]
        gross = net + open_area
        if gross <= 0:
            continue
        share = net / gross
        mine = [c for c in contacts if c["side"] == key]
        normal = [round(sign * v, 6) for v in axis]
        for c in mine:
            name, term = rooms.get(c["spaceId"], (None, None))
            a = min(c["area"], gross)
            faces.append({k: v for k, v in {"side": label, "gross_area": a, "net_area": a * share, "space": c["spaceId"],
                                             "space_name": name, "space_type": term, "is_external": False,
                                             "normal": normal}.items() if v is not None})
        rest = gross - sum(min(c["area"], gross) for c in mine)
        if rest > max(0.05 * gross, 0.1) or not mine:
            f = {"side": label, "gross_area": rest, "net_area": rest * share, "normal": normal}
            if not mine and isinstance(is_external, bool):
                f["is_external"] = is_external
            faces.append(f)
    return faces


def measure_rooms(parsed: dict, rooms: dict, elements: list[dict], model_id: str, discipline: str, log: CalcLog) -> list[dict]:
    """IfcSpace -> MeasuredElement (family "space"). Reported first (IFC Qto_SpaceBaseQuantities),
    else the room solid. Revit's own room Area is not used: it depends on a Revit setting (wall
    centre, core or finish) and disagreed with the room solid by about 9% on the Duplex; it is
    logged. Openings counted for a room: those in an element the room lies on, near the room."""
    spatial = {s["id"]: s for s in parsed["spatial"]}
    by_guid = {e["guid"]: e for e in elements}
    bounding = defaultdict(set)
    for e in elements:
        for f in e.get("faces", []):
            if f.get("space"):
                bounding[f["space"]].add(e["guid"])
    openings_by_host = defaultdict(list)
    for o in parsed["openings"]:
        if o.get("hostId"):
            openings_by_host[o["hostId"]].append(o)
    out = []
    for sid, (raw, term) in rooms.items():
        s = spatial[sid]
        g = s.get("geometry") or {}
        geo = g.get("room") or {}
        rec = {"quantities": {"reported": s.get("quantities", {})}, "psets": s.get("psets", {})}
        prov, bits = {}, []

        def pick(kind, geo_key, label):
            v, src = find_reported(rec, kind)
            if v is not None:
                prov[kind] = "reported"
                bits.append(f"{label} {fmt(round(v, 3))} from {src}")
                return v
            if geo.get(geo_key):
                prov[kind] = "geometry"
                bits.append(f"{label} {fmt(round(geo[geo_key], 3))} from the room solid")
                return geo[geo_key]
            return None
        floor = pick("floor_area", "floorArea", "floor")
        ceiling = pick("ceiling_area", "ceilingArea", "ceiling")
        walls = pick("wall_area", "wallArea", "walls")
        perimeter = pick("room_perimeter", "perimeter", "perimeter")
        height = pick("height", "height", "height")
        revit = (s.get("psets", {}).get("PSet_Revit_Dimensions") or {}).get("Area")
        if isinstance(revit, (int, float)) and floor and abs(revit - floor) / floor > TOLERANCE:
            bits.append(f"Revit Area {fmt(round(revit, 3))} not used ({(revit - floor) / floor:+.1%}, follows a Revit room area setting)")
        walls_net, _ = find_reported(rec, "wall_area_net")
        if walls_net is not None:
            prov["wall_area_net"] = "reported"
        storey = spatial.get(s.get("parentId"), {})
        volume, _ = find_reported(rec, "volume")
        if volume is None and g.get("volume") and g.get("closed", g.get("watertight", True)):
            volume = g["volume"]
        is_storey = storey.get("kind") == "storey"
        m = {
            "guid": sid, "model_id": model_id, "discipline": discipline, "ifc_class": "IfcSpace", "ifc_class_raw": s["ifcClass"],
            "predefined_type": s.get("predefinedType"), "family": "space", "name": s.get("name"), "type_name": s.get("longName"),
            "space_type": term, "materials": [], "storey": storey.get("name") if is_storey else None,
            "storey_elevation": storey.get("elevation") if is_storey else None,
            "spaces": [sid], "status": "new", "count": 1,
            "floor_area": floor, "ceiling_area": ceiling, "wall_area": walls, "wall_area_net": walls_net,
            "skirting_length": None, "perimeter": perimeter, "height": height,
            "net_area": floor, "gross_area": floor, "footprint_area": floor, "net_volume": volume, "gross_volume": volume,
            "faces": [f for f in ({"side": "bottom", "gross_area": floor, "net_area": floor},
                                  {"side": "top", "gross_area": ceiling, "net_area": ceiling}) if f["gross_area"] is not None],
            "openings": [], "layers": [], "child_guids": [], "bounded_by": sorted(bounding.get(sid, ())),
            "props": {f"{ps}.{k}": v for ps, vals in s.get("psets", {}).items() for k, v in vals.items()},
            "provenance": prov, "warnings": [],
        }
        bits += set_room_openings(m, facing_openings(g, [o for h in m["bounded_by"] for o in openings_by_host.get(h, [])]))
        for x in g.get("intersections", []):
            if x["elementId"] in by_guid:
                add_embedded(m, by_guid[x["elementId"]], x["volume"])
        if m.get("embedded"):
            bits.append(f"{len(m['embedded'])} column(s) stand in it, "
                        f"{fmt(round(sum(x.get('area') or 0 for x in m['embedded']), 3))} m2 of floor")
        out.append(m)
        label = f"{s.get('name') or sid} (room" + (f", {raw}" if raw and raw != s.get("name") else "") + (f" -> {term}" if term else "") + ")"
        log.detail("measure", label + ": " + "; ".join(bits) + f"; bounded by {len(m['bounded_by'])} element(s)", guid=sid,
            code="log.measure.room", params=dict(name=label, quantities=bits, boundedBy=len(m['bounded_by'])))
    return out


def facing_openings(room_geo: dict, openings: list[dict]) -> list[dict]:
    """Openings (parsed) in elements bounding a room that face it: their box next to the room's
    box, and upright (a slab opening is not in the room's walls). Each opening once."""
    lo, hi = room_geo.get("bboxMin"), room_geo.get("bboxMax")
    if not lo:
        return []
    out, seen = [], set()
    for o in openings:
        if o["id"] in seen or not o.get("bboxMin"):
            continue
        near = all(o["bboxMin"][i] <= hi[i] + CONTACT_TOL and o["bboxMax"][i] >= lo[i] - CONTACT_TOL for i in range(3))
        if near and (o.get("height") or 0) >= (o.get("depth") or 0) and opening_kind(o) != "recess":
            seen.add(o["id"])
            out.append(opening_record(o))
    return out


def set_room_openings(m: dict, ops: list[dict]) -> list[str]:
    """A room's openings -> net wall area (unless reported) and skirting (perimeter less doors)."""
    m["openings"] = ops
    open_area = sum(o["area"] or 0 for o in ops)
    doors = sum(o["width"] or 0 for o in ops if o["kind"] == "door")
    if m["provenance"].get("wall_area_net") != "reported":
        m["wall_area_net"] = max(m["wall_area"] - open_area, 0.0) if m.get("wall_area") is not None else None
    m["skirting_length"] = max(m["perimeter"] - doors, 0.0) if m.get("perimeter") is not None else None
    return [f"{len(ops)} opening(s) {fmt(round(open_area, 3))} m2 in its walls, doors {fmt(round(doors, 3))} m wide"] if ops else []


def roll_up_parts(out: list[dict], has_body: set[str], log: CalcLog, only: set[str] | None = None):
    """An aggregate without its own body (IfcRoof made of slabs, IfcElementAssembly) takes its
    quantities from its parts: volume = sum of the parts' adopted volumes (only if every part
    with a body has one), area = sum of the planar parts' areas. Parts are still measurable on
    their own; rules decide whether the whole or the parts are measured (rules.py).
    `only`: re-roll just these aggregates (federation, after some parts went to another model)."""
    by_guid = {m["guid"]: m for m in out}

    def depth(m, seen=0):
        p = by_guid.get(m.get("parent_guid"))
        return 0 if p is None or seen > 20 else 1 + depth(p, seen + 1)

    for m in sorted(out, key=lambda m: -depth(m)):              # nested assemblies: deepest first
        if m["guid"] in has_body or not m["child_guids"] or (only is not None and m["guid"] not in only):
            continue
        parts = [by_guid[c] for c in m["child_guids"] if c in by_guid]
        bodies = [p for p in parts if p["guid"] in has_body or p["child_guids"]]
        bits = []
        if bodies and all(p["net_volume"] is not None for p in bodies):
            m["net_volume"] = sum(p["net_volume"] for p in bodies)
            m["gross_volume"] = sum(p["gross_volume"] or p["net_volume"] for p in bodies)
            m["provenance"]["net_volume"] = "derived"
            bits.append(f"volume = sum of {len(bodies)} part(s) = {fmt(round(m['net_volume'], 4))} m3")
        elif bodies:
            m["net_volume"] = m["gross_volume"] = None
            m["warnings"].append("some parts have no reliable volume: no volume for the whole")
        planar = [p for p in parts if p["net_area"] is not None and (p["family"] == "planar" or (      # incl. rolled-up
            p["child_guids"] and p["guid"] not in has_body))]                                        # sub-assemblies
        if m["net_area"] is None and planar:
            m["net_area"] = sum(p["net_area"] for p in planar)
            m["gross_area"] = sum(p["gross_area"] or p["net_area"] for p in planar)
            m["footprint_area"] = m["developed_area"] = m["net_area"]
            m["faces"] = [{"side": s, "gross_area": m["gross_area"], "net_area": m["net_area"]} for s in ("top", "bottom")]
            m["provenance"]["net_area"] = m["provenance"]["gross_area"] = "derived"
            if len({p["thickness"] for p in planar}) == 1 and m["thickness"] is None:
                m["thickness"] = planar[0]["thickness"]
            bits.append(f"area = sum of {len(planar)} planar part(s) = "
                        f"{' + '.join(fmt(round(p['net_area'], 3)) for p in planar)} = {fmt(round(m['net_area'], 3))} m2")
        if bits:
            log.detail("measure", f"{m.get('name') or m['guid']}: no body of its own; " + "; ".join(bits), guid=m["guid"],
                code="log.measure.aggregate", params=dict(name=m.get('name') or m['guid'], quantities=bits))


# ------------------------------------------------------------------------ building values
BUILDING_FIELDS = ("gross_floor_area", "net_floor_area", "footprint_area", "gross_volume", "height")
FLOOR_SLAB_EXCLUDE = ("ROOF", "LANDING")


def building_measures(elements: list[dict], parsed_models: list[dict], log: CalcLog) -> dict:
    """BuildingMeasures for building.<field> in formulas: the IFC building's own quantities
    (Qto_BuildingBaseQuantities) where a model has them, else derived from the measured elements
    of all models. Derived values are approximations and say so in `notes`."""
    out = {"provenance": {}, "notes": []}
    for parsed in parsed_models:                          # first model that reports a value wins
        for s in parsed.get("spatial", []):
            if s["kind"] != "building":
                continue
            rec = {"quantities": {"reported": s.get("quantities", {})}, "psets": s.get("psets", {})}
            for f in BUILDING_FIELDS:
                if f in out:
                    continue
                v, src = find_reported(rec, f"building_{f}")
                if v is not None:
                    out[f], out["provenance"][f] = v, "reported"
                    out["notes"].append(f"{f} {fmt(round(v, 3))} from {src} ({s.get('name') or s['id']})")

    rooms = [e for e in elements if e["family"] == "space"]
    if rooms:
        out["space_volume"] = sum(e.get("net_volume") or 0 for e in rooms)
        out["provenance"]["space_volume"] = "derived"
        if "net_floor_area" not in out:
            out["net_floor_area"] = sum(e.get("floor_area") or 0 for e in rooms)
            out["provenance"]["net_floor_area"] = "derived"
            out["notes"].append(f"net_floor_area = sum of {len(rooms)} room floor areas")
    storeys = {}
    for e in elements:
        if e.get("storey") is not None:
            storeys.setdefault(e["storey"], e.get("storey_elevation"))
    if storeys:
        out["storeys"] = len(storeys)
        out["provenance"]["storeys"] = "derived"
    tops = [e["elevation_top"] for e in elements if e.get("elevation_top") is not None]
    bases = [e["elevation_base"] for e in elements if e.get("elevation_base") is not None]
    if not tops or not bases:                             # most exporters: from the element solids
        kept = {e["guid"] for e in elements}
        boxes = [e["quantities"]["geometry"] for p in parsed_models for e in p.get("elements", [])
                 if e["id"] in kept and e["quantities"]["geometry"].get("bboxMin")]
        tops = [g["bboxMax"][2] for g in boxes]
        bases = [g["bboxMin"][2] for g in boxes]
    if "height" not in out and tops and bases:
        out["height"] = max(tops) - min(bases)
        out["provenance"]["height"] = "derived"
        out["notes"].append("height = highest element top - lowest element base")

    plan = defaultdict(float)                             # floor slab plan area per storey
    for e in elements:
        if e["ifc_class"] == "IfcSlab" and (e.get("predefined_type") or "").upper() not in FLOOR_SLAB_EXCLUDE:
            a = e.get("footprint_area") or e.get("net_area")
            if a and e.get("storey") is not None:
                plan[e["storey"]] += a
    if plan:
        if "gross_floor_area" not in out:
            out["gross_floor_area"] = sum(plan.values())
            out["provenance"]["gross_floor_area"] = "derived"
            out["notes"].append(f"gross_floor_area = plan area of floor slabs on {len(plan)} storey(s) (approximate)")
        if "footprint_area" not in out:
            out["footprint_area"] = max(plan.values())
            out["provenance"]["footprint_area"] = "derived"
            out["notes"].append("footprint_area = largest floor slab plan area of one storey (approximate)")
        if "gross_volume" not in out:
            levels = sorted((elev, name) for name, elev in storeys.items() if elev is not None)
            top = max(tops) if tops else None
            vol, used = 0.0, 0
            for i, (elev, name) in enumerate(levels):
                nxt = levels[i + 1][0] if i + 1 < len(levels) else top
                if name in plan and nxt is not None and nxt > elev:
                    vol += plan[name] * (nxt - elev)
                    used += 1
            if used:
                out["gross_volume"] = vol
                out["provenance"]["gross_volume"] = "derived"
                out["notes"].append(f"gross_volume = floor slab plan area x storey height over {used} storey(s) (approximate)")
    for k in list(out):
        if isinstance(out[k], float):
            out[k] = round(out[k], 6)
    shown = ", ".join(f"{k} {fmt(round(out[k], 2))} ({out['provenance'][k]})" for k in out if k not in ("provenance", "notes"))
    log.info("measure", f"building values for formulas: {shown or 'none'}",
        code="log.measure.building", params=dict(quantities=shown))
    for n in out["notes"]:
        log.detail("measure", f"building: {n}",
            code="log.measure.building_note", params=dict(note=n))
    return out
