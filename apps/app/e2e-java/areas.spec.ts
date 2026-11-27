import { expect, test } from "./fixtures";
import { apiAs, createOrg, makePlatformAdmin, newPerson, rawAs, useSession, waitFor, type Person } from "./helpers";

/**
 * Browser coverage of the areas the smoke suite did not reach (review B-06b, FM-81): notifications, the 3D viewer,
 * the Library editors, the platform admin console and the setup wizard off its suggested path. Each test carries
 * `@b2b` and its area's tag for `BOQLET_BROWSER_SMOKE_FILTER`: `@b2b-notifications`, `@b2b-viewer`,
 * `@b2b-library`, `@b2b-admin`, `@b2b-wizard`.
 */
test.describe.configure({ timeout: 600_000 });

type Boq = { id: string; currentRevision: { id: string; currentRun?: { id: string; status: string } } };
type Preset = { id: string; slug: string; draft?: { id: string } | null; latestPublishedVersion?: { id: string } | null };

let owner: Person;
let org: { id: string; slug: string; name: string };
let project: { id: string };
let boq: Boq;

test.beforeAll(async () => {
  owner = await newPerson("Arya Areas");
  org = await createOrg(owner, "Areas Firm");
  project = await apiAs<{ id: string }>(owner, "POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" });
  boq = await waitFor("the sample BoQ", async () => {
    const boqs = await apiAs<Boq[]>(owner, "GET", `/projects/${project.id}/boqs`);
    const status = boqs[0]?.currentRevision.currentRun?.status;
    return status === "complete" || status === "needs_input" ? boqs[0] : undefined;
  });
});

