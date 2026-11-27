import { beforeAll, describe, expect, it } from "vitest";
import { client } from "../support/env";
import { invitationToken, mailsTo } from "../support/mail";
import { allowSeats } from "../support/plans";
import { signUp, uniqueEmail, type TestUser } from "../support/users";

/**
 * BR-50 (every read and write is scoped to the caller's org and project role; others get 404), BR-52
 * (deleting an org), and the core operations no other suite calls: revoking an invitation, editing a
 * model, deleting a model version.
 */

const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

let owner: TestUser;
let stranger: TestUser;
let orgId: string;
let projectId: string;
let boqId: string;
let modelId: string;

beforeAll(async () => {
  owner = await signUp("Iso Owner", uniqueEmail("iso-owner"));
  stranger = await signUp("Iso Stranger", uniqueEmail("iso-stranger"));
  const { data: org } = await client(owner.token).POST("/orgs", { body: { name: "Iso Firm", slug: slug("iso") } });
  await allowSeats(org!.id);
  orgId = org!.id;
  projectId = (await client(owner.token).POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "Private" } })).data!.id;
  boqId = (await client(owner.token).POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name: "Private BoQ" } })).data!.id;
  modelId = (await client(owner.token).POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name: "Arch" } })).data!.id;
}, 60_000);

describe("BR-50: another org's people see nothing of it", () => {
  it("answers 404 on the org, its projects, BoQs, models, library, audit, usage and attention", async () => {
    const api = client(stranger.token);
    const calls = [
      api.GET("/orgs/{orgId}", { params: { path: { orgId } } }),
      api.GET("/orgs/{orgId}/projects", { params: { path: { orgId } } }),
      api.GET("/orgs/{orgId}/members", { params: { path: { orgId } } }),
      api.GET("/orgs/{orgId}/presets", { params: { path: { orgId } } }),
      api.GET("/orgs/{orgId}/attention", { params: { path: { orgId } } }),
      api.GET("/orgs/{orgId}/audit", { params: { path: { orgId } } }),
      api.GET("/orgs/{orgId}/entitlements", { params: { path: { orgId } } }),
      api.GET("/orgs/{orgId}/search", { params: { path: { orgId }, query: { q: "Private" } } }),
      api.GET("/projects/{projectId}", { params: { path: { projectId } } }),
      api.GET("/projects/{projectId}/boqs", { params: { path: { projectId } } }),
      api.GET("/boqs/{boqId}", { params: { path: { boqId } } }),
      api.GET("/boqs/{boqId}/overrides", { params: { path: { boqId } } }),
      api.GET("/models/{modelId}", { params: { path: { modelId } } }),
      api.PATCH("/projects/{projectId}", { params: { path: { projectId } }, body: { name: "Mine now" } }),
      api.PATCH("/models/{modelId}", { params: { path: { modelId } }, body: { name: "Mine now" } }),
      api.POST("/boqs/{boqId}/overrides", { params: { path: { boqId } }, body: { lineKey: "x", excluded: true, reason: "no" } }),
    ];
    for (const res of await Promise.all(calls)) expect({ url: res.response.url, status: res.response.status }).toEqual({ url: res.response.url, status: 404 });
  });
});

