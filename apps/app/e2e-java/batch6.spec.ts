import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, APP, apiAs, createOrg, newPerson, useSession, waitFor, type Person } from "./helpers";

/**
 * Smoke against Java: the browser parts of the test campaign's Batch 6 (the API parts are in
 * tests/scenarios). Each test carries a tag for `BOQLET_BROWSER_SMOKE_FILTER` (Playwright `-g`):
 * - `@b6-limits`   TF-005, TF-101: a Free org's limit dialog and its upgrade path; plan-gated toggles.
 * - `@b6-versions` TF-100: "new version available", "Use" the newer model version, the change report's Excel.
 * - `@b6-sse`      TF-186: while the event stream is down a run finishes; after the reconnect
 *                  (Last-Event-ID) its notification is replayed to the page.
 * `@b6` runs all three.
 */

test.describe.configure({ timeout: 360_000 });

type Boq = { id: string; name: string; currentRevision: { id: string; currentRun?: { status: string } } };

async function sampleBoq(name: string): Promise<{ owner: Person; org: { id: string; slug: string }; projectId: string; boq: Boq; url: string }> {
  const owner = await newPerson(name);
  const org = await createOrg(owner, `${name} Firm`);
  const project = await apiAs<{ id: string }>(owner, "POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" });
  const boq = await waitFor("the sample BoQ", async () => {
    const boqs = await apiAs<Boq[]>(owner, "GET", `/projects/${project.id}/boqs`);
    const status = boqs[0]?.currentRevision.currentRun?.status;
    return status === "complete" || status === "needs_input" ? boqs[0] : undefined;
  });
  return { owner, org, projectId: project.id, boq, url: `/${org.slug}/projects/${project.id}/boqs/${boq.id}` };
}

test("TF-005, TF-101: on Free, a plan limit opens the limit dialog with the way to upgrade; plan-gated toggles are off with the reason @b6 @b6-limits", async ({ page }) => {
  const owner = await newPerson("Fran Free");
  const org = await createOrg(owner, "Free Firm");
  // Free allows one active project (sample projects don't count).
  await apiAs(owner, "POST", `/orgs/${org.id}/projects`, { name: "The one project" });
  await useSession(page.context(), owner);

  await page.goto(`/${org.slug}/projects/new`);
  await page.getByTestId("project-name").fill("One too many");
  const refused = page.waitForResponse((r) => r.url().endsWith(`/orgs/${org.id}/projects`) && r.request().method() === "POST");
  await page.getByTestId("create-project").click();
  expect((await refused).status()).toBe(402);
  await expect(page.getByTestId("limit-dialog")).toBeVisible();
  // The limit in words (TF-098/TF-129), and the owner's way out: the billing page.
  await expect(page.getByTestId("limit-detail")).toHaveText("Active projects: 1 of 1 in use.");
  const upgrade = page.getByTestId("limit-upgrade");
  await expect(upgrade).toHaveAttribute("href", `/${org.slug}/settings/billing`);
  await upgrade.click();
  await expect(page).toHaveURL(new RegExp(`/${org.slug}/settings/billing$`));

  // Review and approval isn't in Free: its switch can't be turned on, and says why (TF-098, TF-101).
  await page.goto(`/${org.slug}/settings/general`);
  await expect(page.locator("#org-approval")).toBeDisabled();
  await expect(page.getByTestId("org-approval-not-in-plan")).toBeVisible();
  await expect(page.locator("#org-four-eyes")).toBeDisabled();
  // Share links are in Free: that switch works.
  await expect(page.locator("#org-links")).toBeEnabled();
});

