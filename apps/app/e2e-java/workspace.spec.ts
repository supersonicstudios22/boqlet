import { expect, test, type Page } from "./fixtures";
import { apiAs, createOrg, newPerson, useSession, waitFor, type Person } from "./helpers";

/**
 * Smoke against Java: the BoQ workspace's layout and keyboard (review WP-C1).
 * - C-04: no focus jump on load (StrictMode in `next dev`), "Skip to the sheet", separators with a focus ring, one Tab
 *   stop per toolbar, `g s` / `g q` / `?`.
 * - C-03: the line detail lies over the model as a drawer: Description keeps ≥ 320 px at 1440 px, the page stays the
 *   viewport's height; "Model open" and the split are the user's preferences, the same in a fresh browser.
 * - C-02: beside the model, at 1440 and 1024 px, every derived, manual and to-confirm line shows its status mark.
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

/** Every derived, manual and to-confirm line on screen shows its mark, inside the grid's visible width. */
async function marksInView(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector("[data-testid=sheet-grid]")!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>("[data-testid=sheet-line]")].flatMap((row) => {
      const mark = row.querySelector<HTMLElement>("[data-testid=status-mark]");
      const box = mark?.getBoundingClientRect();
      const needs = row.dataset.source !== "measured";
      return needs || mark ? [{ key: row.dataset.key, source: row.dataset.source, mark: mark?.dataset.mark ?? null, label: mark?.getAttribute("aria-label") ?? null, inView: !!box && box.left >= grid.left && box.right <= grid.right }] : [];
    });
  });
}

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
] as const) {
  test(`@c1-gutter C-02: with the model open at ${width} px every derived, manual and to-confirm line shows its mark`, async ({ browser }) => {
    const { owner, url } = await sampleBoq(`Greta Gutter ${width}`);
    const context = await browser.newContext({ viewport: { width, height } });
    await useSession(context, owner);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    // The model beside the sheet: the button at 1280 px and wider, the "⋯" menu below.
    if (!(await page.getByTestId("sheet-split").count())) {
      if (await page.getByTestId("toggle-model").isVisible()) await page.getByTestId("toggle-model").click();
      else {
        await page.getByTestId("sheet-more").click();
        await page.getByTestId("more-toggle-model").click();
        await page.keyboard.press("Escape");
      }
    }
    await expect(page.getByTestId("sheet-split")).toBeVisible();
    await expect(page.locator("[data-testid=sheet-grid] [data-column=source]")).toHaveCount(0);
    const marks = await marksInView(page);
    expect(marks.filter((m) => m.mark).length).toBeGreaterThan(0);
    for (const m of marks) {
      expect(m.mark, `line ${m.key} (${m.source})`).not.toBeNull();
      expect(m.inView, `line ${m.key}'s mark in view`).toBe(true);
      expect(m.label, `line ${m.key}'s mark is named`).toBeTruthy();
    }
    await context.close();
  });
}

