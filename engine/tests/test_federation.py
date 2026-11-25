"""
Federation: several models, one BoQ, measured once (D43, D44; engine/ifc_boq/federation.py).

The buildingSMART certification scene ships the same house as separate discipline models that
share GlobalIds (the chimney, the roof, the placement markers). Expected values come from the
files' own quantity sets or from single-model runs, never from a federated run.
"""
from __future__ import annotations

import json
from collections import defaultdict
from functools import cache

import jsonschema
import pytest

from ifc_boq import presets
from ifc_boq.parse import parse_file
from ifc_boq.paths import FIXTURES, SCHEMAS
from ifc_boq.pipeline import get_boq

SCENE = FIXTURES / "ifc" / "buildingsmart" / "IFC4X3"


@cache
def _parse(name: str) -> str:
    return json.dumps(parse_file(str(SCENE / f"Building-{name}.ifc"), overlaps=False)[0])


def parsed(name: str) -> dict:
    return json.loads(_parse(name))


def run(models, decisions=None) -> dict:
    rs, lib = presets.load_rule_set("as-modelled")
    return get_boq(models, rs, [presets.load_classification("acme-cost-codes")], [presets.load_dictionary("global-seed")],
                   presets.resolution(), decisions or [], lib, federation=presets.federation())


def totals(r: dict) -> dict:
    t = defaultdict(float)
    for l in r["lines"]:
        if l["ruleKind"] == "item" and l["quantity"] is not None:
            t[l["ruleId"]] += l["quantity"]
    return {k: round(v, 2) for k, v in t.items()}


def copy_of(doc: dict, tag: str, shift: float = 0.0) -> dict:
    """The same model under new GlobalIds (as if another discipline modelled the same objects)."""
    text = json.dumps(doc)
    for e in doc["elements"]:
        g = e["id"]
        text = text.replace(f'"{g}"', f'"{tag}{g[len(tag):]}"')
    out = json.loads(text)
    out["header"]["source"]["fileName"] = f"{tag}-{doc['header']['source']['fileName']}"
    out["header"]["source"]["sha256"] = tag + out["header"]["source"]["sha256"][len(tag):]
    if shift:
        for e in out["elements"]:
            g = e["quantities"]["geometry"]
            if g.get("bboxMin"):
                g["bboxMin"] = [v + shift for v in g["bboxMin"]]
                g["bboxMax"] = [v + shift for v in g["bboxMax"]]
    return out


def scene():
    return [{"id": "arch", "parsed": parsed("Architecture"), "discipline": "architecture"},
            {"id": "str", "parsed": parsed("Structural"), "discipline": "structure"},
            {"id": "hvac", "parsed": parsed("Hvac"), "discipline": "mep"}]


def test_one_model_is_a_federation_of_one():
    doc = parsed("Architecture")
    a, b = run(doc), run([{"id": "x", "parsed": doc}])
    assert totals(a) == totals(b)
    assert len(b["models"]) == 1 and b["models"][0]["taken"] == b["models"][0]["elements"]


def test_certification_scene_three_disciplines():
    r = run(scene())
    jsonschema.validate(json.loads(json.dumps(r)), json.loads((SCHEMAS / "boq-result.schema.json").read_text(encoding="utf-8")))
    t = totals(r)
    # the chimney is in all three models under one GlobalId: counted once, from the copy with a body (structure)
    chimney = [e for l in r["lines"] for e in l["trace"]["elements"] if e.get("name") == "house - chimney"]
    assert len(chimney) == 1 and chimney[0]["model"] == "str"
    # one roof GlobalId: the architectural roof (two slabs, Qto NetArea 22.401143 + 31.211693) ...
    assert t["roofs"] == pytest.approx(53.61)
    # ... and the structural roof's timber girders are still measured (Qto lengths, 24.7 m)
    assert t["linear-other"] == pytest.approx(24.7)
    # no element is measured twice by one rule (a concrete slab is in both `slabs` and `slab-concrete` by design;
    # a breakdown measures each part once: paint on both faces of the plumbing wall)
    pairs = [(l["ruleId"], e["guid"], e.get("name")) for l in r["lines"] if l["ruleKind"] == "item" for e in l["trace"]["elements"]]
    assert len(pairs) == len(set(pairs))
    assert not [q for q in r["questions"] if q["kind"] in ("unmatched", "overlap")]


