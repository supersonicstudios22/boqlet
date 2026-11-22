import { describe, expect, it } from "vitest";
import type { Boq, Run } from "@/api/hooks/boqs";
import { headerState, nextStep, saveBlockedReason, type HeaderState } from "./run-state";

const run = (id: string, status: Run["status"], createdAt: string): Run => ({ id, revisionId: "r", status, createdAt });
const boq = (current?: Run, pendingChanges: string[] = []) =>
  ({ currentRevision: { currentRun: current, pendingChanges } }) as unknown as Pick<Boq, "currentRevision">;

describe("headerState (F04 header states)", () => {
  it("none before the first run", () => {
    expect(headerState(boq(), [])).toEqual({ kind: "none" });
  });

  it("active while a run is queued or running, keeping the current run underneath", () => {
    const current = run("a", "complete", "2026-01-01T10:00:00Z");
    const queued = run("b", "queued", "2026-01-01T11:00:00Z");
    expect(headerState(boq(current), [queued, current])).toMatchObject({ kind: "active", run: { id: "b" }, current: { id: "a" } });
  });

  it("prefers the running run over a newer queued one", () => {
    const running = run("b", "running", "2026-01-01T11:00:00Z");
    const queued = run("c", "queued", "2026-01-01T12:00:00Z");
    expect(headerState(boq(), [queued, running])).toMatchObject({ kind: "active", run: { id: "b" } });
  });

  it("failed when the newest run failed after the current one; the current run stays", () => {
    const current = run("a", "needs_input", "2026-01-01T10:00:00Z");
    const failed = run("b", "failed", "2026-01-01T11:00:00Z");
    expect(headerState(boq(current), [failed, current])).toMatchObject({ kind: "failed", run: { id: "b" }, current: { id: "a" } });
  });

  it("the current run's state otherwise (a cancelled newer run is ignored)", () => {
    const current = run("a", "needs_input", "2026-01-01T10:00:00Z");
    expect(headerState(boq(current), [run("b", "cancelled", "2026-01-01T11:00:00Z"), current])).toEqual({ kind: "needs_input", current });
  });
});

describe("saveBlockedReason (BR-22)", () => {
  it("blocks without a run and with pending changes", () => {
    expect(saveBlockedReason(boq())).toBe("noRun");
    const current = run("a", "complete", "2026-01-01T10:00:00Z");
    expect(saveBlockedReason(boq(current, ["inputs.ruleSet"]))).toBe("pending");
    expect(saveBlockedReason(boq(current))).toBeNull();
  });
});

describe("nextStep (P55: one primary, on the next step)", () => {
  const done = run("a", "complete", "2026-01-01T10:00:00Z");
  const complete: HeaderState = { kind: "complete", current: done };
  const lead = (...keys: string[]) => (key: string) => keys.includes(key);
  const all = lead("editBoqs", "answerQuestions", "saveVersion", "confirm", "share");
  const bill = (o: { pending?: string[]; basedOnRunId?: string; status?: string; archived?: boolean } = {}) =>
    ({
      status: o.status ?? "working",
      archived: o.archived ?? false,
      currentRevision: { currentRun: done, pendingChanges: o.pending ?? [], basedOnRunId: o.basedOnRunId ?? null },
    }) as unknown as Parameters<typeof nextStep>[0];

  it("generate first, and again when inputs changed; retry after a failure; nothing while a run works", () => {
    expect(nextStep(bill(), { kind: "none" }, all, 0)).toBe("generate");
    expect(nextStep(bill({ pending: ["inputs.ruleSet"] }), complete, all, 3)).toBe("generate");
    expect(nextStep(bill(), { kind: "failed", run: run("b", "failed", "2026-01-01T11:00:00Z"), current: done }, all, 0)).toBe("retry");
    expect(nextStep(bill(), { kind: "active", run: run("b", "running", "2026-01-01T11:00:00Z"), current: done }, all, 0)).toBeNull();
  });

  it("answer the questions that block the BoQ before saving", () => {
    expect(nextStep(bill(), { kind: "needs_input", current: done }, all, 3)).toBe("answer");
    expect(nextStep(bill(), complete, lead("editBoqs", "saveVersion"), 3)).toBe("save");
    // Optional questions alone (none blocking) do not hold up the save.
    expect(nextStep(bill(), complete, all, 0)).toBe("save");
  });

  it("save, then confirm once the working version is the saved one unchanged", () => {
    expect(nextStep(bill(), complete, all, 0)).toBe("save");
    expect(nextStep(bill({ basedOnRunId: "a" }), complete, all, 0)).toBe("confirm");
    expect(nextStep(bill({ basedOnRunId: "old" }), complete, all, 0)).toBe("save");
  });

  it("with approval: submit, then save the approved version", () => {
    expect(nextStep(bill(), complete, lead("editBoqs", "submit", "confirm"), 0)).toBe("submit");
    expect(nextStep(bill(), complete, lead("saveApproved", "confirm"), 0)).toBe("saveApproved");
  });

  it("share a confirmed BoQ; nothing on an archived one", () => {
    expect(nextStep(bill({ status: "confirmed" }), complete, all, 0)).toBe("share");
    expect(nextStep(bill({ archived: true }), complete, all, 0)).toBeNull();
  });
});
