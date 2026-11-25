r"""
expr.py - the small, safe expression language used across rules, dictionaries and maps.

Spec (also in packages/types/src/rules.ts, `Expr`):
  literals     12  0.5  "text"  true  false  null   (text as written, any language; escapes only \" \\ \n \t \uXXXX)
  operators    + - * /  ( )  = != > >= < <=  AND OR NOT
  functions    IF(c,a,b) MIN(a,b,..) MAX(a,b,..) ROUND(x,step) CEIL(x,step) FLOOR(x,step)
               ABS(x) SQRT(x) PI() COALESCE(a,b,..) UNDER(term,"root") CONTAINS(text,"x") LOWER(x)
  variables    dotted paths into the context: net_area, src.length, p.opening_threshold,
               keys.type_name, props["Pset_WallCommon.FireRating"]
  aggregates   SUM | COUNT | AVG | MIN | MAX over a list, with optional WHERE evaluated per item:
               SUM(openings.area WHERE area > p.min_opening)
               COUNT(openings WHERE kind = "door")
               SUM(src.layers.area WHERE UNDER(material, "board.plasterboard"))

Semantics
  - No Python eval. Expressions are parsed to an AST once (cached) and evaluated.
  - Unknown variables are null. Arithmetic with null gives null. Comparisons with null
    are false except `= null` / `!= null`. AND / OR treat null as false.
  - Inside WHERE, item fields shadow the outer context (so `area` is the opening's area,
    while `p.x` still reaches the parameters).

`explain()` returns the expression with variable and aggregate values substituted, for the
calculation log: "2 * src.length * src.height" -> "2 * 17.383 * 0.3 = 10.43".
"""
from __future__ import annotations

import math
import re
from collections.abc import Callable
from functools import lru_cache
from typing import Any

TOKEN = re.compile(r"""\s*(?:
    (?P<num>\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|
    (?P<str>"(?:[^"\\]|\\.)*")|
    (?P<op>!=|>=|<=|=|>|<|\+|-|\*|/|\(|\)|,|\[|\])|
    (?P<id>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)
)""", re.X)
KEYWORDS = {"AND", "OR", "NOT", "TRUE", "FALSE", "NULL", "WHERE"}
AGGREGATES = {"SUM", "COUNT", "AVG", "MIN", "MAX"}


class ExprError(ValueError):
    pass


ESCAPE = re.compile(r'\\(u[0-9a-fA-F]{4}|["\\nt])')
ESCAPED = {'"': '"', "\\": "\\", "n": "\n", "t": "\t"}


def unescape(body: str) -> str:
    """A string literal's text (review A-22, ENG-001): only \\" \\\\ \\n \\t and \\uXXXX are escapes; every other
    character, non-ASCII ones included, stays as written (a backslash before anything else is kept)."""
    return ESCAPE.sub(lambda m: chr(int(m[1][1:], 16)) if m[1][0] == "u" else ESCAPED[m[1]], body)


MAX_LENGTH = 10_000      # characters in one expression (review A-27)
MAX_NESTING = 64         # brackets, calls, NOT and minus signs inside each other
MAX_TREE_DEPTH = 200     # operators chained in one expression (a + b + c ...): evaluation recurses this deep


def tokenize(src: str):
    if len(src) > MAX_LENGTH:
        raise ExprError(f"The expression is {len(src):,} characters long; at most {MAX_LENGTH:,} are allowed")
    pos, out = 0, []
    n = len(src)
    while pos < n:
        if src[pos:].strip() == "":
            break
        m = TOKEN.match(src, pos)
        if not m or m.end() == pos:
            raise ExprError(f"Unexpected text at {pos}: {src[pos:pos + 20]!r} in {src!r}")
        kind = m.lastgroup
        val = m.group(kind)
        start = m.start(kind)
        if kind == "id" and val.upper() in KEYWORDS:
            kind, val = "kw", val.upper()
        out.append((kind, val, start, m.end()))
        pos = m.end()
    return out


