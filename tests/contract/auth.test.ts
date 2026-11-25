import { describe, expect, it } from "vitest";
import { API_URL } from "../support/env";
import { operationsByTag, samplePath, spec } from "../support/contract";
import { isLocal, localOrigin } from "../support/local-stack.mjs";

/**
 * One contract group per tag of `openapi.yaml`: every secured operation refuses a request
 * without credentials with `401 unauthenticated` and the contract's error body, and public
 * operations (`security: []`) never ask for credentials (conventions.md "Authentication").
 * On the local stack (native sign-in) the requests come from the app's origin, as a browser's do:
 * without it an unsafe request is refused first (403 invalid_origin, checked below).
 */
const s = await spec();
const byTag = operationsByTag(s);

for (const [tag, ops] of [...byTag].sort(([a], [b]) => a.localeCompare(b))) {
  describe(`tag ${tag}`, () => {
    for (const op of ops) {
      const path = samplePath(op);
      if (op.secured) {
        it(`${op.operationId}: ${op.method} ${op.path} needs credentials`, async () => {
          const res = await fetch(API_URL + path, {
            method: op.method,
            headers: {
              ...(op.method === "GET" || op.method === "DELETE" ? {} : { "Content-Type": "application/json" }),
              ...(isLocal() ? { Origin: localOrigin() } : {}),
            },
            body: op.method === "GET" || op.method === "DELETE" ? undefined : "{}",
          });
          expect(res.status).toBe(401);
          const body = (await res.json()) as { code: string; message: string };
          expect(body.code).toBe("unauthenticated");
          expect(typeof body.message).toBe("string");
        });
      } else {
        it(`${op.operationId}: ${op.method} ${op.path} is public`, async () => {
          const res = await fetch(API_URL + path, { method: op.method, redirect: "manual" });
          expect(res.status).not.toBe(401);
        });
      }
    }
  });
}

// Native sign-in (P50) is served only by a backend that runs it. In the Java harness the suites run
// with test tokens, so they see the disabled answer; Java's NativeAuthTest covers the enabled
// behaviour, and so does the local stack, which runs it (below).
describe.skipIf(isLocal())("native sign-in on a backend that doesn't run it", () => {
  for (const [path, body] of [
    ["/auth/sign-in", { email: "someone@example.com", password: "a long enough password", deviceLabel: "Contract suite" }],
    ["/auth/set-password", { token: "t".repeat(43), password: "a long enough password" }],
    ["/auth/sign-up", { email: "someone@example.com", elapsedMs: 5000 }],
    ["/auth/password-reset", { email: "someone@example.com" }],
  ] as const) {
    it(`POST ${path} answers 404 native_auth_disabled`, async () => {
      const res = await fetch(API_URL + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { code: string }).code).toBe("native_auth_disabled");
    });
  }
});

describe.runIf(isLocal())("native sign-in on the local stack (P50)", () => {
  it("a wrong password answers 401 unauthenticated", async () => {
    const res = await fetch(API_URL + "/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: localOrigin() },
      body: JSON.stringify({ email: "nobody@example.com", password: "a long enough password", deviceLabel: "Contract suite" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("unauthenticated");
  });

  it("an unsafe request from another origin answers 403 invalid_origin", async () => {
    const res = await fetch(API_URL + "/orgs", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://elsewhere.example" }, body: "{}" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_origin");
  });
});

it.skipIf(isLocal())("GET /auth/sign-up answers 404 native_auth_disabled there too (P57)", async () => {
  const res = await fetch(API_URL + "/auth/sign-up");
  expect(res.status).toBe(404);
  expect(((await res.json()) as { code: string }).code).toBe("native_auth_disabled");
});

it("covers every tag the contract declares", () => {
  const declared = ((s.doc.tags as { name: string }[] | undefined) ?? []).map((t) => t.name);
  for (const tag of declared) expect(byTag.has(tag), `no operation for tag ${tag}`).toBe(true);
});
