import { expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Helpers of the browser smoke suite against Java (playwright.java.config.ts). People sign up with a
 * native setup link (P50) the way the pilot issues them (`/_test/setup-link`); API calls go straight
 * to Java with the session cookie and the app's Origin, which Java requires on every change.
 */

export const API = process.env.BOQLET_JAVA_API!;
export const APP = new URL(process.env.BOQLET_JAVA_APP ?? "http://localhost:3100").origin;
const MAILHOG = process.env.BOQLET_SUITE_MAILHOG!;
export const PASSWORD = "a long smoke test password 2026";
const COOKIE = "boqlet_session";

export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const newEmail = (prefix: string) => `${unique(prefix)}@example.test`;

export interface Person {
  id: string;
  name: string;
  email: string;
  /** The session cookie's value. */
  session: string;
}

async function testCall<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${API}/_test${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`/_test${path} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** A setup link's token, as `ops/pilot/issue-setup-link.sh` issues it (for `/sign-up?token=`). */
export async function setupLink(email: string, purpose: "setup" | "reset" = "setup"): Promise<string> {
  return (await testCall<{ token: string }>("/setup-link", { email, purpose })).token;
}

/** One address signs in many people here; Java's per-source sign-in limit is for people. */
export const resetAuthLimits = () => testCall("/auth-limits/reset");

async function call(method: string, path: string, opts: { session?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { Origin: APP };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.session) headers.Cookie = `${COOKIE}=${opts.session}`;
  return fetch(`${API}/api/v1${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

/** A JSON call to Java as `person`; throws unless it succeeds. */
export async function apiAs<T>(person: Pick<Person, "session">, method: string, path: string, body?: unknown): Promise<T> {
  const res = await call(method, path, { session: person.session, body });
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** The raw response of a call as `person`, for refusals. */
export async function rawAs(person: Pick<Person, "session">, method: string, path: string, body?: unknown) {
  const res = await call(method, path, { session: person.session, body });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: Record<string, unknown> } };
}

/** An account with a password, from a setup link, without signing in. */
export async function newAccount(name: string, email = newEmail("person")): Promise<{ name: string; email: string }> {
  await resetAuthLimits();
  const token = await setupLink(email);
  const res = await call("POST", "/auth/set-password", { body: { token, password: PASSWORD, name } });
  if (res.status !== 204) throw new Error(`set-password answered ${res.status}: ${await res.text()}`);
  return { name, email };
}

/** Signs in through the API (native sign-in): the new session's cookie. */
export async function signInApi(email: string, takeover = false): Promise<string> {
  await resetAuthLimits();
  const res = await call("POST", "/auth/sign-in", { body: { email, password: PASSWORD, takeover, deviceLabel: "Smoke API" } });
  if (res.status !== 201) throw new Error(`sign-in answered ${res.status}: ${await res.text()}`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`));
  if (!cookie) throw new Error("sign-in set no session cookie");
  expect(cookie).toMatch(/HttpOnly/i);
  return cookie.slice(COOKIE.length + 1).split(";")[0]!;
}

/** A new person with a password and an open session (through the API). */
export async function newPerson(name: string, email = newEmail("person")): Promise<Person> {
  await newAccount(name, email);
  const session = await signInApi(email);
  const me = await apiAs<{ user: { id: string } }>({ session }, "GET", "/me");
  return { id: me.user.id, name, email, session };
}

/** The browser context carries `person`'s session cookie (signed in without the form). */
export async function useSession(context: BrowserContext, person: Person) {
  await context.addCookies([{ name: COOKIE, value: person.session, domain: new URL(APP).hostname, path: "/api/v1", httpOnly: true, sameSite: "Lax" }]);
}

/**
 * An org owned by `person`, with the setup wizard (F16) finished unless `setupDone: false`. Free has
 * one seat (P57): the org gets `seats` (default 25) as an override so colleagues can be invited;
 * `seats: null` keeps Free's.
 */
export async function createOrg(person: Pick<Person, "session">, name: string, opts: { setupDone?: boolean; seats?: number | null } = {}): Promise<{ id: string; slug: string; name: string }> {
  const slug = unique("smoke").toLowerCase();
  const org = await apiAs<{ id: string; slug: string }>(person, "POST", "/orgs", { name, slug });
  if (opts.setupDone !== false) await apiAs(person, "PUT", `/orgs/${org.id}/setup`, { status: "done", step: "review" });
  if (opts.seats !== null) await testCall("/seats", { orgId: org.id, seats: opts.seats ?? 25 });
  return { ...org, name };
}

/** Opens or closes public sign-up (P57), as the platform admin's setting does. */
export const setPublicSignUp = (open: boolean) => testCall("/public-sign-up", { open });

type SignInOptions = {
  /** Java answers that the account is open elsewhere: the form now offers to take over. */
  expectConflict?: boolean;
  /** Where the sign-in leads when that isn't a signed-in page (which opens the app's session). */
  landing?: RegExp;
};

/**
 * The page's React runs (`<html data-hydrated>`, set by the app). A form filled before that is
 * reset by hydration or submitted natively (TF-188): wait for it after every full page load.
 */
export async function hydrated(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true", { timeout: 60_000 });
}

/**
 * Content-Security-Policy violations in a browser context (review A-38): every page of it reports them to the list,
 * from the `securitypolicyviolation` event, whether the policy enforces or only reports. Call before opening pages.
 */
export async function cspViolations(context: BrowserContext): Promise<string[]> {
  const seen: string[] = [];
  await context.exposeBinding("__cspViolation", (_source, text: string) => void seen.push(text));
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __cspViolation: (t: string) => void }).__cspViolation(`${e.effectiveDirective} blocked ${e.blockedURI} on ${location.pathname}`);
    });
  });
  return seen;
}

/** Fills the native sign-in form and waits until the app's session is open (or the takeover question). */
export async function signInWithForm(page: Page, email: string, opts: SignInOptions = {}) {
  await resetAuthLimits();
  await hydrated(page);
  await expect(page.locator('input[name="password"]')).toBeVisible();
  const field = page.locator('input[name="email"]');
  if ((await field.inputValue()) !== email) await field.fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  if (opts.expectConflict) {
    await expect(page.locator('button[type="submit"]')).toHaveText("End the other session and sign in");
    return;
  }
  if (opts.landing) await expect(page).toHaveURL(opts.landing);
  else await expect(page.locator("html")).toHaveAttribute("data-session", "active");
  await skipSplash(page);
}

/** The logo animation after a sign-in covers the page for ~5 s: skipped with a click, as a person may. */
export async function skipSplash(page: Page) {
  const splash = page.getByTestId("splash");
  if (await splash.isVisible()) await splash.click().catch(() => {});
  await expect(splash).toHaveCount(0);
}

/** Sets the password on the native sign-up page (a setup link or an invitation) and signs in. */
export async function setPasswordWithForm(page: Page, name: string, email: string, opts: SignInOptions = {}) {
  await resetAuthLimits();
  await hydrated(page);
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/sign-in\?/);
  await signInWithForm(page, email, opts);
}

/** The links in the mails Java has sent to `email` (MailHog), once its outbox has sent what's due. */
export async function mailLinks(email: string): Promise<string[]> {
  await testCall("/mail/settle");
  const res = await fetch(`${MAILHOG}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`);
  const mails = (await res.json()) as { items: { Content: { Body: string } }[] };
  // Quoted-printable: soft line breaks and `=3D`.
  const bodies = mails.items.map((m) => m.Content.Body.replace(/=\r?\n/g, "").replace(/=3D/gi, "="));
  return bodies.flatMap((b) => b.match(/https?:\/\/[^\s"'<>]+/g) ?? []);
}

/** The invitation token in the newest invitation mail to `email`. */
export async function invitationToken(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const token = (await mailLinks(email)).map((l) => /\/invite\/([A-Za-z0-9_-]{43})/.exec(l)?.[1]).find(Boolean);
    if (token) return token;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no invitation mail to ${email}`);
}

/** Polls until `check` returns a value (not undefined). */
export async function waitFor<T>(what: string, check: () => Promise<T | undefined>, timeoutMs = 180_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
