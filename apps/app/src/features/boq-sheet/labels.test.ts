import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import boqs from "../../../messages/en/boqs.json";

describe("line detail labels", () => {
  it("names every source a line's code can have (LineCode.source; `item` is contract change C03)", () => {
    const source = readFileSync(path.resolve(__dirname, "../../../../../packages/types/src/classification.ts"), "utf8");
    const union = source.match(/export interface LineCode \{[\s\S]*?\bsource: ([^;]+);/)![1];
    const values = [...union.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(values).toContain("item");
    for (const v of values) expect(boqs.detail.codeSource, v).toHaveProperty(v);
  });
});
