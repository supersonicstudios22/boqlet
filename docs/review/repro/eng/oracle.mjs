import { session } from "./api.mjs";
const b = await session("eng-b@review.test");
for (const p of ["/boqs/01a20772-045c-7e5f-b052-2d9ebe12cc44", "/boqs/01a20772-045c-7e5f-b052-000000000000", "/runs/01a20772-06d6-7311-8793-e4e91ebbe503", "/runs/01a20772-06d6-7311-8793-000000000000", "/presets/01a2076f-aa96-7f50-bef9-03557ddfce1a", "/presets/01a2076f-aa96-7f50-bef9-000000000000"]) {
  const r = await b.call("GET", p); console.log(r.status, p.slice(0, 50), r.json.message);
}
