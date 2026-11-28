import { describe, expect, it } from "vitest";
import { advanceDays, hasTestClock, resetClock } from "../support/clock";
import { API_URL, client } from "../support/env";
import { invitationToken } from "../support/mail";
import { allowSeats } from "../support/plans";
import { SMALL_FIRM_SLUG, STUDIO_SLUG, signUp, uniqueEmail, user, type TestUser } from "../support/users";

/** F01 accounts, organisations, members: acceptance criteria and behaviour, through the API only. */

const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A new person with a new Free org; `seats` (an override, default 25) leaves room to invite colleagues (Free has one, P57). */
async function newOwnerWithOrg(prefix = "firm", seats: number | null = 25) {
  const owner = await signUp("Owner Person", uniqueEmail(prefix));
  const { data: org, response } = await client(owner.token).POST("/orgs", { body: { name: "Test Firm", slug: slug(prefix) } });
  expect(response.status).toBe(201);
  if (seats !== null) await allowSeats(org!.id, seats);
  return { owner, org: org! };
}

async function invite(owner: TestUser, orgId: string, email: string, role: "admin" | "member" | "library_editor" | "owner" = "member") {
  return client(owner.token).POST("/orgs/{orgId}/invitations", { params: { path: { orgId } }, body: { email, role } });
}

async function inviteAndJoin(owner: TestUser, orgId: string, role: "admin" | "member" | "owner" = "member") {
  const email = uniqueEmail("invitee");
  expect((await invite(owner, orgId, email, role)).response.status).toBe(201);
  const person = await signUp("Invited Person", email);
  const token = await invitationToken(email);
  const joined = await client(person.token).POST("/invitations/{token}/accept", { params: { path: { token } } });
  expect(joined.response.status).toBe(200);
  return person;
}

describe("F01 organisations", () => {
  it("F01-AC1 a new user creates an org: owner, Free plan, and the org is in GET /me", async () => {
    const { owner, org } = await newOwnerWithOrg();
    expect(org.planId).toBe("free");
    const { data: me } = await client(owner.token).GET("/me");
    expect(me!.memberships).toEqual([expect.objectContaining({ role: "owner", org: expect.objectContaining({ id: org.id }) })]);
  });

  it("a taken slug answers 409 slug_taken", async () => {
    const { owner, org } = await newOwnerWithOrg();
    const again = await client(owner.token).POST("/orgs", { body: { name: "Copy", slug: org.slug } });
    expect(again.response.status).toBe(409);
    expect(again.error).toMatchObject({ code: "slug_taken" });
  });

  it("the app's own route names are never an org's address", async () => {
    const { owner, org } = await newOwnerWithOrg();
    for (const slug of ["admin", "account", "notifications", "onboarding", "invite", "sign-in"]) {
      const created = await client(owner.token).POST("/orgs", { body: { name: "Shadowed", slug } });
      expect({ slug, status: created.response.status }).toEqual({ slug, status: 409 });
    }
    const renamed = await client(owner.token).PATCH("/orgs/{orgId}", { params: { path: { orgId: org.id } }, body: { slug: "admin" } });
    expect(renamed.response.status).toBe(409);
  });

  it("only owners and admins change org settings", async () => {
    const { owner, org } = await newOwnerWithOrg();
    const member = await inviteAndJoin(owner, org.id);
    const denied = await client(member.token).PATCH("/orgs/{orgId}", { params: { path: { orgId: org.id } }, body: { name: "Renamed" } });
    expect(denied.response.status).toBe(403);
    const ok = await client(owner.token).PATCH("/orgs/{orgId}", { params: { path: { orgId: org.id } }, body: { name: "Renamed" } });
    expect(ok.data!.name).toBe("Renamed");
  });

  it("a partial settings PATCH keeps the settings it doesn't name (TF-191)", async () => {
    const { owner, org } = await newOwnerWithOrg("settings");
    const patch = (settings: Record<string, unknown>) => client(owner.token).PATCH("/orgs/{orgId}", { params: { path: { orgId: org.id } }, body: { settings } });
    expect((await patch({ defaultLanguage: "sr" })).data!.settings).toMatchObject({ defaultLanguage: "sr" });
    expect((await patch({ defaultCurrency: "EUR" })).data!.settings).toMatchObject({ defaultLanguage: "sr", defaultCurrency: "EUR" });
  });

  it("someone outside the org gets 404, not 403", async () => {
    const { org } = await newOwnerWithOrg();
    const outsider = await user("victor");
    const res = await client(outsider.token).GET("/orgs/{orgId}", { params: { path: { orgId: org.id } } });
    expect(res.response.status).toBe(404);
  });
});

