// LEAD-001: promotion published while a library editor's draft (based on v1) is open; then the draft is published.
import { session, ctx, show, arr } from "./lib.mjs";
const a = await session("vb-a@review.test");
const lib = await session("vb-lib@review.test");
const est = await session("vb-est@review.test");
const { org, project } = await ctx(a);
let r = await lib.call("POST", `/orgs/${org.id}/presets`, { kind: "dictionary", name: "VB firm names", start: { mode: "empty" } });
show("create dict", r); const D = r.json.id;
show("publish v1", await lib.call("POST", `/presets/${D}/publish`, { changeNote: "Start" }));
let head = (await lib.call("GET", `/presets/${D}`)).json;
const v1 = (await lib.call("GET", `/preset-versions/${head.latestPublishedVersion.id}`)).json;
const own = { id: "lib-entry-1", term: "space.kitchen", field: "space_name", match: { exact: "Kueche" }, source: "user", caseSensitive: true };
r = await lib.call("PUT", `/presets/${D}/draft`, { doc: { ...v1.doc, entries: [...(v1.doc.entries ?? []), own] } });
console.log("lib opens draft from v1 with own entry", r.status, "problems", JSON.stringify(r.json.problems ?? []).slice(0, 200));
// estimator answers a name question in the project; owner promotes it
r = await est.call("POST", `/projects/${project.id}/decisions`, { decisions: [{ questionId: "name:space_name:Roof", kind: "unknown_name", answer: "space.bedroom" }], addToProjectDictionary: false });
show("est answers Roof", r);
const dec = arr((await a.call("GET", `/projects/${project.id}/decisions`)).json).find((d) => d.questionId === "name:space_name:Roof");
show("owner promotes Roof", await a.call("POST", `/decisions/${dec.id}/promote`, { dictionaryPresetId: D }));
head = (await lib.call("GET", `/presets/${D}`)).json;
console.log("head after promotion: latest", head.latestPublishedVersion?.number, "draft", JSON.stringify(head.draft ?? null).slice(0, 200));
show("lib publishes stale draft", await lib.call("POST", `/presets/${D}/publish`, { changeNote: "Add Kueche" }));
for (const v of arr((await lib.call("GET", `/presets/${D}/versions`)).json)) {
  const full = (await lib.call("GET", `/preset-versions/${v.id}`)).json;
  console.log(` v${v.number} ${v.status} | ${v.changeNote} | entries: ${(full.doc.entries ?? []).map((e) => e.id + "->" + e.term).join("; ")}`);
}
const after = arr((await a.call("GET", `/projects/${project.id}/decisions`)).json).find((d) => d.questionId === "name:space_name:Roof");
console.log("decision promoted to", JSON.stringify(after.promotedTo ?? after.promotedToPresetVersionId ?? after.promoted));
