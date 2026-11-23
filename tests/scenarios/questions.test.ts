import { beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "@ifc-boq/api";
import { client, ROOT_URL, authentication } from "../support/env";
import { allowProjects } from "../support/plans";
import { duplexBytes, uploadVersion, waitForVersion } from "../support/models";
import { signUp, uniqueEmail, type TestUser } from "../support/users";

/**
 * F05 questions and decisions (FE-010) on the Duplex. A BoQ without dictionaries leaves the
 * materials and wall types unnamed, so the run needs input: 33 blocking name questions.
 */

const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

let owner: TestUser;
let orgId: string;
let projectId: string;
let boq: Schemas["Boq"];
let first: Schemas["Run"];
/** The answers that also went to the project dictionary. */
let inDictionary: string[] = [];

type Api = ReturnType<typeof client>;

async function finished(api: Api, runId: string) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const { data } = await api.GET("/runs/{runId}", { params: { path: { runId } } });
    if (data && data.status !== "queued" && data.status !== "running") return data;
    if (Date.now() > deadline) throw new Error("run did not finish");
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function generate(api: Api) {
  const { data } = await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: boq.currentRevision.id } } });
  return finished(api, data!.run.id);
}

const questionsOf = async (api: Api, runId: string) => (await api.GET("/runs/{runId}/questions", { params: { path: { runId } } })).data!;
const cardBlocking = async (api: Api) => (await api.GET("/orgs/{orgId}/projects", { params: { path: { orgId } } })).data!.find((p) => p.id === projectId)!.counts!.blockingQuestions;
const pendingChanges = async (api: Api) => (await api.GET("/boqs/{boqId}", { params: { path: { boqId: boq.id } } })).data!.currentRevision.pendingChanges;

/** The first term of each category (any term answers a name question). */
async function firstTerms(api: Api) {
  const { data } = await api.GET("/orgs/{orgId}/terms", { params: { path: { orgId } } });
  const out = new Map<string, string>();
  for (const t of data!) if (!out.has(t.category)) out.set(t.category, t.id);
  return out;
}

beforeAll(async () => {
  owner = await signUp("Questions Owner", uniqueEmail("questions"));
  const api = client(owner.token);
  const { data: org } = await api.POST("/orgs", { body: { name: "Questions Firm", slug: slug("questions") } });
  orgId = org!.id;
  const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "Duplex" } });
  projectId = project!.id;
  const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name: "Architecture", discipline: "architecture" } });
  const version = await uploadVersion(owner, model!.id, await duplexBytes(), "Ifc2x3_Duplex_Architecture.ifc");
  expect((await waitForVersion(owner, version.id)).status).toBe("ready");
  const { data } = await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name: "Unnamed", inputs: { dictionaryVersionIds: [] } } });
  boq = data!;
  first = await generate(api);
}, 240_000);

describe("questions of a run (F05 §1)", () => {
  it("lists every open question, unanswered and blocking first, none answered yet", async () => {
    expect(first.status).toBe("needs_input");
    const questions = await questionsOf(client(owner.token), first.id);
    expect(questions.length).toBe(first.stats!.questions);
    const blocking = questions.filter((q) => q.blocking);
    expect(blocking.length).toBe(first.stats!.blockingQuestions);
    expect(blocking.length).toBeGreaterThanOrEqual(10);
    expect(questions.slice(0, blocking.length).every((q) => q.blocking)).toBe(true);
    expect(questions.every((q) => !q.decision && q.answeredAfterRun === false)).toBe(true);
    expect(blocking.every((q) => q.kind === "unknown_name" && q.answer.kind === "term")).toBe(true);
    // The project card counts them (F02).
    expect(await cardBlocking(client(owner.token))).toBe(blocking.length);
  });
});

