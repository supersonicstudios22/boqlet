import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./fixtures";
import { APP, apiAs, createOrg, newPerson, useSession, waitFor, type Person } from "./helpers";

/**
 * The accessibility and pseudo-locale gates of the browser suite (review B-06, FM-81, FM-110, UX-042;
 * docs/architecture/nfr.md "Quality gates"), tagged `@sweep`:
 * - axe (WCAG 2.0/2.1/2.2 A and AA) on the review's screens, as `docs/review/repro/ux/crawl.mjs` swept them:
 *   every `serious` or `critical` violation must be in `axe-known.json` (screen -> rule ids), the list
 *   C-56 shrinks. A new one fails; a known one no longer found is printed, to be taken off the list;
 * - the pseudo-locale `en-XA` (accented, about 30 % longer) on the core screens: no message key shown
 *   instead of its text, no missing-message error, no horizontal overflow at 1440 px.
 */
test.describe.configure({ mode: "serial", timeout: 600_000 });

const KNOWN: Record<string, string[]> = JSON.parse(readFileSync(path.join(__dirname, "axe-known.json"), "utf8")).violations;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Boq = { id: string; currentRevision: { id: string; currentRun?: { id: string; status: string } } };
type Screen = { name: string; url: string; ready?: string };

let owner: Person;
let screens: Screen[];
let shareUrl: string;

test.beforeAll(async () => {
  owner = await newPerson("Axel Sweep");
  const org = await createOrg(owner, "Sweep Firm");
  const project = await apiAs<{ id: string }>(owner, "POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" });
  const boq = await waitFor("the sample BoQ", async () => {
    const boqs = await apiAs<Boq[]>(owner, "GET", `/projects/${project.id}/boqs`);
    const status = boqs[0]?.currentRevision.currentRun?.status;
    return status === "complete" || status === "needs_input" ? boqs[0] : undefined;
  });
  const [model] = await apiAs<{ id: string }[]>(owner, "GET", `/projects/${project.id}/models`);
  const [version] = await apiAs<{ id: string }[]>(owner, "GET", `/models/${model!.id}/versions`);
  const system = async (kind: string) =>
    (await apiAs<{ id: string }[]>(owner, "GET", `/orgs/${org.id}/presets?kind=${kind}&layer=system`))[0]!.id;
  const share = await apiAs<{ url: string }>(owner, "POST", `/boqs/${boq.id}/share-links`, { mode: "pinned", revisionId: boq.currentRevision.id });
  shareUrl = new URL(share.url).pathname;

  const o = `/${org.slug}`;
  const p = `${o}/projects/${project.id}`;
  const b = `${p}/boqs/${boq.id}`;
  screens = [
    { name: "dashboard", url: o },
    { name: "projects", url: `${o}/projects` },
    { name: "project-new", url: `${o}/projects/new` },
    { name: "project-overview", url: p },
    { name: "models", url: `${p}/models` },
    { name: "model", url: `${p}/models/${model!.id}` },
    { name: "model-version", url: `${p}/models/${model!.id}/versions/${version!.id}` },
    { name: "boqs", url: `${p}/boqs` },
    { name: "boq-sheet", url: b, ready: "sheet-line" },
    ...["questions", "viewer", "changes", "log", "setup", "exports", "versions"].map((tab) => ({ name: `boq-${tab}`, url: `${b}?tab=${tab}` })),
    { name: "decisions", url: `${p}/decisions` },
    { name: "project-library", url: `${p}/library` },
    { name: "project-settings", url: `${p}/settings` },
    { name: "project-activity", url: `${p}/activity` },
    { name: "library", url: `${o}/library` },
    { name: "library-federation", url: `${o}/library?kind=federation` },
    { name: "lib-rule-set", url: `${o}/library/rule_set/${await system("rule_set")}` },
    { name: "lib-classification", url: `${o}/library/classification/${await system("classification")}` },
    { name: "lib-dictionary", url: `${o}/library/dictionary/${await system("dictionary")}` },
    ...["general", "members", "billing", "usage", "audit", "shares"].map((s) => ({ name: `settings-${s}`, url: `${o}/settings/${s}` })),
    { name: "setup", url: `${o}/setup` },
    { name: "account", url: "/account" },
    { name: "notifications", url: "/notifications" },
    { name: "not-found", url: `${o}/projects/00000000-0000-0000-0000-000000000000` },
  ];
});

