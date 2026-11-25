"""Independent oracle (review B-03, QS-021): wall areas read from an IFC with ifcopenshell alone, never ifc_boq's
measure code. Per wall: the axis length (its "Axis" polyline) x its body's height (the world z range of its
extruded solid, through the placements) less each opening's width along the wall x the part of its height inside
the wall. Per type: the sum. The Duplex's HAND_BOQ wall rows are these numbers written out by hand."""
from __future__ import annotations

import itertools
import math
from collections import defaultdict

import ifcopenshell
import ifcopenshell.util.element as eu
import ifcopenshell.util.placement as up
import numpy as np


def solids(el):
    for rep in el.Representation.Representations if el.Representation else []:
        if rep.RepresentationIdentifier != "Body":
            continue
        for item in rep.Items:
            clipped = False
            while item.is_a("IfcBooleanResult"):
                item, clipped = item.FirstOperand, True
            if item.is_a("IfcExtrudedAreaSolid"):
                yield item, clipped


def profile_points(p):
    if p.is_a("IfcRectangleProfileDef"):
        pts = [(sx * p.XDim / 2, sy * p.YDim / 2) for sx, sy in itertools.product((-1, 1), (-1, 1))]
        m = up.get_axis2placement(p.Position) if p.Position else np.eye(4)
        return [(m @ np.array([x, y, 0, 1]))[:2] for x, y in pts]
    if p.is_a("IfcArbitraryClosedProfileDef"):
        c = p.OuterCurve
        return [pt.Coordinates[:2] for pt in c.Points] if c.is_a("IfcPolyline") else []
    return []


def corners(el):
    world = up.get_local_placement(el.ObjectPlacement)
    out = []
    for solid, _ in solids(el):
        pos = up.get_axis2placement(solid.Position) if solid.Position else np.eye(4)
        d = np.array(solid.ExtrudedDirection.DirectionRatios, dtype=float)
        d = d / np.linalg.norm(d) * solid.Depth
        for x, y in profile_points(solid.SweptArea):
            for k in (0, 1):
                local = np.array([x, y, 0.0]) + k * d
                out.append((world @ pos @ np.array([*local, 1.0]))[:3])
    return out


def z_range(el):
    zs = [p[2] for p in corners(el)]
    return (min(zs), max(zs)) if zs else (None, None)


def along(el, direction):
    xs = [float(np.dot(p[:2], direction)) for p in corners(el)]
    return max(xs) - min(xs) if xs else None


def axis_length(wall):
    for rep in wall.Representation.Representations:
        if rep.RepresentationIdentifier == "Axis":
            for item in rep.Items:
                if item.is_a("IfcPolyline"):
                    pts = [p.Coordinates for p in item.Points]
                    return sum(math.dist(a[:2], b[:2]) for a, b in zip(pts, pts[1:]))
    return None


def wall_areas(path: str) -> dict[str, float]:
    """Type name -> sum over its walls of axis length x height less the openings (walls without an axis are skipped)."""
    f = ifcopenshell.open(path)
    totals: dict[str, float] = defaultdict(float)
    for wall in f.by_type("IfcWall"):
        t = eu.get_type(wall)
        name = (t.Name if t else wall.ObjectType) or wall.Name
        length = axis_length(wall)
        z0, z1 = z_range(wall)
        if not length or z0 is None:
            continue
        axis = up.get_local_placement(wall.ObjectPlacement)[:2, 0]
        axis = axis / np.linalg.norm(axis)
        deduct = 0.0
        for rel in wall.HasOpenings:
            op = rel.RelatedOpeningElement
            o0, o1 = z_range(op)
            if o0 is not None:
                deduct += (along(op, axis) or 0) * max(0.0, min(o1, z1) - max(o0, z0))
        totals[name] += length * (z1 - z0) - deduct
    return dict(totals)
