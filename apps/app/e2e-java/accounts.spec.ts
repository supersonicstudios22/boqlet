import { expect, test } from "@playwright/test";
import { API, APP, apiAs, createOrg, hydrated, newAccount, newEmail, newPerson, rawAs, setPasswordWithForm, setupLink, signInApi, signInWithForm, unique, useSession } from "./helpers";

/**
 * Smoke against Java (FE-041/FE-043): native sign-up from a setup link, the session cookie,
 * onboarding and the setup wizard (F01, F16), and what native sign-in refuses (P50).
 */

test("F01-AC1: a new person signs up from a setup link, creates an org, finishes the wizard with the suggested answers and lands on the empty dashboard in under a minute", async ({ page }) => {
  const email = newEmail("signup");
  const token = await setupLink(email);
  const started = Date.now();
  await page.goto(`/sign-up?token=${token}`);
  await setPasswordWithForm(page, "New Person", email);
  // No org yet: onboarding.
  await expect(page).toHaveURL(/\/onboarding$/);
  const name = `Firm ${unique("x")}`;
  await page.getByTestId("org-name").fill(name);
  await page.getByTestId("create-org").click();
  // F16, P18: a new org's owner lands in the setup wizard, and finishes it with the suggested answers.
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByTestId("org-switcher")).toContainText(name);
  await page.getByTestId("setup-start-go").click();
  const wizard = page.getByTestId("setup-wizard");
  await expect(wizard).toHaveAttribute("data-step", "measure");
  await page.getByTestId("setup-suggested").click();
  await expect(wizard).toHaveAttribute("data-step", "items");
  await page.getByTestId("setup-skip").click();
  await expect(wizard).toHaveAttribute("data-step", "names");
  await page.getByTestId("setup-skip").click();
  await expect(wizard).toHaveAttribute("data-step", "review");
  await page.getByTestId("setup-publish-all").click();
  await expect(page.getByTestId("empty-dashboard")).toBeVisible();
  await expect(page.getByTestId("needs-you")).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);
  await expect(page.getByTestId("user-name")).toHaveText("New Person");
});

test("native sign-in: a wrong password is refused; the session cookie is HttpOnly; sign-out ends the session", async ({ page }) => {
  const { email } = await newAccount("Cookie Person");
  await page.goto("/sign-in");
  await hydrated(page);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("not the password at all, really");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('main [role="alert"]')).toHaveText("The email or password is incorrect.");
  expect((await page.context().cookies()).filter((c) => c.name === "boqlet_session")).toHaveLength(0);

  await signInWithForm(page, email);
  const [cookie] = (await page.context().cookies()).filter((c) => c.name === "boqlet_session");
  expect(cookie).toMatchObject({ httpOnly: true, path: "/api/v1", sameSite: "Lax" });
  // The page's scripts can't read it.
  expect(await page.evaluate(() => document.cookie)).not.toContain("boqlet_session");
  expect((await rawAs({ session: cookie!.value }, "GET", "/me")).status).toBe(200);

  // Into an org, whose shell has the user menu.
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByTestId("org-name").fill(`Cookie ${unique("c")}`);
  await page.getByTestId("create-org").click();
  await page.getByTestId("user-menu").click();
  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect((await rawAs({ session: cookie!.value }, "GET", "/me")).status).toBe(401);
});

test("an anonymous visitor is sent to sign-in and comes back to the page afterwards", async ({ page }) => {
  const owner = await newPerson("Return Owner");
  const org = await createOrg(owner, "Return Firm");
  await apiAs(owner, "DELETE", "/sessions/current");
  await page.goto(`/${org.slug}/settings/general`);
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
  await signInWithForm(page, owner.email);
  await expect(page).toHaveURL(new RegExp(`/${org.slug}/settings/general$`));
  await expect(page.getByTestId("settings-name")).toHaveValue("Return Firm");
});

test("Java refuses changes without the app's Origin, also through the app, and bearer tokens", async ({ page }) => {
  const person = await newPerson("Origin Person");
  await useSession(page.context(), person);
  await page.goto("/onboarding");
  await expect(page.locator("html")).toHaveAttribute("data-session", "active");
  // Through the app's proxy, as a page on another site would send it.
  const viaApp = await page.request.post(`${APP}/api/v1/orgs`, {
    headers: { Origin: "https://elsewhere.example", "Content-Type": "application/json" },
    data: { name: "Forged", slug: unique("forged") },
  });
  expect(viaApp.status()).toBe(403);
  expect((await viaApp.json()).code).toBe("invalid_origin");
  const bearer = await fetch(`${API}/api/v1/me`, { headers: { Authorization: "Bearer suite-olivia" } });
  expect(bearer.status).toBe(401);
  // The same request from the app goes through.
  expect((await rawAs(person, "POST", "/orgs", { name: "Real", slug: unique("real") })).status).toBe(201);
});

test("a reset link sets a new password and signs out the open session", async ({ page }) => {
  const person = await newPerson("Reset Person");
  const token = await setupLink(person.email, "reset");
  await page.goto(`/sign-up?token=${token}`);
  await setPasswordWithForm(page, "Reset Person", person.email);
  expect((await rawAs(person, "GET", "/me")).status).toBe(401);
  // A reset link is for an account with a password only; a setup link for an address without one.
  await expect(setupLink(newEmail("nobody"), "reset")).rejects.toThrow(/409/);
  await expect(setupLink(person.email, "setup")).rejects.toThrow(/409/);
  expect(await signInApi(person.email, true)).toHaveLength(43);
});
