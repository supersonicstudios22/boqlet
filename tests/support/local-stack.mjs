// The local Docker stack as a suite target (BOQLET_TARGET=local, docs/testing/README.md "Shared suites on the
// local stack"). The stack runs the product image: native sign-in with a password and a session cookie, the
// app's Origin on every unsafe request, and no test-only routes. What the Java harness does through its
// `/_test/*` routes (SuiteSupport.java) is done here through SQL on the stack's database, the way
// `scripts/local.mjs` issues sign-up links. Plain Node, shared by run.mjs (provisioning) and the suites.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// As scripts/local.mjs: Docker runs from the repository root with the drive letter as Windows writes it.
const root = path.resolve(here, "..", "..").replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const composeFile = path.join(root, "ops", "local", "compose.yaml");

export const isLocal = () => process.env.BOQLET_TARGET === "local";
/** The app's origin the stack allows (BOQLET_APP_URL in ops/local/compose.yaml). */
export const localOrigin = () => process.env.BOQLET_LOCAL_ORIGIN ?? `http://localhost:${process.env.LOCAL_APP_PORT || "3000"}`;
/** Every person the suites make on the local stack signs in with this run's password. */
export const localPassword = () => {
  const password = process.env.BOQLET_SUITE_PASSWORD;
  if (!password) throw new Error("BOQLET_SUITE_PASSWORD is not set (run.mjs sets it for --target local)");
  return password;
};

export const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** One SQL script on the stack's database; returns psql's unaligned output (rows on lines, fields by `|`). */
export function sql(query) {
  const res = spawnSync("docker", ["compose", "-f", composeFile, "exec", "-T", "db",
    "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "boqlet", "-d", "boqlet"], { input: query, encoding: "utf8", cwd: root });
  if (res.error) throw new Error(`docker not found: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`the local database refused the query (is the stack up? npm run local:up): ${res.stderr.trim()}`);
  return res.stdout.trim();
}

/** As `scripts/local.mjs user`: a one-hour setup link (only its sha256 is stored); answers the raw token. */
export function setupLink(email) {
  const token = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(token).digest("hex");
  sql(`INSERT INTO native_setup_links (email, token_hash, expires_at, purpose)
       VALUES (${quote(email)}, ${quote(digest)}, now() + interval '1 hour', 'setup')
       ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, purpose = excluded.purpose`);
  return token;
}

/**
 * Forgets native sign-in attempts: a suite signs in hundreds of people from one address, past the
 * per-address cap a person's office needs (as the harness's `/_test/auth-limits/reset`).
 */
export const resetAuthLimits = () => sql("DELETE FROM native_auth_limits");

/** A person's account with this run's password, as a person setting up from a sign-up link would (F01). */
export async function createAccount(apiUrl, name, email) {
  const token = setupLink(email);
  const res = await fetch(`${apiUrl}/auth/set-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: localOrigin() },
    body: JSON.stringify({ token, password: localPassword(), name }),
  });
  if (res.status === 429) {
    resetAuthLimits();
    return createAccount(apiUrl, name, email);
  }
  if (res.status !== 204) throw new Error(`setting the password of ${email} answered ${res.status}: ${await res.text()}`);
  return sql(`SELECT id FROM users WHERE lower(email) = ${quote(email.toLowerCase())} AND deleted_at IS NULL`);
}

/** Waits until the email outbox has sent everything due (as the harness's `/_test/mail/settle`). */
export async function settleMail() {
  const until = Date.now() + 30_000;
  for (;;) {
    const pending = Number(sql(`SELECT count(*) FROM email_outbox
      WHERE sent_at IS NULL AND canceled_at IS NULL AND next_attempt_at <= now()`));
    if (pending === 0 || Date.now() > until) return pending;
    await new Promise((r) => setTimeout(r, 250));
  }
}
