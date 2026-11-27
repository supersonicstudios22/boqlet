"""Evaluate the same brace expressions in rule descriptions and classification item texts."""
from __future__ import annotations

import re
from typing import Any

from .expr import compile_expr, fmt, syntax_problem, tokenize

BLANK = re.compile(r"\{([^{}]+)\}")
LINE_FIELDS = {
    "area", "space", "space_name", "quantity", "qty", "unit", "description", "keys",
    "p", "building", "src", "term", "fire_rating", "rule_id", "rule_kind", "manual_kind",
    "source", "tags",
}


def _source(match: re.Match) -> str:
    return match[1].strip().removeprefix("expr:").strip()


def render(template: str, evaluator, context: dict, on_blank=None) -> str:
    def substitute(match: re.Match) -> str:
        source = _source(match)
        try:
            value = evaluator.evaluate(source, context)
        except (ValueError, TypeError, ArithmeticError):
            if on_blank:
                on_blank(source)
            return match[0]
        if value is None or (value == "" and on_blank):
            if on_blank:
                on_blank(source)
                return match[0]
            return "-"
        return value if isinstance(value, str) else fmt(round(value, 3) if isinstance(value, float) else value)

    return BLANK.sub(substitute, template)


def _references(node: tuple):
    if not node:
        return
    if node[0] == "var":
        yield node[1][0]
        return
    if node[0] == "agg":
        # WHERE has its own item scope; the collection path belongs to the outer context.
        yield node[2][0]
        return
    for item in node:
        if isinstance(item, tuple):
            yield from _references(item)


def check(template: str, measured_fields: set[str]) -> list[str]:
    problems = []
    known = LINE_FIELDS | measured_fields
    for match in BLANK.finditer(template):
        source = _source(match)
        if problem := syntax_problem(source):
            problems.append(f"{match[0]}: {problem}")
        else:
            for name in sorted(set(_references(compile_expr(source))) - known):
                problems.append(f"{match[0]}: unknown item text field '{name}'")
    return problems


# ------------------------------------------------------------------ the Library's editors (review B-13)

NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
SLOT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _formatted(value: object) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, (list, dict, tuple)):
        return None
    return value if isinstance(value, str) else fmt(round(value, 3) if isinstance(value, float) else value)


def _read_back(template: str, filled: str) -> dict[str, str] | None:
    """What the engine put in each blank of `template` (by the blank as written), read back from a text it
    filled; None when the text does not follow the template (it was edited since)."""
    blanks, pattern, last = [], "", 0
    for match in BLANK.finditer(template):
        pattern += re.escape(template[last:match.start()]) + r"([\s\S]*?)"
        blanks.append(match[0])
        last = match.end()
    pattern += re.escape(template[last:])
    hit = re.fullmatch(pattern, filled)
    if not hit:
        return None
    out: dict[str, str] = {}
    for index, blank in enumerate(blanks):
        out.setdefault(blank, hit[index + 1])
    return out


def sample(template: str, evaluator: Any, line: dict[str, Any] | None = None, filled: str | None = None,
           filled_from: str | None = None) -> dict[str, Any]:
    """An item text as the editor shows it (the Library's "Reads as" and sample), filled by the same rules as
    a run (`render`) and with the same number format, without a preview run: plain text and blanks; a blank
    carries `name` when it is a plain field and `value` when the engine has one. Values come from `filled`
    (a text the engine filled in a preview, read back against `filled_from`, the template it was filled from,
    by default this one; a blank written the same in both gets its value), else from `line` (a preview
    line's `keys`, `unit` and `quantity`); with neither, blanks stay as written. Nothing here can fail a
    run: a blank the values don't cover simply has no value."""
    known = _read_back(filled_from or template, filled) if filled else None
    context = None
    if line is not None:
        keys = line.get("keys") or {}
        context = {**keys, "keys": keys, "unit": line.get("unit"), "quantity": line.get("quantity"),
                   "qty": line.get("quantity")}
    pieces: list[dict[str, str]] = []
    last = 0
    for match in BLANK.finditer(template):
        if match.start() > last:
            pieces.append({"text": template[last:match.start()]})
        source = _source(match)
        piece: dict[str, str] = {"blank": match[0]}
        if NAME.fullmatch(source):
            piece["name"] = source
        value = known.get(match[0]) if known else None
        if value is None and context is not None:
            try:
                value = _formatted(evaluator.evaluate(source, context))
            except (ValueError, TypeError, ArithmeticError, KeyError):
                value = None
        if value is not None:
            piece["value"] = value
        pieces.append(piece)
        last = match.end()
    if last < len(template):
        pieces.append({"text": template[last:]})
    text = "".join(piece.get("value", piece.get("blank", piece.get("text", ""))) for piece in pieces)
    return {"pieces": pieces, "text": text}


def _rename_expression(source: str, old: str, new: str) -> tuple[str, int]:
    """`p.<old>` → `p.<new>` in the identifiers of one expression (never inside a string literal); unchanged
    when the text does not parse as an expression."""
    try:
        compile_expr(source)
        tokens = tokenize(source)
    except (ValueError, RecursionError):
        return source, 0
    out, last, changes = [], 0, 0
    for kind, value, start, end in tokens:
        parts = value.split(".") if kind == "id" else []
        if len(parts) >= 2 and parts[0] == "p" and parts[1] == old:
            out.append(source[last:start] + ".".join(["p", new, *parts[2:]]))
            last = end
            changes += 1
    out.append(source[last:])
    return "".join(out), changes


def _rename_text(text: str, old: str, new: str) -> tuple[str, int]:
    """A string of a rule set: an expression as a whole, else a template's blanks; other text is left alone."""
    renamed, changes = _rename_expression(text, old, new)
    if changes or "{" not in text:
        return renamed, changes
    total = 0

    def blank(match: re.Match[str]) -> str:
        nonlocal total
        inner = match[1]
        body = inner.strip().removeprefix("expr:").strip()
        renamed, count = _rename_expression(body, old, new)
        if not count:
            return match[0]
        total += count
        at = inner.rindex(body)
        return "{" + inner[:at] + renamed + inner[at + len(body):] + "}"

    return BLANK.sub(blank, text), total


def rename_param(doc: dict[str, Any], old: str, new: str) -> tuple[dict[str, Any], int]:
    """Rename a rule set's slot everywhere (review B-13, FM-42): its key in `params` (order kept), every
    `{"param": old}` (bound fields, `dependsOn`) and every `p.old` in the expressions and in the templates'
    blanks, parsed as the engine parses them, so a string literal (`"p.old"`) or a label is never touched."""
    if not SLOT.fullmatch(old) or not SLOT.fullmatch(new):
        raise ValueError("A slot name is a letter or underscore followed by letters, digits or underscores")
    changes = 0

    def walk(node: object) -> object:
        nonlocal changes
        if isinstance(node, str):
            renamed, count = _rename_text(node, old, new)
            changes += count
            return renamed
        if isinstance(node, list):
            return [walk(item) for item in node]
        if isinstance(node, dict):
            out: dict[str, object] = {}
            for k, v in node.items():
                if k == "param" and v == old:
                    changes += 1
                    out[k] = new
                else:
                    out[k] = walk(v)
            return out
        return node

    out = walk(doc)
    assert isinstance(out, dict)
    params = out.get("params")
    if isinstance(params, dict) and old in params:
        out["params"] = {new if k == old else k: v for k, v in params.items()}
        changes += 1
    return out, changes
