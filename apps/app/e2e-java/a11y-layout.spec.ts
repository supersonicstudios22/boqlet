import { expect, test } from "./fixtures";
import { apiAs, createOrg, newPerson, useSession, waitFor, type Person } from "./helpers";

/**
 * Smoke against Java: keyboard focus, page titles and narrow screens (Stage 4 accessibility and widths).
 * - TF-167: each page has its own title.
 * - TF-161: the sheet is one Tab stop.
 * - TF-160: focus returns to the trigger or the grid, or moves to what replaced the focused button.
 * - TF-171: a saved version is readable at 768 px (Quantity in view, no sideways page scroll).
 * - TF-172: the share page shows Quantity at 360 px.
 */

test.describe.configure({ timeout: 360_000 });

type Boq = { id: string; name: string; currentRevision: { id: string; currentRun?: { status: string } } };

async function sampleBoq(name: string): Promise<{ owner: Person; boq: Boq; projectUrl: string; url: string }> {
  const owner = await newPerson(name);
  const org = await createOrg(owner, `${name} Firm`);
  const project = await apiAs<{ id: string }>(owner, "POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" });
  const boq = await waitFor("the sample BoQ", async () => {
    const boqs = await apiAs<Boq[]>(owner, "GET", `/projects/${project.id}/boqs`);
    const status = boqs[0]?.currentRevision.currentRun?.status;
    return status === "complete" || status === "needs_input" ? boqs[0] : undefined;
  });
  const projectUrl = `/${org.slug}/projects/${project.id}`;
  return { owner, boq, projectUrl, url: `${projectUrl}/boqs/${boq.id}` };
}

const focused = (page: import("@playwright/test").Page) => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName);

test("TF-167, TF-161, TF-160: titles, one Tab stop, focus that follows", async ({ page }) => {
  const { owner, boq, projectUrl, url } = await sampleBoq("Tess Tabs");
  await useSession(page.context(), owner);
  await page.goto(url);
  await expect(page.getByTestId("sheet-grid")).toBeVisible();
  await expect(page).toHaveTitle(`${boq.name} · Sheet · Duplex (sample) · boqlet`);

  // One Tab stop: from the grid, Tab leaves it.
  await page.getByTestId("sheet-grid").focus();
  // The arrows also stop on group headings (treegrid, whose buttons are no Tab stops): down to the first line.
  const line = page.locator('[data-testid="sheet-line"][aria-selected="true"]');
  for (let i = 0; i < 6 && !(await line.count()); i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  expect(await focused(page)).not.toBe("line-check");
  expect(await page.evaluate(() => !!document.activeElement?.closest("[data-testid=sheet-grid]"))).toBe(false);

  // A group heading is reached by the arrows and closed and opened by Left and Right.
  await page.getByTestId("sheet-grid").focus();
  await page.keyboard.press("ArrowUp");
  const heading = page.locator('[data-testid="sheet-group"][aria-selected="true"]');
  if (await heading.count()) {
    await page.keyboard.press("ArrowLeft");
    await expect(heading).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowRight");
    await expect(heading).toHaveAttribute("aria-expanded", "true");
  }
  for (let i = 0; i < 6 && !(await line.count()); i++) await page.keyboard.press("ArrowDown");

  // An in-cell edit committed with Enter gives focus back to the grid.
  await page.getByTestId("sheet-grid").focus();
  await page.keyboard.press("F2");
  await page.keyboard.press("End");
  await page.keyboard.type(" (kbd)");
  await page.keyboard.press("Enter");
  await expect.poll(() => focused(page)).toBe("sheet-grid");

  // Generate: focus goes to Cancel while it runs.
  await page.getByTestId("generate").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => focused(page), { timeout: 20_000 }).toMatch(/cancel-run|generate/);

  // Share: "Create link" is replaced by the link, which takes focus.
  await page.getByTestId("share-boq").click();
  await page.getByTestId("share-create").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("share-url")).toBeFocused();
  await page.keyboard.press("Escape");

  // New BoQ dialog closed with Escape: focus back on its button.
  await page.goto(`${projectUrl}/boqs`);
  await page.getByTestId("new-boq").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("create-boq-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("new-boq")).toBeFocused();
});

test("TF-171: a saved version at 768 px shows Quantity without sideways scrolling", async ({ browser }) => {
  const { owner, boq, url } = await sampleBoq("Wendy Width");
  const saved = await apiAs<{ id: string }>(owner, "POST", `/revisions/${boq.currentRevision.id}/issue`, { label: "A", notModelledConfirmed: true });
  const context = await browser.newContext({ viewport: { width: 768, height: 900 } });
  await useSession(context, owner);
  const page = await context.newPage();
  await page.goto(`${url}?tab=sheet&version=${saved.id}`);
  await expect(page.getByTestId("sheet-grid")).toBeVisible();
  const r = await page.evaluate(() => {
    const q = document.querySelector("[data-testid=sheet-line] [data-column=quantity]")!.getBoundingClientRect();
    return { qRight: q.right, vw: innerWidth, scrollW: document.documentElement.scrollWidth };
  });
  expect(r.qRight).toBeLessThanOrEqual(r.vw);
  expect(r.scrollW).toBeLessThanOrEqual(r.vw);
  await context.close();
});

test("TF-172: the share page shows Quantity at 360 px", async ({ browser }) => {
  const { owner, boq } = await sampleBoq("Sam Small");
  const link = await apiAs<{ url: string }>(owner, "POST", `/boqs/${boq.id}/share-links`, { mode: "pinned", revisionId: boq.currentRevision.id, include: { lineDetail: true, viewer: true } });
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  await page.goto(new URL(link.url).pathname);
  await expect(page.getByTestId("share-line").first()).toBeVisible();
  const r = await page.evaluate(() => {
    const q = document.querySelector("[data-testid=share-line] td:last-child")!.getBoundingClientRect();
    return { qRight: q.right, vw: innerWidth, scrollW: document.documentElement.scrollWidth };
  });
  expect(r.qRight).toBeLessThanOrEqual(r.vw);
  expect(r.scrollW).toBeLessThanOrEqual(r.vw);
  await context.close();
});
