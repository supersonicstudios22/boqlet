import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "@ifc-boq/api";
import { client } from "../support/env";
import { allowProjects } from "../support/plans";
import { DUPLEX, duplexBytes, uploadVersion, waitForVersion } from "../support/models";
import { signUp, uniqueEmail, type TestUser } from "../support/users";
import { xlsxRows } from "../support/xlsx";

/**
 * A changed model version through the stack (v1-3, v1-13; F05-AC2, F06-AC3, F08-AC2/AC3; TF-004,
 * TF-008, TF-100): Duplex v1 answered and edited, then `Ifc2x3_Duplex_Architecture_v2.ifc` swapped in
 * (one partition wall removed, one door changed, one window added). The engine's own proof of the
 * same report is `engine/tests/test_diff.py`; its expected values are the fixture read here.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "..", "..", "engine", "tests", "fixtures", "duplex_v1_v2_diff.json");
const SAMPLES = path.resolve(HERE, "..", "..", "fixtures", "ifc", "buildingsmart", "IFC4X3");
const V2 = DUPLEX.replace(/\.ifc$/, "_v2.ifc");
const SYSTEM = "acme-cost-codes";
const PARTITION = "walls | Interior - Partition (92mm Stud) | False |  | m2";
const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
type Api = ReturnType<typeof client>;
type Line = Schemas["RunLine"];

let owner: TestUser;
let api: Api;
let orgId: string;
let projectId: string;
let modelId: string;
let codes: string;
let v2Id: string;

async function finished(runId: string) {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const { data } = await api.GET("/runs/{runId}", { params: { path: { runId } } });
    if (data && data.status !== "queued" && data.status !== "running") return data;
    if (Date.now() > deadline) throw new Error(`run ${runId} did not finish`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
async function job(jobId: string, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const { data } = await api.GET("/jobs/{jobId}", { params: { path: { jobId } } });
    if (data && data.status !== "queued" && data.status !== "running") return data;
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not finish`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
const revisionOf = async (boqId: string) => (await api.GET("/boqs/{boqId}", { params: { path: { boqId } } })).data!.currentRevision;
async function generate(boqId: string) {
  const { data } = await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: (await revisionOf(boqId)).id } } });
  return finished(data!.run.id);
}
const linesOf = async (runId: string): Promise<Line[]> => (await api.GET("/runs/{runId}/lines", { params: { path: { runId } } })).data!.items;
const questionsOf = async (runId: string) => (await api.GET("/runs/{runId}/questions", { params: { path: { runId } } })).data!;
async function useVersion(boqId: string, versionId: string) {
  const revision = await revisionOf(boqId);
  const res = await api.PATCH("/revisions/{revisionId}", { params: { path: { revisionId: revision.id } }, body: { inputs: { models: revision.inputs.models.map((m) => ({ modelId: m.modelId, modelVersionId: versionId, discipline: m.discipline })) } } });
  expect(res.response.status).toBe(200);
}
async function compare(to: string, from: string) {
  const res = await api.POST("/runs/{runId}/compare", { params: { path: { runId: to } }, body: { againstRunId: from } });
  if (res.response.status === 200) return res.data as Schemas["RunDiff"];
  const done = await job((res.data as unknown as Schemas["Job"]).id);
  expect(done.status).toBe("succeeded");
  return (await api.GET("/diffs/{diffId}", { params: { path: { diffId: (done.output as { diffId: string }).diffId } } })).data!;
}
async function all<T>(page: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string | null }>) {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const p = await page(cursor);
    out.push(...p.items);
    cursor = p.nextCursor ?? undefined;
  } while (cursor);
  return out;
}
const diffLines = (diffId: string) => all((cursor) => api.GET("/diffs/{diffId}/lines", { params: { path: { diffId }, query: { limit: 200, ...(cursor ? { cursor } : {}) } } }).then((r) => r.data!));
const diffElements = (diffId: string) => all((cursor) => api.GET("/diffs/{diffId}/elements", { params: { path: { diffId }, query: { limit: 200, ...(cursor ? { cursor } : {}) } } }).then((r) => r.data!));
const newBoq = async (name: string) => (await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name, inputs: { classificationVersionIds: [codes] } } })).data!;
const setOverride = (boqId: string, body: Schemas["LineOverrideInput"]) => api.POST("/boqs/{boqId}/overrides", { params: { path: { boqId } }, body });

/** Answers every open question of a run as a project decision: a contradiction by the geometry, a name by a term of its category. */
async function answerAll(runId: string) {
  const terms = new Map<string, string>();
  for (const t of (await api.GET("/orgs/{orgId}/terms", { params: { path: { orgId } } })).data!) if (!terms.has(t.category)) terms.set(t.category, t.id);
  const open = (await questionsOf(runId)).filter((q) => !q.decision);
  expect(open.length).toBeGreaterThan(0);
  const decisions = open.map((q) => ({
    questionId: q.id,
    kind: q.kind,
    answer: q.kind === "contradiction" ? "geometry" : (terms.get((q.answer as { category?: string }).category ?? "") ?? [...terms.values()][0]!),
  }));
  const res = await api.POST("/projects/{projectId}/decisions", { params: { path: { projectId } }, body: { decisions } });
  expect(res.response.status).toBe(200);
  return open.map((q) => q.id);
}

