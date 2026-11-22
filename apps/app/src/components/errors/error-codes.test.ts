import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import errors from "../../../messages/en/errors.json";

/**
 * TF-077 (api-conventions.md: "The UI translates by `code`… `message` only as a fallback"): every error
 * code the Java API answers has a text in `errors.codes`, except the few no screen shows (the request
 * itself was malformed, or the auth flow handles them).
 */
const java = path.resolve(__dirname, "../../../../../services/api/src/main/java");
const NOT_SHOWN = new Set(["internal", "invalid_request", "method_not_allowed", "not_acceptable", "invalid_token", "unauthenticated", "session_active", "engine_timeout", "ingestion_failed"]);

function javaFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n);
    return statSync(f).isDirectory() ? javaFiles(f) : n.endsWith(".java") ? [f] : [];
  });
}

describe("error codes", () => {
  it("every code Java answers has a text", () => {
    const codes = new Set<string>();
    for (const f of javaFiles(java)) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/HttpStatus\.[A-Z_]+,\s*"([a-z][a-z_]*)"/g)) codes.add(m[1]!);
      // Helpers that take (code, "Message…"): bad("invalid_body", "…"), notReady("no_run", "…").
      for (const m of s.matchAll(/\b(?:bad|invalid|failure|failed|notReady|conflict|forbidden|notFound|ApiError)\(\s*"([a-z]+(?:_[a-z]+)*)"\s*,\s*"[A-Z]/g)) codes.add(m[1]!);
    }
    expect(codes.size).toBeGreaterThan(50);
    const missing = [...codes].filter((c) => !NOT_SHOWN.has(c) && !(c in errors.codes)).sort();
    expect(missing).toEqual([]);
  });
});
