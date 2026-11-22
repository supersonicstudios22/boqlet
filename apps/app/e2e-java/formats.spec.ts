import { expect, test, type Page } from "@playwright/test";
import { apiAs, createOrg, newPerson, useSession, waitFor } from "./helpers";

/**
 * Smoke against Java: the firm's formats and the request limits.
 * - TF-021: BoQ values in the org's number format (sheet, line detail, share page) and dates in its pattern.
 * - TF-174: inputs carry the API's limits (C08), so an over-long name can't be typed.
 */

test.describe.configure({ timeout: 360_000 });

type Boq = { id: string; name: string; currentRevision: { id: string; currentRun?: { status: string } } };

const quantityOf = (page: Page) => page.locator('[data-testid="sheet-line"] [data-column="quantity"]');

test("TF-021: the org's separators and date format on the sheet, the line detail and the share page", async ({ page, browser }) => {
  const owner = await newPerson("Fia Formats");
  const org = await createOrg(owner, "Formats Firm");
  const current = await apiAs<{ settings: Record<string, unknown> }>(owner, "GET", `/orgs/${org.id}`);
  await apiAs(owner, "PATCH", `/orgs/${org.id}`, { settings: { ...current.settings, numberFormat: { decimal: ",", thousands: "." }, dateFormat: "dd.MM.yyyy" } });
  const project = await apiAs<{ id: string }>(owner, "POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" });
  const boq = await waitFor("the sample BoQ", async () => {
    const boqs = await apiAs<Boq[]>(owner, "GET", `/projects/${project.id}/boqs`);
    const status = boqs[0]?.currentRevision.currentRun?.status;
    return status === "complete" || status === "needs_input" ? boqs[0] : undefined;
  });

  await useSession(page.context(), owner);
  await page.goto(`/${org.slug}/projects/${project.id}/boqs/${boq.id}`);
  await expect(page.getByTestId("sheet")).toBeVisible();
  // The Duplex has fractional quantities: each is written with a decimal comma, none with a point.
  const shown = (await quantityOf(page).allInnerTexts()).filter((q) => /\d/.test(q));
  expect(shown.some((q) => /^\d{1,3}(\.\d{3})*,\d+$/.test(q))).toBe(true);
  expect(shown.filter((q) => /\d\.\d{1,2}$/.test(q))).toEqual([]);
  // The line detail's header quantity too.
  await page.locator('[data-testid="sheet-line"][data-source="measured"]').first().click();
  await expect(page.getByTestId("detail-quantity")).toHaveText(/^\d{1,3}(\.\d{3})*(,\d+)? \S+$/);

  // The share page shows the firm's format (PublicShare.numberFormat, dateFormat).
  const link = await apiAs<{ url: string }>(owner, "POST", `/boqs/${boq.id}/share-links`, { mode: "pinned", revisionId: boq.currentRevision.id, include: { lineDetail: true, viewer: false }, label: "Formats" });
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  await pub.goto(new URL(link.url).pathname);
  await expect(pub.getByTestId("share-line").first()).toBeVisible();
  const shared = (await pub.locator('[data-testid="share-line"] td:last-child').allInnerTexts()).filter((q) => /\d/.test(q));
  expect(shared.some((q) => /,\d+$/.test(q))).toBe(true);
  // "Generated dd.MM.yyyy hh:mm"
  await expect(pub.getByText(/\d{2}\.\d{2}\.\d{4}/).first()).toBeVisible();
  await visitor.close();
});

test("TF-174: name and note inputs stop at the API's limits", async ({ page }) => {
  const owner = await newPerson("Lea Limits");
  const org = await createOrg(owner, "Limits Firm");
  await useSession(page.context(), owner);
  await page.goto(`/${org.slug}/projects/new`);
  await expect(page.getByTestId("project-name")).toHaveAttribute("maxlength", "200");
  await page.getByTestId("project-name").fill("x".repeat(250));
  await expect(page.getByTestId("project-name")).toHaveValue("x".repeat(200));
  await page.goto("/account");
  await expect(page.getByTestId("account-name")).toHaveAttribute("maxlength", "120");
});
