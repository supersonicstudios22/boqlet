import { expect, test, type Page } from "./fixtures";
import { APP, apiAs, createOrg, newPerson, useSession, waitFor, type Person } from "./helpers";

/**
 * Smoke against Java: the sheet with the mouse and the screens' states.
 * - TF-104: a double-click on a cell of a line that isn't selected edits that cell.
 * - TF-103: the Item code picker's list is above the next rows; a mouse pick works.
 * - TF-106: without WebGL the viewer says so and lists the elements.
 * - TF-017/TF-019: a project that can't be loaded says so with Try again, and recovers.
 */

test.describe.configure({ timeout: 360_000 });

type Boq = { id: string; currentRevision: { id: string; currentRun?: { status: string } } };

async function sampleBoq(name: string): Promise<{ owner: Person; url: string; projectUrl: string; boq: Boq }> {
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

async function splitOff(page: Page) {
  const toggle = page.getByTestId("toggle-model");
  if ((await toggle.count()) && (await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
}

test("TF-104 and TF-103: double-click a quantity of a line not selected; pick a code with the mouse", async ({ page }) => {
  const { owner, url } = await sampleBoq("Dora Double");
  await useSession(page.context(), owner);
  await page.goto(url);
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-editable", "true");
  await splitOff(page);
  const line = page.locator('[data-testid="sheet-line"][data-source="measured"]').nth(3);
  await expect(line).not.toHaveAttribute("aria-selected", "true");
  await line.locator('[data-column="quantity"]').dblclick();
  await expect(page.getByTestId("cell-editor")).toBeFocused();
  await page.keyboard.press("Escape");

  // The Item picker (only while grouping by a classification).
  if ((await page.getByTestId("group-by").inputValue()) === "") test.skip(true, "the sample BoQ has no classification");
  const mid = page.locator('[data-testid="sheet-line"][data-source="measured"]').nth(5);
  const key = (await mid.getAttribute("data-key"))!;
  await mid.locator('[data-column="item"]').dblclick();
  const list = page.getByTestId("cell-editor-list");
  await expect(list).toBeVisible();
  const option = list.locator("[role=option]").nth(1);
  const code = ((await option.innerText()).split(/\s/)[0])!;
  // What is under the option's centre is the option, not the next row.
  const box = (await option.boundingBox())!;
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("[role=option]"), { x: box.x + 8, y: box.y + box.height / 2 })).toBe(true);
  await option.click();
  await expect(page.locator(`[data-testid="sheet-line"][data-key=${JSON.stringify(key)}] [data-column="item"]`)).toHaveText(code);
});

// A browser of its own without WebGL (launch options can't be set per describe group: they need a new worker).
test("TF-106: without WebGL the viewer says so and lists the elements; picking one shows its lines", async ({ playwright }) => {
  const { owner, url } = await sampleBoq("Nia Nogl");
  const browser = await playwright.chromium.launch({ args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"] });
  try {
    const context = await browser.newContext({ baseURL: APP });
    await useSession(context, owner);
    const page = await context.newPage();
    await page.goto(`${url}?tab=viewer`);
    await expect(page.getByTestId("viewer-no-webgl")).toBeVisible();
    await expect(page.getByTestId("viewer-list-element").first()).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("viewer-list-element").nth(3).click();
    await expect(page.getByTestId("viewer-selection")).toBeVisible();
  } finally {
    await browser.close();
  }
});

test("TF-017 / TF-019: a project the API can't load says so with Try again, and recovers", async ({ page }) => {
  const { owner, projectUrl } = await sampleBoq("Rory Retry");
  await useSession(page.context(), owner);
  let down = true;
  await page.route("**/api/v1/projects/*", (route) => (down && route.request().method() === "GET" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "api_unavailable", message: "" }) }) : route.continue()));
  await page.goto(projectUrl);
  await expect(page.getByTestId("inline-error")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("not-found")).toHaveCount(0);
  down = false;
  await page.getByTestId("inline-error-retry").click();
  await expect(page.getByTestId("overview-models")).toBeVisible();
});
