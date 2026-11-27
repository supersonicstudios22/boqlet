import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import type { ClassificationMap, RuleSet } from "@ifc-boq/types";
import messages from "../../../../messages/en/classificationEditor.json";
import { codeForItem, engineText, firstLineByItem, insertBlank, ITEM_TEXT_NAMES, sampleLines, type PreviewLine } from "./item-text";
import { lineKinds } from "./model";

const line = (ruleId: string, keys: Record<string, unknown> = {}, extra: Partial<PreviewLine> = {}): PreviewLine => ({
  key: `${ruleId}|${JSON.stringify(keys)}`,
  ruleId,
  description: ruleId,
  quantity: 12.5,
  unit: "m2",
  keys,
  ...extra,
});

const map = (rules: ClassificationMap["rules"]): ClassificationMap => ({ schemaVersion: "1.0", id: "m", name: "M", version: "1", codeList: "c", rules, onUnmapped: "flag", onConflict: "first" });

const kinds = lineKinds({
  items: [
    { id: "walls", label: "Walls", tags: ["wall"] },
    { id: "slabs", label: "Slabs", tags: [] },
  ],
  derived: [{ id: "formwork-walls", label: "Formwork to walls", from: ["walls"], tags: [] }],
  manual: [],
} as unknown as RuleSet);

describe("inserting a blank", () => {
  it("puts {name} at the cursor, spaced from the word before it", () => {
    expect(insertBlank("", "thickness")).toEqual({ text: "{thickness}", caret: 11 });
    expect(insertBlank("Walls", "thickness")).toEqual({ text: "Walls {thickness}", caret: 17 });
    expect(insertBlank("Walls  thick", "thickness", 6)).toEqual({ text: "Walls {thickness} thick", caret: 17 });
    expect(insertBlank("Walls (x)", "thickness", 7, 8)).toEqual({ text: "Walls ({thickness})", caret: 18 });
  });

  it("keeps the cursor inside the text", () => {
    expect(insertBlank("ab", "unit", 10, 20)).toEqual({ text: "ab {unit}", caret: 9 });
  });

  it("offers the line keys a line can carry, its unit and quantity", () => {
    expect(ITEM_TEXT_NAMES).toContain("thickness");
    expect(ITEM_TEXT_NAMES).toContain("type_name");
    expect(ITEM_TEXT_NAMES.slice(-2)).toEqual(["unit", "quantity"]);
  });
});

describe("which preview line samples a code", () => {
  const m = map([
    { id: "t-walls", match: { ruleId: "walls" }, code: "B.01", priority: 5 },
    { id: "t-walls-ext", match: { all: [{ ruleId: "walls" }, { where: "is_external = true" }] }, code: "B.02", priority: 6 },
    { id: "tagged", match: { tag: "wall" }, code: "B.09" },
    { id: "fw", match: { ruleId: "formwork-walls" }, code: { fromSource: true } },
    { id: "lookup", match: { ruleId: ["slabs", "roofs"] }, code: { lookup: "rule_id", table: { slabs: "C.01" }, default: "C.99" } },
  ]);

  it("gives the code every line of an item falls to", () => {
    const walls = kinds.find((k) => k.id === "walls")!;
    expect(codeForItem(m, walls, kinds)).toBe("B.01");
    expect(codeForItem(m, kinds.find((k) => k.id === "formwork-walls")!, kinds)).toBe("B.01");
    expect(codeForItem(m, kinds.find((k) => k.id === "slabs")!, kinds)).toBe("C.01");
    expect(codeForItem(map([]), walls, kinds)).toBeUndefined();
  });

  it("takes the first line that gets each code, by its BoQ item", () => {
    const lines = [line("doors"), line("walls", { thickness: 0.2 }), line("walls", { thickness: 0.3 }), line("slabs"), line("roofs")];
    const s = sampleLines(m, lines, kinds);
    expect(s.get("B.01")).toBe(lines[1]);
    expect(s.get("C.01")).toBe(lines[3]);
    // an item the chosen rule set doesn't have is matched by its id alone
    expect(s.get("C.99")).toBe(lines[4]);
    // a split's code goes only to some lines: never sampled (conditions are not evaluated)
    expect(s.has("B.02")).toBe(false);
    expect(s.has("B.09")).toBe(false);
  });

  it("uses tags when the item is known", () => {
    const tagged = map([{ id: "tagged", match: { tag: "wall" }, code: "B.09" }]);
    expect(sampleLines(tagged, [line("walls")], kinds).get("B.09")?.ruleId).toBe("walls");
    expect(sampleLines(tagged, [line("walls")]).has("B.09")).toBe(false);
  });

  it("finds the first line of each BoQ item", () => {
    const lines = [line("walls", { a: 1 }), line("slabs"), line("walls", { a: 2 })];
    const by = firstLineByItem(lines);
    expect(by.get("walls")).toBe(lines[0]);
    expect(by.size).toBe(2);
  });
});

describe("item text words", () => {
  const t = createTranslator({ locale: "en", messages: { classificationEditor: messages }, namespace: "classificationEditor" });
  it("put the item text in words", () => {
    expect(t("itemText.insertValue", { what: "Thickness" })).toBe("+ Thickness");
    expect(t("itemText.label", { code: "B.01" })).toBe("Item text of B.01");
    expect(t("itemText.lineSample", { filled: "no" })).toBe("Item text:");
  });
});

describe("TF-136: the engine's filled item text (preview lines carry `codes`)", () => {
  const wall = line("walls", {}, { codes: { c1: { code: "01.01", text: "Zidanje vanjskih zidova debljine 0.417 m, 417 mm" } } });
  it("is the line's text for the code, only when the line got that code", () => {
    expect(engineText(wall, "c1", "01.01")).toBe("Zidanje vanjskih zidova debljine 0.417 m, 417 mm");
    expect(engineText(wall, "c1", "01.02")).toBeUndefined();
    expect(engineText(wall, "other", "01.01")).toBeUndefined();
    expect(engineText(line("walls"), "c1", "01.01")).toBeUndefined();
  });
});