# ------------------------------------------------------------------------ parser -> AST
class _P:
    def __init__(self, src: str):
        self.src = src
        self.t = tokenize(src)
        self.i = 0
        self.depth = 0

    def nest(self):
        """One level deeper (a bracket, a call, NOT, a minus sign); refuses more than MAX_NESTING (review A-27)."""
        self.depth += 1
        if self.depth > MAX_NESTING:
            raise ExprError(f"The expression is nested too deeply at {self.peek()[2]} (at most {MAX_NESTING} levels) in "
                            f"{self.src[:60]!r}{'...' if len(self.src) > 60 else ''}")

    def peek(self, k=0):
        j = self.i + k
        return self.t[j] if j < len(self.t) else (None, None, len(self.src), len(self.src))

    def take(self, kind=None, val=None):
        k, v, s, e = self.peek()
        if (kind and k != kind) or (val and v != val):
            raise ExprError(f"Expected {val or kind} at {s}, got {v!r} in {self.src!r}")
        self.i += 1
        return v, s, e

    def parse(self):
        node = self.or_()
        if self.i != len(self.t):
            raise ExprError(f"Unexpected {self.peek()[1]!r} in {self.src!r}")
        if tree_depth(node) > MAX_TREE_DEPTH:
            raise ExprError(f"The expression chains more than {MAX_TREE_DEPTH} operators; split it with a formula slot")
        return node

    def or_(self):
        a = self.and_()
        while self.peek()[:2] == ("kw", "OR"):
            self.take()
            a = ("or", a, self.and_())
        return a

    def and_(self):
        a = self.not_()
        while self.peek()[:2] == ("kw", "AND"):
            self.take()
            a = ("and", a, self.not_())
        return a

    def not_(self):
        if self.peek()[:2] == ("kw", "NOT"):
            self.take()
            self.nest()
            node = ("not", self.not_())
            self.depth -= 1
            return node
        return self.cmp()

    def cmp(self):
        a = self.add()
        k, v, _, _ = self.peek()
        if k == "op" and v in ("=", "!=", ">", ">=", "<", "<="):
            self.take()
            return ("cmp", v, a, self.add())
        return a

    def add(self):
        a = self.mul()
        while self.peek()[:2] in (("op", "+"), ("op", "-")):
            op, _, _ = self.take()
            a = ("bin", op, a, self.mul())
        return a

    def mul(self):
        a = self.unary()
        while self.peek()[:2] in (("op", "*"), ("op", "/")):
            op, _, _ = self.take()
            a = ("bin", op, a, self.unary())
        return a

    def unary(self):
        if self.peek()[:2] == ("op", "-"):
            self.take()
            self.nest()
            node = ("neg", self.unary())
            self.depth -= 1
            return node
        return self.atom()

    def atom(self):
        k, v, s, e = self.peek()
        if k == "num":
            self.take()
            return ("lit", float(v))
        if k == "str":
            self.take()
            return ("lit", unescape(v[1:-1]))
        if k == "kw" and v in ("TRUE", "FALSE", "NULL"):
            self.take()
            return ("lit", {"TRUE": True, "FALSE": False, "NULL": None}[v])
        if (k, v) == ("op", "("):
            self.take()
            self.nest()
            node = self.or_()
            self.take("op", ")")
            self.depth -= 1
            return node
        if k == "id":
            self.take()
            if self.peek()[:2] == ("op", "("):
                return self.call(v, s)
            path = v.split(".")
            end = e
            while self.peek()[:2] == ("op", "["):          # props["Pset.Prop"]
                self.take()
                key, _, _ = self.take("str")
                path.append(unescape(key[1:-1]))
                _, _, end = self.take("op", "]")
            return ("var", tuple(path), s, end)
        raise ExprError(f"Unexpected {v!r} at {s} in {self.src!r}")

    def call(self, name, start):
        uname = name.upper()
        self.take("op", "(")
        self.nest()
        try:
            return self._call(uname, start)
        finally:
            self.depth -= 1

    def _call(self, uname, start):
        # aggregate form: NAME(path [WHERE expr])
        if uname in AGGREGATES and self.peek()[0] == "id" and self.peek(1)[:2] in (("kw", "WHERE"), ("op", ")")):
            path, _, _ = self.take("id")
            where = None
            if self.peek()[:2] == ("kw", "WHERE"):
                self.take()
                where = self.or_()
            _, _, end = self.take("op", ")")
            return ("agg", uname, tuple(path.split(".")), where, start, end)
        args = []
        if self.peek()[:2] != ("op", ")"):
            args.append(self.or_())
            while self.peek()[:2] == ("op", ","):
                self.take()
                args.append(self.or_())
        _, _, end = self.take("op", ")")
        return ("call", uname, tuple(args), start, end)