describe("answering (F05 §2, §3)", () => {
  it("bulk-answers 10 names in one request; the run doesn't change until regenerated", async () => {
    const api = client(owner.token);
    const terms = await firstTerms(api);
    const questions = await questionsOf(api, first.id);
    const ten = questions.filter((q) => q.blocking && q.answer.kind === "term" && q.answer.category === "material").slice(0, 10);
    expect(ten).toHaveLength(10);
    inDictionary = ten.map((q) => q.id);
    const { data, response } = await api.POST("/projects/{projectId}/decisions", {
      params: { path: { projectId } },
      body: { decisions: ten.map((q) => ({ questionId: q.id, kind: q.kind, answer: terms.get("material")! })) },
    });
    expect(response.status).toBe(200);
    expect(data!.decisions).toHaveLength(10);
    expect(data!.reopenedRevisions).toEqual([]);

    const after = await questionsOf(api, first.id);
    const answered = after.filter((q) => q.decision);
    expect(answered.map((q) => q.id).sort()).toEqual(ten.map((q) => q.id).sort());
    expect(answered.every((q) => q.answeredAfterRun && q.decision!.answer === terms.get("material"))).toBe(true);
    expect(await cardBlocking(api)).toBe(first.stats!.blockingQuestions! - 10);
    // Answered rows sort after the open ones.
    expect(after.slice(-10).every((q) => q.decision)).toBe(true);
    // The answers wait for a regenerate; the project dictionary moved too (F05 §5).
    expect(await pendingChanges(api)).toEqual(expect.arrayContaining(["decisions", "inputs.dictionaries"]));
    const decisions = (await api.GET("/projects/{projectId}/decisions", { params: { path: { projectId } } })).data!;
    expect(decisions).toHaveLength(10);
    expect(decisions.every((d) => d.usedByLatestRuns === false && d.answerType?.kind === "term")).toBe(true);
  });

  it("answering every blocking question and regenerating gives a complete run (F05 AC1)", async () => {
    const api = client(owner.token);
    const terms = await firstTerms(api);
    const open = (await questionsOf(api, first.id)).filter((q) => q.blocking && !q.decision);
    const { response } = await api.POST("/projects/{projectId}/decisions", {
      params: { path: { projectId } },
      body: {
        decisions: open.map((q) => ({ questionId: q.id, kind: q.kind, answer: terms.get(q.answer.kind === "term" ? (q.answer.category ?? "material") : "material")! })),
        addToProjectDictionary: false,
      },
    });
    expect(response.status).toBe(200);
    const second = await generate(api);
    expect(second.status).toBe("complete");
    expect(second.stats!.blockingQuestions).toBe(0);
    // Every decision the run used is counted (review A-06), not only answers to questions it raised.
    expect(second.stats!.decisionsApplied).toBeGreaterThanOrEqual(open.length);
    expect(await pendingChanges(api)).toEqual([]);

    // The new run lists the answered questions with their answers, not as changed after the run.
    const questions = await questionsOf(api, second.id);
    const answered = questions.filter((q) => q.decision);
    expect(answered.length).toBe(first.stats!.blockingQuestions);
    expect(answered.every((q) => !q.answeredAfterRun)).toBe(true);
    const decisions = (await api.GET("/projects/{projectId}/decisions", { params: { path: { projectId } } })).data!;
    expect(decisions.every((d) => d.usedByLatestRuns)).toBe(true);
  }, 180_000);

  it("dismisses an informative question with null (leave it), and the next run doesn't ask it", async () => {
    const api = client(owner.token);
    const run = (await api.GET("/boqs/{boqId}", { params: { path: { boqId: boq.id } } })).data!.currentRevision.currentRun!;
    const info = (await questionsOf(api, run.id)).find((q) => !q.blocking && !q.decision)!;
    expect(info).toBeTruthy();
    const bad = await api.POST("/projects/{projectId}/decisions", { params: { path: { projectId } }, body: { decisions: [{ questionId: info.id, kind: info.kind, answer: 42 }] } });
    expect(bad.response.status).toBe(400);
    const dismissed = await api.POST("/projects/{projectId}/decisions", { params: { path: { projectId } }, body: { decisions: [{ questionId: info.id, kind: info.kind, answer: null }] } });
    expect(dismissed.response.status, JSON.stringify(dismissed.error)).toBe(200);
    expect(await pendingChanges(api)).toContain("decisions");
    const next = await generate(api);
    const row = (await questionsOf(api, next.id)).find((q) => q.id === info.id)!;
    expect(row.decision?.answer).toBeNull();
    expect(next.stats!.questions).toBe(run.stats!.questions! - 1);
  }, 180_000);

  it("clearing an answer is pending until the next run, which asks again", async () => {
    const api = client(owner.token);
    const decisions = (await api.GET("/projects/{projectId}/decisions", { params: { path: { projectId }, query: { kind: "unknown_name" } } })).data!;
    // One of the answers given without the project dictionary, so clearing it asks again.
    const one = decisions.find((d) => d.answerType?.kind === "term" && !inDictionary.includes(d.questionId))!;
    const { response } = await api.DELETE("/decisions/{decisionId}", { params: { path: { decisionId: one.id } } });
    expect(response.status).toBe(204);
    expect(await pendingChanges(api)).toContain("decisions");
    const run = (await api.GET("/boqs/{boqId}", { params: { path: { boqId: boq.id } } })).data!.currentRevision.currentRun!;
    const row = (await questionsOf(api, run.id)).find((q) => q.id === one.questionId)!;
    expect(row.decision).toBeUndefined();
    expect(row.answeredAfterRun).toBe(true);
    const next = await generate(api);
    expect(next.status).toBe("needs_input");
    expect((await questionsOf(api, next.id)).find((q) => q.id === one.questionId)).toMatchObject({ blocking: true, answeredAfterRun: false });
  }, 180_000);
});

