import { describe, expect, it } from "vitest";
import { boqFormatter } from "./boq-format";

/** TF-021 (F15 §6, §11, P35): BoQ values in the org's number and date format and the project's locale. */

const NNBSP = " ";
const at = new Date(2026, 10, 21, 14, 5);

describe("boqFormatter", () => {
  it("uses the org's separators", () => {
    const f = boqFormatter("en", { numberFormat: { decimal: ",", thousands: "." } });
    expect(f.number(12450.75, { maximumFractionDigits: 3 })).toBe("12.450,75");
    expect(f.number(-3800, { maximumFractionDigits: 3 })).toBe("-3.800");
    expect(boqFormatter("en", { numberFormat: { decimal: ".", thousands: "'" } }).number(1234567.5)).toBe("1'234'567.5");
    expect(boqFormatter("en", { numberFormat: { decimal: ".", thousands: "" } }).number(12450.75)).toBe("12450.75");
  });

  it("defaults to a narrow no-break space and the locale's decimal mark (the project's locale over the UI's)", () => {
    expect(boqFormatter("en", {}).number(12450.75)).toBe(`12${NNBSP}450.75`);
    expect(boqFormatter("en", { locale: "de" }).number(12450.75)).toBe(`12${NNBSP}450,75`);
    expect(boqFormatter("en", { locale: "sr-Latn" }).number(3800)).toBe(`3${NNBSP}800`);
    // An unusable locale falls back to the UI's.
    expect(boqFormatter("en", { locale: "not a locale!" }).number(1.5)).toBe("1.5");
  });

  it("keeps the options it is given (fraction digits, sign)", () => {
    const f = boqFormatter("en", { numberFormat: { decimal: ",", thousands: " " } });
    expect(f.number(1.23456, { maximumFractionDigits: 3 })).toBe("1,235");
    expect(f.number(2.5, { signDisplay: "exceptZero" })).toBe("+2,5");
  });

  it("writes dates in the org's pattern, with the time when asked", () => {
    const f = boqFormatter("en", { dateFormat: "dd.MM.yyyy" });
    expect(f.dateTime(at, { dateStyle: "medium" })).toBe("21.11.2026");
    expect(f.dateTime(at, { dateStyle: "medium", timeStyle: "short" })).toMatch(/^21\.11\.2026 2:05\sPM$/);
    expect(boqFormatter("en", { dateFormat: "yyyy-MM-dd" }).dateTime(at, { dateStyle: "short" })).toBe("2026-11-21");
    expect(boqFormatter("en", { dateFormat: "d/M/yy" }).dateTime(at, { dateStyle: "short" })).toBe("21/11/26");
  });

  it("without a date format, formats as the locale does", () => {
    expect(boqFormatter("en", {}).dateTime(at, { dateStyle: "medium" })).toBe("Nov 21, 2026");
  });
});

describe("TF-147: one way to show a BoQ quantity", () => {
  const f = boqFormatter("en", {});
  it("keeps up to six decimals, so a small quantity never reads as zero", () => {
    expect(f.quantity(0.000123)).toBe("0.000123");
    expect(f.quantity(123456789.123)).toBe(`123${NNBSP}456${NNBSP}789.123`);
    expect(f.quantity(0)).toBe("0");
  });
  it("marks a quantity below the shown precision instead of writing 0", () => {
    expect(f.quantity(0.0000004)).toBe("< 0.000001");
    expect(f.quantity(-0.0000004)).toBe("> -0.000001");
  });
});