def tree_depth(node) -> int:
    """How deep a syntax tree is, without recursion (a tree may be deeper than Python's stack)."""
    deepest, stack = 0, [(node, 1)]
    while stack:
        n, d = stack.pop()
        deepest = max(deepest, d)
        stack.extend((x, d + 1) for x in n if isinstance(x, tuple)) if isinstance(n, tuple) else None
    return deepest


@lru_cache(maxsize=4096)
def compile_expr(src: str):
    try:
        return _P(src).parse()
    except RecursionError:           # belt and braces: never a crash (an outage to the API), always a user error
        raise ExprError(f"The expression is nested too deeply to read: {src[:60]!r}") from None


def syntax_problem(src: str) -> str | None:
    """Parse without evaluating: a syntax error or an unknown function, else None (used by editors)."""
    try:
        node = compile_expr(src)
    except ExprError as e:
        return str(e)
    known = set(default_functions()) | AGGREGATES
    stack = [node]
    while stack:
        n = stack.pop()
        if isinstance(n, tuple):
            if n and n[0] == "call" and n[1] not in known:
                return f"Unknown function {n[1]} in {src!r}"
            stack.extend(x for x in n if isinstance(x, tuple))
    return None


# ------------------------------------------------------------------------ evaluation
def resolve(ctx: Any, path) -> Any:
    cur = ctx
    for part in path:
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur


def _resolve_collection(ctx, path):
    """Walk a path until a list is met. Returns (items, remaining_path) or (scalar, None)."""
    cur = ctx
    for i, part in enumerate(path):
        if isinstance(cur, list):
            return cur, path[i:]
        cur = cur.get(part) if isinstance(cur, dict) else None
        if cur is None:
            return None, None
    if isinstance(cur, list):
        return cur, ()
    return cur, None


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def round_half_up(q: float) -> float:
    """Halves away from zero, as Excel's ROUND (not Python's banker's rounding, TF-059). The tolerance
    absorbs float noise from dividing by a step (0.125 / 0.01 = 12.4999...)."""
    return math.copysign(math.floor(abs(q) + 0.5 + 1e-9), q)


STEP_TOLERANCE = 1e-9     # in steps: absorbs float noise from dividing by a step (0.3 / 0.1 = 2.9999999999999996)


def step_round(x: float, step: float, mode: str = "nearest") -> float:
    """x to a multiple of `step`: "down" (FLOOR), "up" (CEIL) or "nearest" (ROUND, halves away from zero). The one
    step-rounding of the engine (review A-23): FLOOR / CEIL / ROUND with a step and a rule's `rounding` use it, so
    FLOOR(0.3, 0.1) is 0.3 (not 0.2) and no result carries a float tail (rounded to 10 decimals)."""
    q = x / step
    q = math.ceil(q - STEP_TOLERANCE) if mode == "up" else math.floor(q + STEP_TOLERANCE) if mode == "down"         else round_half_up(q)
    return round(q * step, 10)


def _step_round(mode: str, fn):
    def f(x, step=None):
        if not _num(x):
            return None
        if step in (None, 0) or not _num(step):
            return float(fn(x))
        return step_round(x, step, mode)
    return f


def default_functions(broader: dict[str, str | None] | None = None) -> dict[str, Callable]:
    broader = broader or {}

    def under(term, root):
        seen = 0
        while term and seen < 50:
            if term == root:
                return True
            term = broader.get(term)
            seen += 1
        return False

    def mn(*a):
        vals = [x for x in a if _num(x)]
        return min(vals) if vals else None

    def mx(*a):
        vals = [x for x in a if _num(x)]
        return max(vals) if vals else None

    return {
        "IF": lambda c, a, b=None: a if c else b,
        "MIN": mn,
        "MAX": mx,
        "ROUND": _step_round("nearest", round_half_up),
        "CEIL": _step_round("up", math.ceil),
        "FLOOR": _step_round("down", math.floor),
        "ABS": lambda x: abs(x) if _num(x) else None,
        "SQRT": lambda x: math.sqrt(x) if _num(x) and x >= 0 else None,
        "PI": lambda: math.pi,
        "COALESCE": lambda *a: next((x for x in a if x is not None), None),
        "UNDER": under,
        "CONTAINS": lambda a, b: a is not None and b is not None and str(b).lower() in str(a).lower(),
        "LOWER": lambda a: None if a is None else str(a).lower(),
    }


