import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "@ifc-boq/api";
import { advanceClock, resetClock } from "../support/clock";
import { client } from "../support/env";
import { duplexBytes, uploadVersion, waitForVersion } from "../support/models";
import { signUp, uniqueEmail, user, type TestUser } from "../support/users";

/**
 * Models and their versions, jobs and runs as the state machines say (Stage 6 Batch 2): a discipline from
 * the federation settings (TF-128), a scope checked against its schema (TF-074), the processing minutes
 * checked before an upload (TF-076), an expired upload failing (TF-031), a used version kept (TF-032),
 * cancels and failures in the audit (TF-034), and a new run beside one on older inputs (TF-094).
 */

const HVAC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "ifc", "buildingsmart", "IFC2X3", "Building-Hvac.ifc");
const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
type Api = ReturnType<typeof client>;

let owner: TestUser;
let api: Api;
let orgId: string;
let projectId: string;

async function job(jobId: string) {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const { data } = await api.GET("/jobs/{jobId}", { params: { path: { jobId } } });
    if (data && data.status !== "queued" && data.status !== "running") return data;
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not finish`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
const audit = async () => (await api.GET("/projects/{projectId}/audit", { params: { path: { projectId }, query: { limit: 200 } } })).data!.items;
const newModel = async (name: string, body: Record<string, unknown> = {}) =>
  api.POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name, ...body } as never });

beforeAll(async () => {
  owner = await signUp("Lifecycle Owner", uniqueEmail("lifecycle"));
  api = client(owner.token);
  const { data: org } = await api.POST("/orgs", { body: { name: "Lifecycle Firm", slug: slug("lifecycle") } });
  orgId = org!.id;
  const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "Lifecycle" } });
  projectId = project!.id;
}, 120_000);

describe("a model's discipline and scope (F03 §1)", () => {
  it("TF-128: a discipline outside the federation settings is 400; 'detect' takes an allowed one from the first version", async () => {
    const facade = await newModel("Facade", { discipline: "facade" });
    expect(facade.response.status).toBe(400);
    expect(facade.error).toMatchObject({ code: "invalid_discipline", details: { allowed: expect.arrayContaining(["architecture", "mep", "structure"]) } });
    expect((await newModel("Frame", { discipline: "structure" })).response.status).toBe(201);
    const { data: detected } = await newModel("Services", { discipline: "detect" });
    expect((await api.PATCH("/models/{modelId}", { params: { path: { modelId: detected!.id } }, body: { discipline: "facade" } })).response.status).toBe(400);
    const version = await uploadVersion(owner, detected!.id, new Uint8Array(await readFile(HVAC)), "Building-Hvac.ifc");
    expect((await waitForVersion(owner, version.id)).status).toBe("ready");
    const model = (await api.GET("/models/{modelId}", { params: { path: { modelId: detected!.id } } })).data!;
    expect(["architecture", "mep", "structure"]).toContain(model.discipline);
  }, 240_000);

  it("TF-074: a scope with an unknown key is 400 with the engine's problem; a valid scope is kept", async () => {
    const typo = await newModel("Typo", { discipline: "architecture", scope: { exlude: [{ ifcClass: "IfcFurnishingElement" }] } });
    expect(typo.response.status).toBe(400);
    expect(typo.error).toMatchObject({ code: "invalid_scope" });
    expect(JSON.stringify((typo.error as unknown as { details?: unknown }).details)).toContain("exlude");
    const { data, response } = await newModel("Without furniture", { discipline: "architecture", scope: { exclude: [{ ifcClass: "IfcFurnishingElement" }] } });
    expect(response.status).toBe(201);
    expect(data!.scope).toEqual({ exclude: [{ ifcClass: "IfcFurnishingElement" }] });
    expect((await api.PATCH("/models/{modelId}", { params: { path: { modelId: data!.id } }, body: { scope: { include: "all" } as never } })).response.status).toBe(400);
  });
});

describe("model versions (state-machines.md ModelVersion)", () => {
  let modelId: string;
  beforeAll(async () => {
    modelId = (await newModel("Architecture", { discipline: "architecture" })).data!.id;
  });

  it("TF-076: with the month's minutes used up, a new version is refused before any upload", async () => {
    const pat = await user("pat");
    const set = (value: number | null) => client(pat.token).PUT("/admin/orgs/{orgId}/entitlement-overrides", {
      params: { path: { orgId } }, body: { overrides: { processingMinutesPerMonth: value }, reason: "Shared scenario suite: lifecycle" } });
    expect((await set(0)).response.status).toBe(200);
    try {
      const refused = await api.POST("/models/{modelId}/versions", { params: { path: { modelId } }, body: { fileName: "Duplex.ifc", sizeBytes: 1000 } });
      expect(refused.response.status).toBe(402);
      expect(refused.error).toMatchObject({ code: "limit_reached", details: { limit: "processingMinutesPerMonth" } });
    } finally {
      await set(null);
    }
  });

  it("TF-031: an upload not completed within 24 h fails (upload_expired, audited); a late complete queues nothing", async () => {
    const { data } = await api.POST("/models/{modelId}/versions", { params: { path: { modelId } }, body: { fileName: "Late.ifc", sizeBytes: 1000 } });
    // 25 h on, in steps that keep the session alive (it ends after 12 h without a request).
    for (const hours of [10, 10, 5]) {
      await advanceClock(hours * 3600_000);
      expect((await api.GET("/me")).response.status).toBe(200);
    }
    try {
      const late = await api.POST("/model-versions/{versionId}/complete", { params: { path: { versionId: data!.version.id } }, body: {} });
      expect(late.response.status).toBe(200);
      expect(late.data).toMatchObject({ status: "failed", error: { code: "upload_expired" } });
      expect(late.data!.parseJobId ?? null).toBeNull();
    } finally {
      await resetClock();
    }
    const version = (await api.GET("/model-versions/{versionId}", { params: { path: { versionId: data!.version.id } } })).data!;
    expect(version).toMatchObject({ status: "failed", error: { code: "upload_expired" } });
    expect((await audit()).some((a) => a.action === "model_version.failed" && a.entityId === data!.version.id)).toBe(true);
  });

  it("TF-032: a version a BoQ uses can't be deleted (409 version_in_use); an unused one can", async () => {
    const used = await uploadVersion(owner, modelId, await duplexBytes(), "Duplex.ifc");
    expect((await waitForVersion(owner, used.id)).status).toBe("ready");
    const { data: boq } = await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name: "Uses v1", inputs: { models: [{ modelId, modelVersionId: used.id, discipline: "architecture" }] } } });
    expect(boq).toBeTruthy();
    const refused = await api.DELETE("/model-versions/{versionId}", { params: { path: { versionId: used.id } } });
    expect(refused.response.status).toBe(409);
    expect(refused.error).toMatchObject({ code: "version_in_use", details: { usedBy: [{ boqId: boq!.id }] } });
    const { data: spare } = await api.POST("/models/{modelId}/versions", { params: { path: { modelId } }, body: { fileName: "Spare.ifc", sizeBytes: 1000 } });
    expect((await api.DELETE("/model-versions/{versionId}", { params: { path: { versionId: spare!.version.id } } })).response.status).toBe(204);
  }, 240_000);

  it("TF-030: a refused transition names the current state", async () => {
    const ready = (await api.GET("/models/{modelId}/versions", { params: { path: { modelId } } })).data!.find((v) => v.status === "ready")!;
    const retry = await api.POST("/model-versions/{versionId}/retry", { params: { path: { versionId: ready.id } } });
    expect(retry.response.status).toBe(409);
    expect(retry.error).toMatchObject({ code: "invalid_transition", details: { state: "ready" } });
    const cancel = await api.POST("/jobs/{jobId}/cancel", { params: { path: { jobId: ready.parseJobId! } } });
    expect(cancel.response.status).toBe(409);
    expect(cancel.error).toMatchObject({ code: "invalid_transition", details: { state: "succeeded" } });
  });

  it("TF-034: a failed parse is audited as model_version.failed with its code", async () => {
    const broken = new TextEncoder().encode("ISO-10303-21;\nHEADER;\nthis is not a model\n");
    const version = await uploadVersion(owner, modelId, broken, "Broken.ifc");
    const done = await waitForVersion(owner, version.id);
    expect(done.status).toBe("failed");
    const event = (await audit()).find((a) => a.action === "model_version.failed" && a.entityId === version.id);
    expect(event).toMatchObject({ data: { code: done.error!.code } });
  }, 240_000);
});

describe("runs (F04, BR-22)", () => {
  let boq: Schemas["Boq"];
  beforeAll(async () => {
    boq = (await api.GET("/projects/{projectId}/boqs", { params: { path: { projectId } } })).data!.find((b) => b.name === "Uses v1")!;
  });
  const revision = async () => (await api.GET("/boqs/{boqId}", { params: { path: { boqId: boq.id } } })).data!.currentRevision;
  const generate = async () => (await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: (await revision()).id } } })).data!;

  it("TF-094: a Generate after the inputs changed starts a new run beside the running one; the newest becomes current", async () => {
    const first = await generate();
    expect((await generate()).run.id).toBe(first.run.id);                      // same inputs: the same run
    const { data: presets } = await api.GET("/orgs/{orgId}/presets", { params: { path: { orgId }, query: { kind: "classification" } } });
    const codes = presets!.find((p) => p.slug === "acme-cost-codes")!.latestPublishedVersion!.id;
    expect((await api.PATCH("/revisions/{revisionId}", { params: { path: { revisionId: (await revision()).id } }, body: { inputs: { classificationVersionIds: [codes] } } })).response.status).toBe(200);
    const second = await generate();
    expect(second.run.id).not.toBe(first.run.id);
    await job(first.job.id);
    await job(second.job.id);
    const current = await revision();
    expect(current.currentRun!.id).toBe(second.run.id);
    expect(current.pendingChanges).toEqual([]);
  }, 300_000);

  it("TF-034: cancelling a run is audited with who did it, and the run's end too", async () => {
    const started = await generate();
    const cancelled = await api.POST("/jobs/{jobId}/cancel", { params: { path: { jobId: started.job.id } } });
    if (cancelled.response.status === 409) return;      // the run finished first: nothing to cancel
    expect(cancelled.response.status).toBe(200);
    const ended = await job(started.job.id);
    const events = await audit();
    expect(events.some((a) => a.action === "job.cancelled" && a.entityId === started.job.id && a.actor?.id === owner.id)).toBe(true);
    if (ended.status === "cancelled") expect(events.some((a) => a.action === "run.cancelled" && a.entityId === started.run.id)).toBe(true);
  }, 240_000);

  it("TF-137: a run's question list shows the decisions it used, not every decision of the project", async () => {
    const duplexRun = (await revision()).currentRun!;
    const asked = (await api.GET("/runs/{runId}/questions", { params: { path: { runId: duplexRun.id } } })).data!
      .find((q) => q.kind === "contradiction" && !q.decision)!;
    expect(asked).toBeTruthy();
    expect((await api.POST("/projects/{projectId}/decisions", { params: { path: { projectId } }, body: { decisions: [{ questionId: asked.id, kind: asked.kind, answer: "geometry" }] } })).response.status).toBe(200);
    const services = (await api.GET("/projects/{projectId}/models", { params: { path: { projectId } } })).data!.find((m) => m.name === "Services")!;
    const { data: other } = await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name: "Services only",
      inputs: { models: [{ modelId: services.id, modelVersionId: services.latestVersion!.id, discipline: services.discipline }] } } });
    const otherRun = (await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: other!.currentRevision.id } } })).data!;
    await job(otherRun.job.id);
    expect((await api.GET("/runs/{runId}/questions", { params: { path: { runId: otherRun.run.id } } })).data!.map((q) => q.id)).not.toContain(asked.id);
    const again = await generate();
    await job(again.job.id);
    const listed = (await api.GET("/runs/{runId}/questions", { params: { path: { runId: again.run.id } } })).data!.find((q) => q.id === asked.id);
    expect(listed?.decision).toBeTruthy();
  }, 300_000);
});