describe("the command palette's search finds only what the caller can open (review C-09)", () => {
  it("the owner finds the project, its BoQ and model; a member outside the project and another org's people find none of them", async () => {
    const own = client(owner.token);
    const search = async (token: string, org: string, q: string) => {
      const res = await client(token).GET("/orgs/{orgId}/search", { params: { path: { orgId: org }, query: { q } } });
      expect(res.response.status).toBe(200);
      return res.data!.items;
    };
    // Case-insensitive, by name; a BoQ and a model name their project.
    const mine = await search(owner.token, orgId, "priv");
    expect(mine.filter((h) => h.kind === "project").map((h) => h.id)).toContain(projectId);
    expect(mine.find((h) => h.kind === "boq" && h.id === boqId)).toMatchObject({ name: "Private BoQ", projectId, projectName: "Private" });
    expect((await search(owner.token, orgId, "ARCH")).find((h) => h.kind === "model" && h.id === modelId)).toMatchObject({ projectId });
    // Library presets the org lists come too (system presets here).
    expect((await search(owner.token, orgId, "a")).some((h) => h.kind === "preset")).toBe(true);

    // An org member who isn't on the project: not its name, nor its BoQ's or model's.
    const email = uniqueEmail("iso-searcher");
    await own.POST("/orgs/{orgId}/invitations", { params: { path: { orgId } }, body: { email, role: "member" } });
    const member = await signUp("Iso Searcher", email);
    await client(member.token).POST("/invitations/{token}/accept", { params: { path: { token: await invitationToken(email) } } });
    const theirs = await search(member.token, orgId, "priv");
    expect(theirs.filter((h) => h.kind !== "preset")).toEqual([]);
    expect((await search(member.token, orgId, "arch")).filter((h) => h.kind === "model")).toEqual([]);
    // Added to the project, they find it.
    await own.POST("/projects/{projectId}/members", { params: { path: { projectId } }, body: { userId: (await client(member.token).GET("/me")).data!.user.id, role: "viewer" } });
    expect((await search(member.token, orgId, "priv")).map((h) => h.id)).toEqual(expect.arrayContaining([projectId, boqId]));

    // Someone else's org of their own: the same words find nothing of this one.
    const outsider = await signUp("Iso Outsider", uniqueEmail("iso-outsider"));
    const { data: other } = await client(outsider.token).POST("/orgs", { body: { name: "Iso Search Firm", slug: slug("iso-q") } });
    const foreign = await search(outsider.token, other!.id, "priv");
    expect(foreign.map((h) => h.id)).not.toEqual(expect.arrayContaining([projectId]));
    expect(foreign.filter((h) => h.kind !== "preset")).toEqual([]);
    // An empty search is refused.
    expect((await own.GET("/orgs/{orgId}/search", { params: { path: { orgId }, query: { q: "   " } } })).response.status).toBe(400);
  });
});

describe("another org's ids in a body answer like ids that don't exist (security.md, TF-175)", () => {
  it("a rule-set version of another org, in a new BoQ's inputs and a revision's", async () => {
    const own = client(owner.token);
    const system = (await own.GET("/orgs/{orgId}/presets", { params: { path: { orgId }, query: { kind: "rule_set", layer: "system" } } })).data!;
    const base = system.find((p) => p.slug === "as-modelled")!.latestPublishedVersion!.id;
    const preset = (await own.POST("/orgs/{orgId}/presets", { params: { path: { orgId } }, body: { kind: "rule_set", name: "Iso rules", start: { mode: "patch", fromVersionId: base } } })).data!;
    const published = await own.POST("/presets/{presetId}/publish", { params: { path: { presetId: preset.id } }, body: { changeNote: "First" } });
    expect(published.response.status).toBe(200);
    const foreign = published.data!.id;

    const api = client(stranger.token);
    const { data: org } = await api.POST("/orgs", { body: { name: "Iso Stranger Firm", slug: slug("iso-s") } });
    const project = (await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId: org!.id } }, body: { name: "Mine" } })).data!;
    const answer = async (ruleSetVersionId: string) => {
      const res = await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId: project.id } }, body: { name: "B", inputs: { ruleSetVersionId } } });
      return { status: res.response.status, error: res.error };
    };
    const random = await answer("0193a2b4-0000-7000-8000-00000000abcd");
    expect(random.status).toBe(404);
    expect(await answer(foreign)).toEqual(random);
    const bill = (await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId: project.id } }, body: { name: "Mine" } })).data!;
    const patch = (ruleSetVersionId: string) => api.PATCH("/revisions/{revisionId}", { params: { path: { revisionId: bill.currentRevision.id } }, body: { inputs: { ruleSetVersionId } } });
    const r1 = await patch("0193a2b4-0000-7000-8000-00000000abcd");
    const r2 = await patch(foreign);
    expect({ status: r2.response.status, error: r2.error }).toEqual({ status: r1.response.status, error: r1.error });
    expect(r1.response.status).toBe(404);
  });
});