class Evaluator:
    def __init__(self, functions: dict[str, Callable]):
        self.fn = functions

    def eval(self, node, ctx, record=None):
        t = node[0]
        if t == "lit":
            return node[1]
        if t == "var":
            v = resolve(ctx, node[1])
            if record is not None:
                record.append((node[2], node[3], v, False))
            return v
        if t == "neg":
            v = self.eval(node[1], ctx, record)
            return -v if _num(v) else None
        if t == "not":
            return not bool(self.eval(node[1], ctx, record))
        if t == "and":
            return bool(self.eval(node[1], ctx, record)) and bool(self.eval(node[2], ctx, record))
        if t == "or":
            a = bool(self.eval(node[1], ctx, record))
            b = bool(self.eval(node[2], ctx, record))
            return a or b
        if t == "bin":
            a, b = self.eval(node[2], ctx, record), self.eval(node[3], ctx, record)
            op = node[1]
            if not _num(a) or not _num(b):
                if op == "+" and isinstance(a, str) and isinstance(b, str):
                    return a + b
                return None
            if op == "+":
                return a + b
            if op == "-":
                return a - b
            if op == "*":
                return a * b
            return None if b == 0 else a / b
        if t == "cmp":
            op, a, b = node[1], self.eval(node[2], ctx, record), self.eval(node[3], ctx, record)
            if op == "=":
                return _eq(a, b)
            if op == "!=":
                return not _eq(a, b)
            if a is None or b is None:
                return False
            try:
                return {">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b}[op]
            except TypeError:
                return False
        if t == "call":
            f = self.fn.get(node[1])
            if f is None:
                raise ExprError(f"Unknown function {node[1]}")
            return f(*[self.eval(a, ctx, record) for a in node[2]])
        if t == "agg":
            v = self._agg(node, ctx)
            if record is not None:
                record.append((node[4], node[5], v, True))
            return v
        raise ExprError(f"Bad node {t}")

    def _agg(self, node, ctx):
        _, name, path, where, _, _ = node
        items, rest = _resolve_collection(ctx, path)
        if rest is None:                       # not a list: behave like the scalar function
            if name == "COUNT":
                return 0 if items is None else 1
            return items if _num(items) else None
        vals = []
        for it in items:
            item_ctx = {**ctx, **it} if isinstance(it, dict) else ctx
            if where is not None and not bool(self.eval(where, item_ctx)):
                continue
            vals.append(resolve(it, rest) if rest else it)
        if name == "COUNT":
            return len(vals)
        nums = [v for v in vals if _num(v)]
        if name == "SUM":
            return float(sum(nums))
        if not nums:
            return None
        if name == "AVG":
            return sum(nums) / len(nums)
        return min(nums) if name == "MIN" else max(nums)


def _eq(a, b):
    if _num(a) and _num(b):
        return abs(a - b) < 1e-9
    return a == b


def fmt(v) -> str:
    """Number formatting for logs and descriptions."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if _num(v):
        if abs(v - round(v)) < 1e-9:
            return str(int(round(v)))
        return f"{v:.4f}".rstrip("0").rstrip(".")
    return f'"{v}"' if isinstance(v, str) else str(v)


class Expr:
    """Facade: evaluate(src, ctx), explain(src, ctx)."""

    def __init__(self, broader: dict[str, str | None] | None = None):
        self.functions = default_functions(broader)
        self.ev = Evaluator(self.functions)

    def evaluate(self, src: str, ctx: dict) -> Any:
        return self.ev.eval(compile_expr(src), ctx)

    def explain(self, src: str, ctx: dict) -> tuple[Any, str]:
        """(value, "expression with values substituted = value")."""
        record: list = []
        val = self.ev.eval(compile_expr(src), ctx, record)
        text = src
        # replace from the end so earlier offsets stay valid; skip spans inside aggregate spans
        spans = sorted(record, key=lambda r: (r[0], -r[1]))
        kept, last_end = [], -1
        for s, e, v, agg in spans:
            if s >= last_end:
                kept.append((s, e, v, agg))
                last_end = e
        for s, e, v, agg in reversed(kept):
            text = text[:s] + (f"{src[s:e]}⟨{fmt(v)}⟩" if agg else fmt(v)) + text[e:]
        return val, f"{text} = {fmt(val)}"

    def under(self, term, root) -> bool:
        return self.functions["UNDER"](term, root)
