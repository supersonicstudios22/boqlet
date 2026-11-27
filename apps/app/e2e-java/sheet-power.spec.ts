import { expect, test, type Page } from "./fixtures";
import { apiAs, createOrg, newPerson, useSession, waitFor, type Person } from "./helpers";

/**
 * Smoke against Java: the sheet's power features (review WP-C2).
 * - C-06: a header sorts the lines inside their groups (`aria-sort`), the density switch changes the row height and is
 *   the user's preference, "Wrap text" clamps descriptions at three lines with the rows still virtualised, a dragged
 *   column width stays for the BoQ.
 * - C-07: a BoQ without a classification opens grouped by storey, with subtotals; "Measured as" groups by rule; the
 *   sheet's Excel asks for the same grouping.
 * - C-08: after an edit one banner names what is waiting for a run, says why Save version waits, and "Apply now"
 *   generates; afterwards it is gone.
 * - C-09: Ctrl+K opens the command palette anywhere; it finds a BoQ by name in another project and opens it, and
 *   lists the BoQ page's own actions. (Who sees which names: the isolation scenario.)
 */

test.describe.configure({ timeout: 360_000 });

type Boq = { id: string; name: string; currentRevision: { id: string; currentRun?: { id: string; status: string } } };

async function sampleBoq(name: string): Promise<{ owner: Person; boq: Boq; url: string; orgId: string; projectId: string }> {
  const owner = await newPerson(name);
  const org = await createOrg(owner, `${name} Firm`);
  const project = await apiAs<{ id: string }>(owner, "POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" });
  const boq = await waitFor("the sample BoQ", async () => {
    const boqs = await apiAs<Boq[]>(owner, "GET", `/projects/${project.id}/boqs`);
    const status = boqs[0]?.currentRevision.currentRun?.status;
    return status === "complete" || status === "needs_input" ? boqs[0] : undefined;
  });
  return { owner, boq, url: `/${org.slug}/projects/${project.id}/boqs/${boq.id}`, orgId: org.id, projectId: project.id };
}

async function openSheet(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
}

/** The rendered rows in screen order: group id or line quantity text, with each row's box. */
const renderedRows = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-testid=sheet-grid] [data-testid=sheet-line], [data-testid=sheet-grid] [data-testid=sheet-group]")]
      .map((r) => ({
        group: r.dataset.group ?? null,
        quantity: r.querySelector<HTMLElement>("[data-column=quantity]")?.innerText.trim() ?? null,
        top: r.getBoundingClientRect().top,
        bottom: r.getBoundingClientRect().bottom,
        height: r.getBoundingClientRect().height,
      }))
      .sort((a, b) => a.top - b.top),
  );

const number = (text: string | null) => (text && text !== "—" ? Number(text.replace(/[^\d.,-]/g, "").replace(/,/g, "")) : null);