beforeAll(async () => {
  owner = await signUp("Versions Owner", uniqueEmail("model-versions"));
  api = client(owner.token);
  const { data: org } = await api.POST("/orgs", { body: { name: "Model Versions Firm", slug: slug("model-versions") } });
  orgId = org!.id;
  const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "Duplex" } });
  projectId = project!.id;
  const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name: "Architecture", discipline: "architecture" } });
  modelId = model!.id;
  const v1 = await uploadVersion(owner, modelId, await duplexBytes(), "Ifc2x3_Duplex_Architecture.ifc");
  expect((await waitForVersion(owner, v1.id)).status).toBe("ready");
  const { data: presets } = await api.GET("/orgs/{orgId}/presets", { params: { path: { orgId }, query: { kind: "classification" } } });
  codes = presets!.find((p) => p.slug === SYSTEM)!.latestPublishedVersion!.id;
  const v2 = await uploadVersion(owner, modelId, new Uint8Array(await readFile(V2)), "Ifc2x3_Duplex_Architecture_v2.ifc");
  expect((await waitForVersion(owner, v2.id)).status).toBe("ready");
  v2Id = v2.id;
}, 420_000);

describe("answers carry to a changed model version (F05-AC2, F08-AC2, TF-004)", () => {
  it("asks nothing again on v2, and the change report is the engine's v1 → v2 report", async () => {
    const boq = await newBoq("Answers");
    // A new BoQ takes the latest version: put it on v1 first.
    const v1 = (await api.GET("/models/{modelId}/versions", { params: { path: { modelId } } })).data!.find((v) => v.number === 1)!;
    await useVersion(boq.id, v1.id);
    const first = await generate(boq.id);
    const asked = await answerAll(first.id);
    const answered = await generate(boq.id);
    expect((await questionsOf(answered.id)).filter((q) => !q.decision)).toEqual([]);
    await useVersion(boq.id, v2Id);
    const second = await generate(boq.id);
    const questions = await questionsOf(second.id);
    expect(questions.filter((q) => !q.decision)).toEqual([]);
    expect(questions.filter((q) => asked.includes(q.id)).every((q) => q.decision)).toBe(true);
    expect(second.status).toBe("complete");

    const expected = JSON.parse(await readFile(FIXTURE, "utf8")) as { summary: Record<string, number>; lines: Record<string, [number, string]>; elements: Record<string, string> };
    const diff = await compare(second.id, answered.id);
    expect(diff.summary).toMatchObject(expected.summary);
    expect(diff.summary.inputsChanged).toEqual(["inputs.models"]);
    const lines = await diffLines(diff.id);
    expect(lines.map((l) => l.lineKey).sort()).toEqual(Object.keys(expected.lines).sort());
    for (const line of lines) {
      const [delta, cause] = expected.lines[line.lineKey]!;
      expect(Math.abs(line.delta! - delta), line.lineKey).toBeLessThanOrEqual(0.011);
      expect(line.causes, line.lineKey).toEqual([cause]);
    }
    expect(Object.fromEntries((await diffElements(diff.id)).map((e) => [e.guid, e.change]))).toEqual(expected.elements);
  }, 600_000);
});

