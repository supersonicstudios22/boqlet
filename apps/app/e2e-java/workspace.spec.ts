import { expect, test, type Page } from "./fixtures";
import { apiAs, createOrg, newPerson, useSession, waitFor, type Person } from "./helpers";

/**
 * Smoke against Java: the BoQ workspace's layout and keyboard (review WP-C1).
 * - C-01: at 1440×900 the sheet fills the screen: one scroll container (the grid), ≥ 20 rows in view with the
 *   "not in the models" notice collapsed, the toolbar in its fixed order, no layout shift when a line is ticked.
 */

test.describe.configure({ timeout: 360_000 });

type Boq = { id: string; name: string; currentRevision: { id: string; currentRun?: { status: string } } };

async function sampleBoq(name: string): Promise<{ owner: Person; boq: Boq; url: string }> {
  const owner = await newPerson(name);
  const org = await createOrg(owner, `${name} Firm`);
  const project = await apiAs<{ id: string }>(owner, "POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" });
  const boq = await waitFor("the sample BoQ", async () => {
    const boqs = await apiAs<Boq[]>(owner, "GET", `/projects/${project.id}/boqs`);
    const status = boqs[0]?.currentRevision.currentRun?.status;
    return status === "complete" || status === "needs_input" ? boqs[0] : undefined;
  });
  return { owner, boq, url: `/${org.slug}/projects/${project.id}/boqs/${boq.id}` };
}

/** The notice collapsed to its counts line and the one-time rules hint dismissed: the sheet as it is day to day. */
async function dayToDay(page: Page) {
  const notice = page.getByTestId("not-in-models");
  await expect(notice).toBeVisible();
  if ((await notice.getAttribute("data-collapsed")) === "false") await page.getByTestId("not-in-models-toggle").click();
  await expect(notice).toHaveAttribute("data-collapsed", "true");
  const hint = page.getByTestId("system-rules-hint");
  if (await hint.count()) await hint.getByRole("button").click();
}

/** Rows wholly inside the grid's scrolling area, below its sticky header row. */
const rowsInView = (page: Page) =>
  page.evaluate(() => {
    const grid = document.querySelector("[data-testid=sheet-grid]")!;
    const box = grid.getBoundingClientRect();
    const header = grid.querySelector("[role=row]")!.getBoundingClientRect();
    return [...grid.querySelectorAll("[data-testid=sheet-line], [data-testid=sheet-group]")].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= header.bottom - 0.5 && b.bottom <= Math.min(box.bottom, innerHeight) + 0.5;
    }).length;
  });

test("@c1-layout C-01: the sheet fills the screen at 1440×900, one scroll container, fixed toolbar, no shift on tick", async ({ browser }) => {
  const { owner, url } = await sampleBoq("Fiona Fill");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await useSession(context, owner);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
  await dayToDay(page);

  // The page is exactly the viewport: neither the document nor main scrolls; the grid does.
  await expect
    .poll(() =>
      page.evaluate(() => ({
        document: document.scrollingElement!.scrollHeight <= innerHeight,
        main: (() => {
          const m = document.querySelector("#main")!;
          return m.scrollHeight <= m.clientHeight;
        })(),
        grid: (() => {
          const g = document.querySelector("[data-testid=sheet-grid]")!;
          return g.scrollHeight > g.clientHeight;
        })(),
      })),
    )
    .toEqual({ document: true, main: true, grid: true });
  expect(await rowsInView(page)).toBeGreaterThanOrEqual(20);

  // The toolbar: always the same controls in the same order.
  const order = await page.getByTestId("sheet-toolbar").evaluate((bar) =>
    [...bar.querySelectorAll("[data-testid]")].filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute("data-testid")),
  );
  expect(order.filter((id) => ["group-by", "sheet-filters", "sheet-search", "undo-edit", "add-line", "export-xlsx", "toggle-model", "columns-menu"].includes(id!))).toEqual([
    "group-by",
    "sheet-filters",
    "sheet-search",
    "undo-edit",
    "add-line",
    "export-xlsx",
    "toggle-model",
    "columns-menu",
  ]);

  // Filters live in a popover; a filter in force is a chip in the filter bar that removes it, with the count.
  await page.getByTestId("sheet-filters").click();
  await page.getByTestId("filter-source").selectOption("derived");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("filter-chip-source")).toBeVisible();
  await expect(page.getByTestId("filtered-count")).toBeVisible();
  await page.getByTestId("filter-chip-source").click();
  await expect(page.getByTestId("filter-chip-source")).toHaveCount(0);
  await expect(page.getByTestId("filtered-count")).toHaveCount(0);

  // Ticking a line: the bulk bar floats over the grid's foot; nothing above or around the grid moves.
  const grid = page.getByTestId("sheet-grid");
  const before = await grid.boundingBox();
  await page.locator("[data-testid=sheet-line] [data-testid=line-check]").first().click();
  await expect(page.getByTestId("sheet-bulk-bar")).toBeVisible();
  expect(await grid.boundingBox()).toEqual(before);
  await context.close();
});