describe("decisions page (F05 §7)", () => {
  it("exports the decisions as CSV", async () => {
    const res = await fetch(`${ROOT_URL}/api/v1/projects/${projectId}/decisions.csv`, { headers: await authentication(owner.token) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = (await res.text()).trim().split(/\r?\n/);
    const count = (await client(owner.token).GET("/projects/{projectId}/decisions", { params: { path: { projectId } } })).data!.length;
    expect(lines).toHaveLength(count + 1);
  });
});

describe("a decision the run doesn't use is not a pending change (BR-23, TF-029)", () => {
  it("answers about other questions leave the revision ready to save, also when they go to the project dictionary", async () => {
    const api = client(owner.token);
    // A second project in the same org (a person owns one Free org, P57).
    await allowProjects(orgId);
    const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "Duplex pending" } });
    const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId: project!.id } }, body: { name: "Architecture", discipline: "architecture" } });
    const version = await uploadVersion(owner, model!.id, await duplexBytes(), "Ifc2x3_Duplex_Architecture.ifc");
    expect((await waitForVersion(owner, version.id)).status).toBe("ready");
    const bill = (await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId: project!.id } }, body: { name: "X" } })).data!;
    const { data: started } = await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: bill.currentRevision.id } } });
    await finished(api, started!.run.id);
    const pending = async () => (await api.GET("/boqs/{boqId}", { params: { path: { boqId: bill.id } } })).data!.currentRevision.pendingChanges;
    expect(await pending()).toEqual([]);
    const { data: terms } = await api.GET("/orgs/{orgId}/terms", { params: { path: { orgId } } });
    const material = terms!.find((t) => t.category === "material")!.id;
    // A question of another BoQ (or of a model this BoQ doesn't use), and a name answer that publishes the project dictionary.
    const { data, response } = await api.POST("/projects/{projectId}/decisions", {
      params: { path: { projectId: project!.id } },
      body: { decisions: [
        { questionId: "unmatched:IfcSlab:TF-029 another BoQ", kind: "unmatched", answer: "skip" },
        { questionId: "name:material:TF-029 not in this model", kind: "unknown_name", answer: material },
      ] },
    });
    expect(response.status).toBe(200);
    expect(data!.reopenedRevisions).toEqual([]);
    expect(await pending()).toEqual([]);
    const saved = await api.POST("/revisions/{revisionId}/issue", { params: { path: { revisionId: bill.currentRevision.id } }, body: { notModelledConfirmed: true } });
    expect(saved.response.status, JSON.stringify(saved.error)).toBe(200);
  }, 300_000);
});

