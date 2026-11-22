import { describe, expect, it } from "vitest";
import { client } from "../support/env";
import { allowSeats } from "../support/plans";
import { signUp, uniqueEmail } from "../support/users";

/** api-conventions.md "Idempotency" (TF-073): the same `Idempotency-Key` answers the first response again. */
describe("Idempotency-Key", () => {
  it("a repeated key answers the first response; a key that is not a UUID is 400", async () => {
    const owner = await signUp("Idempotent Owner", uniqueEmail("idem"));
    const api = client(owner.token);
    const slug = `idem-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const { data: org } = await api.POST("/orgs", { body: { name: "Idempotent Firm", slug } });
    await allowSeats(org!.id);
    const key = crypto.randomUUID();
    const invite = () => api.POST("/orgs/{orgId}/invitations", {
      params: { path: { orgId: org!.id }, header: { "Idempotency-Key": key } },
      body: { email: uniqueEmail("invited"), role: "member" },
    });
    const first = await invite();
    expect(first.response.status).toBe(201);
    // A different body with the same key: the first invitation, not a second one.
    const again = await invite();
    expect(again.response.status).toBe(201);
    expect(again.data!.id).toBe(first.data!.id);
    expect((await api.GET("/orgs/{orgId}/invitations", { params: { path: { orgId: org!.id } } })).data).toHaveLength(1);
    const bad = await api.POST("/orgs/{orgId}/invitations", {
      params: { path: { orgId: org!.id }, header: { "Idempotency-Key": "not-a-uuid" } },
      body: { email: uniqueEmail("invited"), role: "member" },
    });
    expect(bad.response.status).toBe(400);
    expect(bad.error).toMatchObject({ code: "invalid_parameter" });
  });
});