test("@c1-drawer C-03: the line detail is a drawer over the model; descriptions keep their width; the model pane follows the user", async ({ browser }) => {
  const { owner, url } = await sampleBoq("Dora Drawer");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await useSession(context, owner);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
  // A first visit at 1440 px: the model is open beside the sheet, narrow.
  await expect(page.getByTestId("sheet-split")).toBeVisible();
  const gridBefore = await page.getByTestId("sheet-grid").boundingBox();

  // Opening a line: the detail lies over the model, the grid keeps its width, the page stays the viewport's height.
  await page.locator('[data-testid="sheet-line"][data-source="measured"]').nth(2).click();
  await expect(page.getByTestId("line-detail")).toBeVisible();
  await expect(page.getByTestId("detail-drawer")).toBeVisible();
  expect((await page.getByTestId("sheet-grid").boundingBox())?.width).toBe(gridBefore?.width);
  const r = await page.evaluate(() => {
    const d = document.querySelector('[data-testid="sheet-line"][aria-selected="true"] [data-column=description]')!.getBoundingClientRect();
    const drawer = document.querySelector("[data-testid=detail-drawer]")!.getBoundingClientRect();
    const side = document.querySelector("[data-testid=sheet-side]")!.getBoundingClientRect();
    return { description: d.width, page: document.scrollingElement!.scrollHeight, vh: innerHeight, inside: drawer.left >= side.left - 0.5 && drawer.right <= side.right + 0.5 };
  });
  expect(r.description).toBeGreaterThanOrEqual(320);
  expect(r.page).toBeLessThanOrEqual(r.vh);
  expect(r.inside).toBe(true);

  // The drawer is resizable by keyboard; the sheet/model separator too, and the split is remembered.
  const handle = page.getByTestId("detail-handle");
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", String(before + 40));
  await page.getByTestId("split-handle").focus();
  await page.keyboard.press("ArrowLeft");
  const split = await page.getByTestId("split-handle").getAttribute("aria-valuenow");

  // "Model" off follows the user to a fresh browser, and so does the split once it is on again.
  await page.getByTestId("toggle-model").click();
  await expect(page.getByTestId("sheet-split")).toHaveCount(0);
  await expect.poll(async () => (await apiAs<{ preferences: { sheetModelOpen?: boolean; sheetSplit?: number } }>(owner, "GET", "/me")).preferences).toEqual(
    expect.objectContaining({ sheetModelOpen: false, sheetSplit: Number(split) }),
  );
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await useSession(fresh, owner);
  const page2 = await fresh.newPage();
  await page2.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page2.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
  await expect(page2.getByTestId("toggle-model")).toHaveAttribute("aria-pressed", "false");
  await expect(page2.getByTestId("sheet-split")).toHaveCount(0);
  await page2.getByTestId("toggle-model").click();
  await expect(page2.getByTestId("split-handle")).toHaveAttribute("aria-valuenow", split!);
  await fresh.close();
  await context.close();
});

const focusedId = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a === document.body ? "body" : (a?.getAttribute("data-testid") ?? a?.textContent?.trim() ?? a?.tagName);
  });

test("@c1-keyboard C-04: no focus jump on load, the sheet three Tab stops away, toolbars one stop each, shortcuts", async ({ browser }) => {
  const { owner, url } = await sampleBoq("Kim Keys");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await useSession(context, owner);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
  // The app runs `next dev` here, so React's StrictMode is on: focus must stay on the page (DEC-50).
  await page.waitForTimeout(1500);
  expect(await focusedId(page)).toBe("body");

  // Skip to content, Skip to the sheet, Enter: the grid.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await focusedId(page)).toBe("skip-to-sheet");
  await page.keyboard.press("Enter");
  expect(await focusedId(page)).toBe("sheet-grid");

  // The separator shows a ring when it has focus (WCAG 2.4.7).
  await page.getByTestId("split-handle").focus();
  expect(await page.getByTestId("split-handle").evaluate((e) => getComputedStyle(e).boxShadow)).not.toBe("none");

  // Each toolbar is one Tab stop; the arrows move inside it.
  await page.getByTestId("group-by").focus();
  await expect(page.locator("[role=toolbar]")).toHaveCount(2);
  await page.keyboard.press("ArrowRight");
  expect(await focusedId(page)).toBe("sheet-filters");
  await page.keyboard.press("Tab");
  expect(await focusedId(page)).toBe("sheet-search");
  await page.keyboard.press("Tab");
  expect(await focusedId(page)).toBe("add-line");
  await page.keyboard.press("End");
  expect(await focusedId(page)).toBe("columns-menu");

  // g q and g s; ? lists the keys.
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press("g");
  await page.keyboard.press("q");
  await expect(page).toHaveURL(/tab=questions/);
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(page.getByTestId("sheet-grid")).toBeFocused();
  await page.keyboard.press("Shift+?");
  await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
  await context.close();
});
