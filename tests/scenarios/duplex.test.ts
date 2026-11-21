import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "@ifc-boq/api";
import { client } from "../support/env";
import { duplexBytes, uploadVersion, waitForVersion } from "../support/models";
import { signUp, uniqueEmail, type TestUser } from "../support/users";

/**
 * v1 criterion 1 (TS-004) through the Java API:
 * upload → parse job → run job → lines API, with As modelled (the default rule set) and ACME cost
 * codes, gives exactly the hand-made Duplex BoQ. The expected lines are read from the engine's own
 * acceptance test (`HAND_BOQ`, `COUNTS` in engine/tests/test_duplex.py), as e2e/duplex.spec.ts does.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
type Expected = { hand: [string, string, number, string][]; counts: [string, string, number][] };

function handBoq(): Expected {
  const engine = path.join(ROOT, "engine");
  const venv = path.join(engine, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = process.env.IFC_BOQ_PYTHON || (existsSync(venv) ? venv : "python");
  // pytest only decorates at import time; a stand-in that hands back what it decorates is enough
  // (the API job's Python has the engine but not its test dependencies).
  const script = [
    "import json, sys",
    "class Any:",
    "    def __getattr__(self, name): return self",
    "    def __call__(self, *a, **k): return a[0] if len(a) == 1 and callable(a[0]) and not k else self",
    "sys.modules.setdefault('pytest', Any())",
    "sys.path.insert(0, 'tests')",
    "import test_duplex as t",
    "print(json.dumps({'hand': t.HAND_BOQ, 'counts': t.COUNTS}))",
  ].join("\n");
  return JSON.parse(execFileSync(python, ["-c", script], { cwd: engine, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } }));
}

let owner: TestUser;
let run: Schemas["Run"];
let lines: Schemas["RunLine"][];

beforeAll(async () => {
  owner = await signUp("Duplex Owner", uniqueEmail("duplex"));
  const api = client(owner.token);
  const { data: org } = await api.POST("/orgs", { body: { name: "Duplex Firm", slug: slug("duplex") } });
  const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId: org!.id } }, body: { name: "Duplex" } });
  const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId: project!.id } }, body: { name: "Architecture", discipline: "architecture" } });
  const version = await uploadVersion(owner, model!.id, await duplexBytes(), "Ifc2x3_Duplex_Architecture.ifc");
  expect((await waitForVersion(owner, version.id)).status).toBe("ready");
  const { data: presets } = await api.GET("/orgs/{orgId}/presets", { params: { path: { orgId: org!.id }, query: { kind: "classification" } } });
  const acme = presets!.find((p) => p.slug === "acme-cost-codes")!.latestPublishedVersion!.id;
  const { data: boq } = await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId: project!.id } }, body: { name: "Duplex", inputs: { classificationVersionIds: [acme] } } });
  const { data: started } = await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: boq!.currentRevision.id } } });
  const deadline = Date.now() + 180_000;
  for (;;) {
    const { data } = await api.GET("/runs/{runId}", { params: { path: { runId: started!.run.id } } });
    if (data && data.status !== "queued" && data.status !== "running") {
      run = data;
      break;
    }
    if (Date.now() > deadline) throw new Error("Duplex run did not finish");
    await new Promise((r) => setTimeout(r, 300));
  }
  lines = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id } } })).data!.items;
}, 400_000);

/** The engine test's `q`: the sum of the quantities of a rule's lines whose description contains the text. */
function q(ruleId: string, contains: string) {
  const found = lines.filter((l) => l.ruleId === ruleId && l.description.includes(contains));
  expect(found.length, `no line ${ruleId} / ${JSON.stringify(contains)}`).toBeGreaterThan(0);
  return { quantity: found.reduce((s, l) => s + (l.quantity ?? 0), 0), units: [...new Set(found.map((l) => l.unit))] };
}

describe("v1 criterion 1: the Duplex reproduces the hand-made BoQ through the API", () => {
  it("completes, with every line coded by ACME cost codes", () => {
    expect(run.status).toBe("complete");
    expect(lines.filter((l) => !l.excluded && !l.codes["acme-cost-codes"])).toEqual([]);
  });

  it("gives every hand-made line with its quantity and unit, and every count", () => {
    const expected = handBoq();
    expect(expected.hand.length).toBeGreaterThan(20);
    for (const [ruleId, contains, quantity, unit] of expected.hand) {
      const got = q(ruleId, contains);
      expect(got.units, `${ruleId} / ${contains}`).toEqual([unit]);
      expect(Math.abs(got.quantity - quantity), `${ruleId} / ${contains}: ${got.quantity} vs ${quantity}`).toBeLessThanOrEqual(Math.max(quantity * 2e-3, 0.011));
    }
    for (const [ruleId, contains, count] of expected.counts) expect(q(ruleId, contains).quantity, `${ruleId} / ${contains}`).toBe(count);
  });
});
