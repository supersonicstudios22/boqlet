import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import boqs from "../../../messages/en/boqs.json";
import models from "../../../messages/en/models.json";

/** Batch 2 leftover (TF-184): a progress stage Java writes itself (`waiting_for_worker`) has a text on the model and the run progress. */
describe("progress stages Java writes", () => {
  const jobs = readFileSync(path.resolve(__dirname, "../../../../../services/api/src/main/java/com/boqlet/api/worker/Jobs.java"), "utf8");
  const stages = [...jobs.matchAll(/"stage", "([a-z_]+)"/g)].map((m) => m[1]!);
  it("are found", () => expect(stages).toContain("waiting_for_worker"));
  it("have texts", () => {
    for (const stage of stages) {
      expect((models.status.stages as Record<string, string>)[stage], stage).toBeTruthy();
      expect((boqs.run.stages as Record<string, string>)[stage], stage).toBeTruthy();
    }
  });
});