describe("contradiction thresholds are resolution settings (review WP-A1, A-04)", () => {
  it("a resolution preset's block threshold makes the Duplex party wall's contradiction block, and a bad one is refused", async () => {
    // Its own org: Free allows one org preset (P57).
    const lead = await signUp("Thresholds Lead", uniqueEmail("thresholds"));
    const api = client(lead.token);
    const { data: org } = await api.POST("/orgs", { body: { name: "Thresholds Firm", slug: slug("thresholds") } });
    const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId: org!.id } }, body: { name: "Duplex" } });
    const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId: project!.id } }, body: { name: "Architecture", discipline: "architecture" } });
    const version = await uploadVersion(lead, model!.id, await duplexBytes(), "Ifc2x3_Duplex_Architecture.ifc");
    expect((await waitForVersion(lead, version.id)).status).toBe("ready");

    const { data: preset, error } = await api.POST("/orgs/{orgId}/presets", { params: { path: { orgId: org!.id } }, body: { kind: "resolution", name: `Strict ${slug("r")}`, start: { mode: "empty" } } });
    expect(error).toBeUndefined();
    const draftOf = async () => {
      const p = (await api.GET("/presets/{presetId}", { params: { path: { presetId: preset!.id } } })).data!;
      return (await api.GET("/preset-versions/{presetVersionId}", { params: { path: { presetVersionId: (p.draft ?? p.latestPublishedVersion)!.id } } })).data!.doc as Record<string, unknown>;
    };
    const save = async (values: Record<string, unknown>) =>
      api.PUT("/presets/{presetId}/draft", { params: { path: { presetId: preset!.id } }, body: { doc: { ...(await draftOf()), ...values } } });
    const publish = () => api.POST("/presets/{presetId}/publish", { params: { path: { presetId: preset!.id } }, body: { changeNote: "Block above 20 %" } });

    // Blocking below the asking threshold is refused by the engine's check.
    await save({ contradictionWarnPct: 10, contradictionBlockPct: 5 });
    const bad = await publish();
    expect(bad.response.status).toBe(409);
    expect(bad.error).toMatchObject({ code: "draft_has_problems" });

    await save({ contradictionWarnPct: 10, contradictionBlockPct: 20 });
    const published = await publish();
    expect(published.response.status, JSON.stringify(published.error)).toBe(200);

    // The same model under the default settings: the party wall's contradictions (+42 % volume) are optional.
    const make = async (name: string, resolutionVersionId?: string) => {
      const created = (await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId: project!.id } }, body: { name, inputs: resolutionVersionId ? { resolutionVersionId } : {} } })).data!;
      const { data: started } = await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: created.currentRevision.id } } });
      const run = await finished(api, started!.run.id);
      return (await questionsOf(api, run.id)).filter((q) => q.kind === "contradiction");
    };
    const lenient = await make("Default thresholds");
    expect(lenient.length).toBeGreaterThan(0);
    expect(lenient.every((q) => !q.blocking)).toBe(true);
    const strict = await make("Strict thresholds", published.data!.id);
    const volume = strict.find((q) => q.id === "contradiction:volume:IfcWall:Party Wall - CMU Residential Unit Dimising Wall");
    expect(volume?.blocking).toBe(true);

    // Answering it moves the party wall: the run counts the decision and the line names who answered (A-06).
    const answer = await api.POST("/projects/{projectId}/decisions", { params: { path: { projectId: project!.id } }, body: { decisions: [{ questionId: volume!.id, kind: "contradiction", answer: "geometry" }] } });
    expect(answer.response.status).toBe(200);
    const bill = (await api.GET("/projects/{projectId}/boqs", { params: { path: { projectId: project!.id } } })).data!.find((b) => b.name === "Strict thresholds")!;
    const { data: again } = await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: bill.currentRevision.id } } });
    const run = await finished(api, again!.run.id);
    expect(run.stats!.decisionsApplied).toBeGreaterThanOrEqual(1);
    const lines = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id } } })).data!.items;
    const party = lines.find((l) => l.ruleId === "walls" && l.description.includes("Party Wall"))!;
    const named = party.trace.elements.flatMap((e) => e.decisions ?? []).find((d) => d.questionId === volume!.id);
    expect(named).toMatchObject({ answer: "geometry", by: "Thresholds Lead" });
    expect(Date.parse(named!.at!)).not.toBeNaN();
  }, 360_000);
});
