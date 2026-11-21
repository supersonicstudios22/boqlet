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
  const { data: started } = await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: boq!.currentRevision.id } } });
  const deadline = Date.now() + 180_000;
  for (;;) {
    const { data } = await api.GET("/runs/{runId}", { params: { path: { runId: started!.run.id } } });
    if (data && data.status !== "queued" && data.status !== "running") {
      run = data;
      break;
    }
    if (Date.now() > deadline) throw new Error("federated run did not finish");
    await new Promise((r) => setTimeout(r, 300));
  }
  lines = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id } } })).data!.items;
  questions = (await api.GET("/runs/{runId}/questions", { params: { path: { runId: run.id } } })).data!;
}, 600_000);

describe("v1 criterion 2: federation through the API", () => {
  it("gives one BoQ from both models with no element measured twice by one rule", () => {
    expect(["complete", "needs_input"]).toContain(run.status);
    expect(lines.length).toBeGreaterThan(0);
    const pairs = lines.filter((l) => l.ruleKind === "item").flatMap((l) => l.trace.elements.map((e) => `${l.ruleId}|${e.guid}`));
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
