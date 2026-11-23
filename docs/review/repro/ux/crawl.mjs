import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const args = process.argv.slice(2);
const state = args[0]; const listFile = args[1]; const outJson = args[2];
const width = Number(process.env.W || 1440), height = Number(process.env.H || 900);
const SS = "docs/review/_screenshots/ux";
const pages = JSON.parse(fs.readFileSync(listFile, "utf8"));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height }, storageState: state, reducedMotion: "reduce" });
const page = await ctx.newPage();
const results = fs.existsSync(outJson) ? JSON.parse(fs.readFileSync(outJson, "utf8")) : {};
page.on("console", (m) => { if (m.type() === "error") console.log("  console.error:", m.text().slice(0, 200)); });
for (const p of pages) {
  const t0 = Date.now();
  try {
    await page.goto("http://localhost:3000" + p.url, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForTimeout(p.wait ?? 6000);
    if (p.click) { for (const c of p.click) { await page.locator(c).first().click({ timeout: 10000 }).catch(e => console.log("  click fail", c, e.message.split("\n")[0])); await page.waitForTimeout(2000); } }
    await page.screenshot({ path: `${SS}/${p.name}.png`, fullPage: p.full ?? true });
    const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, title: document.title, h1: [...document.querySelectorAll("h1")].map(h => h.textContent.trim()).slice(0,3) }));
    let ax = null;
    if (p.axe !== false) {
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
      ax = r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, tags: v.tags.filter(t => t.startsWith("wcag")).join(","), help: v.help, sample: v.nodes.slice(0, 3).map(n => n.target.join(" ") + " :: " + (n.failureSummary || "").replace(/\s+/g, " ").slice(0, 220)) }));
    }
    results[p.name] = { url: page.url(), ms: Date.now() - t0, ...sw, axe: ax };
    console.log(p.name, page.url(), `${Date.now() - t0}ms`, "overflow:", sw.sw > sw.cw ? `${sw.sw}>${sw.cw}` : "no", "title:", sw.title, "h1:", sw.h1.join("|"));
    if (ax) for (const v of ax) console.log(`   axe ${v.impact} ${v.id} x${v.n} [${v.tags}]`);
  } catch (e) { console.log(p.name, "FAILED", e.message.split("\n")[0]); results[p.name] = { error: e.message.split("\n")[0] }; }
  fs.writeFileSync(outJson, JSON.stringify(results, null, 1));
}
await ctx.storageState({ path: state });
await browser.close();
