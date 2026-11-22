import { beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "@ifc-boq/api";
import { client } from "../support/env";
import { duplexBytes, uploadVersion, waitForVersion } from "../support/models";
import { signUp, uniqueEmail, user, type TestUser } from "../support/users";
import { xlsxRows } from "../support/xlsx";

/**
 * F14-AC1, BR-61 (TF-005, TF-132): the limits of docs/product/plans-and-limits.md that the other files
 * don't reach, each enforced with `402 limit_reached` and the limit's name, on a Free org. Seats
 * (orgs.test), activeProjects at creation (projects.test, billing.test), maxModelVersionMb (models.test),
 * maxModelsPerBoq at creation (boqs.test) and approvalRequired (versions.test) are tested there.
 * The platform admin's entitlement overrides (F14 §5) stand in for usage that would take an hour to make.
 */

const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
type Api = ReturnType<typeof client>;

let owner: TestUser;
let api: Api;
let orgId: string;
let projectId: string;
let modelId: string;
let versionId: string;
let boq: Schemas["Boq"];
let runId: string;

const limited = (res: { response: Response; error?: unknown }, limit: string) => {
  expect(res.response.status, `${limit}: ${JSON.stringify(res.error)}`).toBe(402);
  expect(res.error).toMatchObject({ code: "limit_reached", details: { limit } });
};
async function override(overrides: Record<string, unknown>) {
  const pat = await user("pat");
  const res = await client(pat.token).PUT("/admin/orgs/{orgId}/entitlement-overrides", { params: { path: { orgId } }, body: { overrides, reason: "Shared scenario suite: limits" } });
  expect(res.response.status).toBe(200);
}
async function job(jobId: string) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const { data } = await api.GET("/jobs/{jobId}", { params: { path: { jobId } } });
    if (data && data.status !== "queued" && data.status !== "running") return data;
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not finish`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  owner = await signUp("Limits Owner", uniqueEmail("limits"));
  api = client(owner.token);
  const { data: org } = await api.POST("/orgs", { body: { name: "Limits Firm", slug: slug("limits") } });
  orgId = org!.id;
  expect((await api.GET("/orgs/{orgId}/entitlements", { params: { path: { orgId } } })).data!.planId).toBe("free");
  const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "Duplex" } });
  projectId = project!.id;
  const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name: "Architecture", discipline: "architecture" } });
  modelId = model!.id;
  const version = await uploadVersion(owner, modelId, await duplexBytes(), "Duplex_A.ifc");
  expect((await waitForVersion(owner, version.id)).status).toBe("ready");
  versionId = version.id;
  boq = (await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name: "Tender" } })).data!;
  const { data: started } = await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: boq.currentRevision.id } } });
  expect((await job(started!.job.id)).status).toBe("succeeded");
  runId = started!.run.id;
}, 300_000);

describe("limits on a Free org (F14-AC1)", () => {
  it("libraryOrgPresets: the org's second preset is 402", async () => {
    const make = (name: string) => api.POST("/orgs/{orgId}/presets", { params: { path: { orgId } }, body: { kind: "dictionary", name, start: { mode: "empty" } } });
    expect((await make("Our names")).response.status).toBe(201);
    limited(await make("More names"), "libraryOrgPresets");
  });

  it("shareLinks: off for the org, a new link is 402; on again, it works", async () => {
    const make = () => api.POST("/boqs/{boqId}/share-links", { params: { path: { boqId: boq.id } }, body: { mode: "latest_issued", label: `Link ${Date.now()}` } });
    await override({ shareLinks: false });
    try {
      limited(await make(), "shareLinks");
    } finally {
      await override({ shareLinks: null });
    }
    expect((await make()).response.status).toBe(201);
  });

  it("activeProjects: unarchiving a project over the limit is 402", async () => {
    expect((await api.POST("/projects/{projectId}/archive", { params: { path: { projectId } } })).response.status).toBe(200);
    try {
      const { data: other, response } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "The active one" } });
      expect(response.status).toBe(201);
      limited(await api.POST("/projects/{projectId}/unarchive", { params: { path: { projectId } } }), "activeProjects");
      expect((await api.POST("/projects/{projectId}/archive", { params: { path: { projectId: other!.id } } })).response.status).toBe(200);
    } finally {
      expect((await api.POST("/projects/{projectId}/unarchive", { params: { path: { projectId } } })).response.status).toBe(200);
    }
  });

  it("maxModelsPerBoq: putting a third model into a BoQ's inputs is 402", async () => {
    const models = [{ modelId, modelVersionId: versionId, discipline: "architecture" }];
    for (const name of ["Structure", "Services"]) {
      const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name, discipline: "architecture" } });
      const version = await uploadVersion(owner, model!.id, await duplexBytes(), `Duplex_${name}.ifc`);
      expect((await waitForVersion(owner, version.id)).status).toBe("ready");
      models.push({ modelId: model!.id, modelVersionId: version.id, discipline: "architecture" });
    }
    const revision = (await api.GET("/boqs/{boqId}", { params: { path: { boqId: boq.id } } })).data!.currentRevision;
    limited(await api.PATCH("/revisions/{revisionId}", { params: { path: { revisionId: revision.id } }, body: { inputs: { models } } }), "maxModelsPerBoq");
  }, 300_000);

  it("approvalWorkflow: four-eyes review is 402 on Free", async () => {
    limited(await api.PATCH("/orgs/{orgId}", { params: { path: { orgId } }, body: { settings: { fourEyes: true } } }), "approvalWorkflow");
  });

  it("exportWatermark: the Free export carries 'Made with boqlet' on its cover", async () => {
    const { data: started } = await api.POST("/runs/{runId}/exports", { params: { path: { runId } }, body: { format: "xlsx" } });
    const done = await job(started!.id);
    expect(done.status).toBe("succeeded");
    const cover = await xlsxRows(owner, (done.output as { exportId: string }).exportId, "Cover");
    expect(cover.flat()).toContain("Made with boqlet");
  });
});

describe("processingMinutesPerMonth used up (BR-61, TF-132)", () => {
  beforeAll(() => override({ processingMinutesPerMonth: 0 }));

  it("new parse, run and preview jobs are 402", async () => {
    const staged = await api.POST("/models/{modelId}/versions", { params: { path: { modelId } }, body: { fileName: "Duplex_B.ifc", sizeBytes: (await duplexBytes()).byteLength } });
    expect(staged.response.status).toBe(201);
    const bytes = await duplexBytes();
    bytes[bytes.length - 1] = 0x20; // another file (no deduplication), still an IFC
    const { upload, version } = staged.data!;
    expect((await fetch(upload.url, { method: upload.method, headers: upload.headers, body: new Blob([bytes as BlobPart]) })).ok).toBe(true);
    limited(await api.POST("/model-versions/{versionId}/complete", { params: { path: { versionId: version.id } }, body: {} }), "processingMinutesPerMonth");
    const revision = (await api.GET("/boqs/{boqId}", { params: { path: { boqId: boq.id } } })).data!.currentRevision;
    limited(await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: revision.id } } }), "processingMinutesPerMonth");
    const rules = (await api.GET("/orgs/{orgId}/presets", { params: { path: { orgId }, query: { kind: "rule_set", layer: "system" } } })).data!.find((p) => p.slug === "as-modelled")!;
    limited(await api.POST("/presets/{presetId}/preview", { params: { path: { presetId: rules.id } }, body: { modelVersionIds: [versionId] } }), "processingMinutesPerMonth");
  });

  it("reading, exporting and answering questions still work", async () => {
    expect((await api.GET("/runs/{runId}/lines", { params: { path: { runId } } })).response.status).toBe(200);
    expect((await api.GET("/projects/{projectId}/models", { params: { path: { projectId } } })).response.status).toBe(200);
    const { data: started, response } = await api.POST("/runs/{runId}/exports", { params: { path: { runId } }, body: { format: "xlsx" } });
    expect(response.status).toBe(202);
    expect((await job(started!.id)).status).toBe("succeeded");
    const open = (await api.GET("/runs/{runId}/questions", { params: { path: { runId } } })).data!.find((q) => !q.decision && q.kind === "contradiction")!;
    const answered = await api.POST("/projects/{projectId}/decisions", { params: { path: { projectId } }, body: { decisions: [{ questionId: open.id, kind: open.kind, answer: "geometry" }] } });
    expect(answered.response.status).toBe(200);
  });
});
