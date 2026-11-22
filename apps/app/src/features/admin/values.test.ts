import { describe, expect, it } from "vitest";
import { draftEntitlements, parseOverrideValue, parsePrice, parseTags, savedEntitlements } from "./values";

describe("override values", () => {
  it("reads numbers and booleans; empty removes the override", () => {
    expect(parseOverrideValue("40")).toBe(40);
    expect(parseOverrideValue(" 2.5 ")).toBe(2.5);
    expect(parseOverrideValue("true")).toBe(true);
    expect(parseOverrideValue("false")).toBe(false);
    expect(parseOverrideValue("")).toBeNull();
    expect(parseOverrideValue("  ")).toBeNull();
  });

  it("refuses anything else", () => {
    for (const v of ["ten", "1e3", "0x10", "40 seats", "TRUE"]) expect(parseOverrideValue(v)).toBeUndefined();
  });
});

describe("tags", () => {
  it("splits on commas, trims, drops empties and duplicates", () => {
    expect(parseTags(" lead, demo,,lead , ")).toEqual(["lead", "demo"]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("TF-153: a trial ends on the day the admin picks, wherever the admin is", () => {
  it("the picked day is stored as the end of that day (UTC) and shown as that day in any time zone", async () => {
    const { trialEnd, trialDay } = await import("./values");
    const iso = trialEnd("2026-12-12");
    expect(iso).toBe("2026-12-12T23:59:59.000Z");
    // A viewer east of UTC (Sarajevo, Tokyo) and west of it (New York) all read 12 Dec.
    for (const timeZone of ["Europe/Sarajevo", "Asia/Tokyo", "America/New_York"]) {
      const shown = (d: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en", { ...options, timeZone: options.timeZone ?? timeZone }).format(d);
      expect(trialDay(iso, shown), timeZone).toBe("Dec 12, 2026");
    }
  });
});

describe("plan entitlements in the editor (P57)", () => {
  const keys = [
    { key: "seats", type: "number" as const },
    { key: "activeProjects", type: "number" as const },
    { key: "shareLinks", type: "boolean" as const },
    { key: "exportWatermark", type: "boolean" as const },
  ];

  it("starts from the plan: a missing number is unlimited, a missing feature is off", () => {
    expect(draftEntitlements(keys, { seats: 1, shareLinks: true })).toEqual({
      seats: { unlimited: false, value: "1" },
      activeProjects: { unlimited: true, value: "" },
      shareLinks: true,
      exportWatermark: false,
    });
  });

  it("saves numbers and features, and leaves unlimited numbers out", () => {
    const draft = draftEntitlements(keys, { seats: 1, shareLinks: true });
    expect(savedEntitlements(draft)).toEqual({ seats: 1, shareLinks: true, exportWatermark: false });
    expect(savedEntitlements({ ...draft, seats: { unlimited: false, value: " 25 " } })).toMatchObject({ seats: 25 });
  });

  it("refuses a number that isn't a whole number of zero or more", () => {
    const draft = draftEntitlements(keys, {});
    for (const value of ["", "-1", "2.5", "ten", "1e3"]) expect(savedEntitlements({ ...draft, seats: { unlimited: false, value } })).toBeUndefined();
    expect(savedEntitlements({ ...draft, seats: { unlimited: true, value: "ten" } })).toEqual({ shareLinks: false, exportWatermark: false });
  });

  it("reads a price: empty is none, two decimals at most", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("49")).toBe(49);
    expect(parsePrice("49,90")).toBe(49.9);
    for (const v of ["-1", "1.999", "abc"]) expect(parsePrice(v)).toBeUndefined();
  });
});
