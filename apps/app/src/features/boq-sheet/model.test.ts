import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RunLine } from "@/api/hooks/sheet";
import { buildRows, countsBySource, displayUnit, facets, filterLines, linesInGroup, shownSource, stepDecisions, subtotal, topGroups, UNCLASSIFIED, type GroupRow } from "./model";

let n = 0;
function line(path: [string, string][] | null, fields: Partial<RunLine> = {}): RunLine {
  const i = n++;
  return {
    key: `l${i}`,
    ruleId: "r",
    ruleKind: "item",
    description: `Line ${i}`,
    unit: "m2",
    quantity: 10,
    source: "measured",
    keys: {},
    trace: { formula: "net_area", params: {}, elements: [] },
    codes: path ? { acme: { system: "acme", code: path[path.length - 1]![0], title: path[path.length - 1]![1], path: path.map(([code, title]) => ({ code, title })), source: "map" } } : {},
    tags: [],
    notes: [],
    sortIndex: i,
    ...fields,
  } as RunLine;
}

const lines = [
  line([["2", "Superstructure"], ["2.5", "External walls"]]),
  line([["10", "Finishes"]], { unit: "m2", quantity: 5 }),
  line(null, { description: "Unmapped thing" }),
  line([["2", "Superstructure"], ["2.1", "Frame"]], { unit: "m3", quantity: 3, source: "derived" }),
  line([["2", "Superstructure"], ["2.5", "External walls"]], { quantity: 2.5, location: { storey: "Level 1" } }),
];

describe("buildRows (F06 §1, §3)", () => {
  it("nests groups by code path in code order, with Unclassified last, and keeps every line", () => {
    const rows = buildRows(lines, "acme");
    const groups = rows.filter((r): r is GroupRow => r.kind === "group");
    expect(groups.map((g) => [g.id, g.depth])).toEqual([
      ["2", 0],
      ["2/2.1", 1],
      ["2/2.5", 1],
      ["10", 0],
      [UNCLASSIFIED, 0],
    ]);
    expect(rows.filter((r) => r.kind === "line")).toHaveLength(lines.length);
  });

  it("subtotals: line count always, the sum only when the unit is shared", () => {
    const groups = buildRows(lines, "acme").filter((r): r is GroupRow => r.kind === "group");
    const top = groups.find((g) => g.id === "2")!;
    expect(top).toMatchObject({ lineCount: 3, unit: null, quantity: null });
    expect(groups.find((g) => g.id === "2/2.5")).toMatchObject({ lineCount: 2, unit: "m2", quantity: 12.5 });
  });

  it("a group whose lines are all to confirm has no sum", () => {
    const flagged = [line([["9", "Preliminaries"]], { unit: "item", quantity: null, source: "flagged" })];
    expect(buildRows(flagged, "acme")[0]).toMatchObject({ lineCount: 1, unit: "item", quantity: null });
  });

  it("collapsing a group hides its lines and subgroups, not the group", () => {
    const rows = buildRows(lines, "acme", new Set(["2"]));
    expect(rows.map((r) => r.id).slice(0, 2)).toEqual(["2", "10"]);
  });

  it("without a system the lines are flat in engine order", () => {
    expect(buildRows(lines, null).map((r) => r.id)).toEqual(lines.map((l) => l.key));
  });
});

describe("subtotal (BR-63)", () => {
  type Vector = { name: string; lines: { unit: string; quantity: number | null; excluded?: boolean }[]; expected: { count: number; unit: string | null; quantity: number | null } };
  const { vectors } = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../fixtures/subtotals.json"), "utf8")) as { vectors: Vector[] };

  it.each(vectors.map((v) => [v.name, v] as const))("%s (shared vectors, also run by Java and the Excel writer)", (_, v) => {
    const got = subtotal(v.lines);
    expect({ count: got.count, unit: got.unit }).toEqual({ count: v.expected.count, unit: v.expected.unit });
    if (v.expected.quantity === null) expect(got.quantity).toBeNull();
    else expect(got.quantity).toBeCloseTo(v.expected.quantity, 9);
  });

  it("a group row shows the same subtotal", () => {
    for (const v of vectors) {
      const rows = buildRows(v.lines.map((l) => line([["1", "Group"]], l)), "acme");
      expect(rows[0]).toMatchObject({ kind: "group", lineCount: v.expected.count, unit: v.expected.unit });
      expect((rows[0] as GroupRow).quantity === null).toBe(v.expected.quantity === null);
    }
  });
});

describe("filterLines (F06 §4)", () => {
  it("filters by source, storey and text over description and codes", () => {
    expect(filterLines(lines, { source: "derived" })).toHaveLength(1);
    expect(filterLines(lines, { storey: "Level 1" })).toHaveLength(1);
    expect(filterLines(lines, { q: "unmapped" })).toHaveLength(1);
    expect(filterLines(lines, { q: "finishes" })).toHaveLength(1);
    expect(filterLines(lines, {})).toBe(lines);
  });

  it("offers the distinct storeys", () => {
    expect(facets(lines).storeys).toEqual(["Level 1"]);
  });
});