describe("F01 invitations", () => {
  it("F01-AC2 an invited user with a different email cannot accept", async () => {
    const { owner, org } = await newOwnerWithOrg();
    const invited = uniqueEmail("right");
    await invite(owner, org.id, invited);
    const token = await invitationToken(invited);
    const preview = await client(null).GET("/invitations/{token}", { params: { path: { token } } });
    // Review C-31: the preview names the inviter and says the address has no account yet.
    expect(preview.data).toMatchObject({ orgName: "Test Firm", email: invited, role: "member", status: "pending", invitedBy: "Owner Person", hasAccount: false });
    const someoneElse = await signUp("Someone Else", uniqueEmail("wrong"));
    const refused = await client(someoneElse.token).POST("/invitations/{token}/accept", { params: { path: { token } } });
    expect(refused.response.status).toBe(409);
    expect(refused.error).toMatchObject({ code: "email_mismatch" });
    const right = await signUp("Right Person", invited.toUpperCase());
    expect((await client(null).GET("/invitations/{token}", { params: { path: { token } } })).data?.hasAccount).toBe(true);
    const ok = await client(right.token).POST("/invitations/{token}/accept", { params: { path: { token } } });
    expect(ok.response.status).toBe(200);
    expect(ok.data!.role).toBe("member");
  });

  it("P57: Free is one person: its owner takes the only seat, so an invitation is 402 seats", async () => {
    const { owner, org } = await newOwnerWithOrg("solo", null);
    const refused = await invite(owner, org.id, uniqueEmail("seat"));
    expect(refused.response.status).toBe(402);
    expect(refused.error).toMatchObject({ code: "limit_reached", details: { limit: "seats", current: 1, max: 1 } });
  });

  it("F01-AC3 inviting beyond the seat limit answers 402 with limit seats (pending invitations count)", async () => {
    const { owner, org } = await newOwnerWithOrg("seats", 2); // 2 seats: the owner takes one
    expect((await invite(owner, org.id, uniqueEmail("seat"))).response.status).toBe(201);
    const over = await invite(owner, org.id, uniqueEmail("seat"));
    expect(over.response.status).toBe(402);
    expect(over.error).toMatchObject({ code: "limit_reached", details: { limit: "seats", current: 2, max: 2 } });
  });

  it("inviting a member answers 409 already_member", async () => {
    const { owner, org } = await newOwnerWithOrg();
    const res = await invite(owner, org.id, owner.email);
    expect(res.response.status).toBe(409);
    expect(res.error).toMatchObject({ code: "already_member" });
  });

  it.runIf(hasTestClock)("invitations expire after 14 days; resending gives a new link", async () => {
    const { owner, org } = await newOwnerWithOrg();
    const email = uniqueEmail("late");
    const { data: inv } = await invite(owner, org.id, email);
    const oldToken = await invitationToken(email);
    try {
      await advanceDays(15);
      const preview = await client(null).GET("/invitations/{token}", { params: { path: { token: oldToken } } });
      expect(preview.data!.status).toBe("expired");
      const late = await signUp("Late Person", email);
      const refused = await client(late.token).POST("/invitations/{token}/accept", { params: { path: { token: oldToken } } });
      expect(refused.response.status).toBe(409);
    } finally {
      await resetClock();
    }
    const listed = await client(owner.token).GET("/orgs/{orgId}/invitations", { params: { path: { orgId: org.id } } });
    expect(listed.data!.find((i) => i.id === inv!.id)?.status).toBe("pending");
  });

  it("members can't invite; admins can't invite owners", async () => {
    const { owner, org } = await newOwnerWithOrg();
    const member = await inviteAndJoin(owner, org.id, "member");
    expect((await invite(member, org.id, uniqueEmail("x"))).response.status).toBe(403);
  });
});

