/**
 * Sessions against Java (F01 §10, BR-54). Java checks every request: it needs the cookie of the
 * account's active session, sent with the bearer token of the browser that opened it.
 *
 * A person signed up by the suites (`suite.signup.<email>`) can have several browsers: the token
 * `suite.signup.<email>.<browser>` is the same person in another browser (Java's test token
 * decoder gives it the same subject and its own provider session). So:
 * - `POST /sessions` with the person's own token signs in from a new browser; the session it
 *   opens is remembered with that browser, and `inSession(person, sessionId)` returns it;
 * - every other request with the person's own token uses a background browser whose session is
 *   opened on first use.
 * The seeded people (BOQLET_JAVA_SUITE_USERS) come with their session open.
 */
interface Browser {
  bearer: string;
  cookie: string;
}

const SIGN_UP = "suite.signup.";
const apiUrl = () => (process.env.API_URL ?? "http://localhost:4010/api/v1").replace(/\/$/, "");

const browsers = new Map<string, Browser>();
const browserOfSession = new Map<string, string>();
let opened = 0;

export const isSignUpToken = (token: string) => token.startsWith(SIGN_UP) && token.split(".").length === 3;
const isBrowserToken = (token: string) => token.startsWith(SIGN_UP) && token.split(".").length > 3;

export function remember(token: string, cookie: string) {
  browsers.set(token, { bearer: token, cookie });
}

/** The person in the browser that opened `sessionId` (after its `POST /sessions`). */
export function browserOf(sessionId: string): string {
  const token = browserOfSession.get(sessionId);
  if (!token) throw new Error(`no browser opened session ${sessionId} in this run`);
  return token;
}

/** A browser nobody has used yet, for the person's next sign-in. */
export function newBrowser(token: string): string {
  return `${token}.b${++opened}${Math.random().toString(36).slice(2, 6)}`;
}

/** Records the session a browser opened (the 201 of `POST /sessions`). */
export function opened201(browser: string, sessionId: string, setCookie: string | null) {
  const cookie = setCookie?.split(";")[0];
  if (!cookie) return;
  browsers.set(browser, { bearer: browser, cookie });
  browserOfSession.set(sessionId, browser);
}

/** Bearer and cookie for a request as `token`, opening the background browser's session if needed. */
export async function credentials(token: string): Promise<Browser | { bearer: string; cookie?: undefined }> {
  const known = browsers.get(token);
  if (known) return known;
  if (!isSignUpToken(token)) return { bearer: token };
  const bearer = `${token}.suite`;
  const res = await fetch(`${apiUrl()}/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceLabel: "Shared scenario suite" }),
  });
  if (res.status !== 201) throw new Error(`opening the suite's session answered ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("opening the suite's session set no cookie");
  const browser = { bearer, cookie };
  browsers.set(token, browser);
  return browser;
}

/** Whether `token` is one browser of a person (reuses its own session on `POST /sessions`). */
export const isBrowser = isBrowserToken;
