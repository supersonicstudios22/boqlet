import { session } from "./api.mjs";
const A = { org: "01a2076f-a171-721e-80ec-f3f95f69d811", project: "01a2076f-aa96-7e11-87e7-fd9c2120e8bb", project2: "01a20770-5fa2-70f4-8c5a-ffd38e459ac3",
  boq: "01a20772-045c-7e5f-b052-2d9ebe12cc44", rev: "01a20772-045c-7dba-a5c7-89cf925a438a", run: "01a20772-06d6-7311-8793-e4e91ebbe503",
  job: "01a20772-06e4-763a-8206-53843d117d27", parseJob: "01a20770-638d-72f4-bec4-119767ee81fc", preset: "01a2076f-aa96-7f50-bef9-03557ddfce1a",
  decision: "01a20770-4880-7909-8209-8a9d77bb0bfa", model: "01a20770-6074-7ec4-9589-79ae23e358e7", version: "01a20770-6105-7532-8b26-dbee04d2467c" };
const a = await session("eng-a@review.test");
// make some A-owned objects
const share = await a.call("POST", `/boqs/${A.boq}/share-links`, { mode: "pinned", revisionId: A.rev });
console.log("A share", share.status, JSON.stringify(share.json).slice(0, 200));
const exp = await a.call("POST", `/runs/${A.run}/exports`, {});
console.log("A export", exp.status, JSON.stringify(exp.json).slice(0, 200));
const b = await session("eng-b@review.test");
const tries = [
  ["GET", `/orgs/${A.org}`], ["GET", `/orgs/${A.org}/members`], ["GET", `/orgs/${A.org}/presets`], ["GET", `/orgs/${A.org}/audit`],
  ["GET", `/orgs/${A.org}/share-links`], ["GET", `/orgs/${A.org}/usage`], ["GET", `/orgs/${A.org}/entitlements`], ["GET", `/orgs/${A.org}/projects`],
  ["GET", `/projects/${A.project}`], ["GET", `/projects/${A.project}/models`], ["GET", `/projects/${A.project}/boqs`], ["GET", `/projects/${A.project}/decisions`],
  ["GET", `/projects/${A.project}/decisions.csv`], ["GET", `/projects/${A.project}/audit`], ["GET", `/projects/${A.project}/members`],
  ["GET", `/boqs/${A.boq}`], ["GET", `/boqs/${A.boq}/revisions`], ["GET", `/boqs/${A.boq}/overrides`], ["GET", `/boqs/${A.boq}/manual-items`], ["GET", `/boqs/${A.boq}/share-links`],
  ["GET", `/revisions/${A.rev}`], ["GET", `/revisions/${A.rev}/comments`], ["GET", `/runs/${A.run}`], ["GET", `/runs/${A.run}/result`], ["GET", `/runs/${A.run}/lines`],
  ["GET", `/runs/${A.run}/questions`], ["GET", `/runs/${A.run}/warnings`], ["GET", `/runs/${A.run}/log`], ["GET", `/runs/${A.run}/coverage`],
  ["GET", `/jobs/${A.job}`], ["GET", `/jobs/${A.parseJob}`], ["POST", `/jobs/${A.job}/cancel`], ["GET", `/presets/${A.preset}`], ["GET", `/presets/${A.preset}/versions`], ["GET", `/presets/${A.preset}/usage`],
  ["GET", `/presets/${A.preset}/template.xlsx`], ["PATCH", `/decisions/${A.decision}`, { answer: "exclude" }], ["DELETE", `/decisions/${A.decision}`],
  ["GET", `/models/${A.model}`], ["GET", `/models/${A.model}/versions`], ["GET", `/model-versions/${A.version}`], ["GET", `/model-versions/${A.version}/geometry`],
  ["GET", `/model-versions/${A.version}/scene`], ["GET", `/model-versions/${A.version}/names`], ["DELETE", `/model-versions/${A.version}`],
  ["POST", `/revisions/${A.rev}/runs`], ["POST", `/boqs/${A.boq}/share-links`, { mode: "pinned", revisionId: A.rev }], ["POST", `/runs/${A.run}/exports`, {}],
  ["POST", `/projects/${A.project}/models`, { name: "x", discipline: "architecture" }], ["PATCH", `/boqs/${A.boq}`, { name: "pwned" }],
];
if (share.json?.id) tries.push(["GET", `/share-links/${share.json.id}`], ["DELETE", `/share-links/${share.json.id}`], ["PATCH", `/share-links/${share.json.id}`, { label: "x" }]);
const expId = exp.json?.id ?? exp.json?.export?.id;
if (expId) tries.push(["GET", `/exports/${expId}`], ["GET", `/exports/${expId}/download`]);
for (const [m, p, body] of tries) {
  const r = await b.call(m, p, body);
  console.log(String(r.status).padEnd(4), m.padEnd(6), p.replace(/[0-9a-f-]{36}/g, (x) => x.slice(0, 8)), typeof r.json === "object" ? (r.json?.code ?? "") + " " + (r.json?.message ?? "").slice(0, 60) : String(r.json).slice(0, 60));
}
