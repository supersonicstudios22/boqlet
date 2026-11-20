import { describe, expect, it } from "vitest";
import { inputsChanged } from "../src/handlers/diffs.js";
import type { RunRec } from "../src/store.js";

/** What the mock tells the worker's diff differs between two runs' requests (FE-030, EN-002). */

type Request = RunRec["request"];
const request = (over: Partial<Request["inputs"]> = {}, rest: Partial<Request> = {}): Request => ({
  inputs: { models: [{ modelId: "m1", modelVersionId: "v1", discipline: "architecture" }], ruleSetVersionId: "rs1", classificationVersionIds: ["c1"], dictionaryVersionIds: [], ...over } as Request["inputs"],
  projectDictionaryVersionId: null,
  ...rest,
});
const edit = (lineKey: string, fields: Record<string, unknown>, createdBy = "u1") =>
  ({ id: `o-${lineKey}`, boqId: "b1", lineKey, createdBy, createdAt: "2026-11-01T00:00:00Z", ...fields }) as NonNullable<Request["adjustments"]>["overrides"][number];

describe("inputsChanged", () => {
  it("is empty for the same request", () => {
    expect(inputsChanged(request(), request())).toEqual([]);
  });

  it("names the inputs that differ", () => {
    expect(inputsChanged(request(), request({ models: [{ modelId: "m1", modelVersionId: "v2", discipline: "architecture" }] }))).toEqual(["inputs.models"]);
    expect(inputsChanged(request(), request({ ruleSetVersionId: "rs2", classificationVersionIds: ["c2"] }))).toEqual(["inputs.ruleSet", "inputs.classifications"]);
    expect(inputsChanged(request(), request({}, { projectDictionaryVersionId: "pd1" }))).toEqual(["inputs.dictionaries"]);
  });

  it("compares answers by question, not by order", () => {
    const a = (answer: string, order: "ab" | "ba" = "ab") => {
      const ds = [{ questionId: "q1", kind: "choice", answer }, { questionId: "q2", kind: "choice", answer: "x" }];
      return request({}, { decisions: order === "ab" ? ds : ds.reverse() });
    };
    expect(inputsChanged(a("brick"), a("brick", "ba"))).toEqual([]);
    expect(inputsChanged(a("brick"), a("concrete"))).toEqual(["decisions"]);
  });

  it("compares line edits by content, not by who made them", () => {
    const adjust = (overrides: ReturnType<typeof edit>[]) => request({}, { adjustments: { overrides, manualItems: [] } });
    expect(inputsChanged(adjust([edit("walls", { quantity: 90 }, "u1")]), adjust([edit("walls", { quantity: 90 }, "u2")]))).toEqual([]);
    expect(inputsChanged(adjust([edit("walls", { quantity: 90 })]), adjust([edit("walls", { quantity: 80 })]))).toEqual(["adjustments"]);
    expect(inputsChanged(request({ ruleSetVersionId: "rs2" }), adjust([edit("slab", { excluded: true })]))).toEqual(["inputs.ruleSet", "adjustments"]);
  });
});
