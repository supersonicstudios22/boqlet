"""Review B-03 (QS-021, DEC-23, DEC-34): the Duplex's hand wall rows come from the file, not from the engine. The
independent reader (tests/independent/duplex_walls.py, ifcopenshell only) gives axis length x height less openings
per wall type; the hand rows in test_duplex.HAND_BOQ are those numbers written out, and the engine must match them
(test_duplex). A hand value that disagrees with the engine is a defect to record, never a tolerance to widen."""
import pytest
from independent.duplex_walls import wall_areas
from test_duplex import HAND_BOQ

from ifc_boq.paths import FIXTURES

DUPLEX = FIXTURES / "ifc" / "Ifc2x3_Duplex_Architecture.ifc"
# wall type (as the file names it) -> the HAND_BOQ row it backs, and what the hand row adds to the axis numbers
ROWS = {
    "Basic Wall:Foundation - Concrete (417mm):128676": ("Foundation - Concrete (417mm)", 0.0),
    "Basic Wall:Foundation - Concrete (435mm):207146": ("Foundation - Concrete (435mm)", 0.0),
    "Basic Wall:Interior - Partition (92mm Stud):128360": ("Partition (92mm", 0.0),
    "Basic Wall:Interior - Plumbing (152mm Stud):128382": ("Plumbing (152mm", 0.0),
    "Basic Wall:Interior - Furring (152 mm Stud):187795": ("Furring (152 mm", 0.0),
    "Basic Wall:Interior - Furring (38 mm Stud):128404": ("Furring (38 mm", 0.0),
    # the four mitred Level 2 walls' axes overlap by the wall's 0.417 m at each corner (2.9 m high)
    "Basic Wall:Exterior - Brick on Block:130892": ("Exterior - Brick on Block", -4 * 0.417 * 2.9),
}


@pytest.fixture(scope="module")
def areas():
    return wall_areas(str(DUPLEX))


@pytest.mark.parametrize("wall_type", sorted(ROWS))
def test_hand_row_is_the_files_axis_length_x_height_less_openings(areas, wall_type):
    contains, correction = ROWS[wall_type]
    hand = next(expected for rule, text, expected, _ in HAND_BOQ if rule == "walls" and text == contains)
    assert areas[wall_type] + correction == pytest.approx(hand, abs=1e-3)


def test_the_oracle_can_fail(areas):
    """Mutation check (B-03): a hand row 1 % off no longer matches the file."""
    for wall_type, (contains, correction) in ROWS.items():
        hand = next(expected for rule, text, expected, _ in HAND_BOQ if rule == "walls" and text == contains)
        assert areas[wall_type] + correction != pytest.approx(1.01 * hand, abs=1e-3), wall_type
