import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { idempotencyHeaders } from "./idempotency";

/**
 * TF-073 (api-conventions.md "Idempotency-Key"): the app sends a key with every action that creates a
 * job or sends an email; a double click or a retry of the same action reuses it, so the API acts once.
 */
afterEach(() => vi.useRealTimers());

describe("idempotencyHeaders", () => {
  it("is one key per action; the same action again at once reuses it, another action or a later one gets a new one", () => {
    vi.useFakeTimers();
    const a = idempotencyHeaders("generateRun:r1")["Idempotency-Key"];
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(idempotencyHeaders("generateRun:r1")["Idempotency-Key"]).toBe(a);
    expect(idempotencyHeaders("generateRun:r2")["Idempotency-Key"]).not.toBe(a);
    expect(idempotencyHeaders("exportRun:x", { groupBy: "a" })["Idempotency-Key"]).not.toBe(idempotencyHeaders("exportRun:x", { groupBy: "b" })["Idempotency-Key"]);
    vi.advanceTimersByTime(3_500);
    expect(idempotencyHeaders("generateRun:r1")["Idempotency-Key"]).not.toBe(a);
  });
});

describe("the actions the API makes idempotent send the key", () => {
  const src = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");
  it.each([
    ["api/hooks/boqs.ts", "/revisions/{revisionId}/runs"],
    ["features/boqs/create-boq-dialog.tsx", "/revisions/{revisionId}/runs"],
    ["api/hooks/exports.ts", "/runs/{runId}/exports"],
    ["api/hooks/exports.ts", "/diffs/{diffId}/export"],
    ["api/hooks/library.ts", "/presets/{presetId}/preview"],
    ["api/hooks/shares.ts", "/boqs/{boqId}/share-links"],
    ["api/hooks/versions.ts", "/revisions/{revisionId}/issue"],
    ["api/hooks/versions.ts", "/boqs/{boqId}/confirm"],
    ["features/exports/edits-import.tsx", "/revisions/{revisionId}/edits-import"],
    ["features/models/upload.ts", "/model-versions/{versionId}/complete"],
    ["features/models/version-status.tsx", "/model-versions/{versionId}/retry"],
    ["features/settings/members-settings.tsx", "/orgs/{orgId}/invitations"],
    ["features/settings/members-settings.tsx", "/orgs/{orgId}/invitations/{invitationId}/resend"],
  ])("%s POST %s", (file, op) => {
    const text = src(file);
    const at = text.indexOf(`api.POST("${op}"`);
    expect(at, op).toBeGreaterThan(0);
    // The call's options, up to the end of its statement.
    const call = text.slice(at, text.indexOf("\n", text.indexOf("})", at)));
    expect(call).toContain("idempotencyHeaders(");
  });
});
