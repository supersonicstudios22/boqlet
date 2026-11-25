import { expect, test } from "./fixtures";
import { createOrg, newAccount, rawAs, signInApi, signInWithForm } from "./helpers";

/**
 * Smoke against Java: one active session per account (F01 §10, F01-AC5) with native sign-in. The
 * second browser is asked before it takes over; the first hears `session.revoked` live (SSE through
 * the app) and shows why it was signed out.
 */

test("F01-AC5: a second browser is asked first; not continuing changes nothing, continuing signs the first out within 5 s", async ({ page, browser }) => {
  const { email } = await newAccount("Two Browsers");
  // An org, so the first browser sits on a dashboard with its live connection.
  const setup = { session: await signInApi(email) };
  await createOrg(setup, "Two Browser Firm");
  expect((await rawAs(setup, "DELETE", "/sessions/current")).status).toBe(204);

  await page.goto("/sign-in");
  await signInWithForm(page, email);
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "open");

  // Second browser: Java answers that a session is active; the form asks before taking over.
  const second = await browser.newContext();
  const other = await second.newPage();
  await other.goto("/sign-in");
  await signInWithForm(other, email, { expectConflict: true });
  await expect(other.locator('main [role="alert"]')).toBeVisible();
  // TF-113: the question says where the other session is and when it was last active, and can be cancelled.
  await expect(other.getByTestId("takeover-question")).toContainText("You're signed in on Web browser, last active");
  await expect(other.getByTestId("takeover-cancel")).toBeVisible();
  expect((await second.cookies()).filter((c) => c.name === "boqlet_session")).toHaveLength(0);

  // Not continuing: the first browser goes on as it was.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-session", "active");
  await expect(page.getByTestId("user-name")).toHaveText("Two Browsers");
  await expect(page.getByTestId("signed-out-reason")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "open");

  // Continuing: the second is in, the first shows why it was signed out, within 5 s.
  await other.locator('button[type="submit"]').click();
  await expect(other.locator("html")).toHaveAttribute("data-session", "active");
  const continued = Date.now();
  await expect(page.getByTestId("signed-out-reason")).toHaveText("You were signed out because your account was opened on another device.", { timeout: 5_000 });
  expect(Date.now() - continued).toBeLessThan(5_000);
  await expect(page).toHaveURL(/\/sign-in/);
  // Said once, above the native form.
  await expect(page.getByText("You were signed out because your account was opened on another device.")).toHaveCount(1);
  // Its cookie no longer opens anything.
  const [stale] = (await page.context().cookies()).filter((c) => c.name === "boqlet_session");
  if (stale) expect((await rawAs({ session: stale.value }, "GET", "/me")).body.code).toBe("session_replaced");
  await second.close();
});
