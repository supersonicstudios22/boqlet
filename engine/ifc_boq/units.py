"""
units.py - the unit registry (review A-28), loaded from data/units.json, which `npm run codegen` writes from
packages/types/src/units.ts. One table for converting line values, checking presets and reading name hints.
"""
from __future__ import annotations

import json
import os

_DATA = json.load(open(os.path.join(os.path.dirname(__file__), "data", "units.json"), encoding="utf-8"))
UNITS: dict[str, dict] = _DATA["UNITS"]
KIND_DIMENSION: dict[str, str] = _DATA["KIND_DIMENSION"]

PER_SI = {u: info["perSi"] for u, info in UNITS.items()}          # SI value x PER_SI[unit] = value in that unit
DIMENSION = {u: info["dimension"] for u, info in UNITS.items()}
TO_METRES = {u: 1 / f for u, f in PER_SI.items() if DIMENSION[u] == "length"}


def of_dimension(dimension: str) -> list[str]:
    return [u for u, d in DIMENSION.items() if d == dimension]


def unit_problem(unit, kind: str | None = None) -> str | None:
    """Why a unit can't measure a quantity of this kind (None: it can). `kind` None or a kind without a
    dimension (formula, a derived or manual line): any registered unit."""
    if not isinstance(unit, str):
        return None
    if unit not in UNITS:
        return f"unit '{unit}' is not a known unit (known: {', '.join(UNITS)})"
    want = KIND_DIMENSION.get(kind or "")
    if want and DIMENSION[unit] != want:
        return (f"unit '{unit}' measures {DIMENSION[unit]}, but the quantity is a {kind} ({want}); "
                f"use one of {', '.join(of_dimension(want))}")
    return None
