// ENG-002: replay exactly what apps/app/src/features/models/upload.ts does for a 101 MiB file.
import { session, show } from "./lib.mjs";
import { readFileSync } from "node:fs";
const a = await session("vb-a@review.test");
const org = (await a.call("GET", "/orgs")).json; const o = (org.items ?? org).find((x) => x.slug === "vb-a-firm");
const projects = (await a.call("GET", `/orgs/${o.id}/projects`)).json; const p = (projects.items ?? projects)[0];
console.log("project", p.name, p.id);
const model = (await a.call("POST", `/projects/${p.id}/models`, { name: "VB big upload", discipline: "mep" })).json;
const head = readFileSync("docs/review/_samples/" + process.argv[2]);
const size = 101 * 1024 * 1024;
const file = Buffer.alloc(size, 0x20); head.copy(file, 0, 0, Math.min(head.length, size));
const created = await a.call("POST", `/models/${model.id}/versions`, { fileName: "big.ifc", sizeBytes: size });
console.log("create", created.status, "method", created.json.upload?.method, "partSizeBytes", created.json.upload?.partSizeBytes, "parts", created.json.upload?.parts?.length, "url==parts[0]", created.json.upload?.url === created.json.upload?.parts?.[0]?.url);
// client: PUT whole file to upload.url with upload.headers
const put = await fetch(created.json.upload.url, { method: "PUT", headers: created.json.upload.headers ?? {}, body: file });
console.log("PUT whole file to upload.url ->", put.status, (await put.text()).slice(0, 300));
// client: complete with body {}
show("complete {}", await a.call("POST", `/model-versions/${created.json.version.id}/complete`, {}));
show("version", await a.call("GET", `/model-versions/${created.json.version.id}`));
