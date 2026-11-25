import { describe, expect, it } from "vitest";
import type { Boq } from "@/api/hooks/boqs";
import { exportChoice } from "./export-choice";

const boq = (over: { pendingChanges?: string[]; status?: string; currentRunId?: string; editBoqs?: boolean; archived?: boolean } = {}) =>
  ({
    archived: over.archived ?? false,
    currentRevision: {
      status: over.status ?? "draft",
      currentRun: { id: over.currentRunId ?? "run-1" },
      pendingChanges: over.pendingChanges ?? [],
      permissions: { editBoqs: over.editBoqs ?? true },
    },
  }) as unknown as Boq;

describe("the sheet's Excel button (review A-41, DEC-38)", () => {
  it("exports at once when nothing waits for the next run", () => {
    expect(exportChoice(boq(), { id: "run-1" }, false)).toEqual({ ask: false });
  });

  it("asks when edits or answers wait for the next run; generate and export is offered to someone who can edit", () => {
    expect(exportChoice(boq({ pendingChanges: ["adjustments", "decisions"] }), { id: "run-1" }, false)).toEqual({
      ask: true,
      pending: ["adjustments", "decisions"],
      canGenerate: true,
    });
  });

  it("someone who can't generate is told so and can only export the last run", () => {
    expect(exportChoice(boq({ pendingChanges: ["adjustments"], editBoqs: false }), { id: "run-1" }, false)).toMatchObject({ ask: true, canGenerate: false });
    expect(exportChoice(boq({ pendingChanges: ["adjustments"], archived: true }), { id: "run-1" }, false)).toMatchObject({ ask: true, canGenerate: false });
  });

  it("a saved version, an older run or a frozen view exports the run shown, without asking", () => {
    expect(exportChoice(boq({ pendingChanges: ["adjustments"], status: "issued" }), { id: "run-1" }, false)).toEqual({ ask: false });
    expect(exportChoice(boq({ pendingChanges: ["adjustments"], currentRunId: "run-2" }), { id: "run-1" }, false)).toEqual({ ask: false });
    expect(exportChoice(boq({ pendingChanges: ["adjustments"] }), { id: "run-1" }, true)).toEqual({ ask: false });
  });
});
