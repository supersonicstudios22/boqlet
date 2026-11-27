import { beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "@ifc-boq/api";
import { client } from "../support/env";
import { invitationToken } from "../support/mail";
import { duplexBytes, uploadVersion, waitForVersion } from "../support/models";
import { setPlan } from "../support/plans";
import { signUp, uniqueEmail, type TestUser } from "../support/users";
import { exportBytes, sha256 } from "../support/xlsx";

/**
 * Saved and confirmed versions for every role (v1-5; BR-20, BR-25, BR-26, BR-27; TF-010, TF-101),
 * beyond versions.test.ts, which walks the states as the lead: every write to a saved version tried as
 * each role, labels past Z, the saved Excel byte for byte after the working version moves on, and a
 * confirmed BoQ refusing the owner's writes while its share link keeps working.
 */

const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
type Api = ReturnType<typeof client>;
type Role = "owner" | "admin" | "lead" | "estimator" | "approver" | "viewer" | "stranger";

const people = {} as Record<Role, TestUser>;
/** An org admin who is not a member of the project (review B-14). */
let outsideAdmin: TestUser;
let orgId: string;
let projectId: string;
let codes: string;
const as = (role: Role): Api => client(people[role].token);
const api = () => as("owner");

async function finished(runId: string) {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const { data } = await api().GET("/runs/{runId}", { params: { path: { runId } } });
    if (data && data.status !== "queued" && data.status !== "running") return data;
    if (Date.now() > deadline) throw new Error(`run ${runId} did not finish`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
const boqOf = async (boqId: string) => (await api().GET("/boqs/{boqId}", { params: { path: { boqId } } })).data!;
async function generate(boqId: string) {
  const { data } = await api().POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: (await boqOf(boqId)).currentRevision.id } } });
  return finished(data!.run.id);
}
const save = (revisionId: string, body: Record<string, unknown> = { notModelledConfirmed: true }) =>
  api().POST("/revisions/{revisionId}/issue", { params: { path: { revisionId } }, body: body as never });
async function newBoq(name: string) {
  const boq = (await api().POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name, inputs: { classificationVersionIds: [codes] } } })).data!;
  await generate(boq.id);
  return boq.id;
}
async function frozenExport(revisionId: string) {
  const deadline = Date.now() + 240_000; // the export queues behind the whole suite's jobs (one engine slot)
  for (;;) {
    const id = (await api().GET("/revisions/{revisionId}", { params: { path: { revisionId } } })).data!.frozen?.exportIds?.[0];
    if (id && (await api().GET("/exports/{exportId}", { params: { path: { exportId: id } } })).data?.sizeBytes) return id;
    if (Date.now() > deadline) throw new Error("the saved version's Excel was not written");
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function member(role: Role, orgRole: "admin" | "member", projectRole: "lead" | "estimator" | "approver" | "viewer") {
  const email = uniqueEmail(role);
  expect((await api().POST("/orgs/{orgId}/invitations", { params: { path: { orgId } }, body: { email, role: orgRole } })).response.status).toBe(201);
  const person = await signUp(`${role[0]!.toUpperCase()}${role.slice(1)} Person`, email);
  expect((await client(person.token).POST("/invitations/{token}/accept", { params: { path: { token: await invitationToken(email) } } })).response.status).toBe(200);
  expect((await api().POST("/projects/{projectId}/members", { params: { path: { projectId } }, body: { userId: person.id, role: projectRole } })).response.status).toBe(201);
  people[role] = person;
}

beforeAll(async () => {
  people.owner = await signUp("Olga Owner", uniqueEmail("roles-owner"));
  const { data: org } = await api().POST("/orgs", { body: { name: "Roles Firm", slug: slug("roles") } });
  orgId = org!.id;
  const billing = (await api().GET("/orgs/{orgId}/billing", { params: { path: { orgId } } })).data!;
  await setPlan(people.owner, orgId, billing.plans!.find((p) => (p.entitlements.seats ?? 99) >= 6 && p.entitlements.shareLinks !== false)!.id);
  const { data: project } = await api().POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "Duplex" } });
  projectId = project!.id;
  // An org admin listed as an estimator still acts as lead (DEC-27, review B-14).
  await member("admin", "admin", "estimator");
  await member("lead", "member", "lead");
  await member("estimator", "member", "estimator");
  await member("approver", "member", "approver");
  await member("viewer", "member", "viewer");
  people.stranger = await signUp("Stan Stranger", uniqueEmail("roles-stranger"));
  const outsideEmail = uniqueEmail("roles-outside-admin");
  expect((await api().POST("/orgs/{orgId}/invitations", { params: { path: { orgId } }, body: { email: outsideEmail, role: "admin" } })).response.status).toBe(201);
  outsideAdmin = await signUp("Ada Outside", outsideEmail);
  expect((await client(outsideAdmin.token).POST("/invitations/{token}/accept", { params: { path: { token: await invitationToken(outsideEmail) } } })).response.status).toBe(200);
  const { data: model } = await api().POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name: "Architecture", discipline: "architecture" } });
  const version = await uploadVersion(people.owner, model!.id, await duplexBytes(), "Duplex_A.ifc");
  expect((await waitForVersion(people.owner, version.id)).status).toBe("ready");
  const { data: presets } = await api().GET("/orgs/{orgId}/presets", { params: { path: { orgId }, query: { kind: "classification" } } });
  codes = presets!.find((p) => p.slug === "acme-cost-codes")!.latestPublishedVersion!.id;
}, 420_000);