/**
 * A screen loaded far enough to judge: its heading (or main region; `/notifications` has no `<main>`,
 * N-26), its own ready marker, no loading state left.
 */
async function open(page: Page, screen: Screen) {
  console.log(`[sweep] ${screen.name} ${screen.url}`);
  await page.goto(screen.url, { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1, main").first()).toBeVisible({ timeout: 120_000 });
  if (screen.ready) await expect(page.getByTestId(screen.ready).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(500);
}

async function serious(page: Page): Promise<{ id: string; nodes: number; sample: string }[]> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.length, sample: v.nodes[0]?.target.join(" ") ?? "" }));
}

test("axe: no serious or critical violation beyond the known list on the app's screens @sweep", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useSession(page.context(), owner);
  const found: Record<string, string[]> = {};
  const fresh: string[] = [];
  for (const screen of screens) {
    await open(page, screen);
    const violations = await serious(page);
    found[screen.name] = violations.map((v) => v.id);
    for (const v of violations) if (!(KNOWN[screen.name] ?? []).includes(v.id)) fresh.push(`${screen.name}: ${v.id} (${v.nodes} nodes, e.g. ${v.sample})`);
  }
  // The public pages, without a session: sign-in, sign-up and the share page.
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const anonymous = await visitor.newPage();
  for (const screen of [{ name: "sign-in", url: "/sign-in" }, { name: "sign-up", url: "/sign-up" }, { name: "share", url: shareUrl }]) {
    await open(anonymous, screen);
    const violations = await serious(anonymous);
    found[screen.name] = violations.map((v) => v.id);
    for (const v of violations) if (!(KNOWN[screen.name] ?? []).includes(v.id)) fresh.push(`${screen.name}: ${v.id} (${v.nodes} nodes, e.g. ${v.sample})`);
  }
  await visitor.close();
  const gone = Object.entries(KNOWN).flatMap(([name, ids]) => ids.filter((id) => !(found[name] ?? []).includes(id)).map((id) => `${name}: ${id}`));
  if (gone.length) console.log(`[axe] known violations no longer found (take them off axe-known.json):\n  ${gone.join("\n  ")}`);
  console.log(`[axe] ${Object.keys(found).length} screens swept`);
  expect(fresh, "new serious/critical axe violations").toEqual([]);
});

const CORE = ["dashboard", "projects", "project-overview", "models", "boqs", "boq-sheet", "boq-questions", "library", "settings-general", "settings-members", "account", "notifications"];
// A message key in place of its text, as next-intl shows a missing one: `namespace.key.path`.
const KEY = /^(common|shell|errors|units|auth|orgs|settings|account|projects|models|boqs|questions|library|ruleSetEditor|classificationEditor|dictionaryEditor|setup|notifications|viewer|audit|shares|admin|engine)\.[A-Za-z0-9_.]+$/;

test("en-XA: the core screens show no message keys, no missing messages and no horizontal overflow @sweep", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useSession(page.context(), owner);
  await page.context().addCookies([{ name: "boqlet-locale", value: "en-XA", domain: new URL(APP).hostname, path: "/" }]);
  const missing: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /MISSING_MESSAGE/.test(m.text())) missing.push(m.text().slice(0, 200));
  });
  const problems: string[] = [];
  for (const screen of screens.filter((s) => CORE.includes(s.name))) {
    await open(page, screen);
    const state = await page.evaluate((pattern) => {
      const key = new RegExp(pattern);
      const texts: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim() ?? "";
        if (key.test(text)) texts.push(text);
      }
      const root = document.documentElement;
      return { keys: texts, overflow: root.scrollWidth - root.clientWidth, pseudo: /\[[^\]]*~+\]/.test(document.body.innerText) };
    }, KEY.source);
    if (!state.pseudo) problems.push(`${screen.name}: no en-XA text (the locale did not apply)`);
    if (state.keys.length) problems.push(`${screen.name}: message keys shown: ${state.keys.slice(0, 5).join(", ")}`);
    if (state.overflow > 1) problems.push(`${screen.name}: ${state.overflow} px wider than the window`);
  }
  expect(problems, "en-XA problems").toEqual([]);
  expect(missing, "missing messages").toEqual([]);
});
