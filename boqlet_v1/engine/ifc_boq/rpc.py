"""Short, synchronous engine operations shared by internal callers."""
from __future__ import annotations

from . import codelist_import, presets
from .expr import syntax_problem
from .pipeline import names_in_model
from .storage import Storage, read_json_gzip
from .worker import validate

OPERATIONS = {"check", "names", "codelist-read", "codelist-build", "expr-check"}


def call(op: str, request: dict, storage: Storage) -> dict:
    if op == "check":
        kind, doc, library = request["kind"], request["doc"], request.get("library")
        problems = presets.check(kind, doc, library)
        result = {"ok": not problems, "problems": problems}
        if kind == "rules":
            flat = presets.flattened(doc, library)
            if flat is not None:
                result["flattened"] = flat
        return result
    if op == "names":
        dictionaries = request.get("dictionaries", [])
        for doc in dictionaries:
            validate(doc, "dictionary")
        parsed = read_json_gzip(storage, request["parsedKey"])
        names = names_in_model(parsed, dictionaries, presets.resolution())
        optional = {"layer", "dictionary", "entryId"}
        return {"names": [{k: v for k, v in name.items() if v is not None or k not in optional}
                          for name in names]}
    if op == "codelist-read":
        key = request["fileKey"]
        data = storage.get_bytes(key)
        try:
            return codelist_import.read_table(request.get("fileName", key), data)
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError(f"Could not read the file: {exc}") from exc
    if op == "codelist-build":
        mapping = request["mapping"]
        if mapping.get("code") is None or mapping.get("title") is None:
            raise ValueError("Choose the code column and the title column")
        return codelist_import.build_codes(request["rows"], request.get("headerRow", 0), mapping,
                                           request.get("hierarchy", "separator"), request.get("separator"))
    if op == "expr-check":
        if request["context"] not in {"line", "element", "building"}:
            raise ValueError("Unknown expression context")
        expr = request["expr"]
        problem = syntax_problem(expr)
        return {"ok": problem is None, "problems": [problem] if problem else [], "readable": expr}
    raise ValueError("Unknown RPC operation")
