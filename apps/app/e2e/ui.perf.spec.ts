import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { emit, generatedDuplexBoq, signInAs } from "./helpers";

/**
 * TS-002, FE-045 (nfr.md "API and UI"): first contentful paint of the app shell (warm), the Duplex
 * viewer to interactive (warm), picking in the viewer, and a live update from the event to the UI.
 * The targets hold against a production build (`E2E_PRODUCTION=1`: `next build` with
 * `API_PROXY_TARGET`, then `next start` on the app port); under `next dev` they are loose regression
 * bounds, as in `sheet.perf.spec.ts`. With `PERF_OUT=<file>` each measurement is appended as a JSON
 * line for the NFR table.
 */
const PRODUCTION = process.env.E2E_PRODUCTION === "1";
const target = (production: number, dev: number) => (PRODUCTION ? production : dev);
const DUPLEX = path.resolve(__dirname, "..", "..", "..", "fixtures", "ifc", "Ifc2x3_Duplex_Architecture.ifc");
test.describe.configure({ timeout: 300_000 });

async function record(name: string, ms: number, targetMs: number) {
  console.log(`[perf] ${name}: ${Math.round(ms)} ms (target ${targetMs} ms${PRODUCTION ? "" : ", next dev bound"})`);
  if (process.env.PERF_OUT) await appendFile(process.env.PERF_OUT, JSON.stringify({ name, ms: Math.round(ms), target: targetMs, production: PRODUCTION }) + "\n");
}

/**
 * Clicks points on the canvas until one picks an element; the time from that click's pointerdown to
 * the element's panel in the DOM, measured in the page (no test-runner round trips). -1: nothing hit.
 */
async function pickLatency(page: Page): Promise<number> {
  const box = (await page.getByTestId("viewer-canvas").boundingBox())!;
  let picked = -1;
  for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.4, 0.5], [0.6, 0.5], [0.5, 0.6], [0.5, 0.4]]) {
    await page.evaluate(() => {
      const w = window as unknown as { __pick?: Promise<number> };
      w.__pick = new Promise<number>((resolve) => {
        let down = 0;
        addEventListener("pointerdown", () => (down = performance.now()), { capture: true, once: true });
        const seen = new MutationObserver(() => {
          if (down && document.querySelector('[data-testid="viewer-element"]')) {
            seen.disconnect();
            resolve(performance.now() - down);
          }
        });
        seen.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => (seen.disconnect(), resolve(-1)), 2000);
      });
    });
    await page.mouse.click(box.x + box.width * fx!, box.y + box.height * fy!);
    picked = await page.evaluate(() => (window as unknown as { __pick: Promise<number> }).__pick);
    if (picked >= 0) break;
  }
  return picked;
}

const fcp = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const now = performance.getEntriesByName("first-contentful-paint")[0];
        if (now) return resolve(now.startTime);
        new PerformanceObserver((list) => resolve(list.getEntriesByName("first-contentful-paint")[0]!.startTime)).observe({ type: "paint", buffered: true });
      }),
  );

test("nfr: first contentful paint of the app shell, warm, ≤ 1.5 s", async ({ page }) => {
  await signInAs(page, "olivia");
  await page.goto("/studio-demo");
  await expect(page.getByRole("navigation").first()).toBeVisible();
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.goto("/studio-demo");
    samples.push(await fcp(page));
  }
  const worst = Math.max(...samples);
  const limit = target(1500, 5000);
  await record("FCP app shell (warm, worst of 5)", worst, limit);
  expect(worst).toBeLessThanOrEqual(limit);
});

test("nfr: the Duplex viewer is interactive ≤ 3 s warm; picking ≤ 100 ms", async ({ page }) => {
  const { url } = await generatedDuplexBoq(new Uint8Array(await readFile(DUPLEX)));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInAs(page, "olivia");
  await page.goto(`${url}?tab=viewer`);
  await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true", { timeout: 120_000 });

  // Warm: the same view again, timed from navigation to every model loaded.
  const start = Date.now();
  await page.goto(`${url}?tab=viewer`);
  await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  const ready = Date.now() - start;
  const readyLimit = target(3000, 10_000);
  await record("Viewer Duplex interactive (warm)", ready, readyLimit);
  expect(ready).toBeLessThanOrEqual(readyLimit);

  const picked = await pickLatency(page);
  expect(picked, "a click on the canvas picks an element").toBeGreaterThanOrEqual(0);
  const pickLimit = target(100, 500);
  await record("Viewer picking (Duplex)", picked, pickLimit);
  expect(picked).toBeLessThanOrEqual(pickLimit);
});

