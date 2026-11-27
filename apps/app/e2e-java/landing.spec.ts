import { expect, test } from "./fixtures";
import { APP, createOrg, cspViolations, hydrated, newAccount, newPerson, signInWithForm, useSession } from "./helpers";

/** P58: the public landing page at `/`, and signed-in visitors going straight to the app (`/app`). */

test("P58: signed out, / is the landing page with Sign in and Request access, and its links lead on", async ({ page }) => {
  const violations = await cspViolations(page.context());
  await page.goto("/");
  await hydrated(page);
  await expect(page).toHaveURL(new RegExp(`^${APP}/?$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quantities you can check.");
  await expect(page.getByRole("table", { name: "Sample bill of quantities lines from the Duplex model" })).toBeVisible();
  await page.getByTestId("landing-request-access").click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await page.goto("/");
  await page.getByTestId("landing-sign-in").click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(violations).toEqual([]);
});

test("P58: signed in, / opens the app: the server sends a browser with the hint, the page one without it", async ({ page }) => {
  const person = await newPerson("Landing Visitor");
  const org = await createOrg(person, "Landing Firm");

  // A session but no hint yet (signed in elsewhere): the landing page finds the session and moves on.
  await useSession(page.context(), person);
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/${org.slug}$`));
  expect((await page.context().cookies()).some((c) => c.name === "boqlet-signed-in")).toBe(true);

  // With the hint, the server redirects before anything of the landing page is sent.
  const response = await page.request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toBe("/app");
});

test("P58: a sign-in without a returnTo opens the app, and a session that has ended clears the hint so / is the landing page again", async ({ page }) => {
  // An account with no open session (a `newPerson` has one, and the form would ask to take it over) and no org yet.
  const person = await newAccount("Hint Clearer");
  await page.goto("/sign-in");
  await signInWithForm(page, person.email, { landing: /\/onboarding$/ });
  expect((await page.context().cookies()).some((c) => c.name === "boqlet-signed-in")).toBe(true);

  await page.context().clearCookies({ name: "boqlet_session" });
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fapp/);
  await hydrated(page);
  await expect.poll(async () => (await page.context().cookies()).some((c) => c.name === "boqlet-signed-in")).toBe(false);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quantities you can check.");
});
