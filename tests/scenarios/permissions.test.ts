import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_URL, authentication, client } from "../support/env";
import { checkResponse } from "../support/contract";
import { invitationToken } from "../support/mail";
import { duplexBytes, uploadVersion, waitForVersion } from "../support/models";
import { setPlan } from "../support/plans";
import { signUp, uniqueEmail, user } from "../support/users";

/**
 * The role matrix of docs/domain/permissions.md (test plan §7.1, S1, C3, C4, S7; TF-092), ported from the
 * Stage 3 sweep (s3a-matrix/matrix.mjs): every row of both role tables, plus a few extras, called as each of
 * the eleven personas, with approval off, approval on, and the project archived; the permission keys the
 * app reads against the same table; search, four-eyes and the admin paths. Cells that fail because of an
 * open finding are `it.fails` and name it; when the finding is fixed the cell starts failing: make it `it`.
 */

const PERSONAS = ["OWN", "ADM", "LIB", "MEM", "LEAD", "EST", "APR", "VIEW", "X", "ANON", "PADM"] as const;
type Persona = (typeof PERSONAS)[number];
type Spare = "S1" | "S2";
const ORG_ROLE: Partial<Record<Persona, string>> = { OWN: "owner", ADM: "admin", LIB: "library_editor", MEM: "member", LEAD: "member", EST: "member", APR: "member", VIEW: "member" };
const PROJECT_ROLE: Partial<Record<Persona, string>> = { OWN: "lead", ADM: "lead", LEAD: "lead", EST: "estimator", APR: "approver", VIEW: "viewer" };
const ALL_ORG = ["owner", "admin", "library_editor", "member"];
const ALL_PROJECT = ["lead", "estimator", "approver", "viewer"];
const EDITING = ["lead", "estimator"];

// ───────────── HTTP as a persona (every answer checked against the contract, TF-078) ─────────────
interface Res { status: number; json: any; text: string }
const tokens: Partial<Record<Persona | Spare, string>> = {};
const ids: Partial<Record<Persona | Spare, string>> = {};
const denials: { row: string; persona: string; details: unknown }[] = [];

