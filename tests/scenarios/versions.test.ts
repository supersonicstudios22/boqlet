import { beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "@ifc-boq/api";
import { API_URL, client, authentication } from "../support/env";
import { invitationToken } from "../support/mail";
import { duplexBytes, uploadVersion, waitForVersion } from "../support/models";
import { setPlan } from "../support/plans";
import { xlsxRows } from "../support/xlsx";
import { signUp, uniqueEmail, type TestUser } from "../support/users";

/**
 * F09 versions (FE-031) and the BoqRevision and Boq state machines (docs/domain/state-machines.md):
 * save version with the next working version, BR-20…BR-27, confirm and reopen, and the optional review
 * (submit, request changes, approve, four-eyes, withdraw, edits during review). One org on a plan with
 * `approvalWorkflow`, through the API only.
 */

const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
type Api = ReturnType<typeof client>;
type Revision = Schemas["BoqRevision"];

let lead: TestUser;
let approver: TestUser;
let estimator: TestUser;
let orgId: string;
let projectId: string;
let boqId: string;
let codes: string;
let lineKey: string;
const as = (u: TestUser): Api => client(u.token);

async function member(role: "member", projectRole: "approver" | "estimator") {
  const email = uniqueEmail(projectRole);
  expect((await as(lead).POST("/orgs/{orgId}/invitations", { params: { path: { orgId } }, body: { email, role } })).response.status).toBe(201);
  const person = await signUp(projectRole === "approver" ? "Ana Approver" : "Erik Estimator", email);
  const token = await invitationToken(email);
  expect((await as(person).POST("/invitations/{token}/accept", { params: { path: { token } } })).response.status).toBe(200);
  expect((await as(lead).POST("/projects/{projectId}/members", { params: { path: { projectId } }, body: { userId: person.id, role: projectRole } })).response.status).toBe(201);
  return person;
}

const boq = async (u: TestUser = lead) => (await as(u).GET("/boqs/{boqId}", { params: { path: { boqId } } })).data!;
const working = async (u: TestUser = lead) => (await boq(u)).currentRevision;

async function generate() {
  const revision = await working();
  const { data } = await as(lead).POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: revision.id } } });
  const deadline = Date.now() + 120_000;
  for (;;) {
    const { data: run } = await as(lead).GET("/runs/{runId}", { params: { path: { runId: data!.run.id } } });
    if (run && run.status !== "queued" && run.status !== "running") return run;
    if (Date.now() > deadline) throw new Error("run did not finish");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const save = (u: TestUser, revisionId: string, body: Record<string, unknown> = { notModelledConfirmed: true }) =>
  as(u).POST("/revisions/{revisionId}/issue", { params: { path: { revisionId } }, body: body as never });

async function edit(quantity: number) {
  const res = await as(lead).POST("/boqs/{boqId}/overrides", { params: { path: { boqId } }, body: { lineKey, quantity, reason: "Site measure" } });
  expect(res.response.status).toBe(200);
}

const kinds = async (u: TestUser) => (await as(u).GET("/notifications", { params: { query: { limit: 200 } } })).data!.items.filter((n) => n.entityType === "revision" || n.entityType === "boq").map((n) => n.kind);

async function setApproval(approvalRequired: boolean, fourEyes = true) {
  const res = await as(lead).PATCH("/orgs/{orgId}", { params: { path: { orgId } }, body: { settings: { approvalRequired, fourEyes } } });
  expect(res.response.status).toBe(200);
}

beforeAll(async () => {
  lead = await signUp("Lena Lead", uniqueEmail("versions"));
  const { data: org } = await as(lead).POST("/orgs", { body: { name: "Versions Firm", slug: slug("versions") } });
  orgId = org!.id;
  // Review and approval is a plan feature: a free org can't switch it on (402); checkout to a plan with it.
  const refused = await as(lead).PATCH("/orgs/{orgId}", { params: { path: { orgId } }, body: { settings: { approvalRequired: true } } });
  expect(refused.response.status).toBe(402);
  const billing = (await as(lead).GET("/orgs/{orgId}/billing", { params: { path: { orgId } } })).data!;
  const plan = billing.plans!.find((p) => p.entitlements.approvalWorkflow === true && (p.entitlements.seats ?? 99) >= 3)!;
  await setPlan(lead, orgId, plan.id);
  const { data: project } = await as(lead).POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "Duplex" } });
  projectId = project!.id;
  approver = await member("member", "approver");
  estimator = await member("member", "estimator");
  const { data: model } = await as(lead).POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name: "Architecture", discipline: "architecture" } });
  const version = await uploadVersion(lead, model!.id, await duplexBytes(), "Duplex_A.ifc");
  expect((await waitForVersion(lead, version.id)).status).toBe("ready");
  const { data: presets } = await as(lead).GET("/orgs/{orgId}/presets", { params: { path: { orgId }, query: { kind: "classification" } } });
  codes = presets!.find((p) => p.slug === "acme-cost-codes")!.latestPublishedVersion!.id;
  boqId = (await as(lead).POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name: "Tender" } })).data!.id;
  const run = await generate();
  const { data: lines } = await as(lead).GET("/runs/{runId}/lines", { params: { path: { runId: run.id } } });
  lineKey = lines!.items.find((l) => l.quantity && l.quantity > 1)!.key;
}, 300_000);

