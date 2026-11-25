import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFormatter, createTranslator } from "next-intl";
import engine from "../../messages/en/engine.json";
import { renderEngineMessage, type EngineMessage } from "./engine-message";

const t = createTranslator({ locale: "en", messages: { engine }, namespace: "engine", onError: () => {} });
const format = createFormatter({ locale: "en" });
const render = (m: EngineMessage) => renderEngineMessage(t as never, format as never, m);

/** Codes in a union type of `packages/types/src/messages.ts`, read from the source (the union has no runtime value). */
function union(name: string): string[] {
  const source = readFileSync(path.resolve(__dirname, "../../../../packages/types/src/messages.ts"), "utf8");
  const body = source.match(new RegExp(`export type ${name} =([^;]+);`))![1]!;
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** Warnings whose params don't carry the whole message (or carry English text): they keep the engine's English. */
const WARNINGS_ON_FALLBACK = ["rule_set", "federation_hole"];

/** Params as the engine writes them (`engine/ifc_boq`), one example per code. */
const EXAMPLES: Record<string, Record<string, unknown>> = {
  "question.unknown_name": { field: "space_name", raw: "Roof", count: 1, blocking: false },
  "question.unmatched": { count: 2, ifcClass: "IfcBeam", name: "W310X60" },
  "question.contradiction": { count: 3, ifcClass: "IfcWall", typeName: "Party Wall", quantity: "thickness", minDifference: -0.1554, maxDifference: -0.1036, reported: 0.55, geometry: 0.493, source: "material layer set", unit: "m" },
  "question.unclassified": { system: "ACME cost codes", description: "Concrete (-) in IfcFooting" },
  "question.classification_conflict": { system: "ACME cost codes", description: "Walls", rules: ["a", "b"], priority: 2 },
  "question.missing_data": { rule: "Walls", name: "Wall 1", reason: "no area", unit: "m2" },
  "question.orphan_override": { lineKey: "walls|brick" },
  "question.overlap": { first: "architecture", second: "structure", count: 4, ifcClass: "IfcColumn", percent: 80 },
  "question.double_claim": { count: 2, ifcClass: "IfcSlab", name: "Floor", claim: "slab", rules: ["Slabs", "Floors"] },
  "question.duplicate_conflict": {
    name: "CL_W1", ifcClass: "IfcWall", guid: "0NWseyvsH7_gBW225aGtuD", fields: ["type", "area"], kept: "structure", count: 2,
    copies: [
      { model: "architecture", ifcClass: "IfcWall", typeName: "Foundation", material: "Concrete", thickness: 0.28, volume: 6.8, area: 24.2916, length: 9.9 },
      { model: "structure", ifcClass: "IfcWall", typeName: "CL_W1", material: "Concrete", thickness: 0.28, volume: 12.67, area: 45.25207, length: 9.6 },
    ],
  },
  unknown_code: { system: "acme", description: "Walls", code: "Z.99" },
  mixed_line: { system: "acme", description: "Walls", fields: ["material", "thickness"], mapRuleId: "walls" },
  item_text_blank: { system: "acme", lineKey: "walls|brick", description: "Walls", blank: "fire_rating" },
  code_check: { system: "acme", description: "Party Wall", code: "D.02", mapRuleId: "internal-walls", expect: "NOT (is_external = true)" },
  federation_storeys: { name: "Level 1", levels: ["Level 1", "Level 1 (structure)"] },
  federation_coordinates: { first: "a.ifc", second: "b.ifc" },
  federation_overlap: { first: "architecture", second: "structure", count: 4, ifcClass: "IfcColumn" },
  federation_unhosted: { count: 1 },
  double_claim: { count: 2, claim: "slab", rules: ["slabs", "floors"] },
  double_count: { count: 228, family: "area", rules: ["Walls", "All walls"], ruleIds: ["all-walls", "walls"], ifcClass: "IfcWall", name: "Basic Wall" },
  implausible: { check: "slab_thickness", count: 11, ifcClass: "IfcSlab", typeName: "600mm Diameter", thickness: 6.002, width: 0.296, max: 1.5 },
  unhosted_opening: { ifcClass: "IfcWindow", name: "Window 1", wall: "Basic Wall:Exterior" },
};

describe("engine messages (F15 §4, contract change C01)", () => {
  it("has a catalogue entry for every question code and every warning code but the listed ones", () => {
    for (const code of [...union("QuestionCode"), ...union("WarningCode").filter((c) => !WARNINGS_ON_FALLBACK.includes(c))]) {
      expect(t.has(code as never), code).toBe(true);
      expect(EXAMPLES[code], `example params for ${code}`).toBeDefined();
    }
  });

  it("renders every catalogue entry from the engine's params, without the fallback", () => {
    for (const [code, params] of Object.entries(EXAMPLES)) {
      const shown = render({ code, params, message: "FALLBACK" });
      expect(shown.source, code).toBe("key");
      expect(shown.text, code).not.toMatch(/FALLBACK|engine\./);
      // No placeholder left unfilled (the blank named by item_text_blank is shown in braces on purpose).
      if (code !== "item_text_blank") expect(shown.text, code).not.toMatch(/[{}]/);
    }
  });

  it("writes the Duplex's questions in full", () => {
    expect(render({ code: "question.contradiction", params: EXAMPLES["question.contradiction"], message: "" }).text).toBe(
      "3 × IfcWall “Party Wall”: the thickness stated in the file and the geometry disagree by -16% to -10% (e.g. 0.55 m from material layer set vs 0.493 m measured). The stated value is used. Which should be used?",
    );
    // WP-A1 A-02: a stated value 1000 times the geometry is a unit error, and the geometry is used
    expect(render({ code: "question.contradiction", message: "", params: {
      count: 1, ifcClass: "IfcSlab", typeName: "Simple floor", quantity: "volume", minDifference: -0.999, maxDifference: -0.999,
      reported: 13243.372, geometry: 13.243, source: "BaseQuantities.GrossVolume", unit: "m3", used: "geometry", unitError: true, scale: "1000",
    } }).text).toBe(
      "1 × IfcSlab “Simple floor”: the volume stated in the file and the geometry disagree by -100% (e.g. 13,243.372 m³ from BaseQuantities.GrossVolume vs 13.243 m³ measured). The stated value looks like a unit error (×1000); the measured value is used. Which should be used?",
    );
    expect(render({ code: "question.unknown_name", params: EXAMPLES["question.unknown_name"], message: "" }).text).toBe(
      "What is “Roof” (space name)? Used 1 time. Not used by the current rules.",
    );
    expect(render({ code: "question.unknown_name", params: { field: "material", raw: "Beton", count: 3, blocking: true }, message: "" }).text).toBe(
      "What is “Beton” (material)? Used 3 times.",
    );
    // WP-A5 A-18: both copies' values, in the order the engine sends them
    expect(render({ code: "question.duplicate_conflict", params: EXAMPLES["question.duplicate_conflict"], message: "" }).text).toBe(
      "IfcWall “CL_W1” is in 2 models under one GlobalId, and the copies differ in type and area: architecture “Foundation”, 24.292 m²; structure “CL_W1”, 45.252 m². Which copy should be measured? Unanswered, the structure copy is used.",
    );
    expect(render({ code: "question.double_claim", params: EXAMPLES["question.double_claim"], message: "" }).text).toBe(
      "2 elements (e.g. IfcSlab “Floor”) are claimed for “slab” by 2 rules (Slabs and Floors): they are counted 2 times. Which rule should measure them?",
    );
    expect(render({ code: "question.missing_data", params: EXAMPLES["question.missing_data"], message: "" }).text).toBe(
      "Rule “Walls” needs a quantity for Wall 1: no area. Enter it in m².",
    );
    expect(render({ code: "item_text_blank", params: EXAMPLES.item_text_blank, message: "" }).text).toBe("[acme] “Walls”: no value for {fire_rating}.");
    expect(render({ code: "implausible", params: EXAMPLES.implausible, message: "" }).text).toBe(
      "11 × IfcSlab “600mm Diameter”: 6.002 m thick but 0.296 m wide. Is it a slab? Check the class before pricing it as one.",
    );
    expect(render({ code: "implausible", params: { check: "slab_name", count: 2, ifcClass: "IfcSlab", typeName: "Pad 2", word: "pad" }, message: "" }).text).toBe(
      "2 × IfcSlab “Pad 2”: the name says “pad”. Is it a slab? Check the class before pricing it as one.",
    );
    expect(render({ code: "unhosted_opening", params: { ...EXAMPLES.unhosted_opening, wall: null }, message: "" }).text).toBe("IfcWindow “Window 1” fills no opening: no wall is reduced by it.");
  });

  it("falls back to the engine's English without a code, for an unknown code, and when a param is missing", () => {
    expect(render({ message: "Old run" })).toEqual({ text: "Old run", source: "fallback" });
    expect(render({ code: "question.not_yet_known", params: {}, message: "Newer engine" })).toEqual({ text: "Newer engine", source: "fallback" });
    expect(render({ code: "log.parse.model", params: { fileName: "a.ifc" }, message: "a.ifc: IFC2X3" }).source).toBe("fallback");
    expect(render({ code: "question.unmatched", params: { count: 2 }, message: "2 x IfcBeam" })).toEqual({ text: "2 x IfcBeam", source: "fallback" });
  });
});

describe("TF-052: an edit to a code that isn't in the code list", () => {
  it("says the edit is not applied", () => {
    const shown = render({ code: "unknown_code", params: { system: "ACME cost codes", description: "Walls", code: "D.02", edit: true }, message: "FALLBACK" });
    expect(shown.source).toBe("key");
    expect(shown.text).toBe("[ACME cost codes] The edit moving “Walls” to the code “D.02” is not applied: the code is not in the code list.");
  });
});

describe("TF-110: a message names the classification, not its id", () => {
  it("replaces params.system by the classification's name when the run has it", async () => {
    const { withSystemName } = await import("./engine-message");
    const m = { code: "item_text_blank", params: { system: "s3a-trades", lineKey: "k", description: "Roof", blank: "fire_rating" }, message: "x" };
    expect(render(withSystemName(m, new Map([["s3a-trades", "Trades with item texts"]]))).text).toBe("[Trades with item texts] “Roof”: no value for {fire_rating}.");
    expect(withSystemName(m, new Map())).toBe(m);
  });
});
