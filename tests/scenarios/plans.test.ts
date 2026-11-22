import { beforeAll, describe, expect, it } from "vitest";
import { client } from "../support/env";
import { invitationToken } from "../support/mail";
import { setPlan } from "../support/plans";
import { signUp, uniqueEmail, user, type TestUser } from "../support/users";

/**
 * P57 (F19 §9, F14): the platform admin configures plans (limits, features, price, order, who sees
 * them, the default) and the platform settings; Free is one person with one org. The suites share one
 * backend, so these tests never change the default plan or Free: they make plans of their own.
 */

const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

let pat: TestUser;
const admin = () => client(pat.token);

beforeAll(async () => {
  pat = await user("pat");
});

async function freshOrg(prefix: string) {
  const owner = await signUp(`${prefix} Owner`, uniqueEmail(prefix));
  const { data: org, response } = await client(owner.token).POST("/orgs", { body: { name: `${prefix} Firm`, slug: slug(prefix) } });
  expect(response.status).toBe(201);
  return { owner, org: org! };
}

const plan = (id: string, entitlements: Record<string, number | boolean>, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Suite ${id}`,
  description: "A plan of the shared suite",
  public: false,
  defaultPlan: false,
  position: 500,
  entitlements,
  reason: "Shared scenario suite",
  ...extra,
});

describe("P57 plans, as the platform admin configures them", () => {
  it("lists every plan, hidden ones too, with the keys a plan may set and the currency", async () => {
    const { data, response } = await admin().GET("/admin/plans");
    expect(response.status).toBe(200);
    expect(data!.currency).toMatch(/^[A-Z]{3}$/);
    const keys = Object.fromEntries(data!.entitlementKeys.map((k) => [k.key, k.type]));
    expect(keys).toMatchObject({ seats: "number", activeProjects: "number", ownedOrgsPerUser: "number", processingMinutesPerMonth: "number", shareLinks: "boolean", approvalWorkflow: "boolean" });
    const free = data!.plans.find((p) => p.id === "free")!;
    expect(free).toMatchObject({ defaultPlan: true, public: true, entitlements: { seats: 1, ownedOrgsPerUser: 1 } });
    expect(free.orgCount).toBeGreaterThan(0);
    expect(data!.plans.filter((p) => p.defaultPlan)).toHaveLength(1);
  });

  it("makes a hidden plan; customers see it with its price once it is public; a change reaches every org on it at once", async () => {
    const id = slug("suite-plan");
    const created = await admin().POST("/admin/plans", { body: plan(id, { seats: 3, activeProjects: 2, shareLinks: true }, { price: { amount: 19.5, period: "month" } }) });
    expect(created.response.status).toBe(201);
    expect(created.data).toMatchObject({ id, public: false, defaultPlan: false, orgCount: 0, price: { amount: 19.5, period: "month" }, entitlements: { seats: 3, activeProjects: 2, shareLinks: true } });
    expect((await client(null).GET("/plans")).data!.map((p) => p.id)).not.toContain(id);
    const again = await admin().POST("/admin/plans", { body: plan(id, {}) });
    expect(again.response.status).toBe(409);
    expect(again.error).toMatchObject({ code: "plan_exists" });

    const { owner, org } = await freshOrg("plan-org");
    await setPlan(owner, org.id, id);
    const limits = async () => (await client(owner.token).GET("/orgs/{orgId}/entitlements", { params: { path: { orgId: org.id } } })).data!;
    expect((await limits()).limits).toMatchObject({ seats: 3, activeProjects: 2 });

    // Before saving: what the change would do. The owner uses one seat; turning share links off takes them away.
    const impact = await admin().POST("/admin/plans/{planId}/impact", { params: { path: { planId: id } }, body: { entitlements: { seats: 0, activeProjects: 2, shareLinks: false } } });
    expect(impact.data).toEqual({ orgs: 1, affected: { seats: 1, shareLinks: 1 } });
    const fine = await admin().POST("/admin/plans/{planId}/impact", { params: { path: { planId: id } }, body: { entitlements: { seats: 5, shareLinks: true } } });
    expect(fine.data).toEqual({ orgs: 1, affected: {} });

    const updated = await admin().PUT("/admin/plans/{planId}", {
      params: { path: { planId: id } },
      body: { ...plan(id, { seats: 1, shareLinks: true }, { public: true, position: 900, price: { amount: 190, period: "year" } }), id: undefined },
    });
    expect(updated.response.status).toBe(200);
    // Every org on the plan has the new limits at once; a limit left out is unlimited.
    const now = await limits();
    expect(now.limits.seats).toBe(1);
    expect(now.limits.activeProjects).toBeUndefined();
    const listed = (await client(null).GET("/plans")).data!.find((p) => p.id === id);
    expect(listed).toMatchObject({ description: "A plan of the shared suite", price: { amount: 190, period: "year", currency: expect.stringMatching(/^[A-Z]{3}$/) } });

    const inUse = await admin().DELETE("/admin/plans/{planId}", { params: { path: { planId: id } }, body: { reason: "Suite" } });
    expect(inUse.response.status).toBe(409);
    expect(inUse.error).toMatchObject({ code: "plan_in_use" });
    await setPlan(owner, org.id, "free");
    expect((await admin().DELETE("/admin/plans/{planId}", { params: { path: { planId: id } }, body: { reason: "Suite" } })).response.status).toBe(204);
    expect((await admin().GET("/admin/plans")).data!.plans.map((p) => p.id)).not.toContain(id);
  });

  it("refuses keys the backend doesn't enforce and values that don't fit them", async () => {
    for (const entitlements of [{ nope: 1 }, { seats: -1 }, { seats: 2.5 }, { shareLinks: 1 }, { seats: true }] as Record<string, number | boolean>[]) {
      const res = await admin().POST("/admin/plans", { body: plan(slug("suite-bad"), entitlements) });
      expect({ entitlements, status: res.response.status }).toEqual({ entitlements, status: 400 });
    }
    expect((await admin().POST("/admin/plans", { body: plan("new", {}) })).response.status).toBe(400);
    expect((await admin().POST("/admin/plans", { body: plan("Not An Id", {}) })).response.status).toBe(400);
    const { org } = await freshOrg("override-key");
    const unknown = await admin().PUT("/admin/orgs/{orgId}/entitlement-overrides", { params: { path: { orgId: org.id } }, body: { overrides: { nope: 3 }, reason: "Suite" } });
    expect(unknown.response.status).toBe(400);
    const known = await admin().PUT("/admin/orgs/{orgId}/entitlement-overrides", { params: { path: { orgId: org.id } }, body: { overrides: { ownedOrgsPerUser: 3 }, reason: "Suite" } });
    expect(known.response.status).toBe(200);
  });

  it("the default plan stays default until another takes its place, and can't be deleted", async () => {
    const free = (await admin().GET("/admin/plans")).data!.plans.find((p) => p.id === "free")!;
    const unset = await admin().PUT("/admin/plans/{planId}", {
      params: { path: { planId: "free" } },
      body: { name: free.name, description: free.description, public: free.public, defaultPlan: false, position: free.position, entitlements: free.entitlements as Record<string, number | boolean>, reason: "Suite" },
    });
    expect(unset.response.status).toBe(409);
    expect(unset.error).toMatchObject({ code: "default_plan_required" });
    const deleted = await admin().DELETE("/admin/plans/{planId}", { params: { path: { planId: "free" } }, body: { reason: "Suite" } });
    expect(deleted.response.status).toBe(409);
    expect((await admin().GET("/admin/plans")).data!.plans.find((p) => p.id === "free")).toMatchObject({ defaultPlan: true, entitlements: free.entitlements });
  });
});

describe("P57 Free is one person with one org", () => {
  it("a person owns one org on the default plan; a second is 402 ownedOrgsPerUser, until the first moves to another plan", async () => {
    const { owner, org } = await freshOrg("one-org");
    const api = client(owner.token);
    const second = await api.POST("/orgs", { body: { name: "Second Firm", slug: slug("second") } });
    expect(second.response.status).toBe(402);
    expect(second.error).toMatchObject({ code: "limit_reached", details: { limit: "ownedOrgsPerUser", current: 1, max: 1 } });
    // A taken address is still the request's own problem first.
    expect((await api.POST("/orgs", { body: { name: "Copy", slug: org.slug } })).response.status).toBe(409);
    await setPlan(owner, org.id, "team");
    const now = await api.POST("/orgs", { body: { name: "Second Firm", slug: slug("second") } });
    expect(now.response.status).toBe(201);
    expect(now.data!.planId).toBe("free");
  });

  it("being invited to someone else's org doesn't count: the person can still make their own", async () => {
    const { org: other, owner: otherOwner } = await freshOrg("host");
    await setPlan(otherOwner, other.id, "team");
    const email = uniqueEmail("guest");
    expect((await client(otherOwner.token).POST("/orgs/{orgId}/invitations", { params: { path: { orgId: other.id } }, body: { email, role: "member" } })).response.status).toBe(201);
    const person = await signUp("Guest Person", email);
    expect((await client(person.token).POST("/invitations/{token}/accept", { params: { path: { token: await invitationToken(email) } } })).response.status).toBe(200);
    expect((await client(person.token).POST("/orgs", { body: { name: "Guest Firm", slug: slug("guest") } })).response.status).toBe(201);
  });
});

describe("P57 platform settings", () => {
  it("reads and changes the currency and public sign-up, with a reason; a bad currency is 400", async () => {
    const before = (await admin().GET("/admin/settings")).data!;
    expect(before.currency).toMatch(/^[A-Z]{3}$/);
    const opened = await admin().PUT("/admin/settings", { body: { publicSignUp: true, reason: "Suite" } });
    expect(opened.data).toEqual({ currency: before.currency, publicSignUp: true });
    expect((await admin().PUT("/admin/settings", { body: { currency: "eur", reason: "Suite" } })).response.status).toBe(400);
    expect((await admin().PUT("/admin/settings", { body: { publicSignUp: true } as never })).response.status).toBe(400);
    const closed = await admin().PUT("/admin/settings", { body: { publicSignUp: before.publicSignUp, reason: "Suite" } });
    expect(closed.data).toEqual(before);
  });
});
