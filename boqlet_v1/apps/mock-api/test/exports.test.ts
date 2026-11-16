import { describe, expect, it } from "vitest";
import { exportFileName } from "../src/handlers/exports.js";

describe("exportFileName", () => {
  it("is {project}_{boq}_Rev{label}_{date}.xlsx, sanitised", () => {
    expect(exportFileName("Duplex / Phase 1", "Tender BoQ", "A", "2026-11-13T10:00:00Z")).toBe("Duplex-Phase-1_Tender-BoQ_RevA_2026-11-13.xlsx");
  });
});
