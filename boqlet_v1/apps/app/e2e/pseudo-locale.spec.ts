import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiAs, generatedDuplexBoq, signInAs } from "./helpers";

/**
 * v1 criterion 11, FE-044 (F15): in the pseudo-locale en-XA the app shell, sheet, questions,
 * Library and share page show no English of their own. Every column header, tab, form label,
 * heading and every aria-label, placeholder and title must come from the catalogue (accented).
 * Data is shown as authored (F15 §5) and engine text keeps its English fallback where the catalogue
 * has no entry yet (docs/11), so elements that carry data are left out by selector.
 */

const DUPLEX = path.resolve(__dirname, "..", "..", "..", "fixtures", "ifc", "Ifc2x3_Duplex_Architecture.ifc");
test.describe.configure({ timeout: 300_000 });

/** Elements whose text or attributes are data (names, codes, descriptions, engine text). */
const DATA = [
  '[data-testid="line-detail"]',
  '[data-testid="sheet-line"] [title]',
  '[data-testid="sheet-group"]',
  '[data-testid="share-line"]',
  '[data-testid="question-message"]',
  '[data-testid="log-entry"]',
  '[data-testid="org-switcher"]',
  '[data-testid="user-menu"]',
  '[data-testid="project-title"]',
  '[data-testid="boq-title"]',
  '[data-testid="share-title"]',
  '[data-testid="preset-name"]',
  '[data-testid="viewer-model"]',
  '[role="radiogroup"] label',
  '[data-testid="question-section"] > h2',
  '[data-testid="wordmark"]',
].join(",");

async function englishOf(page: Page): Promise<string[]> {
  return page.evaluate((data) => {
    const PSEUDO = /[áéíóúŕšţñçðƀĝĥĵķļɱǫṽŵẋýžÁÉÍÓÚŔŠŢÑÇ]/;
    const out: string[] = [];
    // A rule-set question's control is labelled with the question, which is preset data.
    const repeatsQuestion = (el: Element, v: string) => !!el.closest('[data-testid="question"]')?.textContent?.includes(v);
    const isData = (el: Element, v = "") => !!el.closest(data) || (v !== "" && repeatsQuestion(el, v));
    const check = (what: string, value: string | null | undefined, el: Element) => {
      const v = value?.trim();
      if (v && /[A-Za-z]{3,}/.test(v) && !PSEUDO.test(v) && !isData(el, what.startsWith("@") ? v : "")) out.push(`${what}: ${v}`);
    };
    for (const el of document.querySelectorAll('th, [role="columnheader"], [role="tab"], label, legend, h1, h2, h3, h4'))
      check(el.tagName.toLowerCase(), (el as HTMLElement).innerText, el);
    for (const attr of ["aria-label", "placeholder", "title"])
      for (const el of document.querySelectorAll(`[${attr}]`)) check(`@${attr}`, el.getAttribute(attr), el);
    return [...new Set(out)];
  }, DATA);
}

test("v1 criterion 11: shell, sheet, questions, Library and share page in en-XA have no English of their own", async ({ page, context, baseURL, browser }) => {
  const pseudo = [{ name: "boqlet-locale", value: "en-XA", url: baseURL! }];
  await context.addCookies(pseudo);
  const { url, olivia } = await generatedDuplexBoq(new Uint8Array(await readFile(DUPLEX)));
  await signInAs(page, "olivia");
  const screens: [string, () => Promise<void>][] = [
    ["org home", async () => void (await page.goto("/studio-demo"))],
    ["sheet", async () => { await page.goto(url); await expect(page.getByTestId("sheet-line").first()).toBeVisible(); }],
    ["line detail", async () => { await page.getByTestId("sheet-line").first().click(); await expect(page.getByTestId("detail-quantity")).toBeVisible(); }],
    ["questions", async () => { await page.goto(`${url}?tab=questions`); await expect(page.getByTestId("questions-summary")).toBeVisible(); }],
    ["library", async () => { await page.goto("/studio-demo/library"); await expect(page.getByRole("main")).toBeVisible(); }],
  ];
  const me = await apiAs<{ memberships: { org: { id: string; slug: string } }[] }>(olivia, "GET", "/me");
  const orgId = me.memberships.find((m) => m.org.slug === "studio-demo")!.org.id;
  const presets = await apiAs<{ id: string; name: string; kind: string }[]>(olivia, "GET", `/orgs/${orgId}/presets`);
  for (const [kind, p] of [["rule_set", presets.find((x) => x.kind === "rule_set")!], ["classification", presets.find((x) => x.name === "Studio trades")!], ["dictionary", presets.find((x) => x.name === "Studio names")!]] as const)
    screens.push([`library ${kind}`, async () => { await page.goto(`/studio-demo/library/${kind}/${p.id}`); await expect(page.getByRole("tab").first()).toBeVisible(); }]);

  for (const [name, open] of screens) {
    await open();
    expect.soft(await englishOf(page), name).toEqual([]);
  }

  await page.goto(url);
  await page.getByTestId("share-boq").click();
  const dialog = page.getByTestId("share-dialog");
  expect.soft(await englishOf(page), "share dialog").toEqual([]);
  await dialog.getByTestId("share-label").fill("Pseudo");
  await dialog.getByTestId("share-create").click();
  const link = await dialog.getByTestId("share-url").inputValue();
  const visitor = await browser.newContext();
  await visitor.addCookies(pseudo);
  const pub = await visitor.newPage();
  await pub.goto(new URL(link).pathname);
  await expect(pub.getByTestId("share-line").first()).toBeVisible();
  expect.soft(await englishOf(pub), "share page").toEqual([]);
  await visitor.close();
});