describe("displayUnit", () => {
  it("writes squares and cubes as superscripts", () => {
    expect(["m2", "m3", "ft2", "m", "nr", "kg/m3"].map(displayUnit)).toEqual(["m²", "m³", "ft²", "m", "nr", "kg/m³"]);
  });
});

describe("edits in the sheet (F06 §6)", () => {
  const a = line([["9", "Preliminaries"]], { quantity: 4 });
  const b = { ...line([["9", "Preliminaries"]], { quantity: 6 }), excluded: true, edit: { override: { id: "o", boqId: "b", lineKey: "x", createdAt: "" }, fields: ["excluded" as const], engine: { quantity: 6, description: "", unit: "m2", codes: {} } } };
  const c = { ...line([["9", "Preliminaries"]], { quantity: 1 }), sortAfter: null };

  it("keeps an excluded line listed but out of the subtotal and its count, and orders a section by its edits", () => {
    const rows = buildRows([a, b, c], "acme");
    const group = rows[0] as GroupRow;
    expect(group).toMatchObject({ lineCount: 2, quantity: 5 });
    expect(rows.slice(1).map((r) => r.id)).toEqual([c.key, a.key, b.key]);
  });

  it("filters edited and excluded lines", () => {
    expect(filterLines([a, b, c], { source: "excluded" })).toEqual([b]);
    expect(filterLines([a, b, c], { source: "edited" })).toEqual([b]);
  });
});

describe("countsBySource (F06 §12)", () => {
  it("counts the BoQ's lines by source, without excluded lines", () => {
    const lines = [
      line(null),
      line(null),
      line(null, { source: "derived" }),
      line(null, { source: "manual" }),
      line(null, { source: "flagged", quantity: null }),
      { ...line(null), excluded: true },
    ];
    expect(countsBySource(lines)).toEqual({ measured: 2, derived: 1, manual: 1, flagged: 1 });
  });
});

describe("lines to confirm (review A-05)", () => {
  const partial = line(null, { key: "partial", toConfirm: { measured: 2, elements: 3 } });
  const contradicted = line(null, { key: "contradicted", source: "derived", toConfirm: { measured: 1, elements: 1, questions: ["contradiction:volume:IfcSlab:Floor"] } });
  const plain = line(null, { key: "plain" });

  it("shows a measured or derived line the engine marks toConfirm as to confirm", () => {
    expect(shownSource(partial)).toBe("flagged");
    expect(shownSource(contradicted)).toBe("flagged");
    expect(shownSource(plain)).toBe("measured");
    expect(shownSource(line(null, { source: "manual", toConfirm: { measured: 1, elements: 2 } }))).toBe("manual");
  });

  it("finds and counts them with the lines to confirm", () => {
    expect(filterLines([partial, contradicted, plain], { source: "flagged" }).map((l) => l.key)).toEqual(["partial", "contradicted"]);
    expect(countsBySource([partial, contradicted, plain])).toEqual({ measured: 1, derived: 0, manual: 0, flagged: 2 });
  });
});

describe("the sheet's filter shared with the model (F07 §9)", () => {
  it("filters by top-level code group of the Group-by system, and by a set of lines", () => {
    expect(filterLines(lines, { group: "2" }, "acme").map((l) => l.key)).toEqual([lines[0]!.key, lines[3]!.key, lines[4]!.key]);
    expect(filterLines(lines, { group: UNCLASSIFIED }, "acme").map((l) => l.description)).toEqual(["Unmapped thing"]);
    expect(filterLines(lines, { group: "2" }, null)).toHaveLength(lines.length);
    expect(filterLines(lines, { keys: new Set([lines[1]!.key]) }).map((l) => l.key)).toEqual([lines[1]!.key]);
  });

  it("lists the lines under a group row, by its code path", () => {
    expect(linesInGroup(lines, "acme", "2/2.5")).toEqual([lines[0]!.key, lines[4]!.key]);
    expect(linesInGroup(lines, "acme", "2")).toHaveLength(3);
    expect(linesInGroup(lines, "acme", UNCLASSIFIED)).toEqual([lines[2]!.key]);
    expect(linesInGroup(lines, null, "2")).toEqual([]);
  });

  it("offers the top-level groups in code order, Unclassified last", () => {
    expect(topGroups(lines, "acme").map((g) => g.code)).toEqual(["2", "10", UNCLASSIFIED]);
  });
});

describe("decisions on a calculation step (review A-06)", () => {
  it("lists each decision once with the number of elements it decided", () => {
    const volume = { questionId: "contradiction:volume:IfcWall:Party", answer: "geometry", by: "Ana", at: "2026-11-23T09:30:00Z" };
    const thickness = { questionId: "contradiction:thickness:IfcWall:Party", answer: "geometry" };
    const out = stepDecisions([{ guid: "a", decisions: [volume, thickness] }, { guid: "b", decisions: [thickness] }, { guid: "c" }]);
    expect(out).toEqual([{ ...volume, count: 1 }, { ...thickness, count: 2 }]);
  });
});
