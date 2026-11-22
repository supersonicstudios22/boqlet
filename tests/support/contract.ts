import { describeErrors, loadSpec, type Operation, type Spec } from "@ifc-boq/api/spec";

/** The contract, for checks every backend must pass (status codes, error bodies, response shapes). */
let specPromise: Promise<Spec> | null = null;
export const spec = () => (specPromise ??= loadSpec());

export function operationsByTag(s: Spec): Map<string, Operation[]> {
  const out = new Map<string, Operation[]>();
  for (const op of s.operations) {
    const tags = (op.raw.tags as string[] | undefined) ?? ["untagged"];
    for (const tag of tags) out.set(tag, [...(out.get(tag) ?? []), op]);
  }
  return out;
}

/** A concrete URL path for an operation: uuid-looking values for every path parameter. */
export function samplePath(op: Operation): string {
  return op.path.replace(/\{(\w+)\}/g, (_m, name: string) => (/(token|guid|kind)$/i.test(name) ? "sample" : "0193a2b4-0000-7000-8000-000000000000"));
}

type Json = Record<string, unknown>;

/** Follows a local `$ref` chain from a JSON pointer to the node it ends at, and that node's pointer. */
function resolve(doc: Json, pointer: string): { node: Json | undefined; pointer: string } {
  for (let seen = 0; seen < 10; seen++) {
    let node: unknown = doc;
    for (const part of pointer.replace(/^#\//, "").split("/")) {
      node = (node as Json | undefined)?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    const ref = (node as Json | undefined)?.$ref;
    if (typeof ref !== "string" || !ref.startsWith("#/")) return { node: node as Json | undefined, pointer };
    pointer = ref;
  }
  throw new Error(`$ref loop at ${pointer}`);
}

/**
 * Responses the backend doesn't match yet, each with its open finding: delete the entry with the fix.
 * A shared error response is checked against the plain `Error` schema; an operation's own answer
 * (`operationId status`) isn't checked.
 */
const KNOWN_MISMATCHES: Record<string, string> = {
  // The contract puts limit/current/max at the top level; Java, the app and every suite read them under `details`.
  "#/components/responses/LimitReached": "TF-072",
  // A flagged line's `quantity: null` is left out (non_null inclusion) by the by-key read only; the list keeps it.
  "getLine 200": "Stage 6 Batch 6 report, new finding 1",
};

/** The schema of an operation's JSON response with this status: its own, the `NXX` or `default` one, else for an error the `Error` schema. */
function responseSchema(s: Spec, op: Operation, status: number): string | null {
  const responses = (op.raw.responses ?? {}) as Json;
  const key = [String(status), `${String(status)[0]}XX`, "default"].find((k) => k in responses);
  if (!key) return status >= 400 ? "#/components/schemas/Error" : null;
  const ref = (responses[key] as Json | undefined)?.$ref;
  if (typeof ref === "string" && ref in KNOWN_MISMATCHES) return "#/components/schemas/Error";
  const { node, pointer } = resolve(s.doc, `${op.pointer}/responses/${key}`);
  const content = (node?.content ?? {}) as Json;
  const json = Object.keys(content).find((type) => type.includes("json"));
  return json ? `${pointer}/content/${json.replace(/~/g, "~0").replace(/\//g, "~1")}/schema` : null;
}

/**
 * TF-078: every JSON response a suite client receives must match its operation's response schema in
 * `openapi.yaml` (errors: the `Error` schema), so a required field the backend leaves out
 * (`default-property-inclusion: non_null`) fails the test that read it instead of passing unseen.
 */
export async function checkResponse(request: Request, response: Response): Promise<void> {
  if (!(response.headers.get("content-type") ?? "").includes("json")) return;
  const s = await spec();
  const path = new URL(request.url).pathname.replace(/^.*?\/api\/v1(?=\/)/, "");
  const found = s.match(request.method, path);
  if (!found || !("op" in found) || `${found.op.operationId} ${response.status}` in KNOWN_MISMATCHES) return;
  const pointer = responseSchema(s, found.op, response.status);
  if (!pointer) return;
  const text = await response.clone().text();
  if (!text) return;
  const validate = s.validator(pointer);
  if (!validate(JSON.parse(text))) {
    throw new Error(`${request.method} ${path} answered ${response.status} outside the contract (${found.op.operationId}): ${JSON.stringify(describeErrors(validate.errors))}`);
  }
}