test("nfr: a live update reaches the UI ≤ 2 s after the event", async ({ page }) => {
  const marko = await signInAs(page, "marko");
  await page.goto("/studio-demo");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "open");
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const refetch = page.waitForResponse((r) => r.url().endsWith("/api/v1/me"));
    const t0 = Date.now();
    await emit("entity.changed", { entityType: "user", entityId: marko.id, change: "updated" }, [marko.id]);
    await refetch;
    samples.push(Date.now() - t0);
  }
  const worst = Math.max(...samples);
  await record("Live update, event to refetched data (worst of 5)", worst, 2000);
  expect(worst).toBeLessThanOrEqual(2000);
});

/**
 * nfr.md "Viewer: 50k elements ≤ 15 s to interactive; picking ≤ 100 ms", on a large model given by
 * `PERF_VIEWER_IFC` (not in the repository; TS-002 used the NBU Medical Clinic MEP model, 16,012
 * elements, docs/12). Skipped without it. Parsing it through the mock takes minutes.
 */
test("nfr: a large model in the viewer is interactive ≤ 15 s; picking ≤ 100 ms", async ({ page }) => {
  const artifacts = process.env.PERF_VIEWER_GLB && process.env.PERF_VIEWER_SCENE;
  test.skip(!process.env.PERF_VIEWER_IFC && !artifacts, "PERF_VIEWER_IFC names the large model (or PERF_VIEWER_GLB and PERF_VIEWER_SCENE its parse output)");
  test.setTimeout(1_800_000);
  // With the parse output at hand, a Duplex BoQ is shown with the large model's geometry and scene in
  // place of its own (no parse; the coverage colours then find no lines, which costs nothing).
  const { url } = artifacts
    ? await generatedDuplexBoq(new Uint8Array(await readFile(DUPLEX)), ["acme-cost-codes"])
    : await generatedDuplexBoq(new Uint8Array(await readFile(process.env.PERF_VIEWER_IFC!)), ["acme-cost-codes"], {}, { parseMs: 1_500_000, runMs: 300_000 });
  if (artifacts) {
    const glb = await readFile(process.env.PERF_VIEWER_GLB!);
    const scene = await readFile(process.env.PERF_VIEWER_SCENE!);
    await page.route("**/api/v1/model-versions/*/geometry", (route) => route.fulfill({ body: glb, contentType: "model/gltf-binary" }));
    await page.route("**/api/v1/model-versions/*/scene", (route) => route.fulfill({ body: scene, contentType: "application/json" }));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInAs(page, "olivia");
  const start = Date.now();
  await page.goto(`${url}?tab=viewer`);
  await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true", { timeout: 120_000 });
  const ready = Date.now() - start;
  const meshes = await page.getByTestId("viewer").getAttribute("data-meshes");
  const marks = await page.evaluate(() => {
    const at = (prefix: string) => performance.getEntriesByType("mark").find((m) => m.name.startsWith(prefix))?.startTime ?? NaN;
    const load = at("viewer:load:");
    return { untilLoad: Math.round(load), parse: Math.round(at("viewer:parsed:") - load), meshes: Math.round(at("viewer:meshes:") - at("viewer:parsed:")), fit: Math.round(at("viewer:drawn:") - at("viewer:meshes:")), firstFrame: Math.round(at("viewer:frame:") - at("viewer:drawn:")) };
  });
  console.log(`[perf] viewer breakdown (ms): ${JSON.stringify(marks)}`);
  const picked = await pickLatency(page);
  expect(picked, "a click on the canvas picks an element").toBeGreaterThanOrEqual(0);
  await record(`Viewer picking (${meshes} meshes)`, picked, target(100, 500));
  expect(picked).toBeLessThanOrEqual(target(100, 500));
  await record(`Viewer large model interactive (cold, ${meshes} meshes)`, ready, target(15_000, 30_000));
  expect(ready).toBeLessThanOrEqual(target(15_000, 30_000));
});
