// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { keepEdit, takeKeptEdits } from "./kept-edits";

/**
 * TF-146: an edit refused because the session ended (401) is kept in the tab, so after signing in again
 * the sheet offers it ("not saved", Save again or Discard) instead of losing it.
 */
afterEach(() => sessionStorage.clear());

const batch = (key: string) => ({ apply: { overrides: [{ lineKey: key, quantity: 321.5, reason: "site" }] }, undo: { removeOverrideLineKeys: [key] } });

describe("kept edits", () => {
  it("keeps edits per BoQ, in order, and hands them over once", () => {
    keepEdit("b1", batch("a"));
    keepEdit("b1", batch("b"));
    keepEdit("b2", batch("c"));
    expect(takeKeptEdits("b1")).toEqual([batch("a"), batch("b")]);
    expect(takeKeptEdits("b1")).toEqual([]);
    expect(takeKeptEdits("b2")).toEqual([batch("c")]);
  });
  it("survives broken or blocked storage", () => {
    sessionStorage.setItem("boqlet-kept-edits:b1", "{not json");
    expect(takeKeptEdits("b1")).toEqual([]);
  });
});
