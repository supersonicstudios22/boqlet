import { describe, expect, it } from "vitest";
import { clampWidth, columnTrack, COLUMN_WIDTH, fitWidth, readColumnWidths, rowHeight, saveColumnWidths, selectedRowHeight } from "./sheet-layout";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

describe("sheet layout (review C-06)", () => {
  it("gives each density its row height, default 32 px", () => {
    expect([rowHeight("compact"), rowHeight("default"), rowHeight("comfortable"), rowHeight(undefined)]).toEqual([28, 32, 36, 32]);
    expect(selectedRowHeight("compact")).toBeGreaterThan(rowHeight("compact"));
  });

  it("keeps column widths per BoQ, clamped, and forgets them on reset", () => {
    const s = memory();
    saveColumnWidths("boq-1", { description: 420, unit: 10 }, s);
    saveColumnWidths("boq-2", { quantity: 200 }, s);
    expect(readColumnWidths("boq-1", s)).toEqual({ description: 420, unit: COLUMN_WIDTH.min });
    expect(readColumnWidths("boq-2", s)).toEqual({ quantity: 200 });
    saveColumnWidths("boq-1", {}, s);
    expect(readColumnWidths("boq-1", s)).toEqual({});
    expect(readColumnWidths("boq-2", s)).toEqual({ quantity: 200 });
  });

  it("ignores what it can't read", () => {
    const s = memory();
    s.setItem("boqlet.sheet.columns.x", "not json");
    expect(readColumnWidths("x", s)).toEqual({});
    s.setItem("boqlet.sheet.columns.x", JSON.stringify({ a: "wide", b: 120, c: null }));
    expect(readColumnWidths("x", s)).toEqual({ b: 120 });
    expect(readColumnWidths("x", undefined)).toEqual({});
  });

  it("turns a width into a grid track and auto-fits to the widest content", () => {
    expect(columnTrack("unit", "4.5rem", {})).toBe("4.5rem");
    expect(columnTrack("unit", "4.5rem", { unit: 90 })).toBe("90px");
    expect(fitWidth([40, 133.4, 90])).toBe(149);
    expect(fitWidth([5000])).toBe(COLUMN_WIDTH.max);
    expect(clampWidth(1)).toBe(COLUMN_WIDTH.min);
  });
});
