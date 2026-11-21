import { describe, expect, it } from "vitest";
import type { BoqLine, BoqResult, TraceStep } from "@ifc-boq/types";
import { addEditAuthors } from "../src/trace-authors.js";

/** The engine writes the trace steps (EN-013); the mock adds who made a quantity edit (F06 §5). */

const step = (kind: TraceStep["kind"], params: Record<string, unknown> = {}): TraceStep =>
  ({ kind, code: `trace.${kind}`, params, value: 1, unit: "m2" }) as TraceStep;
const line = (key: string, steps: TraceStep[] | undefined) =>
  ({ key, trace: { formula: "", params: {}, elements: [], ...(steps ? { steps } : {}) } }) as unknown as BoqLine;

describe("addEditAuthors", () => {
  it("names the edit's author on the engine's edit step only", () => {
    const edited = line("e", [step("start"), step("edit", { engineQuantity: 267.16, quantity: 300, reason: "measured on site" }), step("result")]);
    const result = { lines: [edited, line("plain", [step("start"), step("result")]), line("old", undefined)] } as unknown as BoqResult;
    addEditAuthors(result, (key) => (key === "e" || key === "plain" ? "Marko" : undefined));
    const [start, edit, end] = edited.trace.steps!;
    expect(edit!.params).toEqual({ engineQuantity: 267.16, quantity: 300, reason: "measured on site", by: "Marko" });
    expect(start!.params).toEqual({});
    expect(end!.params).toEqual({});
    expect(result.lines[1]!.trace.steps!.every((s) => !("by" in s.params))).toBe(true);
    expect(result.lines[2]!.trace.steps).toBeUndefined();
  });

  it("leaves the step as the engine wrote it when the author isn't known", () => {
    const edited = line("e", [step("edit", { quantity: 300 }), step("result")]);
    addEditAuthors({ lines: [edited] } as unknown as BoqResult, () => undefined);
    expect(edited.trace.steps![0]!.params).toEqual({ quantity: 300 });
  });
});
