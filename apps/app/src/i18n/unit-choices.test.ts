import { describe, expect, it } from "vitest";
import { UNITS } from "@ifc-boq/types";
import labels from "../../messages/en/units.json";
import { UNIT_CHOICES } from "./unit-choices";

describe("units come from the registry (review A-28, B-15)", () => {
  it("every unit offered is a registered unit, and every registered unit is offered", () => {
    expect([...UNIT_CHOICES].sort()).toEqual(Object.keys(UNITS).sort());
  });
  it("the label catalogue has exactly the registry's units", () => {
    expect(Object.keys(labels).sort()).toEqual(Object.keys(UNITS).sort());
  });
});
