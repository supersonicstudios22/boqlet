// LEAD-004, LEAD-009, ENG-016, ENG-024, LEAD-021 on VB A Firm's Duplex sample.
import { session, ctx, show, arr, waitJob } from "./lib.mjs";
const a = await session("vb-a@review.test");
const { org, project } = await ctx(a);
show("settings", await a.call("PATCH", `/orgs/${org.id}`, { settings: { approvalRequired: true, fourEyes: true } }));
const users = Object.fromEntries(arr((await a.call("GET", `/orgs/${org.id}/members`)).json).map((m) => [m.user.email.split("@")[0], m.user.id]));
for (const [u, role] of [["vb-est", "estimator"], ["vb-appr", "approver"], ["vb-view", "viewer"], ["vb-adm", "estimator"]]) {
  show(`add ${u} as ${role}`, await a.call("POST", `/projects/${project.id}/members`, { userId: users[u], role }));
}
console.log("members:", JSON.stringify(arr((await a.call("GET", `/projects/${project.id}/members`)).json).map((x) => [x.user.email, x.role])));
const boq = arr((await a.call("GET", `/projects/${project.id}/boqs`)).json).find((b) => b.name === "Duplex quantities");
const rev = boq.currentRevision.id;
const est = await session("vb-est@review.test");
// LEAD-004: estimator edits a line, regenerates, shares the working version
const lines = (await est.call("GET", `/runs/${boq.currentRevision.currentRun.id}/lines?limit=100`)).json.items;
const target = lines.find((l) => l.quantity && l.unit === "m2");
console.log("target line", target.key, target.description, target.quantity);
show("est edit line -> 999", await est.call("POST", `/boqs/${boq.id}/overrides`, { lineKey: target.key, quantity: 999, reason: "unchecked draft figure" }));
const gen = await est.call("POST", `/revisions/${rev}/runs`);
show("est regenerate", gen);
if (gen.json.job) console.log("job", (await waitJob(est.call, gen.json.job.id)).status);
const link = await est.call("POST", `/boqs/${boq.id}/share-links`, { mode: "pinned", revisionId: rev });
show("est pinned share of working draft (approval+fourEyes on)", link);
const token = link.json.url?.split("/s/")[1];
const pub = await fetch(`http://127.0.0.1:8080/api/v1/public/shares/${token}`);
const pj = await pub.json();
console.log("public share", pub.status, JSON.stringify({ revisionStatus: pj.revisionStatus, label: pj.revisionLabel ?? pj.label, keys: Object.keys(pj) }));
const pl = await (await fetch(`http://127.0.0.1:8080/api/v1/public/shares/${token}/lines?limit=100`)).json();
const pline = pl.items.find((l) => l.key === target.key);
console.log("public line", pline?.quantity, JSON.stringify(pline?.overridden ?? null));
// ENG-016: submit to an org admin whose stored project role is estimator
show("est submit to vb-adm (org admin, stored role estimator)", await est.call("POST", `/revisions/${rev}/submit`, { reviewerIds: [users["vb-adm"]], notModelledConfirmed: true }));
show("est submit to vb-a (owner)", await est.call("POST", `/revisions/${rev}/submit`, { reviewerIds: [users["vb-a"]], notModelledConfirmed: true }));
console.log("cur rev", JSON.stringify((await est.call("GET", `/revisions/${rev}`)).json).slice(0, 400));
