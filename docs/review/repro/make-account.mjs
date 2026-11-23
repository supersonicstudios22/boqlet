// Review helper: make a local account (and optionally an org with setup done, the Duplex sample and a plan).
//   node docs/review/repro/make-account.mjs <email> <password> [--org "Name" slug] [--plan enterprise|team|professional|free] [--admin]
// Local Docker stack only. Mirrors scripts/local.mjs demo (setup link through SQL, then Java's own set-password).
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const [email, password, ...rest] = process.argv.slice(2);
const flag = (n) => (rest.indexOf(n) >= 0 ? rest[rest.indexOf(n) + 1] : undefined);
const orgName = flag("--org");
const orgSlug = orgName ? rest[rest.indexOf("--org") + 2] : undefined;
const plan = flag("--plan");
const admin = rest.includes("--admin");
const sql = (q) =>
  execFileSync("docker", ["compose", "-f", "ops/local/compose.yaml", "-p", "boqlet-local", "exec", "-T", "db", "psql", "-U", "boqlet", "-d", "boqlet", "-tAc", q], { encoding: "utf8" }).trim();
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const base = "http://127.0.0.1:8080/api/v1";
let cookie = "";
const call = async (method, path, body, ok) => {
  const headers = { Origin: "http://localhost:3000", ...(cookie ? { Cookie: `boqlet_session=${cookie}` } : {}) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!ok.includes(res.status)) throw new Error(`${method} ${path} ${res.status} ${await res.text()}`);
  const set = res.headers.getSetCookie().find((c) => c.startsWith("boqlet_session="));
  if (set) cookie = set.split(";")[0].slice("boqlet_session=".length);
  return res;
};
const token = randomBytes(32).toString("base64url");
const exists = sql(`SELECT count(*) FROM users WHERE lower(email) = ${quote(email)}`) !== "0";
sql(`INSERT INTO native_setup_links (email, token_hash, expires_at, purpose) VALUES (${quote(email)}, ${quote(createHash("sha256").update(token).digest("hex"))}, now() + interval '1 hour', ${quote(exists ? "reset" : "setup")})
     ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, purpose = excluded.purpose`);
await call("POST", "/auth/set-password", { token, password, name: email.split("@")[0] }, [204]);
if (admin) sql(`UPDATE users SET platform_role = 'admin' WHERE lower(email) = ${quote(email)}`);
if (orgName) {
  await call("POST", "/auth/sign-in", { email, password, takeover: true, deviceLabel: "review setup" }, [201]);
  const org = await (await call("POST", "/orgs", { name: orgName, slug: orgSlug }, [201])).json();
  if (plan) sql(`UPDATE subscriptions SET plan_id = ${quote(plan)} WHERE org_id = ${quote(org.id)}`);
  await call("PUT", `/orgs/${org.id}/setup`, { status: "done", step: "review" }, [200]);
  await call("POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" }, [201]);
  await call("DELETE", "/sessions/current", undefined, [204]);
  console.log(`org ${orgName} /${orgSlug} (${org.id}) plan ${plan ?? "default"}`);
}
console.log(`account ${email} ready${admin ? " (platform admin)" : ""}`);