describe("line edits survive a changed model version (F06-AC3, F08-AC3, TF-008)", () => {
  it("quantity with reason, text, unit, move and exclusion made on v1 apply on v2; the Excel shows the text and the reason", async () => {
    const boq = await newBoq("Edits");
    const v1 = (await api.GET("/models/{modelId}/versions", { params: { path: { modelId } } })).data!.find((v) => v.number === 1)!;
    await useVersion(boq.id, v1.id);
    const before = await linesOf((await generate(boq.id)).id);
    const byKey = new Map(before.map((l) => [l.key, l]));
    const door = before.find((l) => l.ruleId === "doors" && l.key.includes("0864"))!;
    const window = before.find((l) => l.ruleId === "windows")!;
    const steel = before.find((l) => l.ruleId === "steel-sections")!;
    const slab = before.find((l) => l.ruleId === "slabs")!;
    const target = slab.codes[SYSTEM]!.code === "D.02" ? "D.01" : "D.02";
    expect(byKey.get(PARTITION)).toBeTruthy();
    for (const body of [
      { lineKey: PARTITION, quantity: 117.04, reason: "Site survey" },
      { lineKey: door.key, description: "Door 864 mm, edited text" },
      { lineKey: steel.key, quantity: 905, unit: "kg", reason: "Supplier list" },
      { lineKey: slab.key, codes: { [SYSTEM]: target } },
      { lineKey: window.key, excluded: true, reason: "Client supplies" },
    ]) expect((await setOverride(boq.id, body)).response.status, body.lineKey).toBe(200);
    await useVersion(boq.id, v2Id);
    const run = await generate(boq.id);
    expect((await questionsOf(run.id)).filter((q) => q.kind === "orphan_override")).toEqual([]);
    const after = new Map((await linesOf(run.id)).map((l) => [l.key, l]));
    expect(after.get(PARTITION)).toMatchObject({ quantity: 117.04, overridden: { reason: "Site survey" } });
    expect(after.get(PARTITION)!.overridden!.engineQuantity).not.toBeCloseTo(byKey.get(PARTITION)!.quantity!, 2);
    expect(after.get(door.key)).toMatchObject({ description: "Door 864 mm, edited text", overridden: { engineDescription: door.description } });
    expect(after.get(steel.key)).toMatchObject({ quantity: 905, unit: "kg", overridden: { engineUnit: steel.unit } });
    expect(after.get(slab.key)!.codes[SYSTEM]!.code).toBe(target);
    expect(after.get(window.key)!.excluded).toBe(true);

    const { data: started } = await api.POST("/runs/{runId}/exports", { params: { path: { runId: run.id } }, body: { format: "xlsx", groupBy: SYSTEM } });
    const done = await job(started!.id);
    expect(done.status).toBe("succeeded");
    const rows = await xlsxRows(owner, (done.output as { exportId: string }).exportId, "BoQ");
    expect(rows.some((r) => r[1] === "Door 864 mm, edited text")).toBe(true);
    const partitionRow = rows.find((r) => r[8] === PARTITION)!;
    expect(partitionRow[3]).toBe(117.04);
    expect(String(partitionRow[7] ?? "")).toContain("Site survey");
    expect(rows.some((r) => r[8] === window.key)).toBe(false);
  }, 600_000);
});

