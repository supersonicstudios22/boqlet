import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "@ifc-boq/api";
import { client } from "../support/env";
import { uploadVersion, waitForVersion } from "../support/models";
import { signUp, uniqueEmail, type TestUser } from "../support/users";

/**
 * v1 criterion 2 (TS-004) through the full stack: an architecture and a structure model of the
 * buildingSMART certification building in one project give one BoQ in which nothing is measured
 * twice, as the engine's own test_federation shows for the engine alone. The chimney is in both
 * models under one GlobalId and is counted once, from the model with its body.
 */

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "ifc", "buildingsmart", "IFC4X3");
const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

let owner: TestUser;
let run: Schemas["Run"];
let lines: Schemas["RunLine"][];
let questions: Schemas["QuestionWithDecision"][];

beforeAll(async () => {
  owner = await signUp("Federation Owner", uniqueEmail("federation"));
  const api = client(owner.token);
  const { data: org } = await api.POST("/orgs", { body: { name: "Federation Firm", slug: slug("fed") } });
  const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId: org!.id } }, body: { name: "Certification building" } });
  for (const [name, discipline] of [["Architecture", "architecture"], ["Structural", "structure"]] as const) {
    const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId: project!.id } }, body: { name, discipline } });
    const bytes = new Uint8Array(await readFile(path.join(SAMPLES, `Building-${name}.ifc`)));
    const version = await uploadVersion(owner, model!.id, bytes, `Building-${name}.ifc`);
    expect((await waitForVersion(owner, version.id)).status).toBe("ready");
  }
  const { data: boq } = await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId: project!.id } }, body: { name: "Federated", inputs: {} } });
  expect(boq!.currentRevision.inputs.models).toHaveLength(2);
  run = await generate(api, boq!.currentRevision.id);
  lines = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id } } })).data!.items;
  questions = (await api.GET("/runs/{runId}/questions", { params: { path: { runId: run.id } } })).data!;
}, 600_000);

async function generate(api: ReturnType<typeof client>, revisionId: string): Promise<Schemas["Run"]> {
  const { data: started } = await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId } } });
  const deadline = Date.now() + 180_000;
  for (;;) {
    const { data } = await api.GET("/runs/{runId}", { params: { path: { runId: started!.run.id } } });
    if (data && data.status !== "queued" && data.status !== "running") return data;
    if (Date.now() > deadline) throw new Error("federated run did not finish");
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe("v1 criterion 2: federation through the API", () => {
  it("gives one BoQ from both models with no element measured twice by one rule", () => {
    expect(["complete", "needs_input"]).toContain(run.status);
    expect(lines.length).toBeGreaterThan(0);
    // a breakdown measures each part once (paint on each face of a wall, A-11): keyed by the part's name
    const pairs = lines.filter((l) => l.ruleKind === "item").flatMap((l) => l.trace.elements.map((e) => `${l.ruleId}|${e.guid}|${e.name}`));
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("counts the chimney that is in both models once, and measures the roof from the architecture model", () => {
    const chimney = lines.flatMap((l) => l.trace.elements).filter((e) => (e as { name?: string }).name === "house - chimney");
    expect(chimney).toHaveLength(1);
    const roofs = lines.filter((l) => l.ruleId === "roofs").reduce((sum, l) => sum + (l.quantity ?? 0), 0);
    expect(roofs).toBeCloseTo(53.61, 2);
  });

  it("asks no overlap or unmatched questions for these models", () => {
    expect(questions.filter((q) => q.kind === "overlap" || q.kind === "unmatched")).toEqual([]);
  });
});

/**
 * Review A-18: the same object in two models whose copies disagree is asked, not settled by model order. The
 * structural model is federated with a copy of itself (same GlobalIds) in which the inner wall's type has another
 * name: one non-blocking `duplicate_conflict` question; answering it with the other model's copy
 * measures that copy.
 */
describe("copies of one GlobalId that disagree (review A-18)", () => {
  const WALL = "37GxndZsXCwBzM0QrdRDLo";
  let api: ReturnType<typeof client>;
  let projectId: string;
  let revisionId: string;
  const wallModel = async (runId: string) => {
    const items = (await api.GET("/runs/{runId}/lines", { params: { path: { runId } } })).data!.items;
    return [...new Set(items.filter((l) => l.ruleKind === "item").flatMap((l) => l.trace.elements)
      .filter((e) => e.guid === WALL).map((e) => (e as { model?: string }).model))];
  };

  beforeAll(async () => {
    api = client(owner.token);
    const { data: orgs } = await api.GET("/orgs");
    const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId: orgs![0]!.id } }, body: { name: "Two copies" } });
    projectId = project!.id;
    const text = await readFile(path.join(SAMPLES, "Building-Structural.ifc"), "utf8");
    // the inner wall's own type (IfcWallType 3sv$5PJEr5hP_mSgN$A$GJ, used by no other wall) gets another name
    const renamed = text.replace("IFCWALLTYPE('3sv$5PJEr5hP_mSgN$A$GJ',#1,'house - inner wall'", "IFCWALLTYPE('3sv$5PJEr5hP_mSgN$A$GJ',#1,'house - partition'");
    expect(renamed).not.toBe(text);
    for (const [name, discipline, body] of [["Structure", "structure", text], ["Architecture", "architecture", renamed]] as const) {
      const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name, discipline } });
      const version = await uploadVersion(owner, model!.id, new TextEncoder().encode(body), `${name}.ifc`);
      expect((await waitForVersion(owner, version.id)).status).toBe("ready");
    }
    const { data: boq } = await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId } }, body: { name: "Copies", inputs: {} } });
    revisionId = boq!.currentRevision.id;
  }, 600_000);

  it("asks which copy to measure, and measures the copy the answer names", async () => {
    const first = await generate(api, revisionId);
    const asked = (await api.GET("/runs/{runId}/questions", { params: { path: { runId: first.id } } })).data!
      .filter((q) => q.kind === "duplicate_conflict");
    expect(asked.map((q) => q.id)).toEqual([`duplicate_conflict:${WALL}`]);
    const q = asked[0]!;
    expect(q.blocking).toBe(false);
    const options = (q.answer as { options: { value: string }[] }).options.map((o) => o.value);
    expect(options).toEqual(["architecture", "structure"]);
    const before = await wallModel(first.id);
    expect(before).toHaveLength(1);
    const other = options.find((o) => o !== q.suggestion)!;
    const res = await api.POST("/projects/{projectId}/decisions", { params: { path: { projectId } }, body: { decisions: [{ questionId: q.id, kind: q.kind, answer: other }] } });
    expect(res.response.status).toBe(200);
    const second = await generate(api, revisionId);
    const after = await wallModel(second.id);
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before[0]);
    const again = (await api.GET("/runs/{runId}/questions", { params: { path: { runId: second.id } } })).data!.find((x) => x.id === q.id);
    expect(again?.decision?.answer).toBe(other);
  }, 600_000);
});
