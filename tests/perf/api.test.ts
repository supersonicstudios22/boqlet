import { appendFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "@ifc-boq/api";
import { client } from "../support/env";
import { duplexBytes, uploadVersion, waitForVersion } from "../support/models";
import { signUp, uniqueEmail, type TestUser } from "../support/users";

/**
 * TS-002 (nfr.md "API and UI"): CRUD latency p95 ≤ 300 ms and a 500-line page p95 ≤ 500 ms, with
 * ten requests in flight. Runs against API_URL like the shared suites, on Java
 * through `NativeWorkerTest#apiPerformanceAgainstJava`. The BoQ is the Duplex plus manual
 * lines up to 500, which go through the normal run and line indexing. With `PERF_OUT=<file>` each
 * result is appended as a JSON line for the NFR table.
 */

const CONCURRENCY = 10;
const SAMPLES = 100;
const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

let owner: TestUser;
let orgId: string;
let projectId: string;
let boqId: string;
let run: Schemas["Run"];

const quantile = (ms: number[], q: number) => [...ms].sort((a, b) => a - b)[Math.max(0, Math.ceil(ms.length * q) - 1)]!;

/** `SAMPLES` calls of `call`, `CONCURRENCY` at a time; each must answer 2xx. */
async function measure(name: string, call: () => Promise<{ response: Response }>, target: number) {
  const ms: number[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < SAMPLES) {
        next++;
        const t0 = performance.now();
        const { response } = await call();
        ms.push(performance.now() - t0);
        expect(response.ok, `${name}: ${response.status}`).toBe(true);
      }
    }),
  );
  const result = { name, p95: Math.round(quantile(ms, 0.95)), median: Math.round(quantile(ms, 0.5)), target, samples: ms.length, against: "java" };
  console.log(`[perf] ${name}: p95 ${result.p95} ms (target ${target} ms), ${ms.length} requests, ${CONCURRENCY} in flight`);
  if (process.env.PERF_OUT) await appendFile(process.env.PERF_OUT, JSON.stringify(result) + "\n");
  return result.p95;
}

beforeAll(async () => {
  owner = await signUp("Perf Owner", uniqueEmail("perf"));
  const api = client(owner.token);
  const { data: org } = await api.POST("/orgs", { body: { name: "Perf Firm", slug: slug("perf") } });
  orgId = org!.id;
  const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "Duplex perf" } });
  projectId = project!.id;
  const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name: "Architecture", discipline: "architecture" } });
  const version = await uploadVersion(owner, model!.id, await duplexBytes(), "Ifc2x3_Duplex_Architecture.ifc");
  expect((await waitForVersion(owner, version.id)).status).toBe("ready");
  const { data: boq } = await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name: "Perf", inputs: {} } });
  boqId = boq!.id;
  // Manual lines up to 500 lines in the run (the Duplex gives about 40).
  for (let i = 0; i < 460; i++) {
    const { response } = await api.POST("/boqs/{boqId}/manual-items", {
      params: { path: { boqId } },
      body: { item: { id: `perf-${i}`, kind: "other", description: `Perf line ${i}`, unit: "nr", quantity: i + 1 } as never },
    });
    expect(response.status).toBe(201);
  }
  const { data: started } = await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: boq!.currentRevision.id } } });
  const deadline = Date.now() + 180_000;
  for (;;) {
    const { data } = await api.GET("/runs/{runId}", { params: { path: { runId: started!.run.id } } });
    if (data && data.status !== "queued" && data.status !== "running") {
      run = data;
      break;
    }
    if (Date.now() > deadline) throw new Error("run did not finish");
    await new Promise((r) => setTimeout(r, 250));
  }
}, 600_000);

describe("TS-002 API latency (nfr.md)", () => {
  it("CRUD reads and writes: p95 ≤ 300 ms", async () => {
    const api = client(owner.token);
    let n = 0;
    const results = [
      await measure("GET /me", () => api.GET("/me"), 300),
      await measure("GET /orgs/{orgId}/projects", () => api.GET("/orgs/{orgId}/projects", { params: { path: { orgId } } }), 300),
      await measure("GET /projects/{projectId}", () => api.GET("/projects/{projectId}", { params: { path: { projectId } } }), 300),
      await measure("PATCH /projects/{projectId}", () => api.PATCH("/projects/{projectId}", { params: { path: { projectId } }, body: { name: `Duplex perf ${n++}` } }), 300),
      await measure("GET /boqs/{boqId}", () => api.GET("/boqs/{boqId}", { params: { path: { boqId } } }), 300),
    ];
    for (const p of results) expect(p).toBeLessThanOrEqual(300);
  }, 300_000);

  it("a 500-line page of a run: p95 ≤ 500 ms", async () => {
    const api = client(owner.token);
    const { data: page } = await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { limit: 500 } } });
    expect(page!.items.length).toBe(500);
    const p = await measure("GET /runs/{runId}/lines (500 lines)", () => api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { limit: 500 } } }), 500);
    expect(p).toBeLessThanOrEqual(500);
  }, 300_000);
});
