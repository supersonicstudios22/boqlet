/**
 * The part of the mock's seed (mock-api.md "Seed data") the scenarios read, made on Java through
 * the API, once before the suite (vitest `globalSetup`, Java only). The Java suite test has already
 * made the people, Studio Demo and Small Firm (NativeWorkerTest#suiteUsers).
 *
 * - Studio Demo's project **Duplex**: Olivia leads; Marko estimator, Ana approver, Victor viewer;
 *   Ivana is not on it.
 * - Studio Demo's Library, written by Ivana: "Studio rules" (a patch on As modelled with three
 *   settings changed, version 1 published and a draft), "Studio trades" (a copy of demo-trades),
 *   "Studio names" (a copy of acme-company).
 *
 * Idempotent: a second suite in the same Java context finds them and leaves them.
 */
import { client } from "./env";
import { user } from "./users";

export default async function seed() {
  if (process.env.SUITE_TARGET !== "java") return;
  const [olivia, ivana, marko, ana, victor] = await Promise.all((["olivia", "ivana", "marko", "ana", "victor"] as const).map((key) => user(key)));
  const me = (await client(olivia.token).GET("/me")).data!;
  const orgId = me.memberships.find((m) => m.org.slug === "studio-demo")!.org.id;

  const projects = (await client(olivia.token).GET("/orgs/{orgId}/projects", { params: { path: { orgId } } })).data!;
  if (!projects.some((p) => p.name === "Duplex")) {
    const project = must(await client(olivia.token).POST("/orgs/{orgId}/projects", { params: { path: { orgId } }, body: { name: "Duplex" } }), "Duplex");
    for (const [person, role] of [[marko, "estimator"], [ana, "approver"], [victor, "viewer"]] as const) {
      must(await client(olivia.token).POST("/projects/{projectId}/members", { params: { path: { projectId: project.id } }, body: { userId: person.id, role } }), `${role} on Duplex`);
    }
  }

  const library = client(ivana.token);
  const own = (await library.GET("/orgs/{orgId}/presets", { params: { path: { orgId }, query: { layer: "org" } } })).data!;
  const system = async (kind: "rule_set" | "classification" | "dictionary", slug: string) => {
    const list = (await library.GET("/orgs/{orgId}/presets", { params: { path: { orgId }, query: { kind, layer: "system" } } })).data!;
    return list.find((p) => p.slug === slug)!.latestPublishedVersion!.id;
  };
  const publish = async (presetId: string, changeNote: string) =>
    must(await library.POST("/presets/{presetId}/publish", { params: { path: { presetId } }, body: { changeNote } }), `publishing ${changeNote}`);

  if (!own.some((p) => p.name === "Studio rules")) {
    const preset = must(await library.POST("/orgs/{orgId}/presets", {
      params: { path: { orgId } },
      body: { kind: "rule_set", name: "Studio rules", basedOn: "As modelled", description: "Our office settings on As modelled.", start: { mode: "patch", fromVersionId: await system("rule_set", "as-modelled") } },
    }), "Studio rules");
    const draft = await library.GET("/preset-versions/{presetVersionId}", { params: { path: { presetVersionId: preset.draft!.id } } });
    const doc = draft.data!.doc as { params?: Record<string, unknown> };
    const params = { ...doc.params, wall_opening_mode: { value: "over_threshold" }, wall_opening_threshold: { value: 0.5 }, window_measure: { value: "area" } };
    must(await library.PUT("/presets/{presetId}/draft", { params: { path: { presetId: preset.id }, header: { "If-Match": draft.response.headers.get("ETag")! } }, body: { doc: { ...doc, params } } }), "Studio rules settings");
    await publish(preset.id, "Our office settings");
    // A draft on top of version 1.
    must(await library.PUT("/presets/{presetId}/draft", { params: { path: { presetId: preset.id } }, body: { doc: { ...doc, params: { ...params, lines_by_storey: { value: true } } } } }), "Studio rules draft");
  }
  for (const [kind, name, from] of [["classification", "Studio trades", "demo-trades"], ["dictionary", "Studio names", "acme-company"]] as const) {
    if (own.some((p) => p.name === name)) continue;
    const preset = must(await library.POST("/orgs/{orgId}/presets", { params: { path: { orgId } }, body: { kind, name, start: { mode: "copy", fromVersionId: await system(kind, from) } } }), name);
    await publish(preset.id, `Copy of ${from}`);
  }
}

function must<T>(result: { data?: T; error?: unknown; response: Response }, what: string): T {
  if (!result.response.ok || result.data === undefined) {
    throw new Error(`seeding ${what} answered ${result.response.status}: ${JSON.stringify(result.error)}`);
  }
  return result.data;
}