def test_walls_only_in_the_structural_model_are_not_lost():
    """Structure does not own a non-load-bearing sand-lime wall (architecture does), but the
    architectural model has no wall in its place: the walls are taken from structure, and a
    warning says so. Walls total = both models' walls by their measured faces (A-09; the files' Qto
    NetSideArea is volume / thickness, 0.1 % less on the structural walls). (Matching by family instead
    of IFC class once paired a structural wall with the architectural roof slab.)"""
    arch, struc = parsed("Architecture"), parsed("Structural")
    q = lambda doc: sum((e["quantities"]["geometry"]["sides"]["a"] + e["quantities"]["geometry"]["sides"]["b"]) / 2
                        for e in doc["elements"] if e["ifcClass"] == "IfcWall")
    r = run(scene())
    assert totals(r)["walls"] == pytest.approx(round(q(arch) + q(struc), 2), abs=0.02)
    rep = {m["id"]: m for m in r["models"]}
    assert rep["str"]["leftToOthers"] == 0 and rep["str"]["takenWithoutOwner"] >= 4
    assert any(w["code"] == "federation_hole" and "IfcWall" in w["message"] for w in r["warnings"])


def test_a_retagged_copy_adds_nothing():
    """Federating a model with a copy of itself under new GlobalIds and another discipline must
    give the single-model BoQ: every element is left to the one discipline that owns it."""
    struc = parsed("Structural")
    single = totals(run(struc))
    r = run([{"id": "str", "parsed": struc, "discipline": "structure"},
             {"id": "copy", "parsed": copy_of(struc, "ZZ"), "discipline": "architecture"}])
    assert totals(r) == single
    assert not [q for q in r["questions"] if q["kind"] == "overlap"]


def run_with(models, federation_settings: dict, decisions=None) -> dict:
    rs, lib = presets.load_rule_set("as-modelled")
    return get_boq(models, rs, [presets.load_classification("acme-cost-codes")], [presets.load_dictionary("global-seed")],
                   presets.resolution(), decisions or [], lib, federation=federation_settings)


def test_overlap_question_and_answer():
    """If both models take the beams (scope include), the engine asks which model provides them;
    unanswered, both are kept and flagged, and the question blocks (review A-19: "complete" can't hide
    a double count); answered, one is dropped."""
    struc = parsed("Structural")
    models = [{"id": "str", "parsed": struc, "discipline": "structure"},
              {"id": "copy", "parsed": copy_of(struc, "ZZ"), "discipline": "architecture",
               "scope": {"include": [{"ifcClass": "IfcBeam"}]}}]
    r = run(models)
    q = next(q for q in r["questions"] if q["kind"] == "overlap")
    assert q["id"] == "overlap:architecture|structure:IfcBeam" and q["occurrences"] == 6
    assert q["blocking"] is True and r["status"] == "needs_input"
    assert totals(r)["linear-other"] == pytest.approx(2 * 24.7)
    assert any(w["code"] == "federation_overlap" for w in r["warnings"])
    r2 = run(models, [{"questionId": q["id"], "scope": "project", "answer": "structure"}])
    assert totals(r2)["linear-other"] == pytest.approx(24.7)
    assert not [q for q in r2["questions"] if q["kind"] == "overlap"]


def test_overlap_questions_inform_when_the_setting_is_off():
    """`overlapBlocking: false`: the same question, informative, as before A-19."""
    struc = parsed("Structural")
    models = [{"id": "str", "parsed": struc, "discipline": "structure"},
              {"id": "copy", "parsed": copy_of(struc, "ZZ"), "discipline": "architecture",
               "scope": {"include": [{"ifcClass": "IfcBeam"}]}}]
    r = run_with(models, {**presets.federation(), "overlapBlocking": False})
    q = next(q for q in r["questions"] if q["kind"] == "overlap")
    assert q["blocking"] is False
    assert not any(x["blocking"] for x in r["questions"] if x["kind"] == "overlap")


def test_scope_exclude():
    r = run([{"id": "arch", "parsed": parsed("Architecture"), "discipline": "architecture",
              "scope": {"exclude": [{"ifcClass": "IfcEarthworksFill"}]}}])
    assert "earthworks-modelled" not in totals(r)
    assert r["models"][0]["excludedByScope"] == 1


