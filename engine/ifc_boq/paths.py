"""paths.py - where things live. Override with environment variables in deployment."""
from __future__ import annotations

import os
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]           # engine/
ROOT = ENGINE.parent                                  # repo root
PRESETS = Path(os.environ.get("IFC_BOQ_PRESETS", ROOT / "presets"))
# Presets saved from the Library (dev build). Git-ignored; shipped presets are never written.
# Presets saved locally (the old dev Library), read only when IFC_BOQ_USER_PRESETS names a folder (review A-31): a
# developer's presets/user/ files must not change what the CLI measures. None: no user presets.
USER_PRESETS = Path(os.environ["IFC_BOQ_USER_PRESETS"]) if os.environ.get("IFC_BOQ_USER_PRESETS") else None
SCHEMAS = Path(os.environ.get("IFC_BOQ_SCHEMAS", ROOT / "packages" / "types" / "schema"))
CACHE = Path(os.environ.get("IFC_BOQ_CACHE", ENGINE / ".cache"))
FIXTURES = ROOT / "fixtures"
