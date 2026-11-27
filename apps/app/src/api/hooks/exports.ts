"use client";

import { useMutation } from "@tanstack/react-query";
import type { Schemas } from "@ifc-boq/api";
import { api } from "@/api/client";
import { localJobs } from "@/realtime/local-jobs";
import { idempotencyHeaders } from "@/api/idempotency";
import { jobError, jobPollDelay, waitForJob } from "@/api/jobs";

type Job = Schemas["Job"];


/** Hands a file to the browser as a download. */
export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Waits for an export job (asking `GET /jobs/{id}`; SSE also announces it, asking keeps this independent
 * of the event stream), then downloads its file through the signed URL. Returns the export's record.
 */
export async function downloadWhenDone(job: Job) {
  localJobs.add(job.id);
  const current = await waitForJob(job, { what: "export" });
  if (current.status !== "succeeded") throw jobError(current, "export failed");
  const exportId = (current.output as { exportId?: string } | undefined)?.exportId;
  if (!exportId) throw new Error("export without a file");
  const meta = (await api.GET("/exports/{exportId}", { params: { path: { exportId } } })).data!;
  const blob = (await api.GET("/exports/{exportId}/download", { params: { path: { exportId } }, parseAs: "blob" })).data as unknown as Blob;
  saveFile(blob, meta.fileName);
  return meta;
}

/** F12: a run's BoQ Excel (the `export_xlsx` job), downloaded when it is written. */
export function useExportRun(runId: string) {
  return useMutation({
    mutationFn: async ({ groupBy }: { groupBy?: string | null }) =>
      downloadWhenDone((await api.POST("/runs/{runId}/exports", { params: { path: { runId } }, body: { format: "xlsx", ...(groupBy ? { groupBy } : {}) }, headers: idempotencyHeaders(`exportRun:${runId}`, groupBy ?? null) })).data!),
  });
}

/** How long "Generate and export" waits for the run (a large federated model takes minutes). */
const RUN_TIMEOUT_MS = 30 * 60_000;

/**
 * Review A-41 (DEC-38): "Generate and export" from the sheet. Starts a run of the working version, waits
 * for it, then exports that run's Excel (grouped as asked, while the new run still has the grouping).
 * `onGenerated` is told when the run is done, so the sheet can move to it. A run that fails exports nothing.
 */
export async function generateAndExport(revisionId: string, groupBy: string | null, onGenerated?: (run: Schemas["Run"]) => void) {
  const started = (await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId } }, headers: idempotencyHeaders(`generateRun:${revisionId}`) })).data!;
  const begun = Date.now();
  let run = started.run;
  while (run.status === "queued" || run.status === "running") {
    if (Date.now() - begun > RUN_TIMEOUT_MS) throw new Error("generating timed out");
    await new Promise((r) => setTimeout(r, jobPollDelay(Date.now() - begun)));
    run = (await api.GET("/runs/{runId}", { params: { path: { runId: run.id } } })).data!;
  }
  onGenerated?.(run);
  if (run.status !== "complete" && run.status !== "needs_input") {
    // `generateFailed`: the sheet says the run failed, with its message, rather than an export error.
    throw Object.assign(new Error(run.error?.message ?? run.status), { code: run.error?.code ?? "run_failed", generateFailed: true });
  }
  const group = groupBy && (run.classifications ?? []).some((c) => c.id === groupBy) ? groupBy : null;
  const job = (await api.POST("/runs/{runId}/exports", { params: { path: { runId: run.id } }, body: { format: "xlsx", ...(group ? { groupBy: group } : {}) }, headers: idempotencyHeaders(`exportRun:${run.id}`, group) })).data!;
  return downloadWhenDone(job);
}

/** F08 §7: a change report's Excel, downloaded when it is written. */
export function useExportDiff(diffId: string | undefined) {
  return useMutation({
    mutationFn: async () => downloadWhenDone((await api.POST("/diffs/{diffId}/export", { params: { path: { diffId: diffId! } }, headers: idempotencyHeaders(`exportDiff:${diffId}`) })).data!),
  });
}