describe("another org's resources answer exactly like ids that don't exist (review A-37, ENG-014)", () => {
  // Runs, jobs and the rest answer through the same ApiException rule; these are the ones this suite owns.
  it("the same 404 body for a foreign and a random id of an org, project, BoQ, revision, model, version and preset", async () => {
    const own = client(owner.token);
    const revisionId = (await own.GET("/boqs/{boqId}", { params: { path: { boqId } } })).data!.currentRevision.id;
    const versionId = (await own.POST("/models/{modelId}/versions", { params: { path: { modelId } }, body: { fileName: "iso.ifc", sizeBytes: 100 } })).data!.version.id;
    const preset = (await own.POST("/orgs/{orgId}/presets", { params: { path: { orgId } }, body: { kind: "dictionary", name: "Iso names", start: { mode: "empty" } } })).data!;
    const random = "0193a2b4-0000-7000-8000-00000000abcd";
    const api = client(stranger.token);
    const reads: [string, (id: string) => Promise<{ response: Response; error?: unknown }>, string][] = [
      ["org", (id) => api.GET("/orgs/{orgId}", { params: { path: { orgId: id } } }), orgId],
      ["project", (id) => api.GET("/projects/{projectId}", { params: { path: { projectId: id } } }), projectId],
      ["BoQ", (id) => api.GET("/boqs/{boqId}", { params: { path: { boqId: id } } }), boqId],
      ["revision", (id) => api.GET("/revisions/{revisionId}", { params: { path: { revisionId: id } } }), revisionId],
      ["model", (id) => api.GET("/models/{modelId}", { params: { path: { modelId: id } } }), modelId],
      ["model version", (id) => api.GET("/model-versions/{versionId}", { params: { path: { versionId: id } } }), versionId],
      ["preset", (id) => api.GET("/presets/{presetId}", { params: { path: { presetId: id } } }), preset.id],
    ];
    for (const [what, read, foreign] of reads) {
      const a = await read(foreign);
      const b = await read(random);
      expect({ what, status: a.response.status, body: a.error }).toEqual({ what, status: 404, body: b.error });
      expect(a.error).toEqual({ code: "not_found", message: "The resource was not found." });
    }
  });
});

describe("operations no other suite calls", () => {
  it("a model's name and discipline change (F03), audited", async () => {
    const res = await client(owner.token).PATCH("/models/{modelId}", { params: { path: { modelId } }, body: { name: "Architecture", discipline: "architecture" } });
    expect(res.data).toMatchObject({ name: "Architecture", discipline: "architecture" });
    const audit = (await client(owner.token).GET("/projects/{projectId}/audit", { params: { path: { projectId }, query: { action: "model.updated" } } })).data!.items;
    expect(audit).toHaveLength(1);
  });

  it("a model version nobody uses is deleted (F03)", async () => {
    const { data } = await client(owner.token).POST("/models/{modelId}/versions", { params: { path: { modelId } }, body: { fileName: "draft.ifc", sizeBytes: 100 } });
    const versionId = data!.version.id;
    expect((await client(owner.token).DELETE("/model-versions/{versionId}", { params: { path: { versionId } } })).response.status).toBe(204);
    expect((await client(owner.token).GET("/model-versions/{versionId}", { params: { path: { versionId } } })).response.status).toBe(404);
  });

  it("a revoked invitation can't be accepted (F01 §5)", async () => {
    const email = uniqueEmail("iso-invitee");
    const { data: inv } = await client(owner.token).POST("/orgs/{orgId}/invitations", { params: { path: { orgId } }, body: { email, role: "member" } });
    const token = await invitationToken(email);
    expect((await client(owner.token).DELETE("/orgs/{orgId}/invitations/{invitationId}", { params: { path: { orgId, invitationId: inv!.id } } })).response.status).toBe(204);
    const invitee = await signUp("Invitee", email);
    expect((await client(invitee.token).POST("/invitations/{token}/accept", { params: { path: { token } } })).response.status).not.toBe(200);
    expect((await client(invitee.token).GET("/me")).data!.memberships.map((m) => m.org.id)).not.toContain(orgId);
  });

  it("BR-52: deleting the org needs its name typed; it disappears for its members at once and they are told", async () => {
    const email = uniqueEmail("iso-member");
    await client(owner.token).POST("/orgs/{orgId}/invitations", { params: { path: { orgId } }, body: { email, role: "member" } });
    const member = await signUp("Iso Member", email);
    await client(member.token).POST("/invitations/{token}/accept", { params: { path: { token: await invitationToken(email) } } });
    expect((await client(owner.token).DELETE("/orgs/{orgId}", { params: { path: { orgId } }, body: { confirmName: "Wrong" } })).response.status).toBe(400);
    expect((await client(member.token).DELETE("/orgs/{orgId}", { params: { path: { orgId } }, body: { confirmName: "Iso Firm" } })).response.status).toBe(403);
    expect((await client(owner.token).DELETE("/orgs/{orgId}", { params: { path: { orgId } }, body: { confirmName: "Iso Firm" } })).response.status).toBe(202);
    for (const u of [owner, member]) expect((await client(u.token).GET("/me")).data!.memberships.map((m) => m.org.id)).not.toContain(orgId);
    expect((await client(owner.token).GET("/projects/{projectId}", { params: { path: { projectId } } })).response.status).toBe(404);
    expect((await mailsTo(email)).some((m) => /being deleted/.test(m.subject))).toBe(true);
  });
});
