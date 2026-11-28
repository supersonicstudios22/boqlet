import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import boqs from "../../../messages/en/boqs.json";
import library from "../../../messages/en/library.json";
import { displayUnit } from "./model";
import { describeInput, fieldUnit, shareText, type TraceInput } from "./element-inputs";

const tr = createTranslator({ locale: "en", messages: { boqs }, namespace: "boqs.detail.input" }) as unknown as ((key: string, values?: Record<string, string | number>) => string) & { has(key: string): boolean };
const t = Object.assign((key: string, values?: Record<string, string | number>) => tr(key, values), { has: (key: string) => tr.has(key) });
const names = library.names as Record<string, { label: string }>;
const label = (f: string) => names[f]?.label ?? f;
const amount = (v: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(v);
const say = (input: TraceInput) => describeInput(input, t, label, amount, displayUnit);

/** Review C-10: each element's measured inputs and where they came from, in words. */
describe("describeInput", () => {
  it("names the Duplex foundation wall's volume property and its layer-set thickness", () => {
    expect(say({ field: "net_volume", value: 4.587, provenance: "reported", basis: "property", from: "PSet_Revit_Dimensions.Volume" })).toBe(
      "Net volume 4.587 m³ · from PSet_Revit_Dimensions.Volume",
    );
    expect(say({ field: "thickness", value: 0.417, provenance: "reported", basis: "layer_set" })).toBe("Thickness 0.417 m · from the material layer set");
    expect(say({ field: "net_area", value: 11, provenance: "geometry", basis: "faces" })).toBe("Net area 11 m² · mean of its two measured faces");
  });

  it("gives the geometry's value when it differs, and the stated one the geometry replaced", () => {
    expect(say({ field: "thickness", value: 0.55, provenance: "reported", basis: "layer_set", geometry: 0.493 })).toBe(
      "Thickness 0.55 m · from the material layer set · geometry 0.493 m",
    );
    expect(
      say({ field: "thickness", value: 0.493, provenance: "geometry", basis: "sides", stated: 0.55, question: "contradiction:thickness:IfcWall:x" }),
    ).toBe("Thickness 0.493 m · volume ÷ mean face area · the file said 0.55 m · chosen by your answer");
    expect(say({ field: "net_area", value: 49.2014, provenance: "geometry", basis: "faces", stated: 38.4062, from: "PSet_Revit_Dimensions.Area" })).toBe(
      "Net area 49.201 m² · mean of its two measured faces · the file said 38.406 m² (PSet_Revit_Dimensions.Area)",
    );
  });

  it("falls back to the provenance without a basis, and gives each field its unit", () => {
    expect(say({ field: "floor_area", value: 12.5, provenance: "reported" })).toBe("Room floor area 12.5 m² · stated in the file");
    expect(say({ field: "nominal_mass_per_length", value: 60, basis: "profile", from: "W310X60" })).toBe("Nominal mass per metre 60 kg/m · nominal for W310X60");
    expect([fieldUnit("vertical_face_area"), fieldUnit("gross_volume"), fieldUnit("perimeter_outer"), fieldUnit("density"), fieldUnit("bar_count")]).toEqual(["m2", "m3", "m", "kg/m3", ""]);
  });

  it("has a sentence for every basis the engine writes", () => {
    const bases = ["property", "attribute", "layer_set", "mesh", "parts", "faces", "sides", "box", "extent", "up_faces", "surface", "vertical_faces", "volume_thickness", "volume_area", "plus_openings", "less_openings", "openings", "surface_volume", "box_sides", "same", "area_thickness", "face", "profile", "material", "name"];
    for (const b of bases) expect(t.has(`basis.${b}`), b).toBe(true);
  });
});

/** Review C-11 (UX-031): the shares and their total are rounded and carry the line's unit. */
describe("shareText", () => {
  const number = (v: number, o: Intl.NumberFormatOptions) => new Intl.NumberFormat("en", o).format(v);
  it("rounds to 3 decimals and adds the unit", () => {
    expect(shareText(5.250625, "m2", number, displayUnit)).toBe("5.251 m²");
    expect(shareText(12.483345, "m3", number, displayUnit)).toBe("12.483 m³");
    expect(shareText(7, "nr", number, displayUnit)).toBe("7 nr");
  });
});