describe("an edit whose line goes away (BR-09, TF-100)", () => {
  let boqId: string;
  let structure: string;
  let run: Schemas["Run"];
  // Lines only the structure model gives: its footings and its girder.
  let FOOTINGS: string;
  let GIRDER: string;

  const withoutStructure = async () => {
    const revision = await revisionOf(boqId);
    const models = revision.inputs.models.filter((m) => m.modelId !== structure).map((m) => ({ modelId: m.modelId, modelVersionId: m.modelVersionId, discipline: m.discipline }));
    expect((await api.PATCH("/revisions/{revisionId}", { params: { path: { revisionId: revision.id } }, body: { inputs: { models } } })).response.status).toBe(200);
    return generate(boqId);
  };

  beforeAll(async () => {
    // A Free org has one active project and a person owns one Free org (P57): the federated project gets room in the same org.
    await allowProjects(orgId);
    const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "Certification building" } });
    const models: Record<string, string> = {};
    for (const [name, discipline] of [["Architecture", "architecture"], ["Structural", "structure"]] as const) {
      const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId: project!.id } }, body: { name, discipline } });
      const version = await uploadVersion(owner, model!.id, new Uint8Array(await readFile(path.join(SAMPLES, `Building-${name}.ifc`))), `Building-${name}.ifc`);
      expect((await waitForVersion(owner, version.id)).status).toBe("ready");
      models[discipline] = model!.id;
    }
    structure = models.structure!;
    boqId = (await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId: project!.id } }, body: { name: "Federated" } })).data!.id;
    const lines = await linesOf((await generate(boqId)).id);
    const keys = lines.map((l) => l.key);
    FOOTINGS = keys.find((k) => k.startsWith("footings | "))!;
    GIRDER = keys.find((k) => k.startsWith("linear-other | IfcBeam"))!;
    expect([FOOTINGS, GIRDER], keys.join(" ; ")).not.toContain(undefined);
    expect((await setOverride(boqId, { lineKey: FOOTINGS, quantity: 200, reason: "Structural engineer's figure" })).response.status).toBe(200);
    expect((await setOverride(boqId, { lineKey: GIRDER, sortAfter: lines[0]!.key })).response.status).toBe(200);
    run = await withoutStructure();
  }, 600_000);


  it("removing the structure model turns the footing's quantity edit into an orphan_override question, not blocking", async () => {
    expect(run.status).not.toBe("failed");
    const orphan = (await questionsOf(run.id)).find((q) => q.id === `orphan:${FOOTINGS}`);
    expect(orphan).toMatchObject({ kind: "orphan_override", blocking: false, params: { lineKey: FOOTINGS } });
  }, 300_000);

  it("TF-052 (Java part): a reorder-only edit of a line that goes away orphans too", async () => {
    expect((await questionsOf(run.id)).some((q) => q.id === `orphan:${GIRDER}`)).toBe(true);
  });
});

describe("change report timing (F08-AC4, TF-100)", () => {
  it("an uncached Duplex report is ready in under 3 s", async () => {
    const boq = await newBoq("Timing");
    const first = await generate(boq.id);
    const v1 = (await api.GET("/models/{modelId}/versions", { params: { path: { modelId } } })).data!.find((v) => v.number === 1)!;
    await useVersion(boq.id, v1.id);
    const second = await generate(boq.id);
    const started = Date.now();
    const res = await api.POST("/runs/{runId}/compare", { params: { path: { runId: second.id } }, body: { againstRunId: first.id } });
    expect(res.response.status).toBe(202);
    const done = await job((res.data as unknown as Schemas["Job"]).id, 10_000);
    const diffId = (done.output as { diffId: string }).diffId;
    await api.GET("/diffs/{diffId}/lines", { params: { path: { diffId } } });
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 300_000);
});
