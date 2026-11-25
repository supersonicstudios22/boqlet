import { expect, test, type Page } from "./fixtures";
import { PASSWORD, hydrated, mailLinks, newEmail, resetAuthLimits, setPasswordWithForm, setPublicSignUp, signInWithForm, unique, waitFor } from "./helpers";

/**
 * Smoke against Java (P57): public sign-up from the sign-in page through the emailed link to the
 * first org on Free, and the self-service password reset. Basic bot protection refuses forms sent
 * within 3 seconds, so each form waits as long as a person would take.
 */

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await setPublicSignUp(false);
});

/**
 * The link to `/sign-up?token=` in the mails to `email`, as a path on this app: the harness's two
 * Java instances share one outbox, and either may send it with its own app URL.
 */
async function emailedLink(email: string, reset: boolean): Promise<string> {
  const link = await waitFor(`a ${reset ? "reset" : "sign-up"} mail to ${email}`, async () =>
    (await mailLinks(email)).find((l) => l.includes("/sign-up?token=") && l.includes("reset=1") === reset), 30_000);
  const url = new URL(link);
  return url.pathname + url.search;
}

async function sendLinkForm(page: Page, email: string) {
  await hydrated(page);
  await page.locator('input[name="email"]').fill(email);
  // A person takes a few seconds; a form sent sooner is taken for a bot's (P57).
  await page.waitForTimeout(3_200);
  await page.getByTestId("link-submit").click();
  await expect(page.getByTestId("link-sent")).toContainText(email);
}

test("P57: while sign-up is closed, /sign-up says how accounts are made and sign-in offers no sign-up", async ({ page }) => {
  await setPublicSignUp(false);
  await page.goto("/sign-in");
  await hydrated(page);
  await expect(page.getByTestId("forgot-password")).toBeVisible();
  await expect(page.getByTestId("sign-up-link")).toHaveCount(0);
  await page.goto("/sign-up");
  await expect(page.getByText("Open the invitation or setup link you received to create your account.")).toBeVisible();
  await expect(page.getByTestId("sign-up-form")).toHaveCount(0);
});

test("P57: anyone signs up from the sign-in page, sets a password from the email and starts their first org on Free", async ({ page }) => {
  await setPublicSignUp(true);
  await resetAuthLimits();
  const email = newEmail("public");
  await page.goto("/sign-in");
  await hydrated(page);
  await page.getByTestId("sign-up-link").click();
  await expect(page).toHaveURL(/\/sign-up/);
  await sendLinkForm(page, email);

  await page.goto(await emailedLink(email, false));
  await setPasswordWithForm(page, "Public Person", email);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByTestId("org-name").fill(`Public Firm ${unique("x")}`);
  await page.getByTestId("create-org").click();
  await expect(page).toHaveURL(/\/setup$/);
});

test("P57: a forgotten password is reset from the sign-in page by email", async ({ page }) => {
  await setPublicSignUp(true);
  await resetAuthLimits();
  const email = newEmail("forgetful");
  await page.goto("/sign-up");
  await sendLinkForm(page, email);
  await page.goto(await emailedLink(email, false));
  await setPasswordWithForm(page, "Forgetful Person", email);

  await page.context().clearCookies();
  await page.goto(`/sign-in?email=${encodeURIComponent(email)}`);
  await hydrated(page);
  await page.getByTestId("forgot-password").click();
  await expect(page).toHaveURL(/\/reset-password/);
  await resetAuthLimits();
  await sendLinkForm(page, email);

  await page.goto(await emailedLink(email, true));
  await hydrated(page);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  // A reset keeps the account's name: no name field.
  await expect(page.locator('input[name="name"]')).toHaveCount(0);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/sign-in\?/);
  await signInWithForm(page, email, { landing: /\/onboarding$/ });
});
