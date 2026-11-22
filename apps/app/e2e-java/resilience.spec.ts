import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiAs, createOrg, newPerson, useSession, waitFor, type Person } from "./helpers";

/**
 * Smoke against Java: the app when the API restarts (a deploy) and by keyboard.
 * - TF-182: the event stream ends (the server closes each one after 5 minutes, and on shutdown); the
 *   client opens a new one with `Last-Event-ID`, and live updates keep arriving.
 * - TF-183: an edit made while the API doesn't answer is not dropped: "not saved", then saved.
 * - TF-158: a share page's lines open by keyboard.
 * - TF-159: quantity, unit and Item cells are edited by keyboard (F2 on the focused cell).
 */

test.describe.configure({ timeout: 360_000 });

const lineAt = (page: Page, key: string) => page.locator(`[data-testid="sheet-line"][data-key=${JSON.stringify(key)}]`);
const cell = (line: Locator, column: string) => line.locator(`[data-column="${column}"]`);

type Boq = { id: string; name: string; currentRevision: { id: string; currentRun?: { status: string } } };

/** A person with the sample Duplex BoQ generated; its URL in the app. */
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

test("TF-182: when the event stream ends the client reconnects with Last-Event-ID, and live updates keep arriving", async ({ page }) => {
  const { owner, boq, url } = await sampleBoq("Rita Realtime");
  // The first stream ends at once, as the server ends every stream after its lifetime.
  let ended = false;
  await page.route("**/api/v1/events", async (route) => {
    if (ended) return route.continue();
    ended = true;
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "id: 7\nevent: ping\ndata: {}\n\n" });
  });
  const reconnect = page.waitForRequest((r) => r.url().includes("/api/v1/events") && r.headers()["last-event-id"] === "7", { timeout: 30_000 });
  await useSession(page.context(), owner);
  await page.goto(url);
  await expect(page.getByTestId("sheet")).toBeVisible();
  await reconnect;
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "open");
  // An event after the reconnect reaches the page without a reload.
  const name = `Renamed ${Date.now().toString(36)}`;
  await apiAs(owner, "PATCH", `/boqs/${boq.id}`, { name });
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });
});

test("TF-183: an edit made while the API doesn't answer is kept as not saved and saved once it answers", async ({ page }) => {
  const { owner, boq, url } = await sampleBoq("Una Unsaved");
  await useSession(page.context(), owner);
  await page.goto(url);
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-editable", "true");

  // The API is down: the app's proxy answers 503 api_unavailable (as it does for a refused connection).
  await page.route("**/api/v1/boqs/*/overrides/batch", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "api_unavailable", message: "The API is not reachable." }) }));
  const key = (await page.locator('[data-testid="sheet-line"][data-source="measured"]').nth(1).getAttribute("data-key"))!;
  await lineAt(page, key).click();
  await cell(lineAt(page, key), "description").dblclick();
  const text = "Typed while the API was down";
  await page.getByTestId("cell-editor").fill(text);
  await page.getByTestId("cell-editor").press("Enter");
  await expect(page.getByTestId("edit-retrying")).toBeVisible();
  await expect(page.getByTestId("edit-unsaved")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("edit-unsaved")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("edit-error")).toHaveCount(0);

  // The API answers again: "Save again" sends the kept edit.
  await page.unroute("**/api/v1/boqs/*/overrides/batch");
  await page.getByTestId("edit-unsaved-retry").click();
  await expect(page.getByTestId("edit-unsaved")).toHaveCount(0);
  await expect(cell(lineAt(page, key), "description")).toHaveText(text);
  const overrides = await apiAs<{ lineKey: string; description?: string }[]>(owner, "GET", `/boqs/${boq.id}/overrides`);
  expect(overrides.find((o) => o.lineKey === key)?.description).toBe(text);
});

test("TF-158: a share page's line opens its explanation by keyboard", async ({ page, browser }) => {
  const { owner, boq } = await sampleBoq("Kai Keyboard");
  const link = await apiAs<{ url: string }>(owner, "POST", `/boqs/${boq.id}/share-links`, { mode: "pinned", revisionId: boq.currentRevision.id, include: { lineDetail: true, viewer: false }, label: "Keyboard" });
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  await pub.goto(new URL(link.url).pathname);
  await expect(pub.getByTestId("share-line").first()).toBeVisible();
  // Tab from the search box reaches the first line's button; Enter opens it and moves focus into the explanation.
  await pub.getByTestId("share-search").focus();
  await pub.keyboard.press("Tab");
  const first = pub.getByTestId("share-line").first().getByRole("button");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await pub.keyboard.press("Enter");
  await expect(pub.getByTestId("share-detail")).toBeVisible();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  expect(await pub.evaluate(() => !!document.activeElement?.closest("[data-testid=share-detail]"))).toBe(true);
  await visitor.close();
  await page.close();
});

test("TF-159: quantity and unit cells are edited by keyboard: arrows to the cell, F2 or Enter", async ({ page }) => {
  const { owner, boq, url } = await sampleBoq("Kim Keys");
  await useSession(page.context(), owner);
  await page.goto(url);
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-editable", "true");
  await page.getByTestId("sheet-grid").focus();
  await page.keyboard.press("ArrowDown");
  const selected = page.locator('[data-testid="sheet-line"][aria-selected="true"]');
  const key = (await selected.getAttribute("data-key"))!;
  await expect(selected.locator('[data-active="true"]')).toHaveAttribute("data-column", "description");
  // Right to Quantity (past Unit), F2, a new value, Enter, the reason, Enter.
  for (let i = 0; i < 4 && (await selected.locator('[data-active="true"]').getAttribute("data-column")) !== "quantity"; i++) await page.keyboard.press("ArrowRight");
  await expect(selected.locator('[data-active="true"]')).toHaveAttribute("data-column", "quantity");
  await page.keyboard.press("F2");
  await expect(page.getByTestId("cell-editor")).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("77.5");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("reason-input")).toBeVisible();
  await page.keyboard.type("Measured on site");
  await page.keyboard.press("Enter");
  await expect(cell(lineAt(page, key), "quantity")).toHaveText("77.5");
  // Left to Unit; Enter opens its editor too.
  await page.getByTestId("sheet-grid").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(selected.locator('[data-active="true"]')).toHaveAttribute("data-column", "unit");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cell-editor")).toBeFocused();
  await page.keyboard.press("Escape");
  const overrides = await apiAs<{ lineKey: string; quantity?: number }[]>(owner, "GET", `/boqs/${boq.id}/overrides`);
  expect(overrides.find((o) => o.lineKey === key)?.quantity).toBe(77.5);
});
