import { expect, test } from "@playwright/test";
import { apiAs, createOrg, invitationToken, newEmail, newPerson, rawAs, useSession } from "./helpers";

/** Smoke against Java: invitations, plan limits, owners and several orgs (F01, F14). */

test("F01-AC2: an invitation opened by someone signed in with another email is refused", async ({ page }) => {
  const owner = await newPerson("Inviting Owner");
  const org = await createOrg(owner, "Mismatch Firm");
  const invited = newEmail("invited");
  await apiAs(owner, "POST", `/orgs/${org.id}/invitations`, { email: invited, role: "member" });
  const token = await invitationToken(invited);

  const stranger = await newPerson("Someone Else");
  await useSession(page.context(), stranger);
  await page.goto(`/invite/${token}`);
  await expect(page.getByTestId("invitation")).toContainText("Join Mismatch Firm");
  await expect(page.getByTestId("email-mismatch")).toBeVisible();
  await expect(page.getByTestId("accept-invitation")).toHaveCount(0);
  // Java refuses it too, and the invitation stays open for the invited person.
  const accept = await rawAs(stranger, "POST", `/invitations/${token}/accept`);
  expect(accept).toMatchObject({ status: 409, body: { code: "email_mismatch" } });
  expect((await apiAs<{ status: string }>(stranger, "GET", `/invitations/${token}`)).status).toBe("pending");
});

test("F01-AC3: inviting beyond the plan's seats shows the limit dialog (402 seats)", async ({ page }) => {
  const owner = await newPerson("Free Owner");
  // Two seats: the owner and one pending invitation (Free alone has one, P57).
  const org = await createOrg(owner, "Free Firm", { seats: 2 });
  await useSession(page.context(), owner);
  await page.goto(`/${org.slug}/settings/members`);
  await page.getByTestId("invite-email").fill(newEmail("one"));
  await page.getByTestId("invite-submit").click();
  await expect(page.getByTestId("invitations-table")).toBeVisible();
  const refused = page.waitForResponse((r) => r.url().endsWith(`/orgs/${org.id}/invitations`) && r.request().method() === "POST");
  await page.getByTestId("invite-email").fill(newEmail("two"));
  await page.getByTestId("invite-submit").click();
  const response = await refused;
  expect(response.status()).toBe(402);
  expect(await response.json()).toMatchObject({ code: "limit_reached", details: { limit: "seats" } });
  await expect(page.getByTestId("limit-dialog")).toBeVisible();
  await expect(page.getByTestId("limit-detail")).toContainText("Seats: 2 of 2 in use.");
});

test("F01-AC4: the last owner can't leave or be demoted", async ({ page }) => {
  const owner = await newPerson("Sole Owner");
  const org = await createOrg(owner, "Sole Firm");
  await useSession(page.context(), owner);
  await page.goto("/account");
  await page.getByTestId(`leave-${org.slug}`).click();
  await expect(page.getByTestId(`account-org-${org.slug}`)).toContainText("at least one owner");
  // Their own row has no role picker; Java refuses the demotion as well.
  await page.goto(`/${org.slug}/settings/members`);
  await expect(page.getByTestId(`member-${owner.email}`)).toContainText("Owner");
  await expect(page.getByTestId(`member-${owner.email}`).locator("select")).toHaveCount(0);
  // Nobody changes their own role (`own_role`); only an owner could demote them, and there is none other.
  const demoted = await rawAs(owner, "PATCH", `/orgs/${org.id}/members/${owner.id}`, { role: "member" });
  expect(demoted).toMatchObject({ status: 409, body: { code: "own_role" } });
  const left = await rawAs(owner, "DELETE", `/orgs/${org.id}/members/${owner.id}`);
  expect(left).toMatchObject({ status: 409, body: { code: "last_owner" } });
  const members = await apiAs<{ role: string }[]>(owner, "GET", `/orgs/${org.id}/members`);
  expect(members.map((m) => m.role)).toEqual(["owner"]);
});

test("F01-AC6: a person in two orgs switches between them and sees the other org's data", async ({ page }) => {
  const person = await newPerson("Two Orgs");
  const own = await createOrg(person, "First Firm");
  const other = await newPerson("Other Owner");
  const second = await createOrg(other, "Second Firm");
  await apiAs(other, "POST", `/orgs/${second.id}/invitations`, { email: person.email, role: "member" });
  await apiAs(person, "POST", `/invitations/${await invitationToken(person.email)}/accept`);

  await useSession(page.context(), person);
  await page.goto(`/${own.slug}/settings/general`);
  await expect(page.getByTestId("settings-name")).toHaveValue("First Firm");
  await page.getByTestId("org-switcher").click();
  await page.getByTestId(`switch-org-${second.slug}`).click();
  await expect(page).toHaveURL(new RegExp(`/${second.slug}$`));
  await page.goto(`/${second.slug}/settings/general`);
  await expect(page.getByTestId("settings-name")).toHaveValue("Second Firm");
  // A member there: read-only settings, no invitations.
  await expect(page.getByTestId("read-only-note")).toBeVisible();
});
