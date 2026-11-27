"""The vectorised mesh helpers (geometry.components, geometry.fix_winding) agree with trimesh's
graph and repair code they replace (TS-002: they were most of a medium MEP model's parse)."""
import numpy as np
import trimesh

from ifc_boq.geometry import components, fix_winding


def test_components_match_trimesh():
    rng = np.random.default_rng(7)
    for _ in range(100):
        n = int(rng.integers(1, 300))
        edges = rng.integers(0, n, (int(rng.integers(0, 400)), 2))
        label = components(n, edges)
        expected = trimesh.graph.connected_components(edges, nodes=np.arange(n), min_len=1)
        assert len(set(label.tolist())) == len(expected)
        for comp in expected:
            assert len(set(label[comp].tolist())) == 1
            assert label[comp][0] == min(comp)


def scrambled(mesh, rng, share=0.4):
    out = mesh.copy()
    faces = np.array(out.faces)
    flip = rng.random(len(faces)) < share
    faces[flip] = faces[flip][:, ::-1]
    out.faces = faces
    return out


def test_fix_winding_restores_consistent_outward_bodies():
    rng = np.random.default_rng(11)
    pipe = trimesh.creation.cylinder(radius=0.05, height=12, sections=24)
    far = trimesh.creation.box().apply_translation([1e6, 2e6, 0])          # georeferenced coordinates
    for body in (trimesh.creation.box(), pipe, far, trimesh.creation.icosphere(subdivisions=3)):
        for _ in range(10):
            mesh = scrambled(body, rng)
            fix_winding(mesh)
            assert mesh.is_winding_consistent
            assert abs(mesh.volume - body.volume) < 1e-6 * max(1.0, body.volume)


def test_fix_winding_turns_each_body_outward():
    """Two separate boxes, the second turned inside out: both count (trimesh's repair cancels them)."""
    pair = trimesh.util.concatenate([trimesh.creation.box(), trimesh.creation.box().apply_translation([5, 0, 0])])
    faces = np.array(pair.faces)
    faces[12:] = faces[12:][:, ::-1]
    pair.faces = faces
    fix_winding(pair)
    assert abs(pair.volume - 2.0) < 1e-9


def test_signed_volume_is_trimesh_volume_without_mass_properties():
    """Review B-23: the volume a repaired mesh reports before repair comes from the plain tetrahedra sum."""
    import trimesh as _trimesh

    from ifc_boq.geometry import signed_volume

    box = _trimesh.creation.box(extents=(2.0, 3.0, 0.25))
    box.apply_translation((1000.0, -250.0, 3.0))           # away from the origin, as georeferenced models are
    assert abs(signed_volume(box) - box.volume) < 1e-9 * box.volume
    flipped = _trimesh.Trimesh(box.vertices, box.faces[:, ::-1], process=False)
    assert abs(signed_volume(flipped) + box.volume) < 1e-9 * box.volume
    sphere = _trimesh.creation.icosphere(subdivisions=3, radius=0.7)
    assert abs(signed_volume(sphere) - sphere.volume) < 1e-9 * sphere.volume
    assert signed_volume(_trimesh.Trimesh()) == 0.0
