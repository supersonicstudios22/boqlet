import type { Boq, Run } from "@/api/hooks/boqs";

/**
 * What the sheet's Excel button does (review A-41, DEC-38): the sheet shows the run plus edits and answers
 * saved since, but only the engine computes, so an export is of a run. When the working version's inputs
 * changed since its current run, the button asks: generate and export (the default), or export the last
 * run (its Cover then says what it leaves out). A saved version, an older run or nothing pending exports
 * at once.
 */
export type ExportChoice = { ask: false } | { ask: true; pending: string[]; canGenerate: boolean };

export function exportChoice(boq: Pick<Boq, "currentRevision" | "archived">, run: Pick<Run, "id">, frozen: boolean): ExportChoice {
  const revision = boq.currentRevision;
  if (frozen || revision.status === "issued" || revision.currentRun?.id !== run.id || revision.pendingChanges.length === 0) return { ask: false };
  return { ask: true, pending: revision.pendingChanges, canGenerate: !boq.archived && revision.permissions.editBoqs === true };
}