describe("B-14: the reviewer picker offers whom the API accepts (ENG-016, DEC-27)", () => {
  it("lists leads and approvers by effective role, org admins in the project as estimators or not in it at all", async () => {
    const boq = (await api().POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name: slug("Reviewers"), inputs: { classificationVersionIds: [codes] } } })).data!;
    const revisionId = boq.currentRevision.id;
    const { data, response } = await as("estimator").GET("/revisions/{revisionId}/reviewer-candidates", { params: { path: { revisionId } } });
    expect(response.status).toBe(200);
    const byId = new Map(data!.map((c) => [c.user.id, c.role]));
    expect(byId.get(people.admin.id)).toBe("lead");
    expect(byId.get(outsideAdmin.id)).toBe("lead");
    expect(byId.get(people.owner.id)).toBe("lead");
    expect(byId.get(people.lead.id)).toBe("lead");
    expect(byId.get(people.approver.id)).toBe("approver");
    for (const role of ["estimator", "viewer", "stranger"] as const) expect(byId.has(people[role].id)).toBe(false);
    expect((await as("stranger").GET("/revisions/{revisionId}/reviewer-candidates", { params: { path: { revisionId } } })).response.status).toBe(404);
  });
});

describe("BR-20: a saved version refuses every write, for every role (TF-010)", () => {
  let saved: Schemas["BoqRevision"];
  beforeAll(async () => {
    const boqId = await newBoq("Locked");
    const res = await save((await boqOf(boqId)).currentRevision.id);
    expect(res.response.status).toBe(200);
    saved = res.data!;
  }, 300_000);

  const writes: Record<string, (a: Api, revisionId: string) => Promise<{ response: Response; error?: unknown }>> = {
    "change inputs": (a, revisionId) => a.PATCH("/revisions/{revisionId}", { params: { path: { revisionId } }, body: { inputs: { classificationVersionIds: [] } } }),
    generate: (a, revisionId) => a.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId } } }),
    save: (a, revisionId) => a.POST("/revisions/{revisionId}/issue", { params: { path: { revisionId } }, body: { notModelledConfirmed: true } }),
    submit: (a, revisionId) => a.POST("/revisions/{revisionId}/submit", { params: { path: { revisionId } }, body: { reviewerIds: [people.approver.id], notModelledConfirmed: true } }),
    approve: (a, revisionId) => a.POST("/revisions/{revisionId}/approve", { params: { path: { revisionId } }, body: {} }),
    "request changes": (a, revisionId) => a.POST("/revisions/{revisionId}/request-changes", { params: { path: { revisionId } }, body: { comment: "Please check" } }),
    withdraw: (a, revisionId) => a.POST("/revisions/{revisionId}/reopen", { params: { path: { revisionId } } }),
    comment: (a, revisionId) => a.POST("/revisions/{revisionId}/comments", { params: { path: { revisionId } }, body: { text: "A note" } }),
  };
  // Who may make each write at all (docs/domain/permissions.md): the others are refused for their role first.
  const editors: Role[] = ["owner", "admin", "lead", "estimator"];
  const reviewers: Role[] = ["owner", "admin", "lead", "approver"];
  const allowed: Record<string, Role[]> = {
    "change inputs": editors, generate: editors, save: editors, submit: editors, approve: reviewers, "request changes": reviewers,
    withdraw: ["owner", "admin", "lead", "estimator", "approver", "viewer"], comment: ["owner", "admin", "lead", "estimator", "approver", "viewer"],
  };
  const cases = (["owner", "admin", "lead", "estimator", "approver", "viewer", "stranger"] as Role[]).flatMap((role) => Object.keys(writes).map((write) => [role, write] as const));

  it.each(cases)("%s: %s → refused", async (role, write) => {
    const { response, error } = await writes[write]!(as(role), saved.id);
    if (role === "stranger") expect(response.status).toBe(404);
    else if (allowed[write]!.includes(role)) {
      expect(response.status).toBe(409);
      expect(error).toMatchObject({ code: "revision_locked" });
    } else expect([403, 409]).toContain(response.status);
  });
});

