// LEAD-008: with two starred rule sets, new projects take the most recently *updated* one (a draft save counts).
import { session, ctx, show, arr } from "./lib.mjs";
const lib = await session("vb-lib@review.test");
const a = await session("vb-a@review.test");
const { org } = await ctx(a);
const asModelled = "9d493c18-59b5-3526-8341-2b9f9797b59b";
const R = arr((await lib.call("GET", `/orgs/${org.id}/presets?kind=rule_set`)).json).find((p) => p.name === "VB measuring rules");
const r2 = (await lib.call("POST", `/orgs/${org.id}/presets`, { kind: "rule_set", name: "VB second rules", start: { mode: "copy", fromVersionId: asModelled } })).json;
const r2v1 = (await lib.call("POST", `/presets/${r2.id}/publish`, { changeNote: "v1" })).json;
await lib.call("PATCH", `/presets/${r2.id}`, { starred: true });
const p1 = (await a.call("POST", `/orgs/${org.id}/projects`, { name: "VB starred 1" })).json;
console.log("project 1 rule set:", p1.defaults.ruleSetVersionId === r2v1.id ? "VB second rules" : p1.defaults.ruleSetVersionId);
const head = (await lib.call("GET", `/presets/${R.id}`)).json;
const doc = (await lib.call("GET", `/preset-versions/${head.latestPublishedVersion.id}`)).json.doc;
show("draft save on VB measuring rules (no publish)", await lib.call("PUT", `/presets/${R.id}/draft`, { doc: { ...doc, name: "VB measuring rules (draft)" } }));
const p2 = (await a.call("POST", `/orgs/${org.id}/projects`, { name: "VB starred 2" })).json;
console.log("project 2 rule set:", p2.defaults.ruleSetVersionId === head.latestPublishedVersion.id ? "VB measuring rules v" + head.latestPublishedVersion.number : p2.defaults.ruleSetVersionId === r2v1.id ? "VB second rules" : p2.defaults.ruleSetVersionId);
await lib.call("DELETE", `/presets/${R.id}/draft`);
