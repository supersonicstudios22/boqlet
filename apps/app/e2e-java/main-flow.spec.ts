import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createOrg, newPerson, useSession } from "./helpers";

/**
 * Smoke against Java: the main flow in the browser (FL-1): the sample project, then a project of
 * one's own, the Duplex uploaded straight to object storage (a signed PUT from the browser, the
 * bucket's CORS as the pilot sets it), parsed by the engine worker, a BoQ generated, its sheet, the
 * Excel download and a share link opened with no account.
 */

const DUPLEX = path.resolve(__dirname, "..", "..", "..", "fixtures", "ifc", "Ifc2x3_Duplex_Architecture.ifc");
test.describe.configure({ timeout: 360_000 });

test("FL-1 step 5: Try with a sample project opens the sample Duplex with its BoQ", async ({ page }) => {
  const owner = await newPerson("Sample Owner");
  const org = await createOrg(owner, "Sample Firm");
  await useSession(page.context(), owner);
  await page.goto(`/${org.slug}`);
  await expect(page.getByTestId("empty-dashboard")).toBeVisible();
  await page.getByTestId("try-sample").click();
  await expect(page.getByTestId("project-title")).toHaveText("Duplex (sample)");
  const project = page.url();
  // The bundled Duplex is parsed and its BoQ generated in the background.
  await page.goto(`${project}/boqs`);
  const row = page.locator('[data-testid^="boq-row-"]').first();
  await expect(row).toBeVisible({ timeout: 180_000 });
  await row.getByRole("link").first().click();
  await expect(page.getByTestId("sheet-line").first()).toBeVisible({ timeout: 180_000 });
  // Outside the project limit: the dashboard lists it, and a project of one's own still fits.
  await page.goto(`/${org.slug}`);
  await expect(page.getByTestId("project-cards")).toContainText("Duplex (sample)");
});

test("main flow: project, Duplex uploaded from the browser, BoQ generated, sheet, Excel download, share link opened without an account", async ({ page, browser }) => {
  const owner = await newPerson("Flow Owner");
  const org = await createOrg(owner, "Flow Firm");
  await useSession(page.context(), owner);

  await page.goto(`/${org.slug}/projects/new`);
  await page.getByTestId("project-name").fill("Duplex tender");
  await page.getByTestId("create-project").click();
  await expect(page.getByTestId("project-title")).toHaveText("Duplex tender");
  const project = page.url();

  // Upload: the file goes from the browser straight to object storage.
  await page.goto(`${project}/models`);
  await page.getByTestId("model-name").fill("Architecture");
  await page.getByTestId("add-model-submit").click();
  await expect(page.getByTestId("model-Architecture")).toBeVisible();
  const put = page.waitForResponse((r) => r.request().method() === "PUT" && !r.url().startsWith(new URL(page.url()).origin), { timeout: 60_000 });
  await page.locator('[data-testid^="upload-input-"]').setInputFiles({ name: "Duplex_A.ifc", mimeType: "application/octet-stream", buffer: await readFile(DUPLEX) });
  expect((await put).status()).toBe(200);
  await expect(page.getByTestId("version-page")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("input-check-report")).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId("version-page")).toContainText("IFC2X3");

  // A BoQ with the project's defaults, generated.
  await page.goto(`${project}/boqs`);
  await page.getByTestId("new-boq").click();
  const dialog = page.getByTestId("create-boq-dialog");
  await expect(dialog.getByTestId("create-model-Architecture")).toBeChecked();
  await dialog.getByTestId("boq-name").fill("Tender BoQ");
  await dialog.getByTestId("create-boq-submit").click();
  await expect(page.getByTestId("setup-tab")).toBeVisible();
  await page.getByTestId("generate").click();
  await expect(page.getByTestId("current-run")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("boq-header")).toHaveAttribute("data-state", /complete|needs_input/, { timeout: 180_000 });

  // The sheet.
  await page.getByTestId("tab-sheet").click();
  await expect(page.getByTestId("sheet-line").first()).toBeVisible();
  expect(Number(await page.getByTestId("sheet-grid").getAttribute("data-lines"))).toBeGreaterThan(30);

  // The Excel export (made by the engine worker, downloaded from object storage).
  const download = page.waitForEvent("download", { timeout: 180_000 });
  await page.getByTestId("export-xlsx").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
  const saved = test.info().outputPath(file.suggestedFilename());
  await file.saveAs(saved);
  const bytes = await readFile(saved);
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");

  // A share link, opened in a fresh browser with no account.
  await page.getByTestId("share-boq").click();
  const share = page.getByTestId("share-dialog");
  await share.getByTestId("share-label").fill("For the client");
  await share.getByTestId("share-create").click();
  const link = await share.getByTestId("share-url").inputValue();
  expect(link).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  const opened = await pub.goto(new URL(link).pathname);
  expect(opened!.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(pub.getByTestId("share-title")).toHaveText("Tender BoQ");
  await expect(pub.getByTestId("share-line").first()).toBeVisible();
  await expect(pub.locator("body")).not.toContainText("Flow Owner");
  await visitor.close();
});