def test_storeys_are_aligned():
    """'00 groundfloor' at 0.00 in the structural model and 'Ground floor' at +0.05 in the
    architectural one are one level; the architectural name wins. (These files carry no storey
    elevation, so both are set here.)"""
    struc = parsed("Structural")
    other = copy_of(struc, "ZZ")
    for doc, name, z in ((struc, "00 groundfloor", 0.0), (other, "Ground floor", 0.05)):
        for s in doc["spatial"]:
            if s["kind"] == "storey":
                s["name"], s["elevation"] = name, z
    r = run([{"id": "str", "parsed": struc, "discipline": "structure"},
             {"id": "copy", "parsed": other, "discipline": "architecture"}])
    storeys = {l.get("location", {}).get("storey") for l in r["lines"] if l["ruleKind"] == "item"} - {None}
    assert storeys == {"Ground floor"}
    assert any("storey '00 groundfloor'" in e["message"] for e in r["log"])


def test_models_far_apart_are_reported():
    struc = parsed("Structural")
    r = run([{"id": "str", "parsed": struc, "discipline": "structure"},
             {"id": "copy", "parsed": copy_of(struc, "ZZ", shift=5000.0), "discipline": "architecture"}])
    assert any(w["code"] == "federation_coordinates" for w in r["warnings"])


def test_overlap_question_id_survives_a_new_file_name():
    """TF-053: two models of one discipline are told apart by the model's name the API sends (stable
    across versions), not the upload's file name, so an answered overlap stays answered."""
    struc = parsed("Structural")

    def models(file_name):
        copy = copy_of(struc, "ZZ")
        copy["header"]["source"]["fileName"] = file_name
        return [{"id": "v1", "parsed": struc, "discipline": "structure", "name": "Steel frame"},
                {"id": "v2", "parsed": copy, "discipline": "structure", "name": "Steel frame copy",
                 "scope": {"include": [{"ifcClass": "IfcBeam"}]}}]
    first = next(q for q in run(models("frame.ifc"))["questions"] if q["kind"] == "overlap")
    assert first["id"] == "overlap:structure/Steel frame|structure/Steel frame copy:IfcBeam"
    again = run(models("frame_rev2.ifc"), [{"questionId": first["id"], "scope": "project", "answer": "structure/Steel frame"}])
    assert first["id"] not in {q["id"] for q in again["questions"]}


def test_embedded_pairs_whose_boolean_fails_are_logged(monkeypatch):
    """TF-060: a column through a slab of another model that can't be intersected is reported, not skipped."""
    import trimesh

    from ifc_boq import federation, geometry
    from ifc_boq.log import CalcLog
    slab, column = trimesh.creation.box((4, 4, 0.2)), trimesh.creation.box((0.3, 0.3, 3))
    arch = {"id": "a", "fileName": "arch.ifc", "meshes": {"S": slab}}
    struc = {"id": "s", "fileName": "str.ifc", "meshes": {"C": column}}
    taken = [{"guid": "S", "family": "planar", "ifc_class": "IfcSlab", "name": "Slab"},
             {"guid": "C", "family": "linear", "ifc_class": "IfcColumn", "name": "Column"}]
    monkeypatch.setattr(geometry, "shared_volume", lambda a, b: None)
    log = CalcLog()
    federation._embedded_across(taken, {"S", "C"}, {"S": arch, "C": struc}, log)
    entry = next(e for e in log.entries if e["code"] == "log.federation.embedded_failed")
    assert entry["level"] == "warning" and entry["params"]["count"] == 1 and entry["params"]["pairs"] == [["S", "C"]]


# ------------------------------------------------------------------ same GlobalId copies that disagree (review A-18)

def same_ids_copy(doc: dict, change) -> dict:
    """The same model under the same GlobalIds, as another discipline exported it; `change(element)` edits it."""
    out = json.loads(json.dumps(doc))
    out["header"]["source"]["fileName"] = "arch-" + out["header"]["source"]["fileName"]
    for e in out["elements"]:
        change(e)
    return out


def test_identical_copies_raise_no_question():
    struc = parsed("Structural")
    r = run([{"id": "str", "parsed": struc, "discipline": "structure"},
             {"id": "arch", "parsed": same_ids_copy(struc, lambda e: None), "discipline": "architecture"}])
    assert not [q for q in r["questions"] if q["kind"] == "duplicate_conflict"]
    assert totals(r) == totals(run(struc))