test("F13: the bell counts what happened, opens a notification where it points and marks all read @b2b @b2b-notifications", async ({ page }) => {
  // The sample project's parse and run notify its owner.
  const listed = await waitFor("a notification", async () => {
    const page1 = await apiAs<{ items: { id: string; url: string; readAt?: string | null }[]; unreadCount: number }>(owner, "GET", "/notifications");
    return page1.unreadCount > 0 ? page1 : undefined;
  });
  await useSession(page.context(), owner);
  await page.goto(`/${org.slug}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("notification-count")).toHaveText(String(listed.unreadCount), { timeout: 60_000 });

  await page.getByTestId("notification-bell").click();
  const first = page.getByTestId("notification-item").first();
  await expect(first).toHaveAttribute("data-read", "false");
  await first.click();
  const target = listed.items.find((n) => !n.readAt)!;
  await expect(page).toHaveURL(new RegExp(target.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
  await expect.poll(async () => (await apiAs<{ unreadCount: number }>(owner, "GET", "/notifications")).unreadCount, { timeout: 30_000 })
    .toBe(listed.unreadCount - 1);

  if (listed.unreadCount > 1) {
    await page.getByTestId("notification-bell").click();
    await page.getByTestId("notifications-read-all").click();
    await expect(page.getByTestId("notification-count")).toHaveCount(0, { timeout: 30_000 });
  }
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("notification-row").first()).toBeVisible({ timeout: 60_000 });
  const unread = (await apiAs<{ unreadCount: number }>(owner, "GET", "/notifications")).unreadCount;
  await expect(page.locator('[data-testid="notification-row"][data-read="false"]')).toHaveCount(unread);
});

test("F07: the viewer draws the sample model and a model can be hidden and shown again @b2b @b2b-viewer", async ({ page }) => {
  await useSession(page.context(), owner);
  await page.goto(`/${org.slug}/projects/${project.id}/boqs/${boq.id}?tab=viewer`, { waitUntil: "domcontentloaded" });
  const viewer = page.getByTestId("viewer");
  await expect(viewer).toHaveAttribute("data-ready", "true", { timeout: 180_000 });
  const meshes = Number(await viewer.getAttribute("data-meshes"));
  expect(meshes).toBeGreaterThan(0);
  await expect(viewer).toHaveAttribute("data-visible", String(meshes));
  await expect(page.getByTestId("viewer-canvas").locator("canvas")).toBeVisible();

  const toggle = page.getByTestId("viewer-model-toggle").first();
  await toggle.click();
  await expect.poll(async () => Number(await viewer.getAttribute("data-visible")), { timeout: 30_000 }).toBeLessThan(meshes);
  await toggle.click();
  await expect(viewer).toHaveAttribute("data-visible", String(meshes), { timeout: 30_000 });
});

/** An org copy of the first system preset of `kind`: editable, with a draft. */
async function orgCopy(kind: "classification" | "rule_set", name: string): Promise<Preset> {
  const [system] = await apiAs<Preset[]>(owner, "GET", `/orgs/${org.id}/presets?kind=${kind}&layer=system`);
  const preset = await apiAs<Preset>(owner, "POST", `/orgs/${org.id}/presets`, {
    kind, name, start: { mode: "copy", fromVersionId: system!.latestPublishedVersion!.id },
  });
  return apiAs<Preset>(owner, "GET", `/presets/${preset.id}`);
}

async function draftDoc(presetId: string): Promise<Record<string, unknown>> {
  const preset = await apiAs<Preset>(owner, "GET", `/presets/${presetId}`);
  return (await apiAs<{ doc: Record<string, unknown> }>(owner, "GET", `/preset-versions/${preset.draft!.id}`)).doc;
}

test("F10 §13, review B-13: an item text reads as the engine splits it, without a preview run @b2b @b2b-library", async ({ page }) => {
  const preset = await orgCopy("classification", "Areas codes");
  await useSession(page.context(), owner);
  await page.goto(`/${org.slug}/library/classification/${preset.id}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("class-tab-codes").click();
  const box = page.getByTestId("item-text").first();
  await expect(box).toBeVisible({ timeout: 60_000 });
  await box.fill("Wall {thickness} thick, {quantity*2} {unit}");
  const reads = page.getByTestId("item-text-reads").first();
  // The engine's pieces: plain fields read as their names; an expression stays as written until a sample fills it.
  await expect(reads).toContainText("{quantity*2}", { timeout: 30_000 });
  await expect(reads).not.toContainText("{thickness}", { timeout: 30_000 });
  await expect(reads).not.toContainText("{unit}");
  await box.blur();
  const code = await box.getAttribute("data-code");
  await expect.poll(async () => {
    const doc = (await draftDoc(preset.id)) as { codeList?: { codes: { code: string; description?: string }[] } };
    return doc.codeList?.codes.find((c) => c.code === code)?.description;
  }, { timeout: 30_000 }).toBe("Wall {thickness} thick, {quantity*2} {unit}");
});

test("F10, review B-13: renaming a question's slot goes through the engine and keeps the draft valid @b2b @b2b-library", async ({ page }) => {
  const preset = await orgCopy("rule_set", "Areas rules");
  await useSession(page.context(), owner);
  await page.goto(`/${org.slug}/library/rule_set/${preset.id}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("rule-tab-advanced").click();
  await page.getByTestId("rule-tab-setup").click();
  await page.getByTestId("add-question").click();
  const stored = page.getByLabel("Stored as");
  await expect(stored).toHaveValue(/^new_question/, { timeout: 30_000 });
  const before = await stored.inputValue();
  await stored.fill("areas_depth");
  await stored.press("Tab");
  await expect.poll(async () => {
    const params = ((await draftDoc(preset.id)) as { params?: Record<string, unknown> }).params ?? {};
    return [Object.keys(params).includes("areas_depth"), Object.keys(params).includes(before)];
  }, { timeout: 60_000 }).toEqual([true, false]);
  await expect(stored).toHaveValue("areas_depth");
});

test("F19: a platform admin opens the console and an org, and leaves a note; others get not found @b2b @b2b-admin", async ({ page }) => {
  const admin = await newPerson("Ada Admin");
  await makePlatformAdmin(admin.id);
  expect((await rawAs(owner, "GET", "/admin/overview")).status).toBe(404);

  await useSession(page.context(), admin);
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-overview")).toBeVisible({ timeout: 60_000 });
  await page.goto(`/admin/orgs/${org.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-org-name")).toContainText(org.name, { timeout: 60_000 });
  const note = `Checked by the browser suite ${Date.now()}`;
  await page.getByTestId("admin-note-text").fill(note);
  await page.getByTestId("admin-note-add").click();
  await expect(page.getByTestId("admin-note").filter({ hasText: note })).toBeVisible({ timeout: 30_000 });
});

test("F16: the wizard off its suggested answers: a switch turned, a step back, published as answered @b2b @b2b-wizard", async ({ page }) => {
  const person = await newPerson("Wendy Wizard");
  const fresh = await createOrg(person, "Wizard Firm", { setupDone: false });
  await useSession(page.context(), person);
  await page.goto(`/${fresh.slug}/setup`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("setup-start-go").click();
  const wizard = page.getByTestId("setup-wizard");
  await expect(wizard).toHaveAttribute("data-step", "measure", { timeout: 60_000 });
  // The first screen ("What your BoQ includes") is switches: turn one from its suggested answer.
  const choice = page.getByTestId("setup-switch").first();
  await expect(choice).toBeVisible({ timeout: 60_000 });
  const slot = (await choice.getAttribute("data-slot"))!;
  const box = choice.locator('input[type="checkbox"]');
  const suggested = await box.isChecked();
  await box.click();
  await expect(box).toBeChecked({ checked: !suggested });
  // On, then back: the answer is kept.
  await page.getByTestId("measure-step").getByTestId("setup-next").click();
  await expect(page.locator(`[data-testid="setup-switch"][data-slot="${slot}"]`)).toHaveCount(0);
  await page.getByTestId("setup-back").click();
  await expect(page.locator(`[data-testid="setup-switch"][data-slot="${slot}"] input[type="checkbox"]`)).toBeChecked({ checked: !suggested });
  // Through the rest of the step by its progress label ("n of N"): one Next per screen, each checked.
  const progress = page.getByTestId("measure-step").locator("p.label-caps").first();
  const [, at, of] = (await progress.textContent())!.match(/(\d+)\D+(\d+)/)!.map(Number);
  for (let n = at!; n < of!; n++) {
    await page.getByTestId("measure-step").getByTestId("setup-next").click();
    await expect(progress).toHaveText(new RegExp(String.raw`\b${n + 1}\D+${of}\b`));
  }
  await page.getByTestId("measure-step").getByTestId("setup-next").click();
  await expect(wizard).toHaveAttribute("data-step", "items", { timeout: 30_000 });
  await page.getByTestId("setup-skip").click();
  await expect(wizard).toHaveAttribute("data-step", "names");
  await page.getByTestId("setup-skip").click();
  await expect(wizard).toHaveAttribute("data-step", "review");
  await expect(page.getByTestId("setup-review-row").first()).toBeVisible();
  await page.getByTestId("setup-publish-all").click();
  await expect(page.getByTestId("empty-dashboard")).toBeVisible({ timeout: 60_000 });
  // The firm's rule set is published with the answer given, not the suggested one.
  const rules = (await apiAs<Preset[]>(person, "GET", `/orgs/${fresh.id}/presets?kind=rule_set&layer=org`))[0]!;
  const version = await apiAs<{ doc: { params?: Record<string, { value?: unknown }> } }>(person, "GET", `/preset-versions/${rules.latestPublishedVersion!.id}`);
  expect(version.doc.params?.[slot]?.value).toBe(!suggested);
});
