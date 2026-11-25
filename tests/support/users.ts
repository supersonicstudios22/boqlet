import { API_URL, ROOT_URL } from "./env";
import { browserOf, remember } from "./java-sessions";
import { createAccount, isLocal } from "./local-stack.mjs";

/**
 * Seeded people, by first name: the Java suite test makes them (NativeWorkerTest#suiteUsers) and
 * passes them with an open session each as `BOQLET_JAVA_SUITE_USERS`; on the local stack run.mjs does
 * (with this run's addresses, `olivia-<run>@example.com`).
 */
export type SeedUser = "olivia" | "ivana" | "marko" | "ana" | "victor" | "pat";

export interface TestUser {
  id: string;
  name: string;
  email: string;
  token: string;
}

/** The seeded people of the Java suite test, each with an open session (see `java-sessions.ts`). */
const javaUsers: TestUser[] = [];
if (process.env.BOQLET_JAVA_SUITE_USERS) {
  for (const u of JSON.parse(process.env.BOQLET_JAVA_SUITE_USERS) as (TestUser & { cookie: string })[]) {
    remember(u.token, u.cookie);
    javaUsers.push({ id: u.id, name: u.name, email: u.email, token: u.token });
  }
}

export async function user(key: SeedUser): Promise<TestUser> {
  const found = javaUsers.find((u) => u.name === key);
  if (!found) throw new Error(`seeded user ${key} not found`);
  return found;
}

/**
 * A new person, as if they signed up (F01): the test-only `POST /_test/users` (registered only by
 * the Java suite test, never in a build) creates the account with a test token
 * (`suite.signup.<base64url email>`). Signing up opens no session: the person's first request
 * does (`java-sessions.ts`). On the local stack the person sets this run's password from a setup
 * link (local-stack.mjs) and gets the same kind of token, which names them to the suite only.
 */
export async function signUp(name: string, email: string): Promise<TestUser> {
  if (isLocal()) {
    const normalized = email.trim().toLowerCase();
    const id = await createAccount(API_URL, name, normalized);
    return { id, name, email: normalized, token: `suite.signup.${Buffer.from(normalized).toString("base64url")}` };
  }
  const res = await fetch(`${ROOT_URL}/_test/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email }) });
  if (!res.ok) throw new Error(`/_test/users answered ${res.status}`);
  return (await res.json()) as TestUser;
}

/** A unique email for one test run. */
export const uniqueEmail = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.com`;

/**
 * The same person, signed in to the app's session `sessionId` (F01 §10): every request then carries
 * the session: the browser that opened it (`java-sessions.ts`).
 */
export function inSession(u: TestUser, sessionId: string): TestUser {
  return { ...u, token: browserOf(sessionId) };
}

/**
 * The seeded orgs' slugs. In the Java harness they are `studio-demo` and `small-firm`; on the local
 * stack, whose database outlives a run, each run makes its own (`studio-demo-<run>`, run.mjs).
 */
export const STUDIO_SLUG = process.env.BOQLET_SUITE_STUDIO_SLUG ?? "studio-demo";
export const SMALL_FIRM_SLUG = process.env.BOQLET_SUITE_SMALL_FIRM_SLUG ?? "small-firm";
