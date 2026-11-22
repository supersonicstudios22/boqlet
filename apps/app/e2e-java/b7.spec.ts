import { expect, test } from "@playwright/test";
import { apiAs, createOrg, invitationToken, newEmail, newPerson, useSession, waitFor, type Person } from "./helpers";

/**
 * Smoke against Java: the browser parts of the test campaign's Batch 7 (the owner's answers, P54).
 * Each test carries a tag for `BOQLET_BROWSER_SMOKE_FILTER` (Playwright `-g`):
 * - `@b7-viewer`       TF-028 (Q44): a project viewer sees Questions, Log, Setup and Decisions read-only.
 * - `@b7-remove-model` TF-080 (Q50): "Remove model" archives the model and it leaves the list.
 * - `@b7-preferences`  TF-109 (Q55): the "not in the models" collapse follows the user to another browser.
 * - `@b7-setup-gate`   TF-139 (Q57): before setup is finished, org pages lead to the wizard; settings stay.
 * - `@b7-suggested`    TF-173 (Q60): a click on the preselected suggested answer saves it.
 * `@b7` runs all five.
 */

test.describe.configure({ timeout: 360_000 });

type Boq = { id: string; currentRevision: { id: string; currentRun?: { status: string } } };

async function sampleBoq(owner: Person, name: string) {
  const org = await createOrg(owner, `${name} Firm`);
  const project = await apiAs<{ id: string }>(owner, "POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" });
  const boq = await waitFor("the sample BoQ", async () => {
    const boqs = await apiAs<Boq[]>(owner, "GET", `/projects/${project.id}/boqs`);
    const status = boqs[0]?.currentRevision.currentRun?.status;
    return status === "complete" || status === "needs_input" ? boqs[0] : undefined;
  });
  return { org, projectId: project.id, boq, url: `/${org.slug}/projects/${project.id}/boqs/${boq.id}` };
}

test("TF-028: a project viewer sees Questions, Log, Setup and Decisions, with nothing to change @b7 @b7-viewer", async ({ page }) => {
  const owner = await newPerson("Vera Owner");
  const { org, projectId, url } = await sampleBoq(owner, "Viewer");
  const email = newEmail("viewer");
  await apiAs(owner, "POST", `/orgs/${org.id}/invitations`, { email, role: "member" });
  const viewer = await newPerson("Vic Viewer", email);
  await apiAs(viewer, "POST", `/invitations/${await invitationToken(email)}/accept`);
  await apiAs(owner, "POST", `/projects/${projectId}/members`, { userId: viewer.id, role: "viewer" });
  await useSession(page.context(), viewer);

  await page.goto(`${url}?tab=questions`);
  await expect(page.getByTestId("questions-tab")).toBeVisible();
  await expect(page.getByTestId("question-row").first()).toBeVisible();
  await expect(page.getByTestId("answer-control")).toHaveCount(0);
  await expect(page.getByTestId("dismiss")).toHaveCount(0);
  await expect(page.getByTestId("question-select").first()).toBeDisabled();
  await page.getByTestId("tab-log").click();
  await expect(page.getByTestId("tab-log")).toHaveAttribute("aria-current", "page");
  await page.getByTestId("tab-setup").click();
  await expect(page.getByTestId("rule-set-select")).toBeDisabled();
  await page.goto(`/${org.slug}/projects/${projectId}/decisions`);
  await expect(page.getByTestId("decisions-page")).toBeVisible();
  await expect(page.getByTestId("decision-edit")).toHaveCount(0);
  await expect(page.getByTestId("decision-clear")).toHaveCount(0);
});

test("TF-080: \"Remove model\" archives the model and the models list no longer shows it @b7 @b7-remove-model", async ({ page }) => {
  const owner = await newPerson("Rita Remover");
  const org = await createOrg(owner, "Remove Firm");
  const project = await apiAs<{ id: string }>(owner, "POST", `/orgs/${org.id}/projects`, { name: "Remove project" });
  const model = await apiAs<{ id: string }>(owner, "POST", `/projects/${project.id}/models`, { name: "Old facade", discipline: "detect" });
  await useSession(page.context(), owner);
  const list = `/${org.slug}/projects/${project.id}/models`;
  await page.goto(`${list}/${model.id}`);
  await page.getByTestId("remove-model").click();
  await page.getByTestId("remove-model-confirm").click();
  await expect(page).toHaveURL(new RegExp(`${list}$`));
  await expect(page.getByTestId("models-list")).toBeVisible();
  await expect(page.getByTestId("model-Old facade")).toHaveCount(0);
  const models = await apiAs<{ id: string }[]>(owner, "GET", `/projects/${project.id}/models`);
  expect(models.map((m) => m.id)).not.toContain(model.id);
});

test("TF-109: collapsing the \"not in the models\" notice follows the user to a fresh browser @b7 @b7-preferences", async ({ page, browser }) => {
  const owner = await newPerson("Pia Preferences");
  const { url } = await sampleBoq(owner, "Preferences");
  await useSession(page.context(), owner);
  await page.goto(url);
  const notice = page.getByTestId("not-in-models");
  await expect(notice).toHaveAttribute("data-collapsed", "false");
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/me") && r.request().method() === "PATCH");
  await page.getByTestId("not-in-models-toggle").click();
  await expect(notice).toHaveAttribute("data-collapsed", "true");
  expect((await saved).ok()).toBe(true);

  const other = await browser.newContext();
  try {
    const page2 = await other.newPage();
    await useSession(other, owner);
    await page2.goto(url);
    await expect(page2.getByTestId("not-in-models")).toHaveAttribute("data-collapsed", "true");
  } finally {
    await other.close();
  }
});

test("TF-139: before setup is finished, org pages lead to the wizard; the settings stay open @b7 @b7-setup-gate", async ({ page }) => {
  const owner = await newPerson("Gus Gate");
  const org = await createOrg(owner, "Gate Firm", { setupDone: false });
  await useSession(page.context(), owner);
  for (const path of ["", "/projects", "/library", "/library/rule_set/new"]) {
    await page.goto(`/${org.slug}${path}`);
    await expect(page, path || "/").toHaveURL(new RegExp(`/${org.slug}/setup$`));
  }
  await page.goto(`/${org.slug}/settings/general`);
  await expect(page.getByTestId("settings-name")).toHaveValue("Gate Firm");
  await expect(page).toHaveURL(new RegExp(`/${org.slug}/settings/general$`));
});

test("TF-173: a click on the preselected suggested answer saves it @b7 @b7-suggested", async ({ page }) => {
  const owner = await newPerson("Sam Suggested");
  const { url } = await sampleBoq(owner, "Suggested");
  await useSession(page.context(), owner);
  await page.goto(`${url}?tab=questions`);
  // An open question whose answer is a choice with the suggestion already checked.
  const row = page.locator('[data-testid="question-row"][data-answered="false"]').filter({ has: page.locator('[data-testid="answer-control"] input[type="radio"]:checked') }).first();
  await expect(row).toBeVisible();
  const id = await row.getAttribute("data-question-id");
  const saved = page.waitForResponse((r) => /\/api\/v1\/projects\/[^/]+\/decisions$/.test(r.url()) && r.request().method() === "POST");
  await row.locator('[data-testid="answer-control"] input[type="radio"]:checked').click();
  expect((await saved).ok()).toBe(true);
  await expect(page.locator(`[data-testid="question-row"][data-question-id="${id}"]`)).toHaveAttribute("data-answered", "true");
});