def test_copies_that_disagree_raise_a_duplicate_conflict_question():
    """The inner wall's architectural copy names another type: one non-blocking question per GlobalId, showing
    both copies; unanswered the owning discipline's copy is used, answered the named copy is."""
    struc = parsed("Structural")
    wall = next(e for e in struc["elements"] if e["name"] == "house - inner wall")

    def retype(e):
        if e["id"] == wall["id"]:
            e["typeId"], e["objectType"] = None, "Partition 100"
    models = [{"id": "str", "parsed": struc, "discipline": "structure"},
              {"id": "arch", "parsed": same_ids_copy(struc, retype), "discipline": "architecture"}]
    r = run(models)
    jsonschema.validate(json.loads(json.dumps(r)), json.loads((SCHEMAS / "boq-result.schema.json").read_text(encoding="utf-8")))
    qs = [q for q in r["questions"] if q["kind"] == "duplicate_conflict"]
    assert [q["id"] for q in qs] == [f"duplicate_conflict:{wall['id']}"]
    q = qs[0]
    assert q["blocking"] is False and q["params"]["fields"] == ["type"]
    names = {c["model"]: c["typeName"] for c in q["params"]["copies"]}
    assert names["architecture"] == "Partition 100" and names["structure"] not in (None, "Partition 100")
    assert [o["value"] for o in q["answer"]["options"]] == ["architecture", "structure"]
    used = q["suggestion"]
    assert next(o for o in q["answer"]["options"] if o["recommended"])["value"] == used

    def model_of_wall(result):
        return {e["model"] for l in result["lines"] if l["ruleId"] == "walls" for e in l["trace"]["elements"]
                if e["guid"] == wall["id"]}
    assert model_of_wall(r) == {"str" if used == "structure" else "arch"}
    other = "architecture" if used == "structure" else "structure"
    r2 = run(models, [{"questionId": q["id"], "scope": "project", "answer": other}])
    assert not [x for x in r2["questions"] if x["kind"] == "duplicate_conflict"]
    assert model_of_wall(r2) == {"str" if other == "structure" else "arch"}
    assert any(e["code"] == "log.decision.duplicate_copy" for e in r2["log"])
    assert r2["stats"]["decisionsApplied"] == 1


def _el(guid, **kw):
    return {"guid": guid, "ifc_class": "IfcSlab", "ifc_class_raw": "IfcSlab", "family": "planar", "name": "Slab",
            "type_name": "Slab 200", "material": "concrete", "material_raw": "Concrete", "thickness": 0.2,
            "net_volume": 2.0, "net_area": 10.0, "length": 5.0, "child_guids": [], "parent_guid": None,
            "load_bearing": None, "provenance": {}, "openings": [], **kw}


def _combine(copies, answers=None):
    from ifc_boq import federation
    from ifc_boq.expr import Expr
    from ifc_boq.log import CalcLog
    box = ([0, 0, 0], [5, 2, 0.2])
    models = [{"id": mid, "fileName": f"{mid}.ifc", "discipline": disc, "elements": [e], "boxes": {e["guid"]: box},
               "parsed": {"elements": [{"id": e["guid"], "quantities": {"geometry": {}}}], "openings": [], "spatial": []},
               "meshes": None} for mid, disc, e in copies]
    return federation.combine(models, presets.federation(), Expr(), CalcLog(), answers or {}, resolution=presets.resolution())


def test_a_copy_more_than_the_block_threshold_apart_blocks_and_the_owner_wins():
    """CL_W1 in F01: the architectural copy says load-bearing concrete (structure's by the default ownership),
    the structural copy says not load-bearing, so neither model owned its own copy and model order kept the
    architectural 24 m2. Ownership is now judged on every copy: structure's copy is used, and 24 vs 45 m2
    (+86 %, beyond the 50 % block threshold) blocks."""
    elements, _, questions, _ = _combine([
        ("arc", "architecture", _el("W", ifc_class="IfcWall", ifc_class_raw="IfcWall", load_bearing=True, net_area=24.29)),
        ("str", "structure", _el("W", ifc_class="IfcWall", ifc_class_raw="IfcWall", load_bearing=False, net_area=45.25))])
    assert [e["model_id"] if "model_id" in e else e["net_area"] for e in elements] == [45.25]
    q = questions[0]
    assert q["id"] == "duplicate_conflict:W" and q["blocking"] is True and q["suggestion"] == "structure"
    assert q["params"]["fields"] == ["area"]


def test_small_differences_and_missing_values_are_not_a_conflict():
    elements, _, questions, _ = _combine([
        ("arc", "architecture", _el("S", net_area=10.5, material=None, material_raw=None)),   # +5 %: below the 10 % warn threshold
        ("str", "structure", _el("S"))])
    assert questions == [] and len(elements) == 1


def test_a_material_difference_asks_without_blocking():
    _, _, questions, _ = _combine([("arc", "architecture", _el("P", material="metal.steel", material_raw="Steel")),
                                   ("str", "structure", _el("P"))])
    assert [(q["params"]["fields"], q["blocking"], q["suggestion"]) for q in questions] == [(["material"], False, "structure")]
