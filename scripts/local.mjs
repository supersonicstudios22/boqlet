#!/usr/bin/env node
/**
 * The local backend (ops/local/compose.yaml, docs/development/local-setup.md): Java API, engine worker,
 * PostgreSQL, object storage and a mail catcher in Docker.
 *   node scripts/local.mjs up             build and start, wait until the API is ready
 *   node scripts/local.mjs down           stop (data is kept)
 *   node scripts/local.mjs reset          stop and delete all data
 *   node scripts/local.mjs logs [service] follow the logs (api, engine, db, storage, mail)
 *   node scripts/local.mjs status         the containers and the API's readiness
 *   node scripts/local.mjs user <email>   a sign-up link for a new account (or a reset link if it exists)
 *   node scripts/local.mjs admin <email>  make an existing account a platform admin
 *   node scripts/local.mjs check         end-to-end check: sign-up, upload, parse, BoQ run
 *   node scripts/local.mjs suites [--suite contract|scenarios|perf] [--filter name,name]
 *                                        the shared suites (tests/) against this stack; default contract and scenarios
 *   node scripts/local.mjs demo [--email e] [--password p] [--port n] [--no-org]
 *                                        backend up, a demo account ready to sign in, the app on :3000
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Compose v5 builds through Bake, which checks the Dockerfile paths against the working directory
// case-sensitively: from a shell on "c:\..." (a lowercase drive letter) it asks for --allow=fs.read and
// stops (TF-082). Docker runs from the repository root with the drive letter as Windows writes it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..").replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const composeFile = join(root, "ops", "local", "compose.yaml");
// `demo --port n`: the app's port is also the backend's allowed origin (BOQLET_APP_URL, storage CORS).
if (process.argv[2] === "demo" && process.argv.includes("--port")) {
  process.env.LOCAL_APP_PORT = process.argv[process.argv.indexOf("--port") + 1] ?? "";
}
const apiPort = process.env.LOCAL_API_PORT || "8080";
const appPort = process.env.LOCAL_APP_PORT || "3000";
if (!/^\d{2,5}$/.test(appPort)) {
  console.error(`[local] not a port: ${appPort}`);
  process.exit(2);
}
const mailPort = process.env.LOCAL_MAIL_UI_PORT || "8025";
const [, , cmd, ...rest] = process.argv;

function compose(args, opts = {}) {
  const res = spawnSync("docker", ["compose", "-f", composeFile, ...args], { stdio: "inherit", cwd: root, ...opts });
  if (res.error) {
    console.error(`[local] docker not found: install Docker Desktop (or Docker Engine with Compose v2). ${res.error.message}`);
    process.exit(1);
  }
  return res.status ?? 1;
}

function sql(query) {
  const res = spawnSync("docker", ["compose", "-f", composeFile, "exec", "-T", "db",
    "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "boqlet", "-d", "boqlet"], { input: query, encoding: "utf8", cwd: root });
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

/** Builds and starts the backend and waits until the API is ready. */
async function up() {
  // The first build downloads Maven and Python dependencies and takes several minutes.
  if (compose(["up", "-d", "--build", "--remove-orphans"]) !== 0) process.exit(1);
  process.stdout.write(`[local] waiting for the API on http://localhost:${apiPort} ...\n`);
  if (!(await ready(240_000))) {
    console.error("[local] the API did not become ready; see: npm run local:logs -- api");
    process.exit(1);
  }
  console.log(`[local] backend ready. API http://localhost:${apiPort}/api/v1, mail http://localhost:${mailPort}`);
}

/** As ops/pilot/issue-setup-link.sh: a one-hour link (a reset link when the account exists); only its sha256 is stored. */
function issueLink(email) {
  const token = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(token).digest("hex");
  const exists = sql(`SELECT count(*) FROM users WHERE lower(email) = ${quote(email)} AND deleted_at IS NULL`) !== "0";
  const purpose = exists ? "reset" : "setup";
  sql(`INSERT INTO native_setup_links (email, token_hash, expires_at, purpose)
       VALUES (${quote(email)}, ${quote(digest)}, now() + interval '1 hour', ${quote(purpose)})
       ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, purpose = excluded.purpose`);
  return { token, exists };
}

