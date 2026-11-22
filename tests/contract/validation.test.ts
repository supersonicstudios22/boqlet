import { describe, expect, it } from "vitest";
import { API_URL, authentication } from "../support/env";
import { user } from "../support/users";

/** conventions.md "Requests and responses" and "Errors": invalid input is a 400 with a code. */
describe("request validation", () => {
  const send = async (method: string, path: string, body?: string) =>
    fetch(API_URL + path, {
      method,
      headers: { ...(await authentication((await user("olivia")).token)), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body,
    });

  it("rejects unknown fields with 400 unknown_field", async () => {
    const res = await send("POST", "/orgs", JSON.stringify({ name: "Test firm", slug: "test-firm", colour: "red" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "unknown_field" });
  });

  it("rejects a body that breaks the schema with 400 invalid_body", async () => {
    const res = await send("POST", "/orgs", JSON.stringify({ name: "Test firm", slug: "Not a slug!" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_body" });
  });

  it("rejects a string over its maxLength and an array over its maxItems with 400 invalid_body (TF-174)", async () => {
    const name = await send("PATCH", "/me", JSON.stringify({ name: "n".repeat(121) }));
    expect(name.status).toBe(400);
    expect(await name.json()).toMatchObject({ code: "invalid_body" });
    const org = await send("POST", "/orgs", JSON.stringify({ name: "o".repeat(201), slug: "test-firm-long" }));
    expect(org.status).toBe(400);
    expect(await org.json()).toMatchObject({ code: "invalid_body" });
    const parentVersionIds = Array.from({ length: 51 }, () => crypto.randomUUID());
    const parents = await send("POST", "/presets/check", JSON.stringify({ kind: "rule_set", doc: {}, parentVersionIds }));
    expect(parents.status).toBe(400);
    expect(await parents.json()).toMatchObject({ code: "invalid_body" });
  });

  it("rejects a JSON body over 1 MiB with 413 too_large (TF-174)", async () => {
    const res = await send("PATCH", "/me", JSON.stringify({ name: "n".repeat(1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "too_large" });
  });

  it("rejects malformed JSON with 400 invalid_body", async () => {
    const res = await send("POST", "/orgs", "{");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_body" });
  });

  it("rejects an id that is not a uuid with 400", async () => {
    const res = await send("GET", "/orgs/not-a-uuid");
    expect(res.status).toBe(400);
  });
});