describe("save version (F09 §2, approval off)", () => {
  it("BR-22: needs a finished run that reflects the current inputs; the not-in-the-models tick is required", async () => {
    const revision = await working();
    expect(revision.permissions).toMatchObject({ saveVersion: true, submit: false });
    await as(lead).PATCH("/revisions/{revisionId}", { params: { path: { revisionId: revision.id } }, body: { inputs: { classificationVersionIds: [codes] } } });
    const pending = await save(lead, revision.id);
    expect(pending.response.status).toBe(409);
    expect(pending.error).toMatchObject({ code: "not_ready", details: { reason: "pending", pendingChanges: ["inputs.classifications"] } });
    await generate();
    expect((await save(lead, revision.id, {})).response.status).toBe(400);
    expect((await save(approver, revision.id)).response.status).toBe(403);
  });

  it("draft → issued: frozen run, open questions counted, the next working version with the same inputs (BR-21)", async () => {
    const before = await working();
    const res = await save(estimator, before.id, { notModelledConfirmed: true, note: "For the client meeting" });
    expect(res.response.status).toBe(200);
    const saved = res.data!;
    expect(saved).toMatchObject({ status: "issued", label: "A", issueNote: "For the client meeting", issuedBy: { id: estimator.id }, frozen: { runId: before.currentRun!.id } });
    expect(typeof saved.openQuestionsAtSave).toBe("number");
    const next = await working();
    expect(next).toMatchObject({ number: 2, label: "B", status: "draft", basedOnRevisionId: saved.id, basedOnRunId: before.currentRun!.id, pendingChanges: [] });
    expect(next.inputs.classificationVersionIds).toEqual(before.inputs.classificationVersionIds);
    expect(next.currentRun!.id).toBe(before.currentRun!.id);
    expect((await boq()).latestIssuedRevisionId).toBe(saved.id);
    const { data: list } = await as(lead).GET("/boqs/{boqId}/revisions", { params: { path: { boqId } } });
    expect(list!.map((r) => [r.label, r.status])).toEqual([
      ["B", "draft"],
      ["A", "issued"],
    ]);
    expect(await kinds(approver)).toContain("version.saved");
  });

  it("BR-25: saving writes the version's Excel, listed with the saved version", async () => {
    const saved = (await as(lead).GET("/boqs/{boqId}/revisions", { params: { path: { boqId } } })).data!.find((r) => r.label === "A")!;
    const deadline = Date.now() + 60_000;
    let exports: Schemas["Export"][] = [];
    while (!exports.some((e) => e.kind === "issued_boq_xlsx") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      exports = (await as(lead).GET("/revisions/{revisionId}/exports", { params: { path: { revisionId: saved.id } } })).data!;
    }
    expect(exports.find((e) => e.kind === "issued_boq_xlsx")!.fileName).toMatch(/_RevA_/);
    expect((await as(lead).GET("/revisions/{revisionId}", { params: { path: { revisionId: saved.id } } })).data!.frozen!.exportIds).toHaveLength(1);
  });

  it("BR-20: a saved version refuses writes with 409 revision_locked, for every role", async () => {
    const saved = (await as(lead).GET("/boqs/{boqId}/revisions", { params: { path: { boqId } } })).data!.find((r) => r.label === "A")!;
    expect(saved.permissions.editBoqs).toBe(false);
    const patch = await as(lead).PATCH("/revisions/{revisionId}", { params: { path: { revisionId: saved.id } }, body: { inputs: { classificationVersionIds: [] } } });
    expect(patch.error).toMatchObject({ code: "revision_locked" });
    expect((await as(lead).POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: saved.id } } })).error).toMatchObject({ code: "revision_locked" });
    expect((await save(lead, saved.id)).response.status).toBe(409);
  });

  it("BR-26: labels are never reused; a label can be given", async () => {
    await edit(11);
    await generate();
    const revision = await working();
    expect((await save(lead, revision.id, { notModelledConfirmed: true, label: "A" })).error).toMatchObject({ code: "label_taken" });
    const named = await save(lead, revision.id, { notModelledConfirmed: true, label: "Tender issue" });
    expect(named.data).toMatchObject({ label: "Tender issue", number: 2 });
    expect(await working()).toMatchObject({ number: 3, label: "C" });
  });
});

