import { describe, expect, it } from "vitest";
import type { BoqLine, BoqResult } from "@ifc-boq/types";
import { applyLineOrder } from "../src/line-order.js";
import type { ManualItemRec, OverrideRec } from "../src/store.js";

/** Display ordering is the mock's (mock-api.md "Line edits"): `sortAfter` on edits, `sortHint` on manual lines. */

const line = (key: string, section: string) =>
  ({ key, codes: { trades: { system: "trades", code: `${section}.1`, title: "", path: [{ code: section, title: "" }], source: "map" } } }) as unknown as BoqLine;
const result = (lines: BoqLine[]) => ({ lines }) as unknown as BoqResult;
const keys = (r: BoqResult) => r.lines.map((l) => l.key);
const move = (lineKey: string, sortAfter: string | null) => ({ id: lineKey, boqId: "b", lineKey, sortAfter, createdBy: "u", createdAt: "" }) as OverrideRec;
const manual = (id: string, sortHint?: string) => ({ id, boqId: "b", item: { id, kind: "manual", description: id, unit: "item" }, ...(sortHint ? { sortHint } : {}), createdBy: "u", createdAt: "" }) as ManualItemRec;

describe("applyLineOrder", () => {
  it("moves an edited line after another and marks its order as edited", () => {
    const r = result([line("a", "01"), line("b", "01"), line("c", "02")]);
    applyLineOrder(r, [move("a", "c")], []);
    expect(keys(r)).toEqual(["b", "c", "a"]);
    expect(r.lines[2]!.overridden?.fields).toEqual(["order"]);
  });

  it("moves a line first in its section when it goes after nothing", () => {
    const r = result([line("a", "01"), line("b", "02"), line("c", "02")]);
    applyLineOrder(r, [move("c", null)], []);
    expect(keys(r)).toEqual(["a", "c", "b"]);
  });

  it("puts a manual line after its hint, and leaves lines whose target is gone where they are", () => {
    const r = result([line("a", "01"), line("b", "01"), line("m", "01"), line("d", "02")]);
    applyLineOrder(r, [move("d", "gone")], [manual("m", "a"), manual("missing", "a")]);
    expect(keys(r)).toEqual(["a", "m", "b", "d"]);
    expect(r.lines[1]!.overridden).toBeUndefined();
  });
});
