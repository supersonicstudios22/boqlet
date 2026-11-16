"""Generate the deterministic Duplex V2 regression fixture from the checked-in V1."""
from pathlib import Path
from unittest.mock import patch
from uuid import UUID, uuid5

import ifcopenshell
import ifcopenshell.guid
from ifcopenshell.api import geometry, root, type
from ifcopenshell.util import element, placement
from ifcopenshell.util.unit import calculate_unit_scale

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures" / "ifc"
SOURCE = FIXTURES / "Ifc2x3_Duplex_Architecture.ifc"
DESTINATION = FIXTURES / "Ifc2x3_Duplex_Architecture_v2.ifc"

REMOVED_WALL = "2O2Fr$t4X7Zf8NOew3FNld"
CHANGED_DOOR = "1hOSvn6df7F8_7GcBWlS8Z"
DOOR_TYPE_SOURCE = "1hOSvn6df7F8_7GcBWlSFK"
WINDOW_SOURCE = "1hOSvn6df7F8_7GcBWlSga"
NAMESPACE = UUID("28773b19-1f24-5e5d-bfac-bf74d9391c97")
ADDED_WINDOW = ifcopenshell.guid.compress(uuid5(NAMESPACE, "window").hex)


def generate(destination: Path) -> None:
    model = ifcopenshell.open(str(SOURCE))
    previous = {product.GlobalId for product in model.by_type("IfcElement")}
    old_history = {history.id() for history in model.by_type("IfcOwnerHistory")}
    sequence = iter(range(100))
    with patch("ifcopenshell.guid.new", side_effect=lambda: ifcopenshell.guid.compress(
            uuid5(NAMESPACE, f"relationship-{next(sequence)}").hex)):
        root.remove_product(model, product=model.by_guid(REMOVED_WALL))

        door = model.by_guid(CHANGED_DOOR)
        replacement = model.by_guid(DOOR_TYPE_SOURCE)
        type.assign_type(model, related_objects=[door], relating_type=element.get_type(replacement),
                         should_map_representations=True)
        door.Name = replacement.Name.rsplit(":", 1)[0] + ":" + door.Name.rsplit(":", 1)[1]
        door.ObjectType = replacement.ObjectType
        door.OverallWidth = replacement.OverallWidth
        door.OverallHeight = replacement.OverallHeight

        original_window = model.by_guid(WINDOW_SOURCE)
        window = root.copy_class(model, product=original_window)
        window.GlobalId = ADDED_WINDOW
        window.Name = original_window.Name.rsplit(":", 1)[0] + ":999001"
        window.Tag = "999001"
        window.Representation = element.copy_deep(model, original_window.Representation,
                                                  exclude=["IfcGeometricRepresentationContext", "IfcRepresentationMap"])
        transform = placement.get_local_placement(original_window.ObjectPlacement)
        transform[0, 3] += 2 / calculate_unit_scale(model)
        geometry.edit_object_placement(model, product=window, matrix=transform, is_si=False)

    current = {product.GlobalId for product in model.by_type("IfcElement")}
    assert previous - current == {REMOVED_WALL}
    assert current - previous == {ADDED_WINDOW}
    for history in model.by_type("IfcOwnerHistory"):
        if history.id() not in old_history and history.LastModifiedDate is not None:
            history.LastModifiedDate = 1794787200
    model.header.file_name.name = destination.name
    model.write(str(destination))


if __name__ == "__main__":
    generate(DESTINATION)