describe("BR-26: labels go on past Z and are never reused (TF-101)", () => {
  it("A…Z, AA, AB; the next is AC; a used label is 409 label_taken", async () => {
    const boqId = await newBoq("Labels");
    const labels: string[] = [];
    for (let i = 0; i < 28; i++) {
      const res = await save((await boqOf(boqId)).currentRevision.id);
      expect(res.response.status, JSON.stringify(res.error)).toBe(200);
      labels.push(res.data!.label);
    }
    expect(labels).toEqual([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "AA", "AB"]);
    const working = (await boqOf(boqId)).currentRevision;
    expect(working.label).toBe("AC");
    expect((await save(working.id, { notModelledConfirmed: true, label: "B" })).error).toMatchObject({ code: "label_taken" });
  }, 600_000);
});

describe("BR-25: the saved version's Excel stays byte-identical (TF-101)", () => {
  it("after edits, a manual line and a new run on the working version: same SHA-256, same lines and position numbers, the same export on re-export", async () => {
    const boqId = await newBoq("Frozen");
    const saved = (await save((await boqOf(boqId)).currentRevision.id)).data!;
    const frozenRun = saved.frozen!.runId!;
    const exportId = await frozenExport(saved.id);
    const first = sha256(await exportBytes(people.owner, exportId));
    expect(sha256(await exportBytes(people.owner, exportId))).toBe(first);
    const lines = async (runId: string) => (await api().GET("/runs/{runId}/lines", { params: { path: { runId } } })).data!.items.map((l) => [l.key, l.quantity, l.positionNo, l.description, l.excluded ?? false]);
    const before = await lines(frozenRun);
    expect(before.every((l) => l[2])).toBe(true);

    const live = (await api().GET("/runs/{runId}/lines", { params: { path: { runId: frozenRun } } })).data!.items;
    const wall = live.find((l) => l.ruleId === "walls" && l.quantity)!;
    const slab = live.find((l) => l.ruleId === "slabs")!;
    expect((await api().POST("/boqs/{boqId}/overrides", { params: { path: { boqId } }, body: { lineKey: wall.key, quantity: wall.quantity! + 10, reason: "Site measure" } })).response.status).toBe(200);
    expect((await api().POST("/boqs/{boqId}/overrides", { params: { path: { boqId } }, body: { lineKey: slab.key, excluded: true, reason: "By others" } })).response.status).toBe(200);
    expect((await api().POST("/boqs/{boqId}/manual-items", { params: { path: { boqId } }, body: { item: { id: "site-setup", kind: "preliminary", description: "Site setup", unit: "nr", quantity: 1 } } })).response.status).toBe(201);
    await generate(boqId);

    expect(sha256(await exportBytes(people.owner, exportId))).toBe(first);
    expect(await lines(frozenRun)).toEqual(before);
    const { data: again, response } = await api().POST("/runs/{runId}/exports", { params: { path: { runId: frozenRun } }, body: { format: "xlsx" } });
    expect(response.status).toBe(202);
    const deadline = Date.now() + 240_000; // the export queues behind the whole suite's jobs (one engine slot)
    let job = (await api().GET("/jobs/{jobId}", { params: { path: { jobId: again!.id } } })).data!;
    while ((job.status === "queued" || job.status === "running") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      job = (await api().GET("/jobs/{jobId}", { params: { path: { jobId: again!.id } } })).data!;
    }
    expect(job.status).toBe("succeeded");
    expect((job.output as { exportId: string }).exportId).toBe(exportId);
  }, 600_000);
});

