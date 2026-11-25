import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "./fixtures";
import { API, APP, apiAs, createOrg, inflateRun, newPerson, useSession, waitFor, type Person } from "./helpers";

/**
 * UI performance budgets (review B-07, docs/architecture/nfr.md "API and UI"), tagged `@perf`: not in the
 * deploy smoke (playwright.java.config.ts leaves `@perf` out unless `BOQLET_BROWSER_PERF=1`), run nightly by
 * `.github/workflows/nightly.yml` on a production build of the app. Each number is the median of 3, printed as
 * a `[perf]` JSON line; a median over its budget fails the test.
 * - the change report (F08-AC4): an uncached Duplex v1 -> v2 report ready <= 3 s;
 * - a large BoQ (the Duplex run's lines repeated to 4,000, the size of the review's S08 per-element BoQ):
 *   the first sheet row <= 4 s after navigation, and no task longer than 250 ms while typing in its search.
 * Those two are regression gates above today's spread (2026-11-25, three runs: first row 2.1-2.8 s, longest
 * task 87-141 ms): B-18 (lighter line list, non-blocking search) and B-19 (server grouping) work to the
 * targets 2 s and 100 ms and tighten them here (DEC-114).
 */
// Not serial: each budget is measured even when another is over (a failure restarts the worker, which sets up again).
test.describe.configure({ timeout: 900_000 });

const BUDGET = { changeReportMs: 3_000, firstRowMs: 4_000, searchLongestTaskMs: 250 };
const LINES = 4_000;

type Boq = { id: string; currentRevision: { id: string; currentRun?: { id: string; status: string } } };
type Job = { id: string; status: string; output?: { diffId?: string } };

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const report = (name: string, values: number[], budget: number) =>
  console.log(`[perf] ${JSON.stringify({ name, ms: median(values), runs: values, budget, against: "java" })}`);

let owner: Person;
let boq: Boq;
let url: string;
let firstRun: string;

async function finishedRun(runId: string): Promise<string> {
  return waitFor(`run ${runId}`, async () => {
    const run = await apiAs<{ status: string }>(owner, "GET", `/runs/${runId}`);
    return run.status === "complete" || run.status === "needs_input" ? runId : undefined;
  });
}

async function generate(): Promise<string> {
  const started = await apiAs<{ run: { id: string } }>(owner, "POST", `/revisions/${boq.currentRevision.id}/runs`, {});
  return finishedRun(started.run.id);
}

test.beforeAll(async () => {
  owner = await newPerson("Pia Perf");
  const org = await createOrg(owner, "Perf Firm");
  const projectId = (await apiAs<{ id: string }>(owner, "POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" })).id;
  boq = await waitFor("the sample BoQ", async () => {
    const boqs = await apiAs<Boq[]>(owner, "GET", `/projects/${projectId}/boqs`);
    const status = boqs[0]?.currentRevision.currentRun?.status;
    return status === "complete" || status === "needs_input" ? boqs[0] : undefined;
  });
  firstRun = boq.currentRevision.currentRun!.id;
  url = `/${org.slug}/projects/${projectId}/boqs/${boq.id}`;

  // Duplex v2 as the model's next version, used by the working revision (as the change-report scenarios do).
  const [model] = await apiAs<{ id: string }[]>(owner, "GET", `/projects/${projectId}/models`);
  const bytes = await readFile(path.resolve(__dirname, "../../../fixtures/ifc/Ifc2x3_Duplex_Architecture_v2.ifc"));
  const staged = await apiAs<{ version: { id: string }; upload: { method: string; url: string; headers?: Record<string, string> } }>(owner, "POST", `/models/${model!.id}/versions`, {
    fileName: "Ifc2x3_Duplex_Architecture_v2.ifc",
    sizeBytes: bytes.byteLength,
  });
  const put = await fetch(staged.upload.url, { method: staged.upload.method, headers: { ...(staged.upload.headers ?? {}), Origin: APP }, body: bytes });
  expect(put.ok).toBe(true);
  await apiAs(owner, "POST", `/model-versions/${staged.version.id}/complete`, {});
  await waitFor("v2 parsed", async () => ((await apiAs<{ status: string }>(owner, "GET", `/model-versions/${staged.version.id}`)).status === "ready" ? true : undefined));
  const revision = await apiAs<{ inputs: { models: { modelId: string; discipline?: string }[] } }>(owner, "GET", `/revisions/${boq.currentRevision.id}`);
  await apiAs(owner, "PATCH", `/revisions/${boq.currentRevision.id}`, {
    inputs: { models: revision.inputs.models.map((m) => ({ modelId: m.modelId, modelVersionId: staged.version.id, discipline: m.discipline })) },
  });
});

test("F08-AC4: an uncached Duplex v1 -> v2 change report is ready in <= 3 s (median of 3) @perf", async () => {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    // A new run each time, so every report is computed, not read from the cache.
    const later = await generate();
    const started = Date.now();
    const res = await fetch(`${API}/api/v1/runs/${later}/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: APP, Cookie: `boqlet_session=${owner.session}` },
      body: JSON.stringify({ againstRunId: firstRun }),
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as Job;
    const done = await waitFor("the compare job", async () => {
      const state = await apiAs<Job>(owner, "GET", `/jobs/${job.id}`);
      if (state.status === "failed") throw new Error(`compare job ${job.id} failed`);
      return state.status === "succeeded" ? state : undefined;
    });
    await apiAs(owner, "GET", `/diffs/${done.output!.diffId}/lines`);
    times.push(Date.now() - started);
  }
  report("change report, uncached Duplex v1 -> v2", times, BUDGET.changeReportMs);
  expect(median(times)).toBeLessThanOrEqual(BUDGET.changeReportMs);
});

async function openLarge(page: Page): Promise<number> {
  const started = Date.now();
  await page.goto(url, { waitUntil: "commit" });
  await expect(page.getByTestId("sheet-line").first()).toBeVisible({ timeout: 120_000 });
  return Date.now() - started;
}

test.describe("a 4,000-line BoQ", () => {
  test.beforeAll(async () => {
    const run = await generate();
    expect((await inflateRun(run, LINES)).lines).toBe(LINES);
  });

  test("the first sheet row is visible <= 4 s after navigation (median of 3) @perf", async ({ page }) => {
    await useSession(page.context(), owner);
    await openLarge(page); // a first visit warms the server's caches; it is not counted
    const times: number[] = [];
    for (let i = 0; i < 3; i++) times.push(await openLarge(page));
    report(`first sheet row, ${LINES} lines`, times, BUDGET.firstRowMs);
    expect(median(times)).toBeLessThanOrEqual(BUDGET.firstRowMs);
  });

  test("typing in search never blocks the page > 250 ms (median of 3) @perf", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __longTasks: number[] };
      w.__longTasks = [];
      new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__longTasks.push(e.duration))).observe({ type: "longtask", buffered: true });
    });
    await useSession(page.context(), owner);
    const longest: number[] = [];
    for (let i = 0; i < 3; i++) {
      await openLarge(page);
      await page.waitForTimeout(1_000);
      await page.evaluate(() => ((window as unknown as { __longTasks: number[] }).__longTasks = []));
      const search = page.getByTestId("sheet-search");
      await search.click();
      await search.pressSequentially("wall", { delay: 120 });
      await page.waitForTimeout(1_500);
      longest.push(Math.round(await page.evaluate(() => Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks))));
    }
    report(`search, longest task while typing, ${LINES} lines`, longest, BUDGET.searchLongestTaskMs);
    expect(median(longest)).toBeLessThanOrEqual(BUDGET.searchLongestTaskMs);
  });
});
