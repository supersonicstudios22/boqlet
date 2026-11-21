import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { engine } from "../src/engine/engine.js";
import { FIXTURES_DIR } from "../src/paths.js";

/**
 * The mock runs the Duplex through the engine worker. Needs `npm run dev:engine-worker`.
 */
let up = false;
beforeAll(async () => {
  up = await engine()
    .health()
    .then((h) => h.ok)
    .catch(() => false);
  if (!up) console.warn("[engine.test] Start the engine with `npm run dev:engine-worker`");
});

describe("WorkerEngine", () => {
  it("parses the Duplex and generates its BoQ", async (ctx) => {
    if (!up) ctx.skip();
    const model = await engine().parseModel({ path: path.join(FIXTURES_DIR, "ifc", "Ifc2x3_Duplex_Architecture.ifc") });
    expect(model.modelId).toMatch(/^[0-9a-f]{16,}/);
    const { runId, result } = await engine().run({
      models: [{ modelId: model.modelId }],
      ruleSet: "as-modelled",
      dictionaries: ["global-seed"],
      classifications: ["acme-cost-codes"],
      decisions: [],
    });
    expect(runId).toBeTruthy();
    expect(result.lines.length).toBeGreaterThan(30);
    expect(result.lines.every((l) => typeof l.key === "string")).toBe(true);
  });
});
