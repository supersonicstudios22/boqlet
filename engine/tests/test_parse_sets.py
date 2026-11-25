"""
Property and quantity sets without a name, or with a name the element already has (review A-31, ENG-011): S12's 30
unnamed IfcElementQuantity crashed the CLI (TypeError on a None key) while the worker path, through JSON, silently
lost them under "null"; same-name sets overwrote each other. They are kept as '#<step id>' and '<name>#2' and listed
in one `pset_renamed` check, and the CLI measures what the worker measures.
"""
from __future__ import annotations

import json

import ifcopenshell
import ifcopenshell.api
from conftest import DUPLEX

from ifc_boq import paths, presets
from ifc_boq.parse import parse_file
from ifc_boq.pipeline import get_boq
from ifc_boq.storage import LocalStorage, read_json_gzip
from ifc_boq.worker import execute


def model_with_sets(tmp_path) -> str:
    f = ifcopenshell.file(schema="IFC4")
    project = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcProject", name="Sets")
    ifcopenshell.api.run("unit.assign_unit", f, units=[f.createIfcSIUnit(None, "LENGTHUNIT", None, "METRE")])
    site = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcSite", name="Site")
    ifcopenshell.api.run("aggregate.assign_object", f, relating_object=project, products=[site])
    wall = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcWall", name="Wall")
    ifcopenshell.api.run("spatial.assign_container", f, relating_structure=site, products=[wall])
    # created under distinct names (the API reuses a set of the same name), then named as the file has them
    for i, (name, props) in enumerate(((None, {"Volume": 5.0}), ("Qto_WallBaseQuantities", {"NetVolume": 4.0}),
                                       ("Qto_WallBaseQuantities", {"GrossVolume": 4.5}))):
        qto = ifcopenshell.api.run("pset.add_qto", f, product=wall, name=f"tmp{i}")
        ifcopenshell.api.run("pset.edit_qto", f, qto=qto, properties=props)
        qto.Name = name
    for i, value in enumerate(("a", "b")):
        pset = ifcopenshell.api.run("pset.add_pset", f, product=wall, name=f"tmp_pset{i}")
        ifcopenshell.api.run("pset.edit_pset", f, pset=pset, properties={"Value": value})
        pset.Name = "Pset_Same"
    path = tmp_path / "sets.ifc"
    f.write(str(path))
    return str(path)


def test_unnamed_and_repeated_sets_are_kept_and_listed(tmp_path):
    doc, _ = parse_file(model_with_sets(tmp_path), overlaps=False)
    wall = next(e for e in doc["elements"] if e["ifcClass"] == "IfcWall")
    reported = wall["quantities"]["reported"]
    unnamed = [k for k in reported if k.startswith("#")]
    assert len(unnamed) == 1 and reported[unnamed[0]] == {"Volume": 5.0}
    assert reported["Qto_WallBaseQuantities"] == {"NetVolume": 4.0}
    assert reported["Qto_WallBaseQuantities#2"] == {"GrossVolume": 4.5}
    assert {wall["psets"]["Pset_Same"]["Value"], wall["psets"]["Pset_Same#2"]["Value"]} == {"a", "b"}
    (check,) = [c for c in doc["verification"]["checks"] if c["code"] == "pset_renamed"]
    assert check["elementIds"] == [wall["id"]] and check["data"]["count"] == 3 and check["data"]["unnamed"] == 1
    assert "null" not in json.dumps(list(reported))


def test_the_cli_path_measures_what_the_worker_path_measures(tmp_path):
    """parse_file (CLI, compare-baseline) and the worker's parse job then run job give the same lines on the Duplex."""
    rules, lib = presets.load_rule_set("as-modelled")
    code_list, mapping = presets.load_classification("acme-cost-codes")
    doc, _ = parse_file(str(DUPLEX))
    cli = get_boq(doc, rules, [(code_list, mapping)], [presets.load_dictionary("global-seed")], presets.resolution(), [], lib)

    storage = LocalStorage(tmp_path)
    storage.put_file("uploads/source.ifc", DUPLEX)
    env = lambda kind, data, prefix: {"jobId": kind, "type": kind, "orgId": "t", "attempt": 1, "contract": "1",
                                      "input": data, "outputPrefix": prefix}
    parsed = execute(env("parse", {"modelVersionId": "d", "sourceKey": "uploads/source.ifc", "fileName": DUPLEX.name}, "p/"), storage)
    assert parsed["status"] == "succeeded", parsed
    run = execute(env("run", {"models": [{"id": "d", **parsed["output"]["artifacts"]}], "ruleSet": {"doc": rules},
                              "classifications": [{"codeList": code_list, "map": mapping}],
                              "dictionaries": [presets.load_dictionary("global-seed")], "resolution": presets.resolution(),
                              "federation": presets.federation()}, "r/"), storage)
    assert run["status"] == "succeeded", run
    worker = read_json_gzip(storage, run["output"]["resultKey"])
    pick = lambda r: sorted((l["key"], l["quantity"], json.dumps(l.get("codes"), sort_keys=True)) for l in r["lines"])
    assert pick(cli) == pick(worker)
    assert sorted(q["id"] for q in cli["questions"]) == sorted(q["id"] for q in worker["questions"])


def test_the_user_preset_folder_is_read_only_when_configured(tmp_path, monkeypatch):
    (tmp_path / "rules").mkdir()
    mine = {**presets.load_rule_set("as-modelled")[0], "id": "local-only", "name": "Local"}
    (tmp_path / "rules" / "local-only.json").write_text(json.dumps(mine), encoding="utf-8")
    monkeypatch.setattr(paths, "USER_PRESETS", None)
    assert "local-only" not in presets.rule_sets()
    assert presets.save("rules", mine)
    monkeypatch.setattr(paths, "USER_PRESETS", tmp_path)
    assert "local-only" in presets.rule_sets()