/** Whether nothing listens on the port yet. */
function portFree(port) {
  return new Promise((done) => {
    const probe = createServer().once("error", () => done(false)).once("listening", () => probe.close(() => done(true)));
    probe.listen(Number(port));
  });
}

/** The Java API as the app calls it: the app's Origin, and the session cookie once signed in. */
function apiClient() {
  const base = `http://127.0.0.1:${apiPort}/api/v1`;
  let cookie = "";
  const call = async (method, path, body, expected) => {
    const headers = { Origin: `http://localhost:${appPort}`, ...(cookie ? { Cookie: `boqlet_session=${cookie}` } : {}) };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!expected.includes(res.status)) throw new Error(`${method} ${path} answered ${res.status}: ${await res.text()}`);
    const set = res.headers.getSetCookie().find((c) => c.startsWith("boqlet_session="));
    if (set) cookie = set.split(";")[0].slice("boqlet_session=".length);
    return res;
  };
  return { call, json: async (...args) => (await call(...args)).json() };
}

switch (cmd) {
  case "up": {
    await up();
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
  case "demo": {
    // One command to a running boqlet and an account to sign in with (docs/development/local-setup.md):
    // the backend in Docker; an account whose password is set through Java's own set-password, from a
    // setup link (a reset link when the account exists); by default an org with setup finished and the
    // Duplex sample; then `next dev`. Ctrl+C stops the app; the backend stays up (npm run local:down).
    const flag = (name) => {
      const at = rest.indexOf(name);
      return at >= 0 ? rest[at + 1] : undefined;
    };
    const email = (flag("--email") ?? "demo@example.test").trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
      console.error(`[demo] not an email: ${email}`);
      process.exit(2);
    }
    // Java's policy: 15 to 128 characters (code points). Without --password, a new one every run.
    const password = flag("--password") ?? `demo-${randomBytes(15).toString("base64url")}`;
    if ([...password].length < 15 || [...password].length > 128 || !password.trim()) {
      console.error("[demo] the password must be 15 to 128 characters");
      process.exit(2);
    }
    const withOrg = !rest.includes("--no-org");
    if (!(await portFree(appPort))) {
      console.error(`[demo] port ${appPort} is in use: stop what runs there, or pick another (npm run local:demo -- --port 3200)`);
      process.exit(1);
    }
    await up();

    const api = apiClient();
    let landing = "";
    try {
      const { token, exists } = issueLink(email);
      await api.call("POST", "/auth/set-password", { token, password, name: "Demo User" }, [204]);
      console.log(`[demo] ${exists ? "reset the password of" : "created"} ${email}`);
      if (withOrg) {
        await api.call("POST", "/auth/sign-in", { email, password, takeover: true, deviceLabel: "local demo setup" }, [201]);
        const me = await api.json("GET", "/me", undefined, [200]);
        let org = me.memberships.find((m) => m.role === "owner")?.org;
        for (let attempt = 0; !org; attempt++) {
          const slug = attempt === 0 ? "demo-firm" : `demo-firm-${randomBytes(3).toString("hex")}`;
          const res = await api.call("POST", "/orgs", { name: "Demo Firm", slug }, [201, 409]);
          if (res.status === 201) org = await res.json();
        }
        if (org.setup?.status !== "done") await api.call("PUT", `/orgs/${org.id}/setup`, { status: "done", step: "review" }, [200]);
        const projects = await api.json("GET", `/orgs/${org.id}/projects`, undefined, [200]);
        if (!projects.some((p) => p.sample)) {
          await api.call("POST", `/orgs/${org.id}/projects`, { name: "Duplex (sample)", sample: "duplex" }, [201]);
          console.log("[demo] the Duplex sample project is being processed (about a minute)");
        }
        console.log(`[demo] org "${org.name}" (/${org.slug}) with setup finished and the Duplex sample`);
        landing = `/${org.slug}`;
        // Signed out again, so signing in in the browser opens the one active session without a takeover question.
        await api.call("DELETE", "/sessions/current", undefined, [204]);
      }
    } catch (failed) {
      console.error(`[demo] FAILED: ${failed.message}`);
      process.exit(1);
    }

    // The app as `npm run dev:app` runs it, in its own build folder (a `next build` in .next keeps working).
    const app = join(root, "apps", "app");
    const next = createRequire(join(app, "package.json")).resolve("next/dist/bin/next");
    if (spawnSync(process.execPath, ["scripts/pseudo-locale.mjs"], { cwd: app, stdio: "inherit" }).status !== 0) process.exit(1);
    const server = spawn(process.execPath, [next, "dev", "--port", appPort], {
      cwd: app,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, API_PROXY_TARGET: `http://localhost:${apiPort}`, NEXT_DIST_DIR: ".next-demo", NEXT_TELEMETRY_DISABLED: "1" },
    });
    const stop = () => server.kill();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    server.on("exit", (code) => {
      console.log("\n[demo] the app stopped. The backend is still running: npm run local:down stops it (data is kept).");
      process.exit(code ?? 0);
    });
    // A page compiles on its first request: warm the sign-in page before saying it's ready.
    const signIn = `http://localhost:${appPort}/sign-in`;
    for (const deadline = Date.now() + 180_000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 1000))) {
      try {
        if ((await fetch(signIn, { signal: AbortSignal.timeout(60_000) })).ok) break;
      } catch {
        /* still starting */
      }
    }
    const rule = "=".repeat(68);
    console.log(
      [
        "",
        rule,
        " boqlet is running. Sign in at:",
        "",
        `   ${signIn}`,
        ...(landing ? [`   (it opens the org at http://localhost:${appPort}${landing})`] : []),
        "",
        `   Email:     ${email}`,
        `   Password:  ${password}`,
        "",
        ` Mail sent by the app: http://localhost:${mailPort}`,
        " Ctrl+C stops the app; the backend keeps running (npm run local:down stops it).",
        rule,
        "",
      ].join("\n"),
    );
    break;
  }
  case "suites": {
    // The shared contract and scenario suites (tests/, docs/testing/README.md) against this stack, as
    // NativeWorkerTest runs them against its own Java: tests/run.mjs provisions the seeded people and orgs
    // through the stack's sign-up links (BOQLET_TARGET=local). `--filter` names test files, as
    // BOQLET_SCENARIO_FILTER does; a suite with no matching file is skipped.
    const option = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] ?? "" : undefined);
    const suites = (option("--suite") ?? "contract,scenarios").split(",").filter(Boolean);
    const filters = (option("--filter") ?? "").split(",").map((f) => f.trim()).filter(Boolean);
    if (suites.some((suite) => !["contract", "scenarios", "perf"].includes(suite))) {
      console.error("usage: npm run local:suites -- [--suite contract|scenarios|perf] [--filter name,name]");
      process.exit(2);
    }
    if (!(await ready(3000))) {
      console.error("[local] the backend is not running: npm run local:up");
      process.exit(1);
    }
    // The origin the API allows is the app's URL it was started with (`demo --port` changes it).
    const origin = spawnSync("docker", ["compose", "-f", composeFile, "exec", "-T", "api", "sh", "-c", "echo $BOQLET_APP_URL"],
      { encoding: "utf8", cwd: root }).stdout?.trim() || `http://localhost:${appPort}`;
    const testsDir = join(root, "tests");
    let failed = 0;
    for (const suite of suites) {
      const files = readdirSync(join(testsDir, suite)).filter((f) => f.endsWith(".test.ts"));
      const matching = filters.filter((f) => files.some((file) => file.includes(f)));
      if (filters.length && !matching.length) {
        console.log(`[local] ${suite}: no file matches ${filters.join(", ")}; skipped`);
        continue;
      }
      console.log(`[local] ${suite}${matching.length ? ` (${matching.join(", ")})` : ""} against http://localhost:${apiPort}, origin ${origin}`);
      const res = spawnSync(process.execPath, ["run.mjs", suite, ...(matching.length ? [matching.join(",")] : [])], {
        cwd: testsDir,
        stdio: "inherit",
        env: { ...process.env, BOQLET_TARGET: "local", API_URL: `http://localhost:${apiPort}/api/v1`, BOQLET_LOCAL_ORIGIN: origin,
          BOQLET_SUITE_MAILHOG: `http://localhost:${mailPort}` },
      });
      if (res.status !== 0) failed++;
    }
    process.exit(failed ? 1 : 0);
  }
  default:
    console.error("usage: node scripts/local.mjs up | down | reset | logs [service] | status | user <email> | admin <email> | check | demo [--email e] [--password p] [--port n] [--no-org] | suites [--suite s] [--filter f]");
    process.exit(2);
}