test("@c2-sheet C-06: sort inside groups, density, wrap text, column widths", async ({ browser }) => {
  const { owner, url } = await sampleBoq("Sol Sorter");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await useSession(context, owner);
  const page = await context.newPage();
  await openSheet(page, url);
  const grid = page.getByTestId("sheet-grid");
  const lineCount = Number(await grid.getAttribute("data-lines"));

  // Sort by quantity, descending: inside every group the quantities never go up; the groups keep their order.
  const groupsBefore = (await renderedRows(page)).filter((r) => r.group).map((r) => r.group);
  const header = page.locator("[role=columnheader][data-header=quantity]");
  await expect(header).toHaveAttribute("aria-sort", "none");
  await page.getByTestId("sort-quantity").click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await page.getByTestId("sort-quantity").click();
  await expect(header).toHaveAttribute("aria-sort", "descending");
  const sorted = await renderedRows(page);
  expect(sorted.filter((r) => r.group).map((r) => r.group)).toEqual(groupsBefore);
  let run: (number | null)[] = [];
  const runs: (number | null)[][] = [];
  for (const r of sorted) {
    if (r.group) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(number(r.quantity));
  }
  if (run.length) runs.push(run);
  for (const quantities of runs) {
    const measured = quantities.filter((q): q is number => q !== null);
    expect(measured).toEqual([...measured].sort((a, b) => b - a));
    // Lines without a quantity come last.
    expect(quantities.slice(measured.length).every((q) => q === null)).toBe(true);
  }
  // A third click: the sheet's own order again.
  await page.getByTestId("sort-quantity").click();
  await expect(header).toHaveAttribute("aria-sort", "none");

  // Density: compact rows are 28 px, comfortable 36; the choice is the user's, kept on the server.
  await page.getByTestId("columns-menu").click();
  await page.getByTestId("density-compact").click();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await renderedRows(page)).find((r) => !r.group)?.height).toBe(28);
  await expect.poll(async () => (await apiAs<{ preferences?: { sheetDensity?: string } }>(owner, "GET", "/me")).preferences?.sheetDensity).toBe("compact");
  await page.getByTestId("columns-menu").click();
  await page.getByTestId("density-comfortable").click();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await renderedRows(page)).find((r) => !r.group)?.height).toBe(36);

  // Wrap text: descriptions clamp at three lines; rows never overlap and the last line is still reached.
  await page.getByTestId("columns-menu").click();
  await page.getByTestId("wrap-text").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-testid=sheet-line] [data-column=description] > span.line-clamp-3").first()).toBeVisible();
  const wrapped = await renderedRows(page);
  for (let i = 1; i < wrapped.length; i++) expect(wrapped[i]!.top).toBeGreaterThanOrEqual(wrapped[i - 1]!.bottom - 1.5);
  await grid.evaluate((g) => g.scrollTo(0, g.scrollHeight));
  await expect.poll(() => grid.evaluate((g) => g.querySelectorAll("[data-testid=sheet-line]").length)).toBeGreaterThan(0);
  expect(Number(await grid.getAttribute("data-lines"))).toBe(lineCount);
  const lastIndex = await grid.evaluate((g) => Math.max(...[...g.querySelectorAll<HTMLElement>("[role=row][data-index]")].map((r) => Number(r.dataset.index))));
  expect(lastIndex).toBe(Number(await grid.getAttribute("data-rows")) - 1);
  await grid.evaluate((g) => g.scrollTo(0, 0));

  // Column resize: dragging Unit's edge widens it; the width stays for this BoQ after a reload.
  const unit = page.locator("[role=columnheader][data-header=unit]");
  const before = (await unit.boundingBox())!.width;
  const handle = (await page.getByTestId("resize-unit").boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 80, handle.y + handle.height / 2, { steps: 5 });
  await page.mouse.up();
  const after = (await unit.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 40);
  await openSheet(page, url);
  await expect.poll(async () => Math.round((await page.locator("[role=columnheader][data-header=unit]").boundingBox())!.width)).toBe(Math.round(after));
  // The density and wrapping came back from the server too.
  await expect.poll(async () => (await renderedRows(page)).find((r) => !r.group)?.height).toBeGreaterThanOrEqual(36);
  await expect(page.locator("[data-testid=sheet-line] [data-column=description] > span.line-clamp-3").first()).toBeVisible();
  await context.close();
});

test("@c2-grouping C-07: without a classification the sheet groups by storey or by rule, and the Excel follows", async ({ browser }) => {
  const sample = await sampleBoq("Gus Grouper");
  const { owner, url } = sample;
  // The BoQ without its classification, generated again: the case C-07 is about.
  await apiAs(owner, "PATCH", `/revisions/${sample.boq.currentRevision.id}`, { inputs: { classificationVersionIds: [] } });
  await apiAs(owner, "POST", `/revisions/${sample.boq.currentRevision.id}/runs`, {});
  const boq = await waitFor("the run without a classification", async () => {
    const b = await apiAs<Boq & { currentRevision: { pendingChanges: string[] } }>(owner, "GET", `/boqs/${sample.boq.id}`);
    const status = b.currentRevision.currentRun?.status;
    return b.currentRevision.currentRun?.id !== sample.boq.currentRevision.currentRun?.id && (status === "complete" || status === "needs_input") ? b : undefined;
  });
  const run = await apiAs<{ classifications?: unknown[] }>(owner, "GET", `/runs/${boq.currentRevision.currentRun!.id}`);
  expect(run.classifications ?? []).toEqual([]);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await useSession(context, owner);
  const page = await context.newPage();
  await openSheet(page, url);
  const groupBy = page.getByTestId("group-by");
  await expect(groupBy).toHaveValue("~storey");
  const lines = (await apiAs<{ items: { location?: { storey?: string; storeys?: string[] }; quantity: number | null; unit: string }[] }>(owner, "GET", `/runs/${boq.currentRevision.currentRun!.id}/lines?limit=20000`)).items;
  // A line's storey section (the sheet's `groupPath`): its storey, or its only one of several.
  const storeyOf = (l: (typeof lines)[number]) => l.location?.storey ?? (l.location?.storeys?.length === 1 ? l.location.storeys[0] : undefined);
  const storeys = [...new Set(lines.flatMap((l) => (storeyOf(l) ? [storeyOf(l)!] : [])))];
  const groups = page.getByTestId("sheet-group");
  await expect.poll(async () => (await groups.allInnerTexts()).filter((text) => storeys.some((s) => text.startsWith(s))).length).toBe(storeys.length);
  // A storey's subtotal: its lines' count, and the sum when they share a unit (BR-63).
  const first = storeys[0]!;
  const mine = lines.filter((l) => storeyOf(l) === first);
  const heading = groups.and(page.locator(`[data-group=${JSON.stringify(first)}]`));
  await expect(heading).toContainText(String(mine.length));
  // "Measured as": one section per rule; the Item column is not there without a classification.
  await groupBy.selectOption("~rule");
  await expect.poll(() => groups.count()).toBeGreaterThan(1);
  expect(await page.locator("[role=columnheader][data-header=item]").count()).toBe(0);
  // The sheet's Excel asks for the grouping on screen.
  const sent = page.waitForRequest((r) => r.method() === "POST" && /\/runs\/[^/]+\/exports$/.test(r.url()));
  await page.getByTestId("export-xlsx").click();
  const choice = page.getByTestId("export-last-run");
  if (await choice.isVisible().catch(() => false)) await choice.click();
  expect(JSON.parse((await sent).postData() ?? "{}")).toMatchObject({ groupBy: "~rule" });
  await context.close();
});

