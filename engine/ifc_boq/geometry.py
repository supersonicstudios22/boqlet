"""
geometry.py - mesh measurements shared by parse.py (within one file) and federation.py (across files).

Core engine: meshes in, numbers out. No IFC, no decisions (which number to trust is measure.py's).

  room_surfaces    a room solid's floor / ceiling / wall areas, perimeter, height
  element_sides    a planar element's face area on each side of its thin axis
  vertical_faces   a footing's faces standing up, and the part of them against another solid
  side_contacts    where a room's surface lies on a side of a planar element (m2 per room and side)
  shared_volume    solid volume two closed meshes have in common (columns through slabs, duplicates)

Mesh sidecar: every mesh the parser built (elements, openings, spaces), in world coordinates and
float64, saved beside the ParsedModel (`meshes.npz`, save_meshes / load_meshes). The ParsedModel
carries measurements, not meshes; work that needs two models' meshes together (room contacts and
solid overlaps across a federation) reads the sidecar. Without it that work is skipped and logged.
"""
from __future__ import annotations

from functools import cache
from pathlib import Path

import numpy as np
import trimesh

CONTACT_TOL = 0.1    # m: a room surface this close to an element face, and facing it, lies on it
SHARED_MIN = 1e-3    # m3: solids sharing less than this only touch
VERTICAL_NZ = 0.1    # a face whose normal has |z| below this stands up (footing sides and ends)
UP_NZ = 0.05         # a face whose normal has z above this looks up (a roof's top, also when pitched)
CONTACT_OUT = 0.02   # m: a vertical face is in contact where a point this far outside it is in another solid
VERTICAL_CELL = 0.2  # m: spacing of the sample points on a vertical face (contact test)
VERTICAL_K = 40      # at most 40 x 40 sample triangles per mesh triangle


def clip_area(poly: list, ur: tuple, vr: tuple) -> float:
    """Area of a 2D polygon inside the rectangle ur x vr (Sutherland-Hodgman clipping)."""
    def clip(pts, axis, val, keep_ge):
        out = []
        for i in range(len(pts)):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            pin = p[axis] >= val if keep_ge else p[axis] <= val
            qin = q[axis] >= val if keep_ge else q[axis] <= val
            if pin:
                out.append(p)
            if pin != qin:
                t = (val - p[axis]) / (q[axis] - p[axis])
                out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
        return out
    pts = poly
    for axis, val, ge in ((0, ur[0], True), (0, ur[1], False), (1, vr[0], True), (1, vr[1], False)):
        pts = clip(pts, axis, val, ge)
        if len(pts) < 3:
            return 0.0
    return abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2


def room_surfaces(m: trimesh.Trimesh) -> dict:
    """Floor (facing down), ceiling (facing up) and wall (vertical) area of a room solid, the floor
    outline length and the height."""
    nz, area = m.face_normals[:, 2], m.area_faces
    floor, ceil, wall = nz < -0.9, nz > 0.9, np.abs(nz) < 0.1
    perimeter = 0.0
    if floor.any():                     # edges used by one floor triangle only: the outline
        fe = np.sort(m.faces[floor][:, [0, 1, 1, 2, 2, 0]].reshape(-1, 2), axis=1)
        uniq, counts = np.unique(fe, axis=0, return_counts=True)
        b = uniq[counts == 1]
        perimeter = float(np.linalg.norm(m.vertices[b[:, 0]] - m.vertices[b[:, 1]], axis=1).sum())
    return {"floorArea": float(area[floor].sum()), "ceilingArea": float(area[ceil].sum()),
            "wallArea": float(area[wall].sum()), "perimeter": perimeter,
            "height": float(np.ptp(m.vertices[:, 2]))}


def thin_axis(obb_axes) -> np.ndarray:
    """The oriented box's thin axis with a stable sign: up for slabs, else the first clear
    horizontal component positive."""
    n = np.array(obb_axes[2], dtype=float)
    k = 2 if abs(n[2]) > 0.5 else (0 if abs(n[0]) > 1e-6 else 1)
    return n if n[k] > 0 else -n


