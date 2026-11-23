// Backend verifier: small API client for the local stack.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
export const base = "http://127.0.0.1:8080/api/v1";
export const origin = "http://localhost:3000";
export const PW = "verify-backend-password-2026";

export const sql = (q) =>
  execFileSync("docker", ["compose", "-f", "ops/local/compose.yaml", "-p", "boqlet-local", "exec", "-T", "db", "psql", "-U", "boqlet", "-d", "boqlet", "-tAc", q], { encoding: "utf8" }).trim();

export async function session(email, password = PW) {
  let cookie = "";
  const call = async (method, path, body, { raw = false, headers: extra = {} } = {}) => {
    const headers = { Origin: origin, ...(cookie ? { Cookie: `boqlet_session=${cookie}` } : {}), ...extra };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie?.().find((c) => c.startsWith("boqlet_session="));
    if (set) cookie = set.split(";")[0].slice("boqlet_session=".length);
    if (raw) return res;
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  };
  const r = await call("POST", "/auth/sign-in", { email, password, takeover: true, deviceLabel: "verify backend" });
  if (r.status !== 201) throw new Error(`sign-in ${email} ${r.status} ${JSON.stringify(r.json)}`);
  return { call, get cookie() { return cookie; } };
}

export async function waitJob(call, id, ms = 600_000) {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await new Promise((r) => setTimeout(r, 1500))) {
    const job = (await call("GET", `/jobs/${id}`)).json;
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
  }
  throw new Error(`job ${id} did not finish`);
}

export async function upload(call, projectId, file, name = "M", discipline = "architecture") {
  const model = (await call("POST", `/projects/${projectId}/models`, { name, discipline })).json;
  const bytes = readFileSync(file);
  const staged = await call("POST", `/models/${model.id}/versions`, { fileName: file.split(/[\\/]/).pop(), sizeBytes: bytes.byteLength });
  if (staged.status !== 201) return { model, staged };
  const put = await fetch(staged.json.upload.url, { method: staged.json.upload.method, headers: { ...staged.json.upload.headers }, body: bytes });
  const done = await call("POST", `/model-versions/${staged.json.version.id}/complete`, {});
  return { model, staged: staged.json, put: put.status, done };
}

export const show = (label, r) => console.log(label, r.status, typeof r.json === "string" ? r.json.slice(0, 400) : JSON.stringify(r.json).slice(0, 600));
const arr = (j) => (Array.isArray(j) ? j : j.items);
export async function ctx(s, slug = "vb-a-firm") {
  const org = arr((await s.call("GET", "/orgs")).json).find((x) => x.slug === slug);
  const projects = arr((await s.call("GET", `/orgs/${org.id}/projects`)).json);
  return { org, projects, project: projects.find((p) => p.name.startsWith("Duplex")) ?? projects[0] };
}
export { arr };
