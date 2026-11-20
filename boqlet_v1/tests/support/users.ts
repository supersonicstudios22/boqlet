import { API_URL, ROOT_URL, TARGET } from "./env";

/**
 * Seeded people (mock-api.md "Seed data"), by first name. How a suite gets a token depends on the
 * backend: the mock lists its users at `/_dev/users` (token `mock:<userId>`); the Java backend
 * gets its own strategy here after the auth decision (BE-000), and the tests don't change.
 */
export type SeedUser = "olivia" | "ivana" | "marko" | "ana" | "victor" | "pat";

export interface TestUser {
  id: string;
  name: string;
  email: string;
  token: string;
}

let cache: Promise<TestUser[]> | null = null;

interface JavaUser extends TestUser {
  cookie: string;
}

const javaUsers: JavaUser[] = TARGET === "java" && process.env.BOQLET_JAVA_SUITE_USERS
  ? JSON.parse(process.env.BOQLET_JAVA_SUITE_USERS)
  : [];

export function testSessionCookie(token?: string | null) {
  return javaUsers.find((user) => user.token === token)?.cookie;
}

async function mockUsers(): Promise<TestUser[]> {
  const res = await fetch(`${ROOT_URL}/_dev/users`);
  if (!res.ok) throw new Error(`/_dev/users answered ${res.status}`);
  return (await res.json()) as TestUser[];
}

export async function user(key: SeedUser): Promise<TestUser> {
  if (TARGET === "mock") cache ??= mockUsers();
  else if (TARGET === "java") cache ??= Promise.resolve(javaUsers);
  else throw new Error(`Unknown test target ${TARGET}`);
  const found = (await cache).find((u) => u.email.startsWith(`${key}@`));
  if (!found) throw new Error(`seeded user ${key} not found`);
  return found;
}

/**
 * A new person, as if they signed up (F01). Mock: `POST /_dev/users`. Java: the test-only
 * `POST /_test/users` (registered only by the Java suite test, never in a build) creates the
 * account with a test token (`suite.signup.<base64url email>`), then the person opens their session like the app
 * does (`POST /sessions`) and keeps its cookie.
 */
export async function signUp(name: string, email: string): Promise<TestUser> {
  if (TARGET === "mock") {
    const res = await fetch(`${ROOT_URL}/_dev/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email }) });
    if (!res.ok) throw new Error(`sign-up answered ${res.status}`);
    return (await res.json()) as TestUser;
  }
  if (TARGET !== "java") throw new Error(`no sign-up strategy for target ${TARGET}`);
  const res = await fetch(`${ROOT_URL}/_test/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email }) });
  if (!res.ok) throw new Error(`/_test/users answered ${res.status}`);
  const created = (await res.json()) as TestUser;
  const session = await fetch(`${API_URL}/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${created.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceLabel: "Shared scenario suite" }),
  });
  if (session.status !== 201) throw new Error(`opening the session answered ${session.status}`);
  const cookie = session.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("opening the session set no cookie");
  javaUsers.push({ ...created, cookie });
  return created;
}

/** A unique email for one test run. */
export const uniqueEmail = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.com`;

/**
 * The same person, signed in to the app's session `sessionId` (F01 §10): every request then carries
 * the session. Mock: the session id joins the token (`mock:<userId>:<sessionId>`); Java: after BE-000.
 */
export function inSession(u: TestUser, sessionId: string): TestUser {
  if (TARGET !== "mock") throw new Error(`no session strategy for target ${TARGET} yet (BE-000)`);
  return { ...u, token: `${u.token}:${sessionId}` };
}
