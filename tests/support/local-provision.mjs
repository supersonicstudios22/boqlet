// The local stack's part of what NativeWorkerTest#suiteUsers does for the shared suites (run.mjs,
// BOQLET_TARGET=local): six people with this run's addresses and an open session each, Studio Demo
// (team plan) and Small Firm (free) with their memberships, Pat a platform admin. The stack's database
// outlives a run, so every run makes its own people and orgs (`<key>-<run>@example.com`,
// `studio-demo-<run>`); nothing is cleaned up (npm run local:reset).
import { randomBytes } from "node:crypto";
import { createAccount, localOrigin, quote, resetAuthLimits, sql } from "./local-stack.mjs";

export async function provisionLocal() {
  process.env.API_URL ??= `http://localhost:${process.env.LOCAL_API_PORT || "8080"}/api/v1`;
  const api = process.env.API_URL.replace(/\/$/, "");
  const root = api.replace(/\/api\/v1$/, "");
  try {
    const ready = await fetch(`${root}/actuator/health/readiness`, { signal: AbortSignal.timeout(5000) });
    if (!ready.ok) throw new Error(`readiness answered ${ready.status}`);
  } catch (down) {
    console.error(`[tests] the local stack is not ready at ${root} (${down.message}): npm run local:up`);
    process.exit(2);
  }
  const run = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  process.env.BOQLET_SUITE_RUN = run;
  process.env.BOQLET_SUITE_PASSWORD ??= `suite-${randomBytes(12).toString("base64url")}`;
  process.env.BOQLET_SUITE_MAILHOG ??= `http://localhost:${process.env.LOCAL_MAIL_UI_PORT || "8025"}`;
  process.env.BOQLET_SUITE_STUDIO_SLUG = `studio-demo-${run}`;
  process.env.BOQLET_SUITE_SMALL_FIRM_SLUG = `small-firm-${run}`;
  resetAuthLimits();

  const users = [];
  for (const key of ["olivia", "ivana", "marko", "ana", "victor", "pat"]) {
    const email = `${key}-${run}@example.com`;
    const id = await createAccount(api, key, email);
    if (key === "pat") sql(`UPDATE users SET platform_role = 'admin' WHERE id = ${quote(id)}`);
    const res = await fetch(`${api}/auth/sign-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: localOrigin() },
      body: JSON.stringify({ email, password: process.env.BOQLET_SUITE_PASSWORD, deviceLabel: "Shared suites" }),
    });
    if (res.status !== 201) throw new Error(`signing in ${email} answered ${res.status}: ${await res.text()}`);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("boqlet_session="))?.split(";")[0];
    if (!cookie) throw new Error(`signing in ${email} set no session cookie`);
    users.push({ id, email, name: key, token: `suite.signup.${Buffer.from(email).toString("base64url")}`, cookie });
  }
  const id = (key) => quote(users.find((u) => u.name === key).id);
  sql(`
    WITH studio AS (INSERT INTO orgs (id, name, slug) VALUES (gen_random_uuid(), 'Studio Demo', ${quote(process.env.BOQLET_SUITE_STUDIO_SLUG)}) RETURNING id),
         small AS (INSERT INTO orgs (id, name, slug) VALUES (gen_random_uuid(), 'Small Firm', ${quote(process.env.BOQLET_SUITE_SMALL_FIRM_SLUG)}) RETURNING id),
         plans AS (INSERT INTO subscriptions (org_id, plan_id) SELECT id, 'team' FROM studio UNION ALL SELECT id, 'free' FROM small)
    INSERT INTO memberships (org_id, user_id, role)
    SELECT studio.id, m.user_id::uuid, m.role FROM studio, (VALUES (${id("olivia")}, 'owner'), (${id("ivana")}, 'library_editor'),
           (${id("marko")}, 'member'), (${id("ana")}, 'member'), (${id("victor")}, 'member')) AS m(user_id, role)
    UNION ALL SELECT small.id, ${id("olivia")}::uuid, 'owner' FROM small;`);
  process.env.BOQLET_JAVA_SUITE_USERS = JSON.stringify(users);
  console.log(`[tests] local stack ${root}: run ${run}, seeded people <key>-${run}@example.com, orgs ${process.env.BOQLET_SUITE_STUDIO_SLUG}, ${process.env.BOQLET_SUITE_SMALL_FIRM_SLUG}`);
}
