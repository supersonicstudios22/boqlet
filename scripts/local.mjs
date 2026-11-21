#!/usr/bin/env node
/**
 * The local backend (ops/local/compose.yaml, docs/20-local-backend.md): Java API, engine worker,
 * PostgreSQL, object storage and a mail catcher in Docker.
 *   node scripts/local.mjs up             build and start, wait until the API is ready
 *   node scripts/local.mjs down           stop (data is kept)
 *   node scripts/local.mjs reset          stop and delete all data
 *   node scripts/local.mjs logs [service] follow the logs (api, engine, db, storage, mail)
 *   node scripts/local.mjs status         the containers and the API's readiness
 *   node scripts/local.mjs user <email>   a sign-up link for a new account (or a reset link if it exists)
 *   node scripts/local.mjs admin <email>  make an existing account a platform admin
 *   node scripts/local.mjs check         end-to-end check: sign-up, upload, parse, BoQ run
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(root, "ops", "local", "compose.yaml");
const apiPort = process.env.LOCAL_API_PORT || "8080";
const appPort = process.env.LOCAL_APP_PORT || "3000";
const [, , cmd, ...rest] = process.argv;

function compose(args, opts = {}) {
  const res = spawnSync("docker", ["compose", "-f", composeFile, ...args], { stdio: "inherit", ...opts });
  if (res.error) {
    console.error(`[local] docker not found: install Docker Desktop (or Docker Engine with Compose v2). ${res.error.message}`);
    process.exit(1);
  }
  return res.status ?? 1;
}

function sql(query) {
  const res = spawnSync("docker", ["compose", "-f", composeFile, "exec", "-T", "db",
    "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "boqlet", "-d", "boqlet"], { input: query, encoding: "utf8" });
  if (res.status !== 0) {
    console.error(res.stderr || "[local] the database is not running: npm run local:up");
    process.exit(1);
  }
  return res.stdout.trim();
}

async function ready(timeoutMs) {
  const url = `http://127.0.0.1:${apiPort}/actuator/health/readiness`;
  const deadline = Date.now() + timeoutMs;
  // fetch's sockets don't keep Node alive: while Docker's port proxy holds a connection open
  // before the API listens, nothing else would, and the script would exit mid-wait.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    for (;;) {
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(5000) })).ok) return true;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    clearInterval(keepAlive);
  }
}

const quote = (s) => `'${s.replace(/'/g, "''")}'`;
const emailArg = () => {
  const email = (rest[0] || "").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
    console.error(`usage: npm run local:${cmd} -- <email>`);
    process.exit(2);
  }
  return email;
};

switch (cmd) {
  case "up": {
    // The first build downloads Maven and Python dependencies and takes several minutes.
    if (compose(["up", "-d", "--build", "--remove-orphans"]) !== 0) process.exit(1);
    process.stdout.write(`[local] waiting for the API on http://localhost:${apiPort} ...\n`);
    if (!(await ready(240_000))) {
      console.error("[local] the API did not become ready; see: npm run local:logs -- api");
      process.exit(1);
    }
    console.log(`[local] backend ready. API http://localhost:${apiPort}/api/v1, mail http://localhost:8025`);
    const users = sql("SELECT count(*) FROM users");
    if (users === "0") console.log("[local] no accounts yet: npm run local:user -- you@example.com");
    break;
  }
  case "down":
    process.exit(compose(["down"]));
  case "reset":
    process.exit(compose(["down", "-v", "--remove-orphans"]));
  case "logs":
    process.exit(compose(["logs", "-f", "--tail", "200", ...rest]));
  case "status": {
    compose(["ps"]);
    console.log((await ready(1000)) ? "[local] API ready" : "[local] API not ready");
    break;
  }
  case "user": {
    // As ops/pilot/issue-setup-link.sh: a one-hour link; only its sha256 is stored.
    const email = emailArg();
    const token = randomBytes(32).toString("base64url");
    const digest = createHash("sha256").update(token).digest("hex");
    const exists = sql(`SELECT count(*) FROM users WHERE lower(email) = ${quote(email)} AND deleted_at IS NULL`) !== "0";
    const purpose = exists ? "reset" : "setup";
    sql(`INSERT INTO native_setup_links (email, token_hash, expires_at, purpose)
         VALUES (${quote(email)}, ${quote(digest)}, now() + interval '1 hour', ${quote(purpose)})
         ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, purpose = excluded.purpose`);
    console.log(`${exists ? "Password reset" : "Sign-up"} link for ${email} (valid for one hour):`);
    console.log(`http://localhost:${appPort}/sign-up?token=${token}`);
    break;
  }
  case "admin": {
    const email = emailArg();
    const n = sql(`UPDATE users SET platform_role = 'admin' WHERE lower(email) = ${quote(email)} AND deleted_at IS NULL RETURNING 1`);
    if (!n) {
      console.error(`[local] no account for ${email}: create it first (npm run local:user -- ${email})`);
      process.exit(1);
    }
    console.log(`[local] ${email} is a platform admin (sign in again to see /admin)`);
    break;
  }
  case "check": {
    // End to end through the API, as a person would: account, org, project, the Duplex uploaded to
    // the signed URL, parsed by the engine, a BoQ run with lines. Leaves its data behind (local:reset).
    const origin = `http://localhost:${appPort}`;
    const api = `http://127.0.0.1:${apiPort}/api/v1`;
    const stamp = Date.now().toString(36);
    const email = `check-${stamp}@example.test`;
    const password = "a long local check password";
    let cookie = "";
    const call = async (method, path, body, expected) => {
      const headers = { Origin: origin, ...(cookie ? { Cookie: `boqlet_session=${cookie}` } : {}) };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await fetch(`${api}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.status !== expected) throw new Error(`${method} ${path} answered ${res.status} (expected ${expected}): ${await res.text()}`);
      return res;
    };
    const json = async (...args) => (await call(...args)).json();
    const step = (what) => console.log(`[check] ${what}`);
    const waitJob = async (id) => {
      for (const deadline = Date.now() + 300_000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 1000))) {
        const job = await json("GET", `/jobs/${id}`, undefined, 200);
        if (job.status === "succeeded") return job;
        if (["failed", "cancelled"].includes(job.status)) throw new Error(`job ${id} ${job.status}: ${JSON.stringify(job.error ?? job)}`);
      }
      throw new Error(`job ${id} did not finish`);
    };
    try {
      const token = randomBytes(32).toString("base64url");
      sql(`INSERT INTO native_setup_links (email, token_hash, expires_at, purpose)
           VALUES (${quote(email)}, ${quote(createHash("sha256").update(token).digest("hex"))}, now() + interval '1 hour', 'setup')`);
      await call("POST", "/auth/set-password", { token, password, name: "Local Check" }, 204);
      const signIn = await call("POST", "/auth/sign-in", { email, password, takeover: false, deviceLabel: "local check" }, 201);
      cookie = signIn.headers.getSetCookie().find((c) => c.startsWith("boqlet_session="))?.split(";")[0].slice("boqlet_session=".length) ?? "";
      if (!cookie) throw new Error("sign-in set no session cookie");
      step(`signed up and signed in as ${email}`);
      const org = await json("POST", "/orgs", { name: "Local check", slug: `local-check-${stamp}` }, 201);
      const project = await json("POST", `/orgs/${org.id}/projects`, { name: "Duplex" }, 201);
      const model = await json("POST", `/projects/${project.id}/models`, { name: "Architecture", discipline: "architecture" }, 201);
      const bytes = readFileSync(join(root, "fixtures", "ifc", "Ifc2x3_Duplex_Architecture.ifc"));
      const staged = await json("POST", `/models/${model.id}/versions`, { fileName: "Duplex.ifc", sizeBytes: bytes.byteLength }, 201);
      const put = await fetch(staged.upload.url, { method: staged.upload.method, headers: { ...staged.upload.headers, Origin: origin }, body: bytes });
      if (!put.ok) throw new Error(`upload to object storage answered ${put.status}: ${await put.text()}`);
      if (!put.headers.get("access-control-allow-origin")) throw new Error("object storage sent no CORS header for the app's origin");
      step(`uploaded the Duplex to ${new URL(staged.upload.url).origin}`);
      const queued = await json("POST", `/model-versions/${staged.version.id}/complete`, {}, 200);
      await waitJob(queued.parseJobId);
      const version = await json("GET", `/model-versions/${staged.version.id}`, undefined, 200);
      step(`parsed by the engine: ${version.status}`);
      const boq = await json("POST", `/projects/${project.id}/boqs`, { name: "Check" }, 201);
      const started = await json("POST", `/revisions/${boq.currentRevision.id}/runs`, undefined, 202);
      await waitJob(started.job.id);
      const lines = await json("GET", `/runs/${started.run.id}/lines?limit=1`, undefined, 200);
      if (!(lines.total > 30)) throw new Error(`the run has only ${lines.total} lines`);
      step(`BoQ run complete with ${lines.total} lines`);
      console.log("[check] the local backend works end to end");
    } catch (failed) {
      console.error(`[check] FAILED: ${failed.message}`);
      process.exit(1);
    }
    break;
  }
  default:
    console.error("usage: node scripts/local.mjs up | down | reset | logs [service] | status | user <email> | admin <email> | check");
    process.exit(2);
}
