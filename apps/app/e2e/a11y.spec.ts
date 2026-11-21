import { readFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiAs, generatedDuplexBoq, signInAs } from "./helpers";

/**
 * TS-003 (FE-044): axe on the main screens, WCAG 2.2 AA (nfr.md "Accessibility"); no serious or
 * critical violation. Screens from testing.md: S05, S10, S12a–c, S20, plus sign-in and the share
 * page (S35), which nfr.md names. S15c and S29 are pricing-module screens, not built (P48). The 3D
 * canvas is exempt (nfr.md); its element list and controls are checked.
 */

const DUPLEX = path.resolve(__dirname, "..", "..", "..", "fixtures", "ifc", "Ifc2x3_Duplex_Architecture.ifc");
test.describe.configure({ timeout: 300_000 });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: Page, screen: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).exclude("canvas").analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${screen} · ${v.id} (${v.impact}): ${v.help} · ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  if (process.env.A11Y_DEBUG) for (const v of results.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) for (const n of v.nodes.slice(0, 2)) console.log(`DBG ${screen} ${v.id}: ${n.html.slice(0, 400)} :: ${n.failureSummary?.replace(/\s+/g, " ").slice(0, 300)}`);
  expect.soft(blocking, `axe on ${screen}`).toEqual([]);
}

test("TS-003 sign-in, the org home (S05) and the Library editors (S20)", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("main")).toBeVisible();
  await audit(page, "sign-in");

  const olivia = await signInAs(page, "olivia");
  await page.goto("/studio-demo");
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await audit(page, "S05 org home");

  const me = await apiAs<{ memberships: { org: { id: string; slug: string } }[] }>(olivia, "GET", "/me");
  const orgId = me.memberships.find((m) => m.org.slug === "studio-demo")!.org.id;
  const presets = await apiAs<{ id: string; name: string; kind: string }[]>(olivia, "GET", `/orgs/${orgId}/presets`);
  await signInAs(page, "ivana");
  for (const [kind, preset] of [
    ["rule_set", presets.find((p) => p.kind === "rule_set")!],
    ["classification", presets.find((p) => p.name === "Studio trades")!],
    ["dictionary", presets.find((p) => p.name === "Studio names")!],
  ] as const) {
    await page.goto(`/studio-demo/library/${kind}/${preset.id}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("tab").first()).toBeVisible();
    await audit(page, `S20 ${kind}`);
  }
});

test("TS-003 the model version (S10), the BoQ workspace (S12a–c) and the share page (S35)", async ({ page, browser }) => {
  const { url, projectUrl, projectId, olivia } = await generatedDuplexBoq(new Uint8Array(await readFile(DUPLEX)));
  await signInAs(page, "olivia");

  const items = <T,>(r: T[] | { items: T[] }) => (Array.isArray(r) ? r : r.items);
  const model = items(await apiAs<{ id: string }[] | { items: { id: string }[] }>(olivia, "GET", `/projects/${projectId}/models`))[0];
  const version = items(await apiAs<{ id: string }[] | { items: { id: string }[] }>(olivia, "GET", `/models/${model.id}/versions`))[0];
  await page.goto(`${projectUrl}/models/${model.id}/versions/${version.id}`);
  await expect(page.getByTestId("input-check-report")).toBeVisible({ timeout: 60_000 });
  await audit(page, "S10 model version");

  await page.goto(url);
  await expect(page.getByTestId("sheet-line").first()).toBeVisible();
  await audit(page, "S12a sheet");
  await page.getByTestId("sheet-line").first().click();
  await expect(page.getByTestId("detail-quantity")).toBeVisible();
  await audit(page, "S12a line detail");

  await page.goto(`${url}?tab=questions`);
  await expect(page.getByTestId("questions-summary")).toBeVisible();
  await audit(page, "S12b questions");

  await page.goto(`${url}?tab=viewer`);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
  await audit(page, "S12c viewer");

  await page.goto(url);
  await page.getByTestId("share-boq").click();
  const dialog = page.getByTestId("share-dialog");
  await dialog.getByTestId("share-label").fill("Accessibility check");
  await audit(page, "share dialog");
  await dialog.getByTestId("share-create").click();
  const link = await dialog.getByTestId("share-url").inputValue();

  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  await pub.goto(new URL(link).pathname);
  await expect(pub.getByTestId("share-title")).toBeVisible();
  await expect(pub.getByTestId("share-line").first()).toBeVisible();
  await audit(pub, "S35 share page");
  await visitor.close();
});