describe("confirm and reopen (F09 §5–6, BR-27)", () => {
  it("working → confirmed with nothing new: the working version closes; every write answers 409 boq_confirmed", async () => {
    expect((await as(approver).POST("/boqs/{boqId}/confirm", { params: { path: { boqId } }, body: {} })).response.status).toBe(403);
    const res = await as(lead).POST("/boqs/{boqId}/confirm", { params: { path: { boqId } }, body: {} });
    expect(res.response.status).toBe(200);
    expect(res.data).toMatchObject({ status: "confirmed", confirmedBy: { id: lead.id }, currentRevision: { label: "Tender issue", status: "issued" } });
    expect(res.data!.confirmedAt).toBeTruthy();
    const { data: list } = await as(lead).GET("/boqs/{boqId}/revisions", { params: { path: { boqId } } });
    expect(list!.some((r) => r.status === "draft")).toBe(false);
    expect((await as(lead).POST("/boqs/{boqId}/overrides", { params: { path: { boqId } }, body: { lineKey, quantity: 2, reason: "x" } })).error).toMatchObject({ code: "boq_confirmed" });
    expect((await as(lead).PATCH("/boqs/{boqId}", { params: { path: { boqId } }, body: { name: "Renamed" } })).error).toMatchObject({ code: "boq_confirmed" });
    expect(res.data!.currentRevision.permissions).toMatchObject({ editBoqs: false, reopen: true, confirm: false });
    expect(await kinds(estimator)).toContain("boq.confirmed");
  });

  it("confirmed → working on reopen by the lead, with a reason (audited)", async () => {
    expect((await as(estimator).POST("/boqs/{boqId}/reopen", { params: { path: { boqId } }, body: { reason: "x" } })).response.status).toBe(403);
    expect((await as(lead).POST("/boqs/{boqId}/reopen", { params: { path: { boqId } }, body: { reason: " " } })).response.status).toBe(400);
    const res = await as(lead).POST("/boqs/{boqId}/reopen", { params: { path: { boqId } }, body: { reason: "Client changed the brief" } });
    expect(res.data).toMatchObject({ status: "working", currentRevision: { status: "draft", label: "C", pendingChanges: [] } });
    // TF-030: a refused transition names the current state.
    const again = await as(lead).POST("/boqs/{boqId}/reopen", { params: { path: { boqId } }, body: { reason: "Twice" } });
    expect(again.response.status).toBe(409);
    expect(again.error).toMatchObject({ code: "invalid_transition", details: { state: "working" } });
    const saved = (await as(lead).GET("/boqs/{boqId}/revisions", { params: { path: { boqId } } })).data!.find((r) => r.label === "Tender issue")!;
    expect(res.data!.currentRevision.basedOnRevisionId).toBe(saved.id);
    expect(await kinds(estimator)).toContain("boq.reopened");
    // TF-097: the texts say who and why.
    const reopened = (await as(estimator).GET("/notifications", { params: { query: { limit: 200 } } })).data!.items.find((n) => n.kind === "boq.reopened")!;
    expect(reopened.params).toMatchObject({ by: expect.any(String), reason: "Client changed the brief", boq: expect.any(String) });
    const { data: audit } = await as(lead).GET("/projects/{projectId}/audit", { params: { path: { projectId } } });
    expect(audit!.items.some((a) => a.action === "boq.reopened" && (a.data as { reason?: string }).reason === "Client changed the brief")).toBe(true);
  });

  it("confirm saves a final version first when the working version changed", async () => {
    await edit(12);
    await generate();
    expect((await as(lead).POST("/boqs/{boqId}/confirm", { params: { path: { boqId } }, body: {} })).response.status).toBe(400);
    const res = await as(lead).POST("/boqs/{boqId}/confirm", { params: { path: { boqId } }, body: { notModelledConfirmed: true, note: "Final" } });
    expect(res.data).toMatchObject({ status: "confirmed", currentRevision: { label: "C", status: "issued", issueNote: "Final" } });
    // P54 Q54 (TF-096): a confirmed BoQ may be archived and restored; archived, it can't be reopened.
    expect((await as(lead).POST("/boqs/{boqId}/archive", { params: { path: { boqId } } })).data).toMatchObject({ status: "confirmed", archived: true });
    expect((await as(lead).POST("/boqs/{boqId}/reopen", { params: { path: { boqId } }, body: { reason: "Archived" } })).error).toMatchObject({ code: "boq_archived" });
    expect((await as(lead).PATCH("/boqs/{boqId}", { params: { path: { boqId } }, body: { archived: false } })).data).toMatchObject({ status: "confirmed", archived: false });
    await as(lead).POST("/boqs/{boqId}/reopen", { params: { path: { boqId } }, body: { reason: "Review round" } });
  });
});

