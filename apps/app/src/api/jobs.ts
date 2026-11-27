import type { Schemas } from "@ifc-boq/api";
import { api } from "@/api/client";

type Job = Schemas["Job"];

/**
 * How long to wait before asking about a job again (review B-15: one policy for every job the app waits
 * on). Often at first, because a preview or a comparison takes about a second (TF-134), then less; a long
 * export or import is asked about every half second.
 */
export const jobPollDelay = (elapsedMs: number) => (elapsedMs < 1000 ? 100 : elapsedMs < 10_000 ? 250 : 500);

/** A job that ended without succeeding, as an error carrying the job's code. */
export function jobError(job: Job, fallback: string): Error & { code?: string } {
  return Object.assign(new Error(job.error?.message ?? fallback), { code: job.error?.code });
}

/**
 * Waits for a job to finish by asking `GET /jobs/{id}` (independent of the event stream) and returns it as
 * it ended, whatever its status; `what` names the job in the timeout error. The one job-polling loop of the
 * app (review B-15): comparisons, exports, previews and the Excel edits import use it.
 */
export async function waitForJob(job: Job, { timeoutMs = 120_000, what = "job" }: { timeoutMs?: number; what?: string } = {}): Promise<Job> {
  const started = Date.now();
  let current = job;
  while (current.status === "queued" || current.status === "running") {
    if (Date.now() - started > timeoutMs) throw new Error(`${what} timed out`);
    await new Promise((r) => setTimeout(r, jobPollDelay(Date.now() - started)));
    current = (await api.GET("/jobs/{jobId}", { params: { path: { jobId: job.id } } })).data!;
  }
  return current;
}
