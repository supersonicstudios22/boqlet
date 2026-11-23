// ENG reviewer: small API client for the local stack (mirrors scripts/local.mjs check).
import { readFileSync } from "node:fs";
export const base = "http://127.0.0.1:8080/api/v1";
export const origin = "http://localhost:3000";

export async function session(email, password = "review-persona-password-2026") {
  let cookie = "";
  const call = async (method, path, body, { raw = false, headers: extra = {}, rawBody } = {}) => {
    const headers = { Origin: origin, ...(cookie ? { Cookie: `boqlet_session=${cookie}` } : {}), ...extra };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + path, { method, headers, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const set = res.headers.getSetCookie?.().find((c) => c.startsWith("boqlet_session="));
    if (set) cookie = set.split(";")[0].slice("boqlet_session=".length);
    if (raw) return res;
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  };
  const r = await call("POST", "/auth/sign-in", { email, password, takeover: true, deviceLabel: "eng review" });
  if (r.status !== 201) throw new Error(`sign-in ${r.status} ${JSON.stringify(r.json)}`);
  return { call, get cookie() { return cookie; } };
}

export async function waitJob(call, id, ms = 600_000) {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await new Promise((r) => setTimeout(r, 1500))) {
    const job = (await call("GET", `/jobs/${id}`)).json;
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
  }
  throw new Error(`job ${id} did not finish`);
}

export async function upload(call, projectId, file, name = "M", discipline = "architecture", fileName) {
  const model = (await call("POST", `/projects/${projectId}/models`, { name, discipline })).json;
  const bytes = readFileSync(file);
  const staged = await call("POST", `/models/${model.id}/versions`, { fileName: fileName ?? file.split(/[\\/]/).pop(), sizeBytes: bytes.byteLength });
  if (staged.status !== 201) return { model, staged };
  const put = await fetch(staged.json.upload.url, { method: staged.json.upload.method, headers: { ...staged.json.upload.headers, Origin: origin }, body: bytes });
  const done = await call("POST", `/model-versions/${staged.json.version.id}/complete`, {});
  return { model, staged: staged.json, put: put.status, done };
}
