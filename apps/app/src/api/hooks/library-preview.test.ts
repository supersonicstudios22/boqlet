import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jobPollDelay as previewPollDelay } from "@/api/jobs";

/**
 * TF-134 (F16-AC2, 3 s per answer): the preview job is asked for often in its first second (it takes
 * about one), then less; and each preview is its own action for the API (a new draft each time).
 */
describe("preview job polling", () => {
  it("every 100 ms for the first second, then every 250 ms", () => {
    expect(previewPollDelay(0)).toBe(100);
    expect(previewPollDelay(950)).toBe(100);
    expect(previewPollDelay(1000)).toBe(250);
    expect(previewPollDelay(5000)).toBe(250);
  });
  it("each preview call has its own Idempotency-Key (the body doesn't carry the draft)", () => {
    const src = readFileSync(path.resolve(__dirname, "library.ts"), "utf8");
    const call = src.slice(src.indexOf('api.POST("/presets/{presetId}/preview"'), src.indexOf(".data!", src.indexOf('api.POST("/presets/{presetId}/preview"')));
    expect(call).toContain("crypto.randomUUID()");
  });
});