describe("review and approval (F09 §4, approvalRequired on)", () => {
  let revision: Revision;

  it("draft → in_review: reviewers are leads or approvers; they are asked", async () => {
    await setApproval(true, true);
    revision = await working();
    expect(revision.permissions).toMatchObject({ saveVersion: false, submit: true });
    expect((await save(lead, revision.id)).error).toMatchObject({ code: "not_approved" });
    const submit = (body: Record<string, unknown>, u: TestUser = lead) => as(u).POST("/revisions/{revisionId}/submit", { params: { path: { revisionId: revision.id } }, body: body as never });
    expect((await submit({ reviewerIds: [], notModelledConfirmed: true })).response.status).toBe(400);
    expect((await submit({ reviewerIds: [estimator.id], notModelledConfirmed: true })).error).toMatchObject({ code: "invalid_reviewer" });
    const res = await submit({ reviewerIds: [approver.id], message: "Please check the walls", notModelledConfirmed: true });
    expect(res.data).toMatchObject({ status: "in_review", submittedBy: { id: lead.id }, reviewers: [{ id: approver.id }] });
    expect(res.data!.reviewComments![0]).toMatchObject({ text: "Please check the walls" });
    expect(await kinds(approver)).toContain("revision.review_requested");
    const asked = (await as(approver).GET("/notifications", { params: { query: { limit: 200 } } })).data!.items.find((n) => n.kind === "revision.review_requested")!;
    expect(asked.params).toMatchObject({ by: expect.any(String), revision: expect.any(String) }); // TF-097
    // F02 §5, F02-AC5: the review is in the approver's "Needs you", not in the submitter's.
    const needs = async (u: TestUser) => (await as(u).GET("/orgs/{orgId}/attention", { params: { path: { orgId } } })).data!;
    expect(await needs(approver)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "review_requested", params: expect.objectContaining({ boq: expect.any(String) }), url: expect.stringContaining("tab=review") })]));
    expect((await needs(lead)).map((i) => i.kind)).not.toContain("review_requested");
    expect((await working(approver)).permissions).toMatchObject({ approve: true, comment: true });
    // Generating isn't an edit: refused while in review.
    expect((await as(lead).POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: revision.id } } })).error).toMatchObject({ code: "revision_in_review" });
  });

  it("comments: overall and on a line", async () => {
    const res = await as(approver).POST("/revisions/{revisionId}/comments", { params: { path: { revisionId: revision.id } }, body: { text: "Is this right?", lineKey } });
    expect(res.response.status).toBe(201);
    expect(res.data).toMatchObject({ text: "Is this right?", lineKey, by: { id: approver.id } });
    expect((await as(approver).POST("/revisions/{revisionId}/comments", { params: { path: { revisionId: revision.id } }, body: { text: " " } })).response.status).toBe(400);
    // BR-51 (TF-091): the comment is in the project's activity, its text isn't.
    const { data: audit } = await as(lead).GET("/projects/{projectId}/audit", { params: { path: { projectId } } });
    const event = audit!.items.find((a) => a.action === "revision.commented" && (a.data as { commentId?: string }).commentId === res.data!.id);
    expect(event).toMatchObject({ entityId: revision.id, data: { lineKey } });
    expect(JSON.stringify(event)).not.toContain("Is this right?");
  });

  it("BR-23: an edit sends it back to draft and tells the reviewers", async () => {
    await edit(13);
    expect(await working()).toMatchObject({ status: "draft" });
    expect(await kinds(approver)).toContain("revision.review_withdrawn");
    await generate();
    await as(lead).POST("/revisions/{revisionId}/submit", { params: { path: { revisionId: revision.id } }, body: { reviewerIds: [approver.id], notModelledConfirmed: true } });
    expect((await working()).status).toBe("in_review");
  });

  it("BR-24 four-eyes: the submitter can't approve; request changes needs a comment", async () => {
    const approve = (u: TestUser) => as(u).POST("/revisions/{revisionId}/approve", { params: { path: { revisionId: revision.id } }, body: {} });
    expect((await working()).permissions.approve).toBe(false);
    expect((await approve(lead)).error).toMatchObject({ code: "four_eyes" });
    expect((await as(estimator).POST("/revisions/{revisionId}/approve", { params: { path: { revisionId: revision.id } }, body: {} })).response.status).toBe(403);
    const back = (comment: string) => as(approver).POST("/revisions/{revisionId}/request-changes", { params: { path: { revisionId: revision.id } }, body: { comment } });
    expect((await back(" ")).response.status).toBe(400);
    const res = await back("Walls under 1 % look off");
    expect(res.data).toMatchObject({ status: "draft" });
    expect(res.data!.reviewComments!.at(-1)).toMatchObject({ outcome: "changes_requested", text: "Walls under 1 % look off" });
    expect(await kinds(lead)).toContain("revision.changes_requested");
    // F02 §5: the submitter's "Needs you" has the changes requested; the approver's review is gone.
    const needs = async (u: TestUser) => ((await as(u).GET("/orgs/{orgId}/attention", { params: { path: { orgId } } })).data ?? []).map((i) => i.kind);
    expect(await needs(lead)).toContain("changes_requested");
    expect(await needs(approver)).not.toContain("review_requested");
  });

  it("in_review → approved → issued by someone other than the submitter", async () => {
    await as(lead).POST("/revisions/{revisionId}/submit", { params: { path: { revisionId: revision.id } }, body: { reviewerIds: [approver.id], notModelledConfirmed: true } });
    const ok = await as(approver).POST("/revisions/{revisionId}/approve", { params: { path: { revisionId: revision.id } }, body: { comment: "Fine" } });
    expect(ok.data).toMatchObject({ status: "approved", approvedBy: { id: approver.id } });
    expect(await kinds(lead)).toContain("revision.approved");
    expect((await save(lead, revision.id, {})).error).toMatchObject({ code: "four_eyes" });
    const saved = await save(approver, revision.id, {});
    expect(saved.data).toMatchObject({ status: "issued", label: "D", approvedBy: { id: approver.id } });
    expect(await working()).toMatchObject({ status: "draft", label: "E", basedOnRevisionId: revision.id });
  });

  it("withdraw a review; confirm needs the working version saved first", async () => {
    await edit(14);
    await generate();
    revision = await working();
    await as(lead).POST("/revisions/{revisionId}/submit", { params: { path: { revisionId: revision.id } }, body: { reviewerIds: [approver.id], notModelledConfirmed: true } });
    expect((await as(lead).POST("/boqs/{boqId}/confirm", { params: { path: { boqId } }, body: {} })).error).toMatchObject({ code: "revision_in_review" });
    const withdrawn = await as(lead).POST("/revisions/{revisionId}/reopen", { params: { path: { revisionId: revision.id } } });
    expect(withdrawn.data).toMatchObject({ status: "draft" });
    expect((await as(approver).POST("/boqs/{boqId}/confirm", { params: { path: { boqId } }, body: { notModelledConfirmed: true } })).error).toMatchObject({ code: "not_saved" });
    await setApproval(false);
  });
});