test("TF-100: a newer model version is offered on the BoQ, \"Use\" takes it, and the change report's Excel downloads @b6 @b6-versions", async ({ page }) => {
  const { owner, projectId, boq, url } = await sampleBoq("Vera Versions");
  // The working version is saved as A, so the Changes tab compares against it.
  await apiAs(owner, "POST", `/revisions/${boq.currentRevision.id}/issue`, { label: "A", notModelledConfirmed: true });

  // Duplex v2 uploaded as the model's next version (through the API, as the browser would).
  const [model] = await apiAs<{ id: string; name: string }[]>(owner, "GET", `/projects/${projectId}/models`);
  const bytes = await readFile(path.resolve(__dirname, "../../../fixtures/ifc/Ifc2x3_Duplex_Architecture_v2.ifc"));
  const staged = await apiAs<{ version: { id: string }; upload: { method: string; url: string; headers?: Record<string, string> } }>(owner, "POST", `/models/${model!.id}/versions`, {
    fileName: "Ifc2x3_Duplex_Architecture_v2.ifc",
    sizeBytes: bytes.byteLength,
  });
  const put = await fetch(staged.upload.url, { method: staged.upload.method, headers: { ...(staged.upload.headers ?? {}), Origin: APP }, body: bytes });
  expect(put.ok).toBe(true);
  await apiAs(owner, "POST", `/model-versions/${staged.version.id}/complete`, {});
  await waitFor("v2 parsed", async () => ((await apiAs<{ status: string }>(owner, "GET", `/model-versions/${staged.version.id}`)).status === "ready" ? true : undefined));

  await useSession(page.context(), owner);
  await page.goto(url);
  await expect(page.getByTestId("new-model-version")).toBeVisible();
  await page.getByTestId(`use-newer-version-${model!.name}`).click();
  await expect(page.getByTestId("new-model-version")).toHaveCount(0);
  const oldRun = (await page.getByTestId("current-run").getAttribute("data-run"))!;
  await page.getByTestId("generate").click();
  await expect(page.getByTestId("current-run")).not.toHaveAttribute("data-run", oldRun, { timeout: 180_000 });
  await expect(page.getByTestId("boq-header")).toHaveAttribute("data-state", /complete|needs_input/, { timeout: 180_000 });

  // The change report against A, and its Excel.
  await page.getByTestId("tab-changes").click();
  await expect(page.getByTestId("changes-report")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("change-element").first()).toBeVisible();
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByTestId("changes-export").click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
});

/** The newest event id the API has for this person (its replay of the last minutes), read straight from Java. */
async function lastEventId(person: Person): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(`${API}/api/v1/events`, { headers: { Cookie: `boqlet_session=${person.session}`, Accept: "text/event-stream", "Last-Event-ID": "0" }, signal: controller.signal });
  const reader = res.body!.getReader();
  let text = "";
  const until = Date.now() + 2_000;
  while (Date.now() < until) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), until - Date.now()))]);
    if (!chunk || chunk.done) break;
    text += new TextDecoder().decode(chunk.value);
  }
  controller.abort();
  const ids = [...text.matchAll(/^id:\s*(\S+)/gm)].map((m) => m[1]!);
  return ids.at(-1) ?? "0";
}

test("TF-186: events sent while the stream was down are replayed after the reconnect (Last-Event-ID), with no gap @b6 @b6-sse", async ({ page }) => {
  const { owner, boq, url } = await sampleBoq("Gil Gap");
  const resumeFrom = await lastEventId(owner);
  // 1. The page's first stream ends at once at the newest event; 2. then the API "is down" (every
  // reconnect fails) while a run is generated; 3. then it is back.
  let phase: "first" | "down" | "up" = "first";
  const reconnects: (string | null)[] = [];
  await page.route("**/api/v1/events", async (route) => {
    if (phase === "first") {
      phase = "down";
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `id: ${resumeFrom}\n\n` });
    }
    if (phase === "down") return route.abort();
    reconnects.push(route.request().headers()["last-event-id"] ?? null);
    return route.continue();
  });
  await useSession(page.context(), owner);
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "retrying", { timeout: 15_000 });

  // While the stream is down: a run is generated and finishes (its notification is an SSE event).
  const started = await apiAs<{ run: { id: string } }>(owner, "POST", `/revisions/${boq.currentRevision.id}/runs`);
  await waitFor("the run", async () => {
    const run = await apiAs<{ status: string }>(owner, "GET", `/runs/${started.run.id}`);
    return run.status === "complete" || run.status === "needs_input" ? run : undefined;
  });
  phase = "up";

  // The client resumes from the last id it had, and the run's notification, sent while it was away,
  // arrives as a toast: only the replayed event can show it (refetches don't make toasts).
  await expect.poll(() => reconnects[0], { timeout: 30_000 }).toBe(resumeFrom);
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "open");
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: `${boq.name} is generated` })).toBeVisible({ timeout: 15_000 });
});
