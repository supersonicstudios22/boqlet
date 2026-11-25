import { expect, test, type Locator, type Page } from "./fixtures";
import { apiAs, createOrg, invitationToken, newEmail, newPerson, setPasswordWithForm, useSession, waitFor } from "./helpers";

/**
 * Smoke against Java: live co-editing (F06 §14, criterion 10) through Java's realtime stream. An
 * invited colleague sets up their account from the invitation (native sign-up), joins, and both
 * open the sample BoQ: each sees the other, and an edit in one browser appears in the other.
 */

test.describe.configure({ timeout: 360_000 });

const lineAt = (page: Page, key: string) => page.locator(`[data-testid="sheet-line"][data-key=${JSON.stringify(key)}]`);
const cell = (line: Locator, column: string) => line.locator(`[data-column="${column}"]`);

test("F06-AC10: an invited colleague joins; two browsers on one BoQ see each other, and an edit in one shows in the other within seconds", async ({ page, browser }) => {
  const owner = await newPerson("Olga Owner");
  const org = await createOrg(owner, "Live Firm");
  const project = await apiAs<{ id: string }>(owner, "POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" });
  const email = newEmail("colleague");
  await apiAs(owner, "POST", `/orgs/${org.id}/invitations`, { email, role: "member" });
  const token = await invitationToken(email);

  // The colleague: from the invitation to an account, signed in, joined.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto(`/invite/${token}`);
  await expect(page2.getByTestId("invitation")).toContainText("Join Live Firm");
  await page2.getByTestId("invite-sign-in").click();
  await expect(page2).toHaveURL(/\/sign-in\?/);
  await page2.getByRole("link", { name: "Set up your invited account" }).click();
  await setPasswordWithForm(page2, "Carl Colleague", email, { landing: new RegExp(`/invite/${token}$`) });
  await page2.getByTestId("accept-invitation").click();
  await expect(page2).toHaveURL(new RegExp(`/${org.slug}$`));

  const members = await apiAs<{ user: { id: string; email: string } }[]>(owner, "GET", `/orgs/${org.id}/members`);
  const colleague = members.find((m) => m.user.email === email)!.user;
  await apiAs(owner, "POST", `/projects/${project.id}/members`, { userId: colleague.id, role: "estimator" });
  const boq = await waitFor("the sample BoQ", async () => {
    const boqs = await apiAs<{ id: string; currentRevision: { currentRun?: { status: string } } }[]>(owner, "GET", `/projects/${project.id}/boqs`);
    const status = boqs[0]?.currentRevision.currentRun?.status;
    return status === "complete" || status === "needs_input" ? boqs[0] : undefined;
  });
  const url = `/${org.slug}/projects/${project.id}/boqs/${boq.id}`;

  await useSession(page.context(), owner);
  await page.goto(url);
  await page2.goto(url);
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-editable", "true");
  await expect(page2.getByTestId("sheet")).toHaveAttribute("data-editable", "true");

  // Presence: each sees the other.
  await expect(page.locator('[data-testid="presence-user"][data-name="Carl Colleague"]')).toBeVisible();
  await expect(page2.locator('[data-testid="presence-user"][data-name="Olga Owner"]')).toBeVisible();

  // The owner edits a quantity: the colleague's sheet shows it without a reload.
  const key = (await page.locator('[data-testid="sheet-line"][data-source="measured"]').first().getAttribute("data-key"))!;
  await lineAt(page, key).click();
  await cell(lineAt(page, key), "quantity").dblclick();
  await page.getByTestId("cell-editor").fill("123.5");
  await page.getByTestId("cell-editor").press("Enter");
  await page.getByTestId("reason-input").fill("Measured on site");
  await page.getByTestId("reason-confirm").click();
  await expect(cell(lineAt(page, key), "quantity")).toHaveText("123.5");
  const shownAt = Date.now();
  await expect(cell(lineAt(page2, key), "quantity")).toHaveText("123.5", { timeout: 5_000 });
  expect(Date.now() - shownAt).toBeLessThan(5_000);

  // The colleague leaves: the owner no longer sees them.
  await page2.goto(`/${org.slug}/projects/${project.id}`);
  await expect(page.locator('[data-testid="presence-user"][data-name="Carl Colleague"]')).toHaveCount(0, { timeout: 15_000 });
  await other.close();
});
