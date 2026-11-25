import os
import tempfile

# Presets a developer saved from the Library (presets/user) must not change test results.
os.environ["IFC_BOQ_USER_PRESETS"] = tempfile.mkdtemp(prefix="ifc-boq-user-presets-")
# Review B-01: every result an engine test makes is checked against the invariants, and any violation raises.
os.environ["IFC_BOQ_STRICT_INVARIANTS"] = "1"

import pytest  # noqa: E402

from ifc_boq.parse import parse_file  # noqa: E402
from ifc_boq.paths import FIXTURES  # noqa: E402

DUPLEX = FIXTURES / "ifc" / "Ifc2x3_Duplex_Architecture.ifc"


@pytest.fixture(scope="session")
def duplex_parsed(tmp_path_factory):
    """Parse the Duplex once per test session (about 5 s)."""
    doc, _ = parse_file(str(DUPLEX))
    return doc
