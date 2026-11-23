"""
verify_quantities.py - independent check of boqlet's quantities (QS review, Phase 1).

Recomputes chosen elements' quantities WITHOUT boqlet's measuring code and compares them with the
app's BoQ, element by element (via each line's trace: GlobalId -> share) and for a few whole lines:

  hand    plain arithmetic on raw STEP values (extrusion depths, profile dimensions, opening sizes,
          layer thicknesses, units), encoded below as constants with their derivation in comments.
          Never Qto_*/BaseQuantities, never a library quantity function.
  script  IfcOpenShell 0.9 tessellation (ifcopenshell.geom, world coordinates, file units scaled by
          this script's own reading of IfcUnitAssignment) + this file's own mesh arithmetic:
          vertex welding, BFS winding repair, signed-tetrahedron volume, face areas by normal.
          No trimesh, nothing from engine/ifc_boq.

Usage (from the repository root; the wrapper picks engine/.venv's Python):

  docs/review/tools/verify-quantities                 # run the CURRENT engine on the samples, compare
  docs/review/tools/verify-quantities --baseline      # compare against docs/review/baseline/engine instead
  docs/review/tools/verify-quantities --only S05 S09  # some samples only
  docs/review/tools/verify-quantities --strict        # also fail when a KNOWN difference has gone away
  docs/review/tools/verify-quantities --json out.json # write the table as JSON too

Samples: docs/review/_samples (bash docs/review/tools/fetch-samples.sh). Configuration: the CLI default
(as-modelled + global-seed + acme-cost-codes, no decisions). Parsing reuses compare-baseline's parse
cache (docs/review/_scratch/parse-cache), so a second run takes seconds; S08 parses in ~40 s cold.

Result per check:
  OK       app matches the independent value(s) within tolerance
  KNOWN    app differs, but exactly as documented (a measurement-rule choice or a known defect; the
           note and the QS-xxx finding in docs/review/04-civil-engineer.md explain it)
  FIXED    a KNOWN difference is gone: the app now matches the independent value (update the check)
  FAIL     app differs from the independent value and from the documented known value
  ERROR    the check could not run (missing sample, element or line)
Exit code: 0 when every check is OK / KNOWN / FIXED (FIXED fails with --strict), 1 on FAIL or ERROR,
3 when the engine or samples are not available.
Tolerance: |app - expected| <= max(abs_tol, rel_tol * |expected|); defaults 0.011 (line rounding to
0.01) and 0.5 %. A check may set its own.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from collections import defaultdict, deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
REVIEW = HERE.parent
ROOT = REVIEW.parents[1]
SAMPLES = REVIEW / "_samples"
BASELINE = REVIEW / "baseline" / "engine"

S = {
    "S01": "S01-wall-with-opening-and-window.ifc",
    "S02": "S02-column-straight-rectangle-tessellation.ifc",
    "S03": "S03-simple-scene-architecture-ifc2x3.ifc",
    "S04": "S04-simple-scene-structural-ifc4x3.ifc",
    "S05": "S05-duplex-architecture-ifc2x3.ifc",
    "S08": "S08-revit-str-ifc4.ifc",
    "S09": "S09-samplehouse-ifc4.ifc",
}

# ------------------------------------------------------------------------------------------------
# The checks. Fields:
#   id, sample, rule (ruleId), line (substring of the line description; "" = any line of the rule)
#   guids: elements whose trace shares are summed (None = the whole line quantity)
#   what:  what the number is (for the table)
#   script: (method, [guids measured]) - None when no script check applies
#   hand:  number from plain arithmetic (None when the shape is not hand-checkable), derivation in
#          the comment above the check
#   known: {"app": value the app gives today, "note": why} - documented difference
#   tol:   optional (abs, rel)
# Script methods (all on this file's own mesh arithmetic):
#   side_mean  mean of the two wall faces (triangles whose normal is within 18 deg of the thin
#              horizontal axis), i.e. face area net of openings, no reveals
#   top        area of up-facing triangles (normal z > 0.95)
#   up_true    true area of every up-facing triangle (z > 0.05), for sloped roofs
#   volume     enclosed volume after winding repair
#   length     extent along the principal axis of the vertices
#   vert_faces area of all vertical faces (|normal z| < 0.05) = formwork to sides and ends
#   count      number of the listed elements present in the file
#   count_name (IFC class, text): number of occurrences of the class whose Name contains the text
#   length_x60 length x 60 kg/m / 1000 (t), for a W..X60 section (kg/m stated in the designation)
# ------------------------------------------------------------------------------------------------
CHECKS = [
    # S01 wall: IfcExtrudedAreaSolid #71: profile 3000 x 300 mm (#72), depth 2000 mm; LENGTHUNIT MILLI.
    # Opening #87: 1000 x 300 mm profile, depth 1000 -> 1.000 x 1.000 m through the wall.
    # gross face 3.000 x 2.000 = 6.000 m2; net = 6.000 - 1.000 x 1.000 = 5.000 m2
    dict(id="S01-wall-net-area", sample="S01", rule="walls", line="", guids=["3ZYW59sxj8lei475l7EhLU"],
         what="IfcWall net area m2", script=("side_mean", ["3ZYW59sxj8lei475l7EhLU"]), hand=5.000),
    # S01 window: one IfcWindow #102 (OverallWidth 1000, OverallHeight 1000) -> 1 nr
    dict(id="S01-window-count", sample="S01", rule="windows", line="", guids=["0tA4DSHd50le6Ov9Yu0I9X"],
         what="IfcWindow count nr", script=("count", ["0tA4DSHd50le6Ov9Yu0I9X"]), hand=1),
    # S02 column: units are inches (IfcConversionBasedUnit 'inch' = 0.0254 m); IfcTriangulatedFaceSet
    # #287 z from 0 to 120 -> 120 x 0.0254 = 3.048 m
    dict(id="S02-column-length", sample="S02", rule="linear-other", line="IfcColumn", guids=["2WUGYBphrFv8aLIFJCmiIk"],
         what="IfcColumn length m", script=("length", ["2WUGYBphrFv8aLIFJCmiIk"]), hand=3.048),
    # S03 slab on grade (Brep, not hand-checkable without the faces; script only)
    dict(id="S03-slab-top-area", sample="S03", rule="slabs", line="groundfloor", guids=["3zR0BOEcLADRKln4HYporH"],
         what="IfcSlab top area m2", script=("top", ["3zR0BOEcLADRKln4HYporH"]), hand=None),
    dict(id="S03-slab-volume", sample="S03", rule="slab-concrete", line="groundfloor", guids=["3zR0BOEcLADRKln4HYporH"],
         what="IfcSlab concrete m3", script=("volume", ["3zR0BOEcLADRKln4HYporH"]), hand=None),
    # S03 outer wall (gable, Brep): mean of both faces = the app's volume / width
    dict(id="S03-wall-left-area", sample="S03", rule="walls", line="house left", guids=["0OfZwWc8j9QP5uX8xPTxDH"],
         what="IfcWall area m2", script=("side_mean", ["0OfZwWc8j9QP5uX8xPTxDH"]), hand=None),
    # S03 gable roof = its two slab parts, 45 deg: true sloped area of the up faces
    dict(id="S03-roof-developed", sample="S03", rule="roofs", line="", guids=["2iPwJwpPDCSgMheXwk9cBT"],
         what="IfcRoof developed area m2", script=("up_true", ["0ZTBBPo6f6bxqV2K7Oelrq", "12UVOn4wvAJPMUExKdZLb8"]), hand=None,
         tol=(0.02, 0.01)),
    # S04 strip footing (ring under the house, tessellated): volume
    dict(id="S04-footing-volume", sample="S04", rule="footings", line="", guids=["0pFmhV8oD1dB40_b4pscr8"],
         what="IfcFooting volume m3", script=("volume", ["0pFmhV8oD1dB40_b4pscr8"]), hand=None),
    # S04 footing formwork: the app uses 2 x longest plan extent x height (6.2 m x 0.3 m); the footing is a
    # ring (plan area 12.31 m2 inside a 5.8 x 6.2 m box), whose real side faces total ~15.15 m2.
    dict(id="S04-footing-formwork", sample="S04", rule="formwork-footings", line="", guids=["0pFmhV8oD1dB40_b4pscr8"],
         what="formwork to footing sides m2", script=("vert_faces", ["0pFmhV8oD1dB40_b4pscr8"]), hand=None,
         known={"app": 3.72, "note": "QS-005: formwork_footings_formula = 2 x length x height assumes a straight "
                                     "strip; a ring/L footing's side faces are 4x larger"}),
    # S04 girder (tessellated, sloped): length
    dict(id="S04-girder-length", sample="S04", rule="linear-other", line="girder", guids=["0rh7bRO0L9fg1NzgGKU$Ut"],
         what="IfcBeam length m", script=("length", ["0rh7bRO0L9fg1NzgGKU$Ut"]), hand=None),
    # S05 exterior wall 138062: IfcExtrudedAreaSolid #3789: rectangle 8.800 x 0.417 m, depth 3.100 m.
    # Openings: window #6287 2.420 x 4.835 m and door #21699 0.813 x 2.420 m, both through 0.417 m.
    # gross 8.800 x 3.100 = 27.280; openings 4.835 x 2.420 = 11.7007 + 0.813 x 2.420 = 1.96746 -> 13.66816
    # net 27.280 - 13.66816 = 13.61184 m2
    dict(id="S05-extwall-net-area", sample="S05", rule="walls", line="Exterior - Brick on Block", guids=["2O2Fr$t4X7Zf8NOew3FNtn"],
         what="IfcWall net area m2", script=("side_mean", ["2O2Fr$t4X7Zf8NOew3FNtn"]), hand=13.61184),
    # S05 foundation wall 140479: rectangle 8.800 x 0.417, depth 1.250 -> 8.800 x 1.250 = 11.000 m2
    dict(id="S05-fdnwall-area", sample="S05", rule="walls", line="Foundation - Concrete (417mm)", guids=["2O2Fr$t4X7Zf8NOew3FK80"],
         what="IfcWall area m2", script=("side_mean", ["2O2Fr$t4X7Zf8NOew3FK80"]), hand=11.000),
    # S05 partition 139143: rectangle 2.920 x 0.124, depth 2.795; door opening 0.762 x 2.032
    # 2.920 x 2.795 = 8.1614; 0.762 x 2.032 = 1.548384; net 6.613016 m2
    dict(id="S05-partition-net-area", sample="S05", rule="walls", line="Partition (92mm", guids=["2O2Fr$t4X7Zf8NOew3FNau"],
         what="IfcWall net area m2", script=("side_mean", ["2O2Fr$t4X7Zf8NOew3FNau"]), hand=6.613016),
    # S05 strip footing 186596: rectangle 18.283 x 0.900, depth 0.300 -> 4.93641 m3
    dict(id="S05-footing-volume", sample="S05", rule="footings", line="", guids=["0kF45Qs8L9PAM9kmb1lT5d"],
         what="IfcFooting volume m3", script=("volume", ["0kF45Qs8L9PAM9kmb1lT5d"]), hand=4.93641),
    # S05 slab on grade 141232: polygon (-3.983,4.654) (-3.983,-2.454) (0.275,-2.454) (0.275,-4.654)
    # (3.983,-4.654) (3.983,4.654) = 7.966 x 9.308 - 4.258 x 2.200 = 74.147528 - 9.3676 = 64.779928 m2
    dict(id="S05-slab-top-area", sample="S05", rule="slabs", line="127mm", guids=["2O2Fr$t4X7Zf8NOew3FK4F"],
         what="IfcSlab top area m2", script=("top", ["2O2Fr$t4X7Zf8NOew3FK4F"]), hand=64.779928),
    # ... x depth 0.127 = 8.227051 m3
    dict(id="S05-slab-volume", sample="S05", rule="slab-concrete", line="127mm", guids=["2O2Fr$t4X7Zf8NOew3FK4F"],
         what="IfcSlab concrete m3", script=("volume", ["2O2Fr$t4X7Zf8NOew3FK4F"]), hand=8.227051),
    # S05 beam W310X60 207325: IfcExtrudedAreaSolid #36678 depth 7.4213 m (= PSet_Revit_Structural Cut
    # Length); W310X60 states 60 kg/m -> 7.4213 x 60 = 445.278 kg = 0.445278 t.
    # The app multiplies PSet_Revit_Dimensions.Length = 7.523 m (Revit's analytical length) -> 0.45138 t.
    dict(id="S05-beam-mass", sample="S05", rule="steel-sections", line="W310X60", guids=["2OrWItJ6zAwBNp0OUxK_l8"],
         what="IfcBeam mass t", script=("length_x60", ["2OrWItJ6zAwBNp0OUxK_l8"]), hand=0.445278, tol=(0.0005, 0.005),
         known={"app": 0.45138, "note": "QS-012: length is PSet_Revit_Dimensions.Length (analytical, +0.10 m), "
                                        "not the member's cut length; +1.4 % mass"}),
    # S05 party wall 143239 (surface model): axis 16.966 m x unconnected height 2.900 m = 49.2014 m2 of face.
    # Before WP-A3 A-09 the app took Revit volume 25.8301 / layer-set 0.550 = 46.964 m2 (the body is not a
    # full 0.55 m prism); FIXED: walls are measured by their faces
    dict(id="S05-partywall-area", sample="S05", rule="walls", line="Party Wall", guids=["2O2Fr$t4X7Zf8NOew3FKau"],
         what="IfcWall area m2", script=("side_mean", ["2O2Fr$t4X7Zf8NOew3FKau"]), hand=16.966 * 2.900),
    # S05 party wall line, all four elements: 49.2014 + stubs 139234 / 139347 4.201 x 2.795 (IfcRectangleProfileDef,
    # extruded 2.795) + stub 139374 2.200 x 2.795 = 78.834 m2 (71.67 by volume / thickness before A-09)
    dict(id="S05-partywall-line", sample="S05", rule="walls", line="Party Wall", guids=None,
         what="line total m2 (4 walls)", script=("side_mean", ["2O2Fr$t4X7Zf8NOew3FKau", "2O2Fr$t4X7Zf8NOew3FNbT",
                                                               "2O2Fr$t4X7Zf8NOew3FKRi", "2O2Fr$t4X7Zf8NOew3FKRH"]),
         hand=16.966 * 2.900 + 2 * 4.201 * 2.795 + 2.200 * 2.795),
    # S05 exterior brick-on-block line, all twelve walls (faces vs the app's volume / thickness)
    dict(id="S05-extwall-line", sample="S05", rule="walls", line="Exterior - Brick on Block", guids=None,
         what="line total m2 (12 walls)", script=("side_mean", "LINE"), hand=None),
    # S05 partitions line (18 walls)
    dict(id="S05-partition-line", sample="S05", rule="walls", line="Partition (92mm", guids=None,
         what="line total m2 (18 walls)", script=("side_mean", "LINE"), hand=None),
    # S05 footings line (7 strip footings)
    dict(id="S05-footings-line", sample="S05", rule="footings", line="", guids=None,
         what="line total m3 (7 footings)", script=("volume", "LINE"), hand=None),
    # S05 ceiling 187149 (surface model): plan area
    dict(id="S05-ceiling-area", sample="S05", rule="coverings", line="Gypsum", guids=["3bXiCStxP6Fgxdej$yc5T8"],
         what="IfcCovering area m2", script=("top", ["3bXiCStxP6Fgxdej$yc5T8"]), hand=None),
    # S05 roof 184483 = slab part 3ThA22djr8AQQ9eQMA5s7I. Flat; plan 0.417..8.383 x -17.383..-0.417 m
    # = 7.966 x 16.966 = 135.151 m2, less two skylight openings 1.0291 x 1.0811 = 1.11256 each
    # -> 135.151 - 2.22512 = 132.926 m2
    dict(id="S05-roof-area", sample="S05", rule="roofs", line="Live Roof", guids=["0jf0rYHfX3RAB3bSIRjmxl"],
         what="IfcRoof area m2", script=("top", ["3ThA22djr8AQQ9eQMA5s7I"]), hand=132.926036),
    # S05 windows M_Fixed 4835 x 2420: the file has two IfcWindow named "...4835mm x 2420mm..." (145788, 146016)
    dict(id="S05-windows-4835-count", sample="S05", rule="windows", line="4835mm", guids=None,
         what="line total nr", script=("count_name", ("IfcWindow", "4835mm x 2420mm")), hand=2),
    # S08 square concrete column 1173925: mapped extrusion depth 3000 mm -> 3.000 m
    dict(id="S08-column-length", sample="S08", rule="linear-other", line="450 x 450", guids=["3OQjd9jwr1COqcP44Fm6HA"],
         what="IfcColumn length m", script=("length", ["3OQjd9jwr1COqcP44Fm6HA"]), hand=3.000),
    # S08 pile cap 1175183 (IfcSlab BASESLAB): profile 3800 x 3800 mm, depth 1000 mm.
    # plan (top) 3.800 x 3.800 = 14.440 m2. The file's Qto_SlabBaseQuantities.NetArea = 44.08 is the
    # exporter's total surface (2 x 14.44 + 4 x 3.8 x 1.0); FIXED by WP-A1 A-03 (NetArea > GrossArea skipped).
    dict(id="S08-pilecap-area", sample="S08", rule="slabs", line="3800 x 3800", guids=["3OQjd9jwr1COqcP44Fm6DW"],
         what="IfcSlab (pile cap) top area m2", script=("top", ["3OQjd9jwr1COqcP44Fm6DW"]), hand=14.440),
    # ... edge formwork: perimeter 4 x 3.800 = 15.200 m x depth 1.000 m = 15.200 m2. The file's
    # Qto_SlabBaseQuantities.Width = 3800 mm is the plan width (57.76 m2 before WP-A1 A-03, which takes the thin axis)
    dict(id="S08-pilecap-edge-formwork", sample="S08", rule="formwork-slab-edges", line="", guids=["3OQjd9jwr1COqcP44Fm6DW"],
         what="edge formwork m2", script=("vert_faces", ["3OQjd9jwr1COqcP44Fm6DW"]), hand=15.200),
    # S09 ground floor 286349: IfcRectangleProfileDef #33932 8667.5 x 16867.5 mm, depth 470 mm
    # plan 8.6675 x 16.8675 = 146.19906 m2. Before WP-A1 (A-01) the app took BaseQuantities.GrossVolume
    # 68713.556 (the exporter wrote m2 x mm) / 0.470 m = 146199.06 m2; it now reads BaseQuantities.GrossArea
    dict(id="S09-slab-area", sample="S09", rule="slabs", line="Floor-Grnd-Susp", guids=["3cUkl32yn9qRSPvBJVyWgQ"],
         what="IfcSlab top area m2", script=("top", ["3cUkl32yn9qRSPvBJVyWgQ"]), hand=146.19906),
    # S09 first floor 295048: polygon -> 5.735 x 13.9675 + 0.0325 x 4.900 = 80.26286 m2; x 0.165 m
    # = 13.24337 m3. The file's BaseQuantities.GrossVolume = 13243.37 (1000x) is a unit error (WP-A1 A-02)
    dict(id="S09-floor-volume", sample="S09", rule="slab-concrete", line="Simple floor", guids=["3ntFzSulnDNeQ4nJrMgcOt"],
         what="IfcSlab concrete m3", script=("volume", ["3ntFzSulnDNeQ4nJrMgcOt"]), hand=13.243372),
]

ABS_TOL, REL_TOL = 0.011, 0.005


# ------------------------------------------------------------------------------------------------
# Independent geometry (own arithmetic)
# ------------------------------------------------------------------------------------------------
def length_unit(f) -> float:
    """Metres per file length unit, read from IfcUnitAssignment by this script."""
    prefixes = {"MILLI": 1e-3, "CENTI": 1e-2, "DECI": 1e-1, "KILO": 1e3, None: 1.0}
    for ua in f.by_type("IfcUnitAssignment"):
        for u in ua.Units:
            if getattr(u, "UnitType", None) != "LENGTHUNIT":
                continue
            if u.is_a("IfcSIUnit"):
                return prefixes[u.Prefix]
            if u.is_a("IfcConversionBasedUnit"):
                mwu = u.ConversionFactor
                inner = mwu.UnitComponent
                return float(mwu.ValueComponent.wrappedValue) * (prefixes[inner.Prefix] if inner.is_a("IfcSIUnit") else 1.0)
    return 1.0


def meshes(f, guids):
    import numpy as np
    import ifcopenshell.geom as geom
    s = geom.settings()
    s.set("use-world-coords", True)
    s.set("convert-back-units", True)          # file units; scaled with our own factor below
    L = length_unit(f)
    els = []
    for g in guids:
        try:
            els.append(f.by_guid(g))
        except RuntimeError:
            pass
    out = {}
    if not els:
        return out
    it = geom.iterator(s, f, 1, include=els)
    if it.initialize():
        while True:
            sh = it.get()
            v = np.array(sh.geometry.verts, dtype=float).reshape(-1, 3) * L
            fc = np.array(sh.geometry.faces, dtype=int).reshape(-1, 3)
            out[sh.guid] = (v, fc)
            if not it.next():
                break
    return out


def _weld(v, fc, tol=1e-6):
    import numpy as np
    key = np.round(v / tol).astype(np.int64)
    _, idx, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return v[idx], inv.reshape(-1)[fc]


def _orient(fc):
    """Consistent winding by walking shared edges."""
    fc = fc.copy()
    edge_faces = defaultdict(list)
    for i, t in enumerate(fc):
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            edge_faces[(min(a, b), max(a, b))].append(i)
    seen = [False] * len(fc)
    comps = []
    for start in range(len(fc)):
        if seen[start]:
            continue
        seen[start] = True
        q, comp = deque([start]), [start]
        while q:
            i = q.popleft()
            t = fc[i]
            for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                for j in edge_faces[(min(a, b), max(a, b))]:
                    if seen[j]:
                        continue
                    u = fc[j]
                    if (a, b) in {(u[0], u[1]), (u[1], u[2]), (u[2], u[0])}:
                        fc[j] = u[[0, 2, 1]]
                    seen[j] = True
                    q.append(j)
                    comp.append(j)
        comps.append(comp)
    return fc, comps


def measure(v, fc) -> dict:
    import numpy as np
    v, fc = _weld(v, fc)
    fc, comps = _orient(fc)
    a, b, c = v[fc[:, 0]], v[fc[:, 1]], v[fc[:, 2]]
    vol = 0.0
    for comp in comps:
        vol += abs(float(np.einsum("ij,ij->i", a[comp], np.cross(b[comp], c[comp])).sum()) / 6.0)
    n = np.cross(b - a, c - a)
    ar = np.linalg.norm(n, axis=1) / 2
    with np.errstate(invalid="ignore", divide="ignore"):
        u = n / np.linalg.norm(n, axis=1)[:, None]
    u = np.nan_to_num(u)
    xy = v[:, :2] - v[:, :2].mean(0)
    _, _, vt = np.linalg.svd(xy, full_matrices=False)
    short = np.array([vt[1, 0], vt[1, 1], 0.0])
    across = np.abs(u @ short)
    up = u[:, 2]
    cen = v - v.mean(0)
    _, _, vt3 = np.linalg.svd(cen, full_matrices=False)
    return {
        "volume": vol,
        "side_mean": float(ar[across > 0.95].sum()) / 2,      # both faces, halved (orientation-free)
        "top": float(ar[up > 0.95].sum()) if (up > 0.95).any() else float(ar[up < -0.95].sum()),
        "up_true": float(ar[up > 0.05].sum()) if (up > 0.05).any() else float(ar[up < -0.05].sum()),
        "vert_faces": float(ar[np.abs(up) < 0.05].sum()),
        "length": float(np.ptp(cen @ vt3[0])),
    }


def script_value(f, method: str, guids: list[str]):
    import ifcopenshell  # noqa: F401
    if method == "count_name":
        cls, text = guids
        return float(sum(1 for e in f.by_type(cls) if text in (e.Name or "")))
    if method == "count":
        n = 0
        for g in guids:
            try:
                f.by_guid(g)
                n += 1
            except RuntimeError:
                pass
        return float(n)
    ms = meshes(f, guids)
    missing = [g for g in guids if g not in ms]
    if missing:
        raise RuntimeError(f"no geometry for {missing}")
    total = 0.0
    for g in guids:
        m = measure(*ms[g])
        if method == "length_x60":
            total += m["length"] * 60 / 1000
        else:
            total += m[method]
    return total


# ------------------------------------------------------------------------------------------------
# The app's values
# ------------------------------------------------------------------------------------------------
def engine_result(sid: str) -> dict:
    sys.path.insert(0, str(HERE))
    import compare_baseline as cb        # parse cache + presets folder handling (no measuring code used here)
    from ifc_boq import presets
    from ifc_boq.pipeline import get_boq
    parsed, meshes_ = cb.cached_parse(SAMPLES / S[sid])
    rule_set, lib = presets.load_rule_set("as-modelled")
    return get_boq([{"parsed": parsed, "meshes": meshes_}], rule_set,
                   [presets.load_classification("acme-cost-codes")], [presets.load_dictionary("global-seed")],
                   presets.resolution(), [], lib, federation=presets.federation())


def baseline_result(sid: str) -> dict:
    with gzip.open(BASELINE / f"{sid}-default" / "result.json.gz", "rb") as g:
        return json.loads(g.read().decode("utf-8"))


def app_value(result: dict, chk: dict):
    lines = [l for l in result["lines"] if l["ruleId"] == chk["rule"] and chk["line"] in l["description"]]
    if not lines:
        raise RuntimeError(f"no line {chk['rule']} / {chk['line']!r}")
    if chk["guids"] is None:
        if len(lines) > 1:
            raise RuntimeError(f"{len(lines)} lines match {chk['rule']} / {chk['line']!r}")
        q = lines[0]["quantity"]
        return q, lines[0], [e["guid"] for e in lines[0]["trace"]["elements"]]
    total, found = 0.0, set()
    for l in lines:
        for e in l["trace"]["elements"]:
            if e["guid"] in chk["guids"]:
                if e.get("quantity") is None:
                    return None, l, list(found)
                total += e["quantity"]
                found.add(e["guid"])
    if found != set(chk["guids"]):
        raise RuntimeError(f"elements not in the line trace: {sorted(set(chk['guids']) - found)}")
    return total, lines[0], list(found)


def close(a, b, tol) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= max(tol[0], tol[1] * abs(b))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--baseline", action="store_true", help="read docs/review/baseline/engine/<sample>-default")
    ap.add_argument("--only", nargs="*", help="sample ids (S01 S05 ...)")
    ap.add_argument("--strict", action="store_true", help="FIXED counts as a failure")
    ap.add_argument("--json", help="also write the rows as JSON")
    args = ap.parse_args(argv)
    os.environ.setdefault("PYTHONUTF8", "1")
    try:
        import ifcopenshell
        import numpy  # noqa: F401
    except ImportError as e:
        print("ifcopenshell / numpy missing:", e, file=sys.stderr)
        return 3
    sys.path.insert(0, str(ROOT / "engine"))
    samples = [s for s in S if not args.only or s in args.only]
    rows, results, files = [], {}, {}
    for sid in samples:
        p = SAMPLES / S[sid]
        if not p.exists():
            print(f"sample {sid} missing ({p}); run bash docs/review/tools/fetch-samples.sh", file=sys.stderr)
            return 3
        try:
            results[sid] = baseline_result(sid) if args.baseline else engine_result(sid)
        except Exception as e:  # noqa: BLE001
            print(f"engine failed on {sid}: {type(e).__name__}: {e}", file=sys.stderr)
            return 3
        files[sid] = ifcopenshell.open(str(p))

    for chk in CHECKS:
        if chk["sample"] not in samples:
            continue
        tol = chk.get("tol", (ABS_TOL, REL_TOL))
        row = {"id": chk["id"], "sample": chk["sample"], "what": chk["what"], "rule": chk["rule"],
               "line": chk["line"], "hand": chk["hand"], "known": (chk.get("known") or {}).get("app")}
        try:
            app, line, guids = app_value(results[chk["sample"]], chk)
            row["app"] = app
            method, sg = chk["script"] if chk["script"] else (None, None)
            if method:
                sg = guids if sg == "LINE" else sg
                row["script"] = script_value(files[chk["sample"]], method, sg)
            else:
                row["script"] = None
            refs = [x for x in (row["hand"], row["script"]) if x is not None]
            # the two independent methods must agree with each other first
            if row["hand"] is not None and row["script"] is not None and not close(row["script"], row["hand"], tol):
                row["status"], row["note"] = "FAIL", "hand and script disagree"
            elif all(close(app, r, tol) for r in refs):
                row["status"] = "FIXED" if chk.get("known") else "OK"
                row["note"] = ("known difference gone: " + chk["known"]["note"]) if chk.get("known") else ""
            elif chk.get("known") and close(app, chk["known"]["app"], tol):
                row["status"], row["note"] = "KNOWN", chk["known"]["note"]
            else:
                row["status"], row["note"] = "FAIL", "app differs from the independent value"
            ref = refs[0] if refs else None
            row["diff"] = (app - ref) if (app is not None and ref is not None) else None
            row["diffPct"] = (100 * (app - ref) / ref) if (app is not None and ref) else None
        except Exception as e:  # noqa: BLE001
            row.update(status="ERROR", note=f"{type(e).__name__}: {e}", app=row.get("app"), script=row.get("script"))
        rows.append(row)

    def fmt(x, nd=3):
        return "-" if x is None else (f"{x:,.{nd}f}" if abs(x) < 1e6 else f"{x:.4g}")
    hdr = f"{'check':28s} {'what':30s} {'app':>12s} {'script':>12s} {'hand':>12s} {'diff %':>8s}  status"
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        print(f"{r['id']:28s} {r['what'][:30]:30s} {fmt(r.get('app')):>12s} {fmt(r.get('script')):>12s} "
              f"{fmt(r.get('hand')):>12s} {fmt(r.get('diffPct'), 1):>8s}  {r['status']}"
              + (f"  ({r['note']})" if r.get("note") else ""))
    counts = defaultdict(int)
    for r in rows:
        counts[r["status"]] += 1
    print("\n" + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())),
          f"- source: {'baseline' if args.baseline else 'current engine'}")
    if args.json:
        Path(args.json).write_text(json.dumps(rows, indent=1), encoding="utf-8")
    bad = counts["FAIL"] + counts["ERROR"] + (counts["FIXED"] if args.strict else 0)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