test("@c2-pending C-08: an edit shows one banner naming what waits; Apply now generates and it goes", async ({ browser }) => {
  const { owner, boq, url } = await sampleBoq("Paula Pending");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await useSession(context, owner);
  const page = await context.newPage();
  await openSheet(page, url);

  // Edit a measured line's quantity, with its reason.
  const line = page.locator('[data-testid="sheet-line"][data-source="measured"]').first();
  const key = (await line.getAttribute("data-key"))!;
  await line.click();
  await line.locator('[data-column="quantity"]').dblclick();
  await page.getByTestId("cell-editor").fill("123.45");
  await page.keyboard.press("Enter");
  await page.getByTestId("reason-input").fill("Measured on site");
  await page.getByTestId("reason-confirm").click();
  await expect(page.locator(`[data-testid="sheet-line"][data-key="${key}"]`)).toHaveAttribute("data-edited", /quantity/);

  // One banner: "1 edit not applied yet.", the list on expand, Save version's reason beside it.
  const banner = page.getByTestId("pending-banner");
  await expect(banner).toHaveAttribute("data-edits", "1");
  await expect(page.getByTestId("pending-summary")).toHaveText(/^1 edit.* not applied yet\.$/);
  await expect(page.getByTestId("pending-save-waits")).toBeVisible();
  await expect(page.getByTestId("save-version").or(page.getByTestId("submit-for-review")).first()).toBeDisabled();
  await page.getByTestId("pending-toggle").click();
  await expect(page.getByTestId("pending-list")).toContainText("(quantity)");

  // Apply now: a run, then nothing waits and Save version can be used.
  await page.getByTestId("pending-apply").click();
  await expect(banner).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId("boq-header")).not.toHaveAttribute("data-state", "active", { timeout: 120_000 });
  const after = await apiAs<{ currentRevision: { pendingChanges: string[]; currentRun?: { id: string } } }>(owner, "GET", `/boqs/${boq.id}`);
  expect(after.currentRevision.pendingChanges).toEqual([]);
  expect(after.currentRevision.currentRun?.id).not.toBe(boq.currentRevision.currentRun?.id);
  await context.close();
});

test("@c2-palette C-09: Ctrl+K finds a BoQ across projects and opens it; the page's actions are listed", async ({ browser }) => {
  const { owner, url, orgId } = await sampleBoq("Pia Palette");
  const tower = await apiAs<{ id: string }>(owner, "POST", `/orgs/${orgId}/projects`, { name: "Harbour Tower" });
  const tender = await apiAs<{ id: string }>(owner, "POST", `/projects/${tower.id}/boqs`, { name: "Tower tender" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await useSession(context, owner);
  const page = await context.newPage();
  await openSheet(page, url);

  // In a BoQ: its actions come first ("Here").
  await page.keyboard.press("Control+k");
  const palette = page.getByTestId("palette");
  await expect(palette).toBeVisible();
  await expect(page.getByTestId("palette-input")).toBeFocused();
  await page.getByTestId("palette-input").fill("excel");
  await expect(page.locator('[data-testid="palette-option"][data-kind="actions"]').first()).toContainText("Excel");
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  // From the top bar's field: a BoQ of another project, named with its project; Enter opens it.
  await page.getByTestId("palette-open").click();
  await page.getByTestId("palette-input").fill("tower t");
  const hit = page.locator(`[data-testid="palette-option"][data-id="boq:${tender.id}"]`);
  await expect(hit).toContainText("Tower tender");
  await expect(hit).toContainText("Harbour Tower");
  await expect(page.getByTestId("palette-input")).toHaveAttribute("aria-activedescendant", (await hit.getAttribute("id"))!);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/projects/${tower.id}/boqs/${tender.id}`));

  // Pages too, by keyboard: Ctrl+K, "members", Enter.
  await page.keyboard.press("Control+k");
  await page.getByTestId("palette-input").fill("members");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\/members$/);
  await context.close();
});