describe("frozen exports and the audit CSV (F12, FE-032)", () => {
  async function exportOf(runId: string, profile?: "issue" | "working") {
    const { data: job } = await as(lead).POST("/runs/{runId}/exports", { params: { path: { runId } }, body: { format: "xlsx", ...(profile ? { profile } : {}) } });
    const deadline = Date.now() + 60_000;
    for (;;) {
      const { data } = await as(lead).GET("/jobs/{jobId}", { params: { path: { jobId: job!.id } } });
      if (data!.status === "succeeded") return (data!.output as { exportId: string }).exportId;
      if (data!.status === "failed" || Date.now() > deadline) throw new Error(`export ${data!.status}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  it("BR-25: exporting a saved version's run answers the file frozen with it, every time; its download is audited", async () => {
    const saved = (await as(lead).GET("/boqs/{boqId}/revisions", { params: { path: { boqId } } })).data!.find((r) => r.label === "A")!;
    const frozen = saved.frozen!.exportIds![0]!;
    expect(await exportOf(saved.frozen!.runId!)).toBe(frozen);
    expect(await exportOf(saved.frozen!.runId!)).toBe(frozen);
    const { response } = await as(lead).GET("/exports/{exportId}/download", { params: { path: { exportId: frozen } }, redirect: "manual" } as never);
    expect(response.status).toBe(302);
    const { data: audit } = await as(lead).GET("/projects/{projectId}/audit", { params: { path: { projectId }, query: { action: "export.downloaded" } } });
    expect(audit!.items.some((a) => a.entityId === frozen)).toBe(true);
  });

  it("review C-22 (DEC-40): a saved version's frozen file is the one to send; its working workbook is a new file of the same run", async () => {
    const saved = (await as(lead).GET("/boqs/{boqId}/revisions", { params: { path: { boqId } } })).data!.find((r) => r.label === "A")!;
    const frozen = saved.frozen!.exportIds![0]!;
    const sheetsOf = async (exportId: string) => {
      const workbook = await xlsxRows(lead, exportId, "BoQ");
      return { a2: String(workbook[1]?.[0] ?? ""), log: await xlsxRows(lead, exportId, "Log").then(() => true, () => false) };
    };
    expect(await sheetsOf(frozen)).toMatchObject({ log: false });
    expect((await sheetsOf(frozen)).a2).not.toContain("Rules:");
    expect(await exportOf(saved.frozen!.runId!, "issue")).toBe(frozen);
    const working = await exportOf(saved.frozen!.runId!, "working");
    expect(working).not.toBe(frozen);
    const { data: meta } = await as(lead).GET("/exports/{exportId}", { params: { path: { exportId: working } } });
    expect(meta!.kind).toBe("issued_boq_xlsx");
    expect(meta!.fileName).toMatch(/_RevA_.*_working\.xlsx$/);
    expect(await sheetsOf(working)).toMatchObject({ log: true });
    expect((await as(lead).GET("/revisions/{revisionId}", { params: { path: { revisionId: saved.id } } })).data!.frozen!.exportIds).toEqual([frozen]);
  });

  it("the working version's export is a new WORKING file recorded on the working version", async () => {
    const revision = await working();
    const id = await exportOf(revision.currentRun!.id);
    const { data: meta } = await as(lead).GET("/exports/{exportId}", { params: { path: { exportId: id } } });
    expect(meta!.kind).toBe("boq_xlsx");
    const { data: list } = await as(lead).GET("/revisions/{revisionId}/exports", { params: { path: { revisionId: revision.id } } });
    expect(list!.some((e) => e.id === id)).toBe(true);
  });

  it("the project audit as CSV, with the page's filters, for leads and approvers", async () => {
    const res = await fetch(`${API_URL}/projects/${projectId}/audit.csv?action=version.saved`, { headers: await authentication(lead.token) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const lines = (await res.text()).replace(/^﻿/, "").trim().split(/\r\n/);
    expect(lines[0]).toBe("at,actor,action,entityType,entityId,project,data");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((l) => l.split(",")[2] === "version.saved")).toBe(true);
    expect((await fetch(`${API_URL}/projects/${projectId}/audit.csv`, { headers: await authentication(estimator.token) })).status).toBe(403);
  });
});

/**
 * Review A-46 (LEAD-004, DEC-42): with approval required, a link to a version that isn't saved is the lead's or
 * an approver's to make; others share saved versions (pinned, or the latest saved one). "Share only saved
 * versions" applies that to everyone. Links made before stay.
 */
describe("A-46 sharing under approval", () => {
  let shareBoq: string;
  let saved: string;
  const current = async (u: TestUser = lead) => (await as(u).GET("/boqs/{boqId}", { params: { path: { boqId: shareBoq } } })).data!.currentRevision;
  const share = (u: TestUser, body: Record<string, unknown>) => as(u).POST("/boqs/{boqId}/share-links", { params: { path: { boqId: shareBoq } }, body: body as never });
  const settings = (s: Record<string, unknown>) => as(lead).PATCH("/orgs/{orgId}", { params: { path: { orgId } }, body: { settings: s } });
  async function run() {
    const { data } = await as(lead).POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: (await current()).id } } });
    const deadline = Date.now() + 120_000;
    for (;;) {
      const { data: r } = await as(lead).GET("/runs/{runId}", { params: { path: { runId: data!.run.id } } });
      if (r && r.status !== "queued" && r.status !== "running") return r;
      if (Date.now() > deadline) throw new Error("run did not finish");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  beforeAll(async () => {
    expect((await settings({ approvalRequired: false, shareOnlySavedVersions: false })).response.status).toBe(200);
    shareBoq = (await as(lead).POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name: "Shared" } })).data!.id;
    await run();
    const issued = await save(lead, (await current()).id);
    expect(issued.response.status).toBe(200);
    saved = issued.data!.id;
    await run();
  }, 300_000);

  it("an estimator can't pin the working version; an approver can; a saved version and the latest saved one stay open", async () => {
    expect((await settings({ approvalRequired: true, fourEyes: true })).response.status).toBe(200);
    const working = await current(estimator);
    expect(working.status).toBe("draft");
    expect(working.permissions).toMatchObject({ share: true, shareWorking: false });
    const refused = await share(estimator, { mode: "pinned", revisionId: working.id });
    expect(refused.response.status).toBe(403);
    expect(refused.error).toMatchObject({ code: "approval_required_for_share", details: { required: "approver" } });
    // Without a revision id a pinned link pins the working version: refused the same way.
    expect((await share(estimator, { mode: "pinned" })).error).toMatchObject({ code: "approval_required_for_share" });
    expect((await share(estimator, { mode: "pinned", revisionId: saved })).response.status).toBe(201);
    expect((await share(estimator, { mode: "latest_issued" })).response.status).toBe(201);
    expect((await current(approver)).permissions).toMatchObject({ shareWorking: true });
    expect((await share(approver, { mode: "pinned", revisionId: working.id })).response.status).toBe(201);
    expect((await share(lead, { mode: "pinned", revisionId: working.id })).response.status).toBe(201);
  });

  it("'share only saved versions' refuses a working pin for everyone, even with approval off; existing links stay", async () => {
    const before = (await as(lead).GET("/boqs/{boqId}/share-links", { params: { path: { boqId: shareBoq } } })).data!.filter((l) => l.status === "active").length;
    expect((await settings({ approvalRequired: false, shareOnlySavedVersions: true })).response.status).toBe(200);
    const working = await current();
    expect(working.permissions).toMatchObject({ share: true, shareWorking: false });
    expect((await share(lead, { mode: "pinned", revisionId: working.id })).error).toMatchObject({ code: "saved_versions_only" });
    expect((await share(lead, { mode: "pinned", revisionId: saved })).response.status).toBe(201);
    const after = (await as(lead).GET("/boqs/{boqId}/share-links", { params: { path: { boqId: shareBoq } } })).data!.filter((l) => l.status === "active").length;
    expect(after).toBe(before + 1);
    expect((await settings({ shareOnlySavedVersions: false })).response.status).toBe(200);
    expect((await current()).permissions).toMatchObject({ shareWorking: true });
  });
});