async function call(who: Persona | Spare | null, method: string, path: string, body?: unknown): Promise<Res> {
  const token = who ? tokens[who] : undefined;
  const headers: Record<string, string> = { ...(token ? await authentication(token) : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
  const request = new Request(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const response = await fetch(request.clone());
  await checkResponse(request, response.clone());
  const text = await response.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json, text };
}
const as = (p: Persona | Spare | null) => ({
  get: (path: string) => call(p, "GET", path),
  post: (path: string, body: unknown = {}) => call(p, "POST", path, body),
  patch: (path: string, body: unknown) => call(p, "PATCH", path, body),
  put: (path: string, body: unknown) => call(p, "PUT", path, body),
  del: (path: string, body?: unknown) => call(p, "DELETE", path, body),
});
type Api = ReturnType<typeof as>;
const own = as("OWN"), lead = as("LEAD"), est = as("EST"), apr = as("APR");
const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function must(r: Res, what: string) {
  if (r.status < 200 || r.status >= 300) throw new Error(`${what}: ${r.status} ${r.text.slice(0, 300)}`);
  return r.json;
}
async function waitJob(api: Api, jobId: string) {
  for (const deadline = Date.now() + 180_000; Date.now() < deadline; await sleep(250)) {
    const j = (await api.get(`/jobs/${jobId}`)).json;
    if (j && j.status !== "queued" && j.status !== "running") return j;
  }
  throw new Error(`job ${jobId} did not finish`);
}

// ───────────── the world: org, personas, project, BoQ, presets ─────────────
const S = {} as {
  org: { id: string; name: string }; project: string; model: string; version: string; hidden: string; hiddenBoq?: string;
  boq: string; run: string; lineKey: string; saved: string; companyDict: string; orgRuleSet: string; dictDoc: unknown;
};

async function join(key: Persona | Spare, role: string, name: string) {
  const email = uniqueEmail(`matrix-${key.toLowerCase()}`);
  must(await own.post(`/orgs/${S.org.id}/invitations`, { email, role }), `invite ${key}`);
  const person = await signUp(name, email);
  tokens[key] = person.token;
  ids[key] = person.id;
  must(await as(key).post(`/invitations/${await invitationToken(email)}/accept`), `accept ${key}`);
  return email;
}
const emails: Partial<Record<Spare, string>> = {};

beforeAll(async () => {
  const owner = await signUp("Olga Owner", uniqueEmail("matrix-own"));
  tokens.OWN = owner.token;
  ids.OWN = owner.id;
  const org = must(await own.post("/orgs", { name: "Matrix Studio", slug: `matrix-${stamp()}` }), "org");
  S.org = { id: org.id, name: org.name };
  const plans = (await client(owner.token).GET("/orgs/{orgId}/billing", { params: { path: { orgId: org.id } } })).data!.plans!;
  await setPlan(owner, org.id, plans.find((p) => (p.entitlements.seats ?? 99) >= 12 && p.entitlements.approvalWorkflow === true)!.id);
  must(await own.put(`/orgs/${S.org.id}/setup`, { status: "done", step: "review" }), "setup done");
  for (const [key, role, name] of [["ADM", "admin", "Adam Admin"], ["LIB", "library_editor", "Lia Library"], ["MEM", "member", "Max Member"], ["LEAD", "member", "Lena Lead"],
    ["EST", "member", "Erik Estimator"], ["APR", "member", "Ana Approver"], ["VIEW", "member", "Vera Viewer"], ["S1", "member", "Spare One"], ["S2", "member", "Spare Two"]] as const) {
    const email = await join(key, role, name);
    if (key === "S1" || key === "S2") emails[key] = email;
  }
  const outsider = await signUp("Xena Outsider", uniqueEmail("matrix-x"));
  tokens.X = outsider.token;
  must(await as("X").post("/orgs", { name: "Matrix Other", slug: `matrix-other-${stamp()}` }), "other org");
  tokens.PADM = (await user("pat")).token;

  const project = must(await lead.post(`/orgs/${S.org.id}/projects`, { name: "Matrix Duplex" }), "project");
  S.project = project.id;
  for (const [key, role] of [["EST", "estimator"], ["APR", "approver"], ["VIEW", "viewer"]] as const) must(await lead.post(`/projects/${S.project}/members`, { userId: ids[key], role }), `add ${key}`);
  must(await own.post(`/projects/${S.project}/members`, { userId: ids.ADM, role: "lead" }), "add ADM");
  const model = must(await lead.post(`/projects/${S.project}/models`, { name: "Architecture", discipline: "architecture" }), "model");
  S.model = model.id;
  const leadUser = { id: ids.LEAD!, name: "Lena Lead", email: "", token: tokens.LEAD! };
  const version = await uploadVersion(leadUser, S.model, await duplexBytes(), "Duplex.ifc");
  expect((await waitForVersion(leadUser, version.id)).status).toBe("ready");
  S.version = version.id;
  S.hidden = must(await own.post(`/orgs/${S.org.id}/projects`, { name: "Matrix Hidden" }), "hidden project").id;

  const boq = must(await lead.post(`/projects/${S.project}/boqs`, { name: "Matrix BoQ", inputs: { dictionaryVersionIds: [] } }), "boq");
  const run = await generate(lead, boq.currentRevision.id);
  S.boq = boq.id;
  S.run = run.id;
  const lines = (await lead.get(`/runs/${run.id}/lines?limit=50`)).json.items;
  S.lineKey = (lines.find((l: any) => l.quantity > 1) ?? lines[0]).key;
  S.saved = must(await lead.post(`/revisions/${boq.currentRevision.id}/issue`, { notModelledConfirmed: true, note: "matrix A" }), "issue").id;

  const system = async (kind: string, slug: string) => (await own.get(`/orgs/${S.org.id}/presets?kind=${kind}&layer=system`)).json.find((p: any) => p.slug === slug).latestPublishedVersion.id;
  const dict = must(await own.post(`/orgs/${S.org.id}/presets`, { kind: "dictionary", name: "Company names", start: { mode: "copy", fromVersionId: await system("dictionary", "acme-company") } }), "company dictionary");
  must(await own.post(`/presets/${dict.id}/publish`, { changeNote: "matrix" }), "publish dictionary");
  S.companyDict = dict.id;
  S.dictDoc = (await own.get(`/preset-versions/${(await own.get(`/presets/${dict.id}`)).json.latestPublishedVersion.id}`)).json.doc;
  const rules = must(await own.post(`/orgs/${S.org.id}/presets`, { kind: "rule_set", name: "Matrix rules", start: { mode: "patch", fromVersionId: await system("rule_set", "as-modelled") } }), "org rule set");
  must(await own.post(`/presets/${rules.id}/publish`, { changeNote: "matrix" }), "publish rules");
  S.orgRuleSet = rules.id;

  for (const t of (await own.get(`/orgs/${S.org.id}/terms`)).json ?? []) if (!terms.has(t.category)) terms.set(t.category, t.id);
  questionPool.push(...((await lead.get(`/runs/${S.run}/questions`)).json ?? []).filter((q: any) => q.kind === "unknown_name" && q.answer?.kind === "term" && !q.decision));
  expect(questionPool.length).toBeGreaterThan(2);
}, 600_000);

afterAll(async () => {
  if (tokens.OWN) await setApproval(false).catch(() => undefined);
});

// ───────────── targets: made lazily, reused until a call succeeds (then consumed) ─────────────
function pool<T>(make: () => Promise<T>) {
  let current: T | null = null;
  return { async get() { return (current ??= await make()); }, consume() { current = null; }, peek: () => current };
}
async function generate(api: Api, revisionId: string) {
  const started = must(await api.post(`/revisions/${revisionId}/runs`), "generate");
  await waitJob(api, started.job.id);
  return (await api.get(`/runs/${started.run.id}`)).json;
}
const boqOf = async (id: string, api = own) => (await api.get(`/boqs/${id}`)).json;
async function newBoq(name: string, { run = true, projectId = "", by = lead } = {}) {
  const boq = must(await by.post(`/projects/${projectId || S.project}/boqs`, { name: `${name} ${stamp()}` }), `boq ${name}`);
  if (run) await generate(by, boq.currentRevision.id);
  return boq.id as string;
}
let ARCHIVED = false;
async function ready(boqId: string) {
  let rev = (await boqOf(boqId)).currentRevision;
  if (ARCHIVED) return rev;
  if (!rev.currentRun || (rev.pendingChanges ?? []).length || !["succeeded", "needs_input"].includes(rev.currentRun.status)) {
    await generate(own, rev.id);
    rev = (await boqOf(boqId)).currentRevision;
  }
  return rev;
}
const terms = new Map<string, string>();
const questionPool: any[] = [];
let qIndex = 0;
const nextQuestion = () => questionPool[qIndex++ % questionPool.length];
const answerOf = (q: any) => ({ questionId: q.id, kind: q.kind, answer: terms.get(q.answer.category ?? "material") ?? [...terms.values()][0] });
async function decision() {
  const q = nextQuestion();
  must(await lead.post(`/projects/${S.project}/decisions`, { decisions: [answerOf(q)], addToProjectDictionary: false }), "decision");
  return (await lead.get(`/projects/${S.project}/decisions`)).json.find((d: any) => d.questionId === q.id).id as string;
}
const orgPreset = async () => must(await own.post(`/orgs/${S.org.id}/presets`, { kind: "dictionary", name: `Matrix dict ${stamp()}`, start: { mode: "empty" } }), "org preset").id as string;
const shareLink = async (boqId: string, by = lead) => must(await by.post(`/boqs/${boqId}/share-links`, { mode: "latest_issued", label: `m ${stamp()}` }), "share link").id as string;
async function setApproval(approvalRequired: boolean, fourEyes = true) {
  must(await own.patch(`/orgs/${S.org.id}`, { settings: { approvalRequired, fourEyes, publicLinksAllowed: true } }), "approval");
}
async function reinvite(spare: Spare) {
  must(await own.post(`/orgs/${S.org.id}/invitations`, { email: emails[spare], role: "member" }), "reinvite");
  must(await as(spare).post(`/invitations/${await invitationToken(emails[spare]!)}/accept`), "accept again");
}
const revisionStatus = async (boqId: string) => (await boqOf(boqId)).currentRevision;
/** The review BoQ's working revision in the wanted state (submitted by EST). */
async function reviewState(boqId: string, want: string) {
  for (let i = 0; i < 6; i++) {
    const rev = await revisionStatus(boqId);
    if (rev.status === want) return rev;
    if (rev.status === "in_review" || rev.status === "approved") { must(await est.post(`/revisions/${rev.id}/reopen`), "withdraw"); continue; }
    if (rev.status === "draft") {
      if (want === "draft") return rev;
      await ready(boqId);
      must(await est.post(`/revisions/${rev.id}/submit`, { reviewerIds: [ids.APR, ids.LEAD], notModelledConfirmed: true }), "submit");
      if (want === "approved") must(await apr.post(`/revisions/${rev.id}/approve`, {}), "approve");
    }
  }
  throw new Error(`review state ${want}`);
}
async function confirmedState(boqId: string, want: "working" | "confirmed") {
  const b = await boqOf(boqId);
  if (want === "confirmed" && b.status !== "confirmed") must(await own.post(`/boqs/${boqId}/confirm`, { notModelledConfirmed: true }), "confirm");
  if (want === "working" && b.status === "confirmed") must(await own.post(`/boqs/${boqId}/reopen`, { reason: "matrix reset" }), "reopen");
}

const editBoq = pool(() => newBoq("Edits"));
const editBoqPool = () => editBoq;
const T = {
  invitation: pool(async () => must(await own.post(`/orgs/${S.org.id}/invitations`, { email: uniqueEmail("matrix-inv"), role: "member" }), "inv").id as string),
  archivablePreset: pool(orgPreset),
  draftPreset: pool(async () => { const id = await orgPreset(); must(await own.put(`/presets/${id}/draft`, { doc: S.dictDoc }), "draft"); return id; }),
  editPreset: pool(orgPreset),
  projectPreset: pool(async () => must(await lead.post(`/orgs/${S.org.id}/presets`, { kind: "dictionary", name: `Project dict ${stamp()}`, projectId: S.project, start: { mode: "empty" } }), "project preset").id as string),
  decision: pool(decision),
  question: pool(async () => nextQuestion()),
  model: pool(async () => must(await lead.post(`/projects/${S.project}/models`, { name: `Spare model ${stamp()}` }), "model").id as string),
  stagedVersion: pool(async () => must(await lead.post(`/models/${S.model}/versions`, { fileName: `m-${stamp()}.ifc`, sizeBytes: 1000 }), "staged").version.id as string),
  archivableBoq: pool(() => newBoq("Archive me", { run: false })),
  archivedBoq2: pool(async () => { const id = await newBoq("Archived 2", { run: false }); must(await lead.post(`/boqs/${id}/archive`), "archive boq"); return id; }),
  archivedBoq: pool(async () => { const id = await newBoq("Archived", { run: false }); must(await lead.post(`/boqs/${id}/archive`), "archive boq"); return id; }),
  genBoq: pool(() => newBoq("Generate", { run: false })),
  editBoq: editBoqPool(),
  saveBoq: pool(() => newBoq("Save")),
  reviewBoq: pool(() => newBoq("Review")),
  confirmBoq: pool(async () => { const id = await newBoq("Confirm"); must(await lead.post(`/revisions/${(await boqOf(id)).currentRevision.id}/issue`, { notModelledConfirmed: true }), "save for confirm"); return id; }),
  manualItem: pool(async (): Promise<string> => { const b: string = await editBoq.get(); return must(await lead.post(`/boqs/${b}/manual-items`, { item: { id: `m-${stamp()}`, kind: "preliminary", description: "Hoarding", unit: "m", quantity: 1 } }), "manual").id as string; }),
  link: pool(() => shareLink(S.boq, lead)),
  hiddenLink: pool(async () => { S.hiddenBoq ??= await newBoq("Hidden", { run: false, projectId: S.hidden, by: own }); return shareLink(S.hiddenBoq, own); }),
  projectMember: pool(async () => { await own.del(`/projects/${S.project}/members/${ids.S1}`); must(await own.post(`/projects/${S.project}/members`, { userId: ids.S1, role: "viewer" }), "add S1"); return ids.S1!; }),
};

// ───────────── the rows: permissions.md, both tables ─────────────
interface Phase { name: "off" | "on" | "archived"; approval: boolean; archived?: boolean }
interface Row {
  id: string; table: "org" | "project"; action: string; allow: string[] | ((ph: Phase) => string[]); write?: boolean; extra?: boolean;
  in?: Phase["name"][]; last?: boolean; reuse?: boolean; allowedState?: string[]; visible?: (p: Persona) => boolean;
  target?: { get(): Promise<any>; consume(): void; peek(): any }; prepare?: (t: any) => Promise<unknown>;
  call: (a: Api, target: any, p: Persona) => Promise<Res>; after?: (r: Res, target: any, p: Persona) => Promise<unknown>;
}
const reasonBody = { reason: "matrix" };
const P = () => S.project;
const ROWS: Row[] = [
  // ── Org roles ──
  { id: "O1a", table: "org", action: "Rename org", allow: ["owner", "admin"], call: (a) => a.patch(`/orgs/${S.org.id}`, { name: S.org.name }) },
  { id: "O1b", table: "org", action: "Change org settings (publicLinksAllowed)", allow: ["owner", "admin"], call: (a) => a.patch(`/orgs/${S.org.id}`, { settings: { publicLinksAllowed: true } }) },
  { id: "O2a", table: "org", action: "Billing: see", allow: ["owner"], call: (a) => a.get(`/orgs/${S.org.id}/billing`) },
  { id: "O2b", table: "org", action: "Billing: change plan (checkout)", allow: ["owner"], allowedState: ["checkout_unavailable"], call: (a) => a.post(`/orgs/${S.org.id}/billing/checkout`, { planId: "team", returnUrl: "http://localhost:3000/back" }) },
  { id: "O2c", table: "org", action: "Billing: invoices (portal)", allow: ["owner"], allowedState: ["checkout_unavailable", "portal_unavailable", "billing_unavailable"], call: (a) => a.post(`/orgs/${S.org.id}/billing/portal`, { returnUrl: "http://localhost:3000/back" }) },
  { id: "O4a", table: "org", action: "Invite members", allow: ["owner", "admin"], call: (a) => a.post(`/orgs/${S.org.id}/invitations`, { email: uniqueEmail("matrix-inv"), role: "member" }), after: async (r) => r.json?.id && own.del(`/orgs/${S.org.id}/invitations/${r.json.id}`) },
  { id: "O4b", table: "org", action: "Invitations: list", allow: ["owner", "admin"], call: (a) => a.get(`/orgs/${S.org.id}/invitations`) },
  { id: "O4c", table: "org", action: "Invitations: revoke", allow: ["owner", "admin"], target: T.invitation, call: (a, id) => a.del(`/orgs/${S.org.id}/invitations/${id}`) },
  { id: "O4d", table: "org", action: "Change a member's role", allow: ["owner", "admin"], call: (a) => a.patch(`/orgs/${S.org.id}/members/${ids.S1}`, { role: "library_editor" }), after: () => own.patch(`/orgs/${S.org.id}/members/${ids.S1}`, { role: "member" }) },
  { id: "O5", table: "org", action: "Make someone owner", allow: ["owner"], call: (a) => a.patch(`/orgs/${S.org.id}/members/${ids.S1}`, { role: "owner" }), after: () => own.patch(`/orgs/${S.org.id}/members/${ids.S1}`, { role: "member" }) },
  { id: "O4e", table: "org", action: "Remove a member", allow: ["owner", "admin"], call: (a) => a.del(`/orgs/${S.org.id}/members/${ids.S2}`), after: () => reinvite("S2") },
  { id: "O6", table: "org", action: "Create projects", allow: ALL_ORG, call: (a, _, p) => a.post(`/orgs/${S.org.id}/projects`, { name: `Made by ${p} ${stamp()}` }), after: async (r) => r.json?.id && own.post(`/projects/${r.json.id}/archive`) },
  { id: "O7", table: "org", action: "See all projects (the list includes a project they aren't on)", allow: ["owner", "admin"],
    call: async (a) => { const r = await a.get(`/orgs/${S.org.id}/projects`); if (r.status !== 200) return r; const seen = (r.json.items ?? r.json).some((x: any) => x.id === S.hidden); return { ...r, status: seen ? 200 : 403, json: { code: seen ? "listed" : "not_listed", details: { required: "admin" } } }; } }, // a 403 of the test's own, not the API's (TF-013)
  { id: "O8a", table: "org", action: "Library: view org presets (list)", allow: ALL_ORG, call: (a) => a.get(`/orgs/${S.org.id}/presets`) },
  { id: "O8b", table: "org", action: "Library: view an org preset", allow: ALL_ORG, call: (a) => a.get(`/presets/${S.companyDict}`) },
  { id: "O9a", table: "org", action: "Library: create org preset", allow: ["owner", "admin", "library_editor"], call: (a) => a.post(`/orgs/${S.org.id}/presets`, { kind: "dictionary", name: `Created ${stamp()}`, start: { mode: "empty" } }), after: async (r) => r.json?.id && own.post(`/presets/${r.json.id}/archive`) },
  { id: "O9b", table: "org", action: "Library: edit org preset (rename)", allow: ["owner", "admin", "library_editor"], target: T.editPreset, reuse: true, call: (a, id) => a.patch(`/presets/${id}`, { name: `Edited ${stamp()}` }) },
  { id: "O9c", table: "org", action: "Library: edit org preset (save draft)", allow: ["owner", "admin", "library_editor"], target: T.editPreset, reuse: true, call: (a, id) => a.put(`/presets/${id}/draft`, { doc: S.dictDoc }) },
  { id: "O9d", table: "org", action: "Library: publish org preset", allow: ["owner", "admin", "library_editor"], target: T.draftPreset, call: (a, id) => a.post(`/presets/${id}/publish`, { changeNote: "matrix" }) },
  { id: "O9e", table: "org", action: "Library: archive org preset", allow: ["owner", "admin", "library_editor"], target: T.archivablePreset, call: (a, id) => a.post(`/presets/${id}/archive`) },
  // LIB is ✓ in the org table but has no role on the decision's project: 404 (not visible).
  { id: "O10", table: "org", action: "Promote a decision to the company dictionary", allow: ["owner", "admin", "library_editor"], target: T.decision, write: true, visible: (p) => !["LIB", "MEM"].includes(p),
    call: (a, id) => a.post(`/decisions/${id}/promote`, { dictionaryPresetId: S.companyDict }) },
  { id: "O11", table: "org", action: "Finish the setup wizard", allow: ["owner", "admin", "library_editor"], call: (a) => a.put(`/orgs/${S.org.id}/setup`, { status: "done", step: "review" }) },
  { id: "O12", table: "org", action: "See org usage", allow: ["owner", "admin"], call: (a) => a.get(`/orgs/${S.org.id}/usage`) },
  { id: "O13a", table: "org", action: "See org audit log", allow: ["owner", "admin"], call: (a) => a.get(`/orgs/${S.org.id}/audit`) },
  { id: "O13b", table: "org", action: "See org audit log (CSV)", allow: ["owner", "admin"], call: (a) => a.get(`/orgs/${S.org.id}/audit.csv`) },
  { id: "O14a", table: "org", action: "See every share link of the org", allow: ["owner", "admin"], call: (a) => a.get(`/orgs/${S.org.id}/share-links`) },
  { id: "O14b", table: "org", action: "Revoke any share link of the org (in a project they aren't on)", allow: ["owner", "admin"], target: T.hiddenLink, visible: (p) => ["OWN", "ADM"].includes(p), call: (a, id) => a.del(`/share-links/${id}`) },
  { id: "Ox1", table: "org", extra: true, action: "(extra) See the org", allow: ALL_ORG, call: (a) => a.get(`/orgs/${S.org.id}`) },
  { id: "Ox2", table: "org", extra: true, action: "(extra) List org members", allow: ALL_ORG, call: (a) => a.get(`/orgs/${S.org.id}/members`) },
  { id: "Ox3", table: "org", extra: true, action: "(extra) Entitlements", allow: ALL_ORG, call: (a) => a.get(`/orgs/${S.org.id}/entitlements`) },
  { id: "Ox4", table: "org", extra: true, action: "(extra) Setup progress (read)", allow: ALL_ORG, call: (a) => a.get(`/orgs/${S.org.id}/setup`) },

  // ── Project roles ──
  ...([
    ["P1a", "project", (a: Api) => a.get(`/projects/${P()}`)],
    ["P1b", "models", (a: Api) => a.get(`/projects/${P()}/models`)],
    ["P1c", "model", (a: Api) => a.get(`/models/${S.model}`)],
    ["P1d", "model versions", (a: Api) => a.get(`/models/${S.model}/versions`)],
    ["P1e", "model version", (a: Api) => a.get(`/model-versions/${S.version}`)],
    ["P1f", "viewer scene", (a: Api) => a.get(`/model-versions/${S.version}/scene`)],
    ["P1g", "BoQs", (a: Api) => a.get(`/projects/${P()}/boqs`)],
    ["P1h", "BoQ", (a: Api) => a.get(`/boqs/${S.boq}`)],
    ["P1i", "versions (revisions)", (a: Api) => a.get(`/boqs/${S.boq}/revisions`)],
    ["P1j", "saved version", (a: Api) => a.get(`/revisions/${S.saved}`)],
    ["P1k", "lines", (a: Api) => a.get(`/runs/${S.run}/lines?limit=5`)],
    ["P1l", "explanation (line by key)", (a: Api) => a.get(`/runs/${S.run}/lines/by-key?key=${encodeURIComponent(S.lineKey)}`)],
    ["P1m", "calculation log", (a: Api) => a.get(`/runs/${S.run}/log`)],
    ["P1n", "questions", (a: Api) => a.get(`/runs/${S.run}/questions`)],
    ["P1o", "coverage", (a: Api) => a.get(`/runs/${S.run}/coverage`)],
    ["P1p", "saved version's exports", (a: Api) => a.get(`/revisions/${S.saved}/exports`)],
    ["P1q", "export (Excel of a run)", (a: Api) => a.post(`/runs/${S.run}/exports`, { format: "xlsx" })],
    ["P1r", "decisions", (a: Api) => a.get(`/projects/${P()}/decisions`)],
    ["P1s", "project members", (a: Api) => a.get(`/projects/${P()}/members`)],
  ] as [string, string, (a: Api) => Promise<Res>][]).map(([id, what, call]): Row => ({ id, table: "project", action: `See the project: ${what}`, allow: ALL_PROJECT, in: ["P1a", "P1h", "P1j"].includes(id) ? ["off", "archived"] : ["off"], call })),
  { id: "P2a", table: "project", action: "Edit project settings", allow: ["lead"], write: true, call: (a) => a.patch(`/projects/${P()}`, { name: "Matrix Duplex" }) },
  { id: "P2b", table: "project", action: "Archive the project", allow: ["lead"], write: true, in: ["off"], call: (a) => a.post(`/projects/${P()}/archive`), after: () => own.post(`/projects/${P()}/unarchive`) },
  { id: "P2c", table: "project", action: "Restore the archived project", allow: ["lead"], in: ["archived"], last: true, call: (a) => a.post(`/projects/${P()}/unarchive`), after: () => own.post(`/projects/${P()}/archive`) },
  { id: "P3a", table: "project", action: "Manage project members (add)", allow: ["lead"], write: true, call: (a) => a.post(`/projects/${P()}/members`, { userId: ids.S2, role: "viewer" }), after: () => own.del(`/projects/${P()}/members/${ids.S2}`) },
  { id: "P3b", table: "project", action: "Manage project members (change role)", allow: ["lead"], write: true, target: T.projectMember, reuse: true, call: (a, u) => a.patch(`/projects/${P()}/members/${u}`, { role: "estimator" }), after: () => own.patch(`/projects/${P()}/members/${ids.S1}`, { role: "viewer" }) },
  { id: "P3c", table: "project", action: "Manage project members (remove)", allow: ["lead"], write: true, target: T.projectMember, call: (a, u) => a.del(`/projects/${P()}/members/${u}`) },
  { id: "P4a", table: "project", action: "Create models", allow: EDITING, write: true, call: (a) => a.post(`/projects/${P()}/models`, { name: `Model ${stamp()}` }), after: async (r) => r.json?.id && own.del(`/models/${r.json.id}`) },
  { id: "P4b", table: "project", action: "Upload versions (stage an upload)", allow: EDITING, write: true, call: (a) => a.post(`/models/${S.model}/versions`, { fileName: `m-${stamp()}.ifc`, sizeBytes: 1000 }), after: async (r) => r.json?.version?.id && own.del(`/model-versions/${r.json.version.id}`) },
  { id: "P4c", table: "project", action: "Edit model (name, scope)", allow: EDITING, write: true, call: (a) => a.patch(`/models/${S.model}`, { name: "Architecture" }) },
  { id: "P4d", table: "project", action: "Archive a model", allow: EDITING, write: true, target: T.model, call: (a, id) => a.del(`/models/${id}`) },
  { id: "P4e", table: "project", action: "Retry a model version", allow: EDITING, write: true, allowedState: ["invalid_transition", "not_retryable", "not_failed"], call: (a) => a.post(`/model-versions/${S.version}/retry`) },
  { id: "P4f", table: "project", action: "Delete a model version", allow: EDITING, write: true, target: T.stagedVersion, call: (a, id) => a.del(`/model-versions/${id}`) },
  { id: "P5a", table: "project", action: "Create BoQs", allow: EDITING, write: true, call: (a) => a.post(`/projects/${P()}/boqs`, { name: `BoQ ${stamp()}` }), after: async (r) => r.json?.id && own.post(`/boqs/${r.json.id}/archive`) },
  { id: "P5b", table: "project", action: "Edit inputs", allow: EDITING, write: true, target: T.genBoq, reuse: true,
    call: async (a, b) => { const rev = (await boqOf(b)).currentRevision; return a.patch(`/revisions/${rev.id}`, { inputs: { classificationVersionIds: rev.inputs.classificationVersionIds ?? [] } }); } },
  { id: "P5c", table: "project", action: "Rename a BoQ", allow: EDITING, write: true, target: T.genBoq, reuse: true, call: (a, b) => a.patch(`/boqs/${b}`, { name: `Generate ${stamp()}` }) },
  { id: "P5d", table: "project", action: "Generate runs", allow: EDITING, write: true, target: T.genBoq, reuse: true,
    call: async (a, b) => a.post(`/revisions/${(await boqOf(b)).currentRevision.id}/runs`), after: async (r) => r.json?.job?.id && waitJob(own, r.json.job.id) },
  { id: "P5e", table: "project", action: "Archive a BoQ", allow: ["lead"], write: true, target: T.archivableBoq, call: (a, b) => a.post(`/boqs/${b}/archive`) },
  { id: "P5f", table: "project", action: "Restore an archived BoQ", allow: ["lead"], write: true, target: T.archivedBoq, call: (a, b) => a.patch(`/boqs/${b}`, { archived: false }) },
  { id: "P5g", table: "project", action: "Restore an archived BoQ and rename it in one PATCH", allow: ["lead"], write: true, in: ["archived"], target: T.archivedBoq2, reuse: true,
    call: (a, b, p) => a.patch(`/boqs/${b}`, { archived: false, name: `Renamed by ${p}` }) },
  { id: "P6a", table: "project", action: "Answer questions", allow: EDITING, write: true, target: T.question, call: (a, q) => a.post(`/projects/${P()}/decisions`, { decisions: [answerOf(q)], addToProjectDictionary: false }) },
  { id: "P6b", table: "project", action: "Clear an answer", allow: EDITING, write: true, target: T.decision, call: (a, id) => a.del(`/decisions/${id}`) },
  { id: "P7a", table: "project", action: "Edit lines (quantity)", allow: EDITING, write: true, target: T.editBoq, reuse: true,
    call: async (a, b) => { const run = (await boqOf(b)).currentRevision.currentRun; const line = (await own.get(`/runs/${run.id}/lines?limit=20`)).json.items.find((l: any) => l.quantity > 1); return a.post(`/boqs/${b}/overrides`, { lineKey: line.key, quantity: Math.round(line.quantity * 2), reason: "matrix" }); } },
  { id: "P7b", table: "project", action: "Add manual lines", allow: EDITING, write: true, target: T.editBoq, reuse: true,
    call: (a, b) => a.post(`/boqs/${b}/manual-items`, { item: { id: `m-${stamp()}`, kind: "preliminary", description: "Hoarding", unit: "m", quantity: 1 } }), after: async (r) => r.json?.id && own.del(`/manual-items/${r.json.id}`) },
  { id: "P7c", table: "project", action: "Remove a manual line", allow: EDITING, write: true, target: T.manualItem, call: (a, id) => a.del(`/manual-items/${id}`) },
  { id: "P8a", table: "project", action: "Edit project-layer presets (create)", allow: EDITING, write: true,
    call: (a) => a.post(`/orgs/${S.org.id}/presets`, { kind: "dictionary", name: `Proj ${stamp()}`, projectId: P(), start: { mode: "empty" } }), after: async (r) => r.json?.id && own.post(`/presets/${r.json.id}/archive`) },
  { id: "P8b", table: "project", action: "Edit project-layer presets (rename)", allow: EDITING, write: true, target: T.projectPreset, reuse: true, call: (a, id) => a.patch(`/presets/${id}`, { name: `Proj ${stamp()}` }) },
  { id: "P9", table: "project", action: "Save version (approval off)", allow: (ph) => (ph.approval ? ["lead", "approver"] : EDITING), write: true, in: ["off", "archived"], target: T.saveBoq,
    call: async (a, b) => a.post(`/revisions/${(await ready(b)).id}/issue`, { notModelledConfirmed: true }) },
  { id: "P9v", table: "project", action: "Save version, approval on, not approved", allow: ["lead", "approver"], write: true, in: ["on"], allowedState: ["not_approved"], target: T.reviewBoq, reuse: true,
    prepare: (b) => reviewState(b, "draft"), call: async (a, b) => a.post(`/revisions/${(await ready(b)).id}/issue`, { notModelledConfirmed: true }) },
  { id: "P10v", table: "project", action: "Submit for review, approval off", allow: EDITING, write: true, in: ["off"], allowedState: ["approval_off"], target: T.saveBoq, reuse: true,
    call: async (a, b) => a.post(`/revisions/${(await ready(b)).id}/submit`, { reviewerIds: [ids.APR], notModelledConfirmed: true }) },
  { id: "P11v", table: "project", action: "Approve, approval off", allow: ["lead", "approver"], write: true, in: ["off"], allowedState: ["invalid_transition", "approval_off"], target: T.saveBoq, reuse: true,
    call: async (a, b) => a.post(`/revisions/${(await revisionStatus(b)).id}/approve`, {}) },
  { id: "P10", table: "project", action: "Submit for review (approval on)", allow: EDITING, write: true, in: ["on", "archived"], target: T.reviewBoq, reuse: true,
    prepare: (b) => reviewState(b, "draft"), call: async (a, b) => a.post(`/revisions/${(await ready(b)).id}/submit`, { reviewerIds: [ids.APR], notModelledConfirmed: true }) },
  { id: "P11a", table: "project", action: "Approve (approval on)", allow: ["lead", "approver"], write: true, in: ["on", "archived"], target: T.reviewBoq, reuse: true,
    prepare: (b) => reviewState(b, "in_review"), call: async (a, b) => a.post(`/revisions/${(await revisionStatus(b)).id}/approve`, {}) },
  { id: "P11b", table: "project", action: "Request changes (approval on)", allow: ["lead", "approver"], write: true, in: ["on", "archived"], target: T.reviewBoq, reuse: true,
    prepare: (b) => reviewState(b, "in_review"), call: async (a, b) => a.post(`/revisions/${(await revisionStatus(b)).id}/request-changes`, { comment: "matrix: please change" }) },
  { id: "P11c", table: "project", action: "Save the approved version (approval on)", allow: ["lead", "approver"], write: true, in: ["on", "archived"], target: T.reviewBoq, reuse: true,
    prepare: (b) => reviewState(b, "approved"), call: async (a, b) => a.post(`/revisions/${(await revisionStatus(b)).id}/issue`, { notModelledConfirmed: true }) },
  { id: "P11d", table: "project", extra: true, action: "(extra) Review comment (approval on)", allow: ["lead", "estimator", "approver"], write: true, in: ["on", "archived"], target: T.reviewBoq, reuse: true,
    prepare: (b) => reviewState(b, "in_review"), call: async (a, b) => a.post(`/revisions/${(await revisionStatus(b)).id}/comments`, { text: "matrix comment" }) },
  { id: "P11e", table: "project", extra: true, action: "(extra) Withdraw a review (approval on)", allow: ["lead", "estimator", "approver"], write: true, in: ["on", "archived"], target: T.reviewBoq, reuse: true,
    prepare: (b) => reviewState(b, "in_review"), call: async (a, b) => a.post(`/revisions/${(await revisionStatus(b)).id}/reopen`) },
  { id: "P12", table: "project", action: "Confirm a BoQ", allow: (ph) => (ph.approval ? ["lead", "approver"] : ["lead"]), write: true, in: ["off", "on", "archived"], target: T.confirmBoq, reuse: true,
    prepare: (b) => confirmedState(b, "working"), call: (a, b) => a.post(`/boqs/${b}/confirm`, {}) },
  { id: "P13", table: "project", action: "Reopen a confirmed BoQ", allow: ["lead"], write: true, in: ["off", "on", "archived"], target: T.confirmBoq, reuse: true,
    prepare: (b) => confirmedState(b, "confirmed"), call: (a, b) => a.post(`/boqs/${b}/reopen`, reasonBody) },
  { id: "P14a", table: "project", action: "Create share links", allow: ["lead", "estimator", "approver"], write: true, call: (a) => a.post(`/boqs/${S.boq}/share-links`, { mode: "latest_issued", label: `m ${stamp()}` }),
    after: async (r) => r.json?.id && own.del(`/share-links/${r.json.id}`) },
  { id: "P14b", table: "project", action: "Edit share links", allow: ["lead", "estimator", "approver"], write: true, target: T.link, reuse: true, call: (a, id) => a.patch(`/share-links/${id}`, { label: `edited ${stamp()}` }) },
  { id: "P14c", table: "project", extra: true, action: "(extra) List share links of a BoQ", allow: ALL_PROJECT, call: (a) => a.get(`/boqs/${S.boq}/share-links`) },
  { id: "P15", table: "project", action: "Revoke any share link of the project (the lead's link)", allow: ["lead", "approver"], write: true, target: T.link, call: (a, id) => a.del(`/share-links/${id}`) },
  { id: "P16a", table: "project", action: "Project audit log", allow: ["lead", "approver"], in: ["off", "archived"], call: (a) => a.get(`/projects/${P()}/audit`) },
  { id: "P16b", table: "project", action: "Project audit log (CSV)", allow: ["lead", "approver"], call: (a) => a.get(`/projects/${P()}/audit.csv`) },
];

/** Expected answer of a row for a persona: `ok` (2xx or an allowed state code) or a status (and code). */
function expected(row: Pick<Row, "table" | "allow" | "write" | "visible">, p: Persona, phase: Phase): { ok: true } | { status: number[]; code?: string } {
  if (p === "ANON") return { status: [401] };
  if (p === "PADM" || p === "X") return { status: [404] };
  const allow = typeof row.allow === "function" ? row.allow(phase) : row.allow;
  if (row.table === "org") {
    if (row.visible && !row.visible(p)) return { status: [404] };
    const ok = allow.includes(ORG_ROLE[p]!);
    if (phase.archived && row.write) return ok ? { status: [409], code: "project_archived" } : { status: [403, 409] };
    return ok ? { ok: true } : { status: [403] };
  }
  const role = PROJECT_ROLE[p];
  if (!role) return { status: [404] };
  const ok = allow.includes(role);
  if (phase.archived && row.write) return ok ? { status: [409], code: "project_archived" } : { status: [403, 409] };
  return ok ? { ok: true } : { status: [403] };
}

/** Cells that fail because of an open finding (Stage 3 matrix, results.json): `phase:row:persona`. */
const KNOWN: Record<string, string> = {};
/** Writes an archived project still allows (permissions.md, P54: Q42 revoke a share link, promote a name answer; TF-012 c, d). */
const ARCHIVED_ALLOWED = ["P2c", "P15", "O10"];

const PHASES: (Phase & { setup: () => Promise<unknown>; teardown?: () => Promise<unknown> })[] = [
  { name: "off", approval: false, setup: () => setApproval(false) },
  { name: "on", approval: true, setup: () => setApproval(true, true) },
  { name: "archived", approval: true, archived: true, setup: primeArchived, teardown: () => own.post(`/projects/${P()}/unarchive`) },
];
async function primeArchived() {
  await setApproval(true, true);
  await T.decision.get();
  await T.question.get();
  await reviewState(await T.reviewBoq.get(), "in_review");
  await confirmedState(await T.confirmBoq.get(), "working");
  for (const t of [T.archivableBoq, T.archivedBoq, T.archivedBoq2, T.genBoq, T.editBoq, T.saveBoq, T.manualItem, T.link, T.projectMember, T.model, T.stagedVersion, T.projectPreset]) await t.get();
  if ((await own.get(`/projects/${P()}`)).json.status !== "archived") must(await own.post(`/projects/${P()}/archive`), "archive the project");
}
const phasesOf = (row: Row) => row.in ?? (row.write ? ["off", "archived"] : ["off"]);
const FIRST = ["P6a", "P6b", "O10"];
const order = [...ROWS.filter((r) => FIRST.includes(r.id)), ...ROWS.filter((r) => !FIRST.includes(r.id) && !r.last), ...ROWS.filter((r) => r.last)];

/** The project permission keys permissions.md promises (the approval setting matters for approve and confirm). */
function specKeys(p: Persona, phase: Phase) {
  const role = PROJECT_ROLE[p];
  const leadRole = role === "lead", estimator = role === "estimator", approver = role === "approver";
  const w = (v: boolean) => v && !phase.archived;
  return {
    // P54 Q53 (TF-090): `archive` stays true on an archived project, to unarchive it.
    view: true, edit: w(leadRole), archive: leadRole, manageMembers: w(leadRole),
    editModels: w(leadRole || estimator), editBoqs: w(leadRole || estimator), answerQuestions: w(leadRole || estimator), editLines: w(leadRole || estimator),
    editPresets: w(leadRole || estimator), saveVersion: w(leadRole || estimator),
    approve: w(phase.approval && (leadRole || approver)), confirm: w(leadRole || (phase.approval && approver)), reopen: w(leadRole),
    share: w(leadRole || estimator || approver), revokeShares: leadRole || approver, seeAudit: leadRole || approver,
  };
}
const KNOWN_KEYS: Record<string, string> = {};

for (const phase of PHASES) {
  describe(`role matrix, ${phase.name === "off" ? "approval off" : phase.name === "on" ? "approval on" : "project archived"} (permissions.md, TF-092)`, () => {
    beforeAll(async () => {
      await phase.setup();
      ARCHIVED = !!phase.archived;
    }, 600_000);
    afterAll(async () => {
      if (phase.teardown) await phase.teardown();
      ARCHIVED = false;
    });

    for (const p of Object.keys(PROJECT_ROLE) as Persona[]) {
      const known = KNOWN_KEYS[`${phase.name}:${p}`];
      (known ? it.fails : it)(`${known ? `${known}: ` : ""}the project's permission keys as ${p} are permissions.md's`, async () => {
        const keys = (await as(p).get(`/projects/${P()}`)).json.permissions;
        expect(keys).toEqual(specKeys(p, phase));
      });
    }
    if (phase.archived) {
      it("TF-012: a BoQ's revision keys in an archived project allow only view and seeAudit", async () => {
        const rev = (await lead.get(`/boqs/${await T.reviewBoq.get()}`)).json.currentRevision.permissions;
        expect(Object.entries(rev).filter(([, v]) => v === true).map(([k]) => k).sort()).toEqual(["seeAudit", "view"]);
      });
      it("a share link's keys in an archived project: no edit, but the lead may revoke it (P54 Q42)", async () => {
        const link = (await lead.get(`/boqs/${S.boq}/share-links`)).json.find((l: any) => l.id === T.link.peek());
        expect(link?.permissions).toMatchObject({ edit: false, revoke: true });
      });
    }

    for (const row of order.filter((r) => phasesOf(r).includes(phase.name))) {
      for (const p of PERSONAS) {
        const known = KNOWN[`${phase.name}:${row.id}:${p}`];
        const exp = phase.archived && ARCHIVED_ALLOWED.includes(row.id) ? expected({ ...row, write: false }, p, phase) : expected(row, p, phase);
        const want = "ok" in exp ? "2xx" : exp.status.join("/") + (exp.code ? ` ${exp.code}` : "");
        (known ? it.fails : it)(`${known ? `${known}: ` : ""}${row.id} ${row.action}: ${p} → ${want}`, async () => {
          const target = row.target ? await row.target.get() : undefined;
          if (row.prepare && !phase.archived) await row.prepare(target);
          const res = await row.call(as(p === "ANON" ? null : p), target, p);
          if (res.status === 403) denials.push({ row: row.id, persona: p, details: res.json?.details ?? null });
          if (res.status >= 200 && res.status < 300) {
            if (row.target && !row.reuse && !phase.archived) row.target.consume();
            if (row.after) await row.after(res, target, p);
          }
          if ("ok" in exp) {
            const allowed = (row.allowedState ?? []).includes(res.json?.code);
            expect(res.status >= 200 && res.status < 300 || allowed, `${res.status} ${res.text.slice(0, 200)}`).toBe(true);
          } else {
            expect(exp.status, `${res.status} ${res.text.slice(0, 200)}`).toContain(res.status);
            if (exp.code) expect(res.json?.code).toBe(exp.code);
          }
        });
      }
    }
  });
}

describe("search and direct reads (C3, S7)", () => {
  beforeAll(() => setApproval(false));
  const listed = async (p: Persona, q?: string) => {
    const r = await as(p === "ANON" ? null : p).get(`/orgs/${S.org.id}/projects${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    return r.status === 200 ? (r.json.items ?? r.json).map((x: any) => x.id) as string[] : r.status;
  };
  it("C3: a member without a project role doesn't see it in the list or by its URLs (404)", async () => {
    const list = await listed("MEM");
    expect(Array.isArray(list) && !list.includes(P())).toBe(true);
    for (const path of [`/projects/${P()}`, `/boqs/${S.boq}`, `/runs/${S.run}/lines`, `/models/${S.model}`, `/revisions/${S.saved}`, `/projects/${P()}/decisions`]) {
      expect((await as("MEM").get(path)).status, path).toBe(404);
    }
  });
  it.each(PERSONAS.filter((p) => p !== "ANON"))("S7: searching projects as %s finds what the role sees", async (p) => {
    const hit = await listed(p, "Matrix");
    if (p === "X" || p === "PADM") return expect(hit).toBe(404);
    expect(Array.isArray(hit)).toBe(true);
    expect((hit as string[]).includes(P())).toBe(!!PROJECT_ROLE[p]);
    expect((hit as string[]).includes(S.hidden)).toBe(p === "OWN" || p === "ADM");
  });
  it("S7: searching as nobody is 401", async () => {
    expect(await listed("ANON", "Matrix")).toBe(401);
  });
});

describe("four-eyes and approval variants (F09 §4, BR-24)", () => {
  let boq: string;
  beforeAll(async () => {
    boq = await newBoq("Four eyes");
    await setApproval(true, true);
  }, 300_000);
  afterAll(() => setApproval(false));

  it("four-eyes on: the submitting lead can't approve or save; another approver can", async () => {
    const rev = await ready(boq);
    must(await lead.post(`/revisions/${rev.id}/submit`, { reviewerIds: [ids.APR, ids.LEAD], notModelledConfirmed: true }), "submit");
    expect((await lead.get(`/boqs/${boq}`)).json.currentRevision.permissions.approve).toBe(false);
    expect(await lead.post(`/revisions/${rev.id}/approve`, {})).toMatchObject({ status: 403, json: { code: "four_eyes" } });
    must(await apr.post(`/revisions/${rev.id}/approve`, {}), "approve");
    expect((await lead.get(`/boqs/${boq}`)).json.currentRevision.permissions.saveApproved).toBe(false);
    expect(await lead.post(`/revisions/${rev.id}/issue`, { notModelledConfirmed: true })).toMatchObject({ status: 403, json: { code: "four_eyes" } });
    expect((await apr.post(`/revisions/${rev.id}/issue`, { notModelledConfirmed: true })).status).toBeLessThan(300);
  }, 300_000);
  it("four-eyes on: the owner who submitted can't approve either", async () => {
    const rev = await ready(boq);
    must(await own.post(`/revisions/${rev.id}/submit`, { reviewerIds: [ids.APR], notModelledConfirmed: true }), "submit");
    expect(await own.post(`/revisions/${rev.id}/approve`, {})).toMatchObject({ status: 403, json: { code: "four_eyes" } });
    must(await own.post(`/revisions/${rev.id}/reopen`), "withdraw");
  }, 300_000);
  it("four-eyes off: the submitting lead approves and saves", async () => {
    await setApproval(true, false);
    const rev = await ready(boq);
    must(await lead.post(`/revisions/${rev.id}/submit`, { reviewerIds: [ids.LEAD], notModelledConfirmed: true }), "submit");
    expect((await lead.get(`/boqs/${boq}`)).json.currentRevision.permissions.approve).toBe(true);
    expect((await lead.post(`/revisions/${rev.id}/approve`, {})).status).toBeLessThan(300);
    expect((await lead.post(`/revisions/${rev.id}/issue`, { notModelledConfirmed: true })).status).toBeLessThan(300);
  }, 300_000);
  it("approval on: an estimator can't approve; a viewer can't request changes", async () => {
    await setApproval(true, true);
    const rev = await ready(boq);
    must(await est.post(`/revisions/${rev.id}/submit`, { reviewerIds: [ids.APR], notModelledConfirmed: true }), "submit");
    expect((await est.post(`/revisions/${rev.id}/approve`, {})).status).toBe(403);
    expect((await as("VIEW").post(`/revisions/${rev.id}/request-changes`, { comment: "no" })).status).toBe(403);
    must(await est.post(`/revisions/${rev.id}/reopen`), "withdraw");
  }, 300_000);
});

describe("keys and refusals beyond the tables", () => {
  beforeAll(() => setApproval(false));
  it("TF-015: with approval off, an approver's project keys approve and confirm are false", async () => {
    expect((await apr.get(`/projects/${P()}`)).json.permissions).toMatchObject({ approve: false, confirm: false });
  });
  it("with approval off, an approver's revision keys approve and confirm are false", async () => {
    expect((await apr.get(`/boqs/${S.boq}`)).json.currentRevision.permissions).toMatchObject({ approve: false, confirm: false });
  });
  it.each(["VIEW", "APR"] as const)("TF-020: %s may not retry a model version; editModels is false", async (p) => {
    expect((await as(p).get(`/projects/${P()}`)).json.permissions.editModels).toBe(false);
    expect((await as(p).post(`/model-versions/${S.version}/retry`)).status).toBe(403);
  });
  it("TF-014: a library editor who is a viewer on the project previews an org rule set on its version", async () => {
    must(await own.post(`/projects/${P()}/members`, { userId: ids.LIB, role: "viewer" }), "LIB viewer");
    try {
      expect((await as("LIB").post(`/presets/${S.orgRuleSet}/preview`, { modelVersionIds: [S.version] })).status).toBeLessThan(300);
    } finally {
      await own.del(`/projects/${P()}/members/${ids.LIB}`);
    }
  });
});

describe("the admin paths (BR-57, TF-011)", () => {
  const paths = ["/admin/orgs", "/%61dmin/orgs", "/adm%69n/overview", "/%61dmin/users"];
  it.each(PERSONAS.flatMap((p) => paths.map((path) => [p, path] as const)))("%s GET %s", async (p, path) => {
    const r = await call(p === "ANON" ? null : p, "GET", path);
    expect(r.status).toBe(p === "PADM" ? 200 : p === "ANON" ? 401 : 404);
  });
  it.each(PERSONAS)("%s PATCH /%61dmin/orgs/{org}", async (p) => {
    const r = await call(p === "ANON" ? null : p, "PATCH", `/%61dmin/orgs/${S.org.id}`, { tags: ["matrix"], reason: "matrix probe" });
    if (p === "PADM") expect(r.status).toBeLessThan(300);
    else expect(r.status).toBe(p === "ANON" ? 401 : 404);
  });
  it.each([["org", () => `/orgs/${S.org.id}`], ["project", () => `/projects/${P()}`], ["BoQ", () => `/boqs/${S.boq}`], ["lines", () => `/runs/${S.run}/lines`]] as const)(
    "BR-57: the platform admin can't read the %s by their platform role (404)", async (_what, path) => {
      expect((await as("PADM").get(path())).status).toBe(404);
    });
});

describe("refusal bodies and deleting the org (permissions.md 'Errors')", () => {
  it("TF-013: every 403 of the matrix carries details.required", () => {
    expect(denials.length).toBeGreaterThan(0);
    expect(denials.filter((d) => (d.details as { required?: unknown } | null)?.required === undefined)).toEqual([]);
  });
  it.each(PERSONAS.filter((p) => p !== "OWN"))("O3 Delete org as %s is refused", async (p) => {
    const r = await call(p === "ANON" ? null : p, "DELETE", `/orgs/${S.org.id}`, { confirmName: S.org.name });
    const exp = expected({ table: "org", allow: ["owner"] }, p, { name: "off", approval: false });
    expect("status" in exp && exp.status).toContain(r.status);
  });
  it("O3 Delete org as its owner (a throwaway org of their own)", async () => {
    const org = must(await own.post("/orgs", { name: "Matrix Throwaway", slug: `matrix-throwaway-${stamp()}` }), "throwaway org");
    expect((await own.del(`/orgs/${org.id}`, { confirmName: "Matrix Throwaway" })).status).toBeLessThan(300);
  });
});