def element_sides(m: trimesh.Trimesh, obb_axes) -> dict:
    """{axis, a, b}: area of the mesh faces facing along (a) and against (b) the thin axis."""
    n = thin_axis(obb_axes)
    dots = m.face_normals @ n
    return {"axis": [float(v) for v in n], "a": float(m.area_faces[dots > 0.9].sum()),
            "b": float(m.area_faces[dots < -0.9].sum())}


def _lattice(tris: np.ndarray, cell: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Centres, normals and areas of an equal-area subdivision of each triangle into k x k parts
    (k from its longest edge / cell, at most VERTICAL_K): a fixed, deterministic sample of a surface."""
    pts, nrm, area = [], [], []
    for t in tris:
        u, v = t[1] - t[0], t[2] - t[0]
        n = np.cross(u, v)
        a = float(np.linalg.norm(n)) / 2
        if a <= 0:
            continue
        e = max(np.linalg.norm(u), np.linalg.norm(v), np.linalg.norm(t[2] - t[1]))
        bary = _bary(int(min(VERTICAL_K, max(1, np.ceil(e / cell)))))
        pts.append(t[0] + np.outer(bary[:, 0], u) + np.outer(bary[:, 1], v))
        nrm.append(np.repeat([n / (2 * a)], len(bary), axis=0))
        area.append(np.full(len(bary), a / len(bary)))
    if not pts:
        return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0)
    return np.vstack(pts), np.vstack(nrm), np.concatenate(area)


@cache
def _bary(k: int) -> np.ndarray:
    """Barycentric (along u, along v) centres of the k x k sub-triangles of a triangle: the upright
    one of each row i, column j, and the inverted one beside it where there is one."""
    out = []
    for i in range(k):
        for j in range(k - i):
            out.append(((i + 1 / 3) / k, (j + 1 / 3) / k))
            if i + j < k - 1:
                out.append(((i + 2 / 3) / k, (j + 2 / 3) / k))
    return np.array(out)


def vertical_faces(m: trimesh.Trimesh, others: list[trimesh.Trimesh]) -> dict:
    """{area, contact}: area of the faces standing up (|normal z| < VERTICAL_NZ: a footing's sides and
    ends), and the part of it against or inside another closed solid of `others` (a point CONTACT_OUT
    outside the face lies in it: the next footing, a wall, a slab edge). Formwork goes on the rest."""
    sel = np.abs(m.face_normals[:, 2]) < VERTICAL_NZ
    area = float(m.area_faces[sel].sum())
    if area <= 0 or not others:
        return {"area": area, "contact": 0.0}
    pts, nrm, part = _lattice(m.triangles[sel], VERTICAL_CELL)
    probe = pts + nrm * CONTACT_OUT
    inside = np.zeros(len(probe), dtype=bool)
    for o in others:
        lo, hi = o.bounds
        near = ~inside & np.all(probe >= lo, axis=1) & np.all(probe <= hi, axis=1)
        if near.any():
            inside[near] = points_inside(o, probe[near])
    return {"area": area, "contact": min(area, float(part[inside].sum()))}


def up_faces(m: trimesh.Trimesh) -> dict:
    """{area, plan}: the true area of the faces looking up (normal z > UP_NZ, a roof's weathering
    surface, pitched or flat) and their plan projection (A-15: a roof with its own body and no layer set)."""
    sel = m.face_normals[:, 2] > UP_NZ
    area = float(m.area_faces[sel].sum())
    plan = float((m.area_faces[sel] * m.face_normals[sel, 2]).sum())
    return {"area": area, "plan": plan}


def points_inside(m: trimesh.Trimesh, pts: np.ndarray, chunk: int = 2_000_000) -> np.ndarray:
    """Which points lie inside a closed mesh: the winding number (the solid angle its triangles
    subtend at the point, Van Oosterom & Strackee) is about 4 pi inside and 0 outside. Plain numpy,
    no spatial index; points x triangles in chunks."""
    tris = m.triangles
    out = np.zeros(len(pts), dtype=bool)
    step = max(1, chunk // max(1, len(tris)))
    for s in range(0, len(pts), step):
        p = pts[s:s + step]
        a, b, c = (tris[None, :, i, :] - p[:, None, :] for i in range(3))
        la, lb, lc = (np.linalg.norm(x, axis=2) for x in (a, b, c))
        det = np.einsum("ijk,ijk->ij", a, np.cross(b, c))
        div = (la * lb * lc + np.einsum("ijk,ijk->ij", a, b) * lc + np.einsum("ijk,ijk->ij", a, c) * lb
               + np.einsum("ijk,ijk->ij", b, c) * la)
        out[s:s + step] = np.abs(2 * np.arctan2(det, div).sum(axis=1)) > 2 * np.pi
    return out


def room_index(m: trimesh.Trimesh) -> tuple:
    """What side_contacts needs of a room solid."""
    return (m, m.triangles_center, m.face_normals, m.vertices.min(0), m.vertices.max(0))


def side_contacts(m: trimesh.Trimesh, axis, obb_axes, rooms: dict) -> list[dict]:
    """[{spaceId, side, area}]: the area of each room surface lying on side a or b of a planar
    element (facing it, within CONTACT_TOL), clipped to the element's extent along its face."""
    n = np.asarray(axis, dtype=float)
    proj = m.vertices @ n
    da, db = proj.max(), proj.min()
    u, v = np.array(obb_axes[0], dtype=float), np.array(obb_axes[1], dtype=float)
    ur = (float((m.vertices @ u).min()), float((m.vertices @ u).max()))
    vr = (float((m.vertices @ v).min()), float((m.vertices @ v).max()))
    lo, hi = m.vertices.min(0) - CONTACT_TOL, m.vertices.max(0) + CONTACT_TOL
    out = []
    for sid, (rm, cen, nrm, rlo, rhi) in rooms.items():
        if np.any(rhi < lo) or np.any(rlo > hi):
            continue
        rd, rc = nrm @ n, cen @ n
        # a room on side a faces back towards the element (its outward normal is -n)
        for side, mask in (("a", (rd < -0.9) & (np.abs(rc - da) < CONTACT_TOL)),
                           ("b", (rd > 0.9) & (np.abs(rc - db) < CONTACT_TOL))):
            if not mask.any():
                continue
            a = sum(clip_area([(float(p @ u), float(p @ v)) for p in tri], ur, vr) for tri in rm.vertices[rm.faces[mask]])
            if a > 0.01:
                out.append({"spaceId": sid, "side": side, "area": round(a, 6)})
    return out


def boxes_touch(a: trimesh.Trimesh, b: trimesh.Trimesh, gap: float = 1e-4) -> bool:
    lo, hi = np.maximum(a.bounds[0], b.bounds[0]), np.minimum(a.bounds[1], b.bounds[1])
    return bool(np.all(hi - lo > gap))


def shared_volume(a: trimesh.Trimesh, b: trimesh.Trimesh) -> float | None:
    """Volume of the intersection of two solids (m3); 0 when their boxes do not overlap, None when
    the boolean fails (open or broken meshes)."""
    if not boxes_touch(a, b):
        return 0.0
    try:
        return abs(float(a.intersection(b, engine="manifold").volume))
    except Exception:
        return None


def signed_volume(m: trimesh.Trimesh) -> float:
    """The mesh's signed volume (sum of the triangles' tetrahedra from the origin, divided by 6), the volume
    trimesh's mass properties give, without their inertia and centre (review B-23)."""
    t = np.asarray(m.triangles, dtype=np.float64)
    if len(t) == 0:
        return 0.0
    return float(np.einsum("ij,ij->i", t[:, 0], np.cross(t[:, 1], t[:, 2])).sum() / 6.0)


def components(n: int, edges: np.ndarray) -> np.ndarray:
    """Connected components of an undirected graph on nodes 0..n-1: a label per node, the smallest
    node of its component. Vectorised union-find (hook roots, then compress), so large meshes cost a
    few numpy passes instead of a Python graph (networkx took a tenth of a medium model's parse)."""
    label = np.arange(n)
    if len(edges) == 0:
        return label
    a, b = np.asarray(edges[:, 0]), np.asarray(edges[:, 1])
    while True:
        la, lb = label[a], label[b]
        apart = la != lb
        if not apart.any():
            return label
        np.minimum.at(label, np.maximum(la[apart], lb[apart]), np.minimum(la[apart], lb[apart]))
        while True:
            up = label[label]
            if np.array_equal(up, label):
                break
            label = up


def fix_winding(m: trimesh.Trimesh) -> None:
    """Turn the faces of each connected body the same way and each body outward (positive volume).
    The rule is trimesh.repair.fix_normals' (two faces sharing an edge run it in opposite
    directions), spread breadth-first a whole frontier at a time; trimesh does it face by face in
    Python, which was most of a medium MEP model's parse. Unlike fix_normals, each body is turned
    outward on its own, so separate pieces of one element no longer cancel each other's volume."""
    faces = np.array(m.faces)
    count = len(faces)
    pairs, shared = m.face_adjacency, m.face_adjacency_edges
    if count == 0:
        return

    def runs(f, u, v):
        """True where face f runs the edge u -> v (else v -> u)."""
        t = faces[f]
        return ((t[:, 0] == u) & (t[:, 1] == v)) | ((t[:, 1] == u) & (t[:, 2] == v)) | ((t[:, 2] == u) & (t[:, 0] == v))

    flip = np.zeros(count, dtype=bool)
    label = components(count, pairs)
    if len(pairs):
        u, v = shared[:, 0], shared[:, 1]
        clash = runs(pairs[:, 0], u, v) == runs(pairs[:, 1], u, v)       # same direction: one must turn
        src = np.concatenate([pairs[:, 0], pairs[:, 1]])
        dst = np.concatenate([pairs[:, 1], pairs[:, 0]])
        turn = np.concatenate([clash, clash])
        order = np.argsort(src, kind="stable")
        dst, turn = dst[order], turn[order]
        start = np.searchsorted(src[order], np.arange(count + 1))
        seen = np.zeros(count, dtype=bool)
        frontier = np.flatnonzero(label == np.arange(count))             # one root per body keeps its turn
        seen[frontier] = True
        while frontier.size:
            lo, n = start[frontier], start[frontier + 1] - start[frontier]
            total = int(n.sum())
            if total == 0:
                break
            slot = np.repeat(lo - np.cumsum(n) + n, n) + np.arange(total)
            parent, child, step = np.repeat(frontier, n), dst[slot], turn[slot]
            new = ~seen[child]
            child, first = np.unique(child[new], return_index=True)
            flip[child] = flip[parent[new][first]] ^ step[new][first]
            seen[child] = True
            frontier = child
    faces[flip] = faces[flip][:, ::-1]
    verts = np.asarray(m.vertices)
    tri = (verts - verts.mean(0))[faces]                              # centred: georeferenced coordinates are large
    signed = np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2]))
    inward = np.bincount(label, weights=signed, minlength=count) < 0
    turn_body = inward[label]
    faces[turn_body] = faces[turn_body][:, ::-1]
    m.faces = faces


def save_meshes(meshes: dict[str, trimesh.Trimesh], path: str | Path):
    ids = list(meshes)
    verts = [np.asarray(meshes[i].vertices, dtype=np.float64) for i in ids]
    faces = [np.asarray(meshes[i].faces, dtype=np.int32) for i in ids]
    np.savez_compressed(path, ids=np.array(ids), vcount=np.array([len(v) for v in verts], dtype=np.int64),
                        fcount=np.array([len(f) for f in faces], dtype=np.int64),
                        verts=np.concatenate(verts) if verts else np.zeros((0, 3)),
                        faces=np.concatenate(faces) if faces else np.zeros((0, 3), dtype=np.int32))


def load_meshes(path: str | Path) -> dict[str, trimesh.Trimesh]:
    out, vo, fo = {}, 0, 0
    with np.load(path, allow_pickle=False) as data:
        verts, faces = data["verts"], data["faces"]
        for mesh_id, nv, nf in zip(data["ids"], data["vcount"], data["fcount"]):
            out[str(mesh_id)] = trimesh.Trimesh(verts[vo:vo + nv], faces[fo:fo + nf], process=False)
            vo, fo = vo + nv, fo + nf
    return out
