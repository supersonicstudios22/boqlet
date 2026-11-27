import { describe, expect, it } from "vitest";
import type { LineOverride, ManualItemRecord } from "@/api/hooks/edits";
import type { RunLine } from "@/api/hooks/sheet";
import { notAppliedEdits } from "./pending";

const line = (key: string, fields: Partial<RunLine> = {}): RunLine =>
  ({ key, ruleId: "walls", ruleKind: "item", description: `Line ${key}`, unit: "m2", quantity: 10, source: "measured", keys: {}, trace: { formula: "", params: {}, elements: [] }, codes: { acme: { system: "acme", code: "2.5", title: "Walls", path: [], source: "map" } }, tags: [], notes: [], sortIndex: 0, ...fields }) as RunLine;
const edit = (lineKey: string, fields: Partial<LineOverride> = {}): LineOverride => ({ lineKey, ...fields }) as LineOverride;
const manual = (id: string, description: string, quantity: number, unit = "item"): ManualItemRecord => ({ id: `rec-${id}`, item: { id, kind: "other", description, unit, quantity } }) as unknown as ManualItemRecord;

describe("edits not applied yet (review C-08)", () => {
  it("is empty when the run has every edit and manual line", () => {
    const lines = [
      line("a", { quantity: 12, overridden: { fields: ["quantity"], engineQuantity: 10, reason: "site" } }),
      line("b", { excluded: true, overridden: { fields: ["excluded"] } }),
      line("c", { codes: { acme: { system: "acme", code: "3.1", title: "", path: [], source: "decision" } }, overridden: { fields: ["codes"], engineCodes: { acme: "2.5" } } }),
      line("boq.site", { ruleId: "boq.site", ruleKind: "manual", description: "Site hoarding", unit: "m", quantity: 42 }),
    ];
    const overrides = [edit("a", { quantity: 12, reason: "site" }), edit("b", { excluded: true }), edit("c", { codes: { acme: "3.1" } })];
    expect(notAppliedEdits(lines, overrides, [manual("site", "Site hoarding", 42, "m")])).toEqual([]);
  });

  it("names each edit made, changed or undone since the run, and manual lines added, changed or removed", () => {
    const lines = [
      line("a", { quantity: 12, overridden: { fields: ["quantity"], engineQuantity: 10 } }),
      line("b"),
      line("c", { quantity: 3, overridden: { fields: ["quantity"], engineQuantity: 5, engineDescription: "Line c" } }),
      line("boq.old", { ruleId: "boq.old", ruleKind: "manual", description: "Old item", unit: "item", quantity: 1 }),
      line("boq.kept", { ruleId: "boq.kept", ruleKind: "manual", description: "Kept", unit: "item", quantity: 1 }),
    ];
    const overrides = [edit("a", { quantity: 14 }), edit("b", { description: "Renamed wall" }), edit("gone", { quantity: 1 })];
    const out = notAppliedEdits(lines, overrides, [manual("new", "Skip hire", 2), manual("kept", "Kept", 3)]);
    expect(out).toEqual([
      { key: "a", description: "Line a", kind: "changed", fields: ["quantity"] },
      { key: "b", description: "Renamed wall", kind: "changed", fields: ["description"] },
      { key: "c", description: "Line c", kind: "restored" },
      { key: "new", description: "Skip hire", kind: "added" },
      { key: "boq.kept", description: "Kept", kind: "changed" },
      { key: "boq.old", description: "Old item", kind: "removed" },
    ]);
  });
});
