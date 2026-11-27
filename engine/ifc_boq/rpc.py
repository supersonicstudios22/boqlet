"""Short, synchronous engine operations shared by internal callers."""
from __future__ import annotations

from base64 import b64decode, b64encode
from contextlib import contextmanager
from threading import BoundedSemaphore

from . import codelist_import, presets
from . import templates as item_texts
from .expr import Expr, syntax_problem
from .pipeline import names_in_model
from .storage import Storage, read_json_gzip
from .worker import validate

TEMPLATE_OPERATIONS = {"template-export", "template-import"}
OPERATIONS = {"check", "names", "codelist-read", "codelist-build", "expr-check", "item-text-sample",
              "rename-param"} | TEMPLATE_OPERATIONS
ITEM_TEXT_SAMPLES_MAX = 500  # one Library page of codes (review B-13)
# A user's workbook may take a few hundred MB while it is read (TF-039 caps one at 64 MB expanded, about
# 500 MB in memory at worst), so the rpc engine reads at most this many at once (TF-187).
WORKBOOK_READ_SLOTS = 2
WORKBOOK_READS = BoundedSemaphore(WORKBOOK_READ_SLOTS)
WORKBOOK_WAIT_SECONDS = 5.0  # well inside the API's 15 s rpc timeout


class Busy(RuntimeError):
    """Every workbook slot stayed taken for the whole wait; the caller should try again shortly."""


@contextmanager
def _workbook_slot():
    if not WORKBOOK_READS.acquire(timeout=WORKBOOK_WAIT_SECONDS):
        raise Busy("The engine is reading other workbooks right now; try again in a moment.")
    try:
        yield
    finally:
        WORKBOOK_READS.release()


def call(op: str, request: dict, storage: Storage) -> dict:
    if op in TEMPLATE_OPERATIONS:
        from .sheets import templates

        if op == "template-export":
            return {"xlsx": b64encode(templates.write(request)).decode("ascii")}
        content = b64decode(request["file"], validate=True)
        with _workbook_slot():
            return templates.read(request, content)
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
        with _workbook_slot():
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
    if op == "item-text-sample":
        # The Library's "Reads as" and samples: the engine's own filling and number format (review B-13).
        items = request.get("items") or []
        if len(items) > ITEM_TEXT_SAMPLES_MAX:
            raise ValueError(f"At most {ITEM_TEXT_SAMPLES_MAX} item texts at once")
        evaluator = Expr()
        return {"results": [item_texts.sample(str(item.get("template", "")), evaluator, item.get("line"),
                                              item.get("filled"), item.get("filledFrom")) for item in items]}
    if op == "rename-param":
        doc, changes = item_texts.rename_param(request["doc"], request["from"], request["to"])
        return {"doc": doc, "changes": changes}
    raise ValueError("Unknown RPC operation")