describe("BR-27: a confirmed BoQ refuses the owner's writes; its share link keeps working (TF-101)", () => {
  let boqId: string;
  let token: string;
  let overrideId: string;
  let itemId: string;
  let lineKey: string;

  beforeAll(async () => {
    boqId = await newBoq("Confirmed");
    const run = (await boqOf(boqId)).currentRevision.currentRun!;
    lineKey = (await api().GET("/runs/{runId}/lines", { params: { path: { runId: run.id } } })).data!.items.find((l) => l.quantity)!.key;
    overrideId = (await api().POST("/boqs/{boqId}/overrides", { params: { path: { boqId } }, body: { lineKey, description: "Edited before confirming" } })).data!.id;
    itemId = (await api().POST("/boqs/{boqId}/manual-items", { params: { path: { boqId } }, body: { item: { id: "hoarding", kind: "preliminary", description: "Hoarding", unit: "m", quantity: 40 } } })).data!.id;
    await generate(boqId);
    const share = await api().POST("/boqs/{boqId}/share-links", { params: { path: { boqId } }, body: { mode: "latest_issued", label: "Client" } });
    expect(share.response.status).toBe(201);
    token = share.data!.url.split("/").pop()!;
    const confirmed = await api().POST("/boqs/{boqId}/confirm", { params: { path: { boqId } }, body: { notModelledConfirmed: true } });
    expect(confirmed.response.status, JSON.stringify(confirmed.error)).toBe(200);
    expect(confirmed.data!.status).toBe("confirmed");
  }, 300_000);

  const writes: Record<string, () => Promise<{ response: Response; error?: unknown }>> = {
    "edit a line": () => api().POST("/boqs/{boqId}/overrides", { params: { path: { boqId } }, body: { lineKey, quantity: 1, reason: "x" } }),
    "remove an edit": () => api().DELETE("/overrides/{overrideId}", { params: { path: { overrideId } } }),
    "edits in a batch": () => api().POST("/boqs/{boqId}/overrides/batch", { params: { path: { boqId } }, body: { overrides: [{ lineKey, description: "x" }] } }),
    "add a manual line": () => api().POST("/boqs/{boqId}/manual-items", { params: { path: { boqId } }, body: { item: { id: "extra", kind: "other", description: "Extra", unit: "nr", quantity: 1 } } }),
    "edit a manual line": () => api().PATCH("/manual-items/{itemId}", { params: { path: { itemId } }, body: { item: { id: "hoarding", kind: "preliminary", description: "Hoarding", unit: "m", quantity: 41 } } }),
    "delete a manual line": () => api().DELETE("/manual-items/{itemId}", { params: { path: { itemId } } }),
    rename: () => api().PATCH("/boqs/{boqId}", { params: { path: { boqId } }, body: { name: "Renamed" } }),
  };
  it.each(Object.keys(writes))("owner: %s → 409 boq_confirmed", async (write) => {
    const { response, error } = await writes[write]!();
    expect(response.status).toBe(409);
    expect(error).toMatchObject({ code: "boq_confirmed" });
  });

  it("the share link still answers, and a new one can be made", async () => {
    expect((await client(null).GET("/public/shares/{token}", { params: { path: { token } } })).response.status).toBe(200);
    const lines = await client(null).GET("/public/shares/{token}/lines", { params: { path: { token } } });
    expect(lines.response.status).toBe(200);
    expect(lines.data!.items.length).toBeGreaterThan(0);
    expect((await api().POST("/boqs/{boqId}/share-links", { params: { path: { boqId } }, body: { mode: "latest_issued", label: "After confirming" } })).response.status).toBe(201);
  });
});
