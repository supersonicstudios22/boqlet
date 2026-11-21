"""Evaluate the same brace expressions in rule descriptions and classification item texts."""
from __future__ import annotations

import re

from .expr import compile_expr, fmt, syntax_problem

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