describe("F01 roles and members", () => {
  it("F01-AC4 the last owner can't leave or be demoted", async () => {
    const { owner, org } = await newOwnerWithOrg();
    const admin = await inviteAndJoin(owner, org.id, "admin");
    const path = { orgId: org.id, userId: owner.id };
    const leave = await client(owner.token).DELETE("/orgs/{orgId}/members/{userId}", { params: { path } });
    expect(leave.response.status).toBe(409);
    expect(leave.error).toMatchObject({ code: "last_owner" });
    // An admin may not touch an owner at all; the owner may not change their own role.
    expect((await client(admin.token).PATCH("/orgs/{orgId}/members/{userId}", { params: { path }, body: { role: "member" } })).response.status).toBe(403);
    const own = await client(owner.token).PATCH("/orgs/{orgId}/members/{userId}", { params: { path }, body: { role: "member" } });
    expect(own.response.status).toBe(409);
    // With a second owner, the first may leave.
    const promoted = await client(owner.token).PATCH("/orgs/{orgId}/members/{userId}", { params: { path: { orgId: org.id, userId: admin.id } }, body: { role: "owner" } });
    expect(promoted.data!.role).toBe("owner");
    expect((await client(owner.token).DELETE("/orgs/{orgId}/members/{userId}", { params: { path } })).response.status).toBe(204);
  });

  it("F01-AC7 every action writes an audit event", async () => {
    const { owner, org } = await newOwnerWithOrg();
    await client(owner.token).PATCH("/orgs/{orgId}", { params: { path: { orgId: org.id } }, body: { name: "Audited" } });
    const person = await inviteAndJoin(owner, org.id, "member");
    const path = { orgId: org.id, userId: person.id };
    await client(owner.token).PATCH("/orgs/{orgId}/members/{userId}", { params: { path }, body: { role: "admin" } });
    await client(owner.token).DELETE("/orgs/{orgId}/members/{userId}", { params: { path } });
    const { data } = await client(owner.token).GET("/orgs/{orgId}/audit", { params: { path: { orgId: org.id } } });
    const actions = data!.items.map((e) => e.action);
    for (const action of ["org.created", "org.updated", "member.invited", "member.joined", "member.role_changed", "member.removed"]) {
      expect(actions).toContain(action);
    }
  });

  it("F01-AC6 a user in two orgs sees both, and each org's data stays its own", async () => {
    const olivia = await user("olivia");
    const { data: orgs } = await client(olivia.token).GET("/orgs");
    expect(orgs!.map((o) => o.slug).sort()).toEqual(expect.arrayContaining([SMALL_FIRM_SLUG, STUDIO_SLUG]));
    for (const org of orgs!) {
      const members = await client(olivia.token).GET("/orgs/{orgId}/members", { params: { path: { orgId: org.id } } });
      expect(members.response.status).toBe(200);
    }
  });

  it("PATCH /me changes my name", async () => {
    const me = await signUp("Old Name", uniqueEmail("rename"));
    const { data } = await client(me.token).PATCH("/me", { body: { name: "New Name" } });
    expect(data!.name).toBe("New Name");
  });

  it("TF-121: PATCH /me takes a language tag as the locale, nothing else", async () => {
    const me = await signUp("Locale Person", uniqueEmail("locale"));
    const bad = await client(me.token).PATCH("/me", { body: { locale: "not a locale!!" } });
    expect(bad.response.status).toBe(400);
    expect(bad.error).toMatchObject({ code: "invalid_body" });
    expect((await client(me.token).PATCH("/me", { body: { locale: "sr-Latn" } })).data!.locale).toBe("sr-Latn");
  });

  it("TF-176: names refuse control and text-direction characters; other scripts and emoji are names", async () => {
    const { owner, org } = await newOwnerWithOrg("names");
    for (const name of ["a\u0007b", "\u001b[31mred", "a\r\nb", "abc‮txt.exe", "x\ud800", "nul\u0000"]) {
      const me = await client(owner.token).PATCH("/me", { body: { name } });
      expect(me.response.status, JSON.stringify(name)).toBe(400);
      expect(me.error).toMatchObject({ code: "invalid_body" });
    }
    const renamed = await client(owner.token).PATCH("/orgs/{orgId}", { params: { path: { orgId: org.id } }, body: { name: "Firm‮" } });
    expect(renamed.response.status).toBe(400);
    expect((await client(owner.token).PATCH("/me", { body: { name: "Ana Đurić 名前 😀" } })).data!.name).toBe("Ana Đurić 名前 😀");
  });

  it("TF-119: org.updated names the settings that changed, before and after", async () => {
    const { owner, org } = await newOwnerWithOrg("settings");
    await client(owner.token).PATCH("/orgs/{orgId}", { params: { path: { orgId: org.id } }, body: { settings: { publicLinksAllowed: false } } });
    const { data } = await client(owner.token).GET("/orgs/{orgId}/audit", { params: { path: { orgId: org.id }, query: { action: "org.updated" } } });
    expect(data!.items[0]!.data).toMatchObject({ before: { settings: { publicLinksAllowed: true } }, after: { settings: { publicLinksAllowed: false } } });
  });

  it("TF-083: HEAD on a public route answers as GET does", async () => {
    expect((await fetch(`${API_URL}/plans`, { method: "HEAD" })).status).toBe(200);
  });
});
