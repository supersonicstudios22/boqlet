import { beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "@ifc-boq/api";
import { API_URL, authentication, client } from "../support/env";
import { duplexBytes, uploadVersion, waitForVersion } from "../support/models";
import { xlsxRows } from "../support/xlsx";
import { signUp, uniqueEmail, type TestUser } from "../support/users";

/** F06 sheet data (FE-009): lines, one line's detail, warnings and the log of a Duplex run. */

const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const SYSTEM = "acme-cost-codes";

let owner: TestUser;
let run: Schemas["Run"];
let lines: Schemas["RunLine"][];

beforeAll(async () => {
  owner = await signUp("Sheet Owner", uniqueEmail("sheet"));
  const api = client(owner.token);
  const { data: org } = await api.POST("/orgs", { body: { name: "Sheet Firm", slug: slug("sheet") } });
  const { data: project } = await api.POST("/orgs/{orgId}/projects", { params: { path: { orgId: org!.id } }, body: { name: "Duplex" } });
  const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId: project!.id } }, body: { name: "Architecture", discipline: "architecture" } });
  const version = await uploadVersion(owner, model!.id, await duplexBytes(), "Ifc2x3_Duplex_Architecture.ifc");
  expect((await waitForVersion(owner, version.id)).status).toBe("ready");
  const { data: presets } = await api.GET("/orgs/{orgId}/presets", { params: { path: { orgId: org!.id }, query: { kind: "classification" } } });
  const codes = presets!.find((p) => p.slug === SYSTEM)!.latestPublishedVersion!.id;
  const { data: boq } = await api.POST("/projects/{projectId}/boqs", { params: { path: { projectId: project!.id } }, body: { name: "Sheet", inputs: { classificationVersionIds: [codes] } } });
  const { data: started } = await api.POST("/revisions/{revisionId}/runs", { params: { path: { revisionId: boq!.currentRevision.id } } });
  const deadline = Date.now() + 120_000;
  for (;;) {
    const { data } = await api.GET("/runs/{runId}", { params: { path: { runId: started!.run.id } } });
    if (data && data.status !== "queued" && data.status !== "running") {
      run = data;
      break;
    }
    if (Date.now() > deadline) throw new Error("run did not finish");
    await new Promise((r) => setTimeout(r, 250));
  }
  const { data: page } = await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { include: "trace" } } });
  lines = page!.items;
}, 240_000);

const lineOf = (key: string) => client(owner.token).GET("/runs/{runId}/lines/by-key", { params: { path: { runId: run.id }, query: { key } } });

describe("lines (F06 §1)", () => {
  it("returns every line of the run in engine order, each with its codes", async () => {
    expect(["complete", "needs_input"]).toContain(run.status);
    expect(lines.length).toBe(run.stats!.lines);
    expect(lines.map((l) => l.sortIndex)).toEqual(lines.map((_, i) => i));
    expect(lines.filter((l) => l.codes[SYSTEM]).length).toBeGreaterThan(lines.length / 2);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });

  it("filters by source, storey and text without changing the lines (F06 §4)", async () => {
    const api = client(owner.token);
    const derived = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { source: "derived", include: "trace" } } })).data!;
    expect(derived.items.length).toBe(lines.filter((l) => l.source === "derived").length);
    expect(derived.total).toBe(derived.items.length);
    const storey = lines.find((l) => l.location?.storey)?.location?.storey;
    if (storey) {
      const onStorey = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { storey } } })).data!;
      expect(onStorey.items.length).toBeGreaterThan(0);
      expect(onStorey.items.every((l) => l.location?.storey === storey || l.location?.storeys?.includes(storey))).toBe(true);
    }
    const word = lines[lines.length - 1]!.description.split(/\s+/)[0]!.toLowerCase();
    const search = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { q: word } } })).data!;
    expect(search.items.length).toBeGreaterThan(0);
    for (const l of search.items) expect(l.description.toLowerCase().includes(word) || Object.values(l.codes).some((c) => c.code.toLowerCase().includes(word) || c.title.toLowerCase().includes(word))).toBe(true);
    // Filtered lines are the same objects as unfiltered ones.
    const byKey = new Map(lines.map((l) => [l.key, l]));
    for (const l of derived.items) expect(l).toEqual(byKey.get(l.key));
  });

  it("pages with a cursor", async () => {
    const api = client(owner.token);
    const first = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { limit: 10 } } })).data!;
    expect(first.items.length).toBe(10);
    expect(first.nextCursor).toBeTruthy();
    const second = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { limit: 10, cursor: first.nextCursor! } } })).data!;
    expect(second.items[0]!.sortIndex).toBe(10);
  });

  it("sends each line's trace as a summary unless include=trace (review B-18)", async () => {
    const api = client(owner.token);
    const summary = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id } } })).data!.items;
    const full = new Map(lines.map((l) => [l.key, l]));
    expect(summary.length).toBe(lines.length);
    for (const l of summary) {
      const whole = full.get(l.key)!;
      expect(l.trace.steps ?? []).toEqual([]);
      expect(l.trace.params).toEqual({});
      expect(l.trace.formula).toBe(whole.trace.formula);
      expect(l.trace.sourceLine).toBe(whole.trace.sourceLine);
      expect(l.trace.elements).toEqual(whole.trace.elements.map((e) => ({ guid: e.guid, quantity: e.quantity, ...(e.model !== undefined ? { model: e.model } : {}) })));
      expect({ ...l, trace: undefined }).toEqual({ ...whole, trace: undefined });
    }
    expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(lines).length);
    // The list is gzipped for a client that accepts it (review B-18).
    const res = await fetch(`${API_URL}/runs/${run.id}/lines?include=trace`, { headers: { ...(await authentication(owner.token)), "Accept-Encoding": "gzip" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  it("groups server-side for large runs: group rows with counts, then one group's lines (F06 edge cases)", async () => {
    const api = client(owner.token);
    const grouped = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { groupBy: SYSTEM, level: 1 } } })).data!;
    expect(grouped.items).toEqual([]);
    expect(grouped.groups!.reduce((n, g) => n + g.lineCount, 0)).toBe(lines.length);
    const group = grouped.groups!.find((g) => g.path)!;
    const inGroup = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { groupBy: SYSTEM, level: 1, groupPath: group.path } } })).data!;
    expect(inGroup.items.length).toBe(group.lineCount);
    expect(inGroup.items.every((l) => l.codes[SYSTEM]!.path[0]!.code === group.path)).toBe(true);
    // Review B-19: an empty groupPath lists the lines without a code in the system (the Unclassified group).
    const unclassified = grouped.groups!.find((g) => g.path === "");
    const loose = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { groupBy: SYSTEM, level: 1, groupPath: "" } } })).data!;
    expect(loose.items.length).toBe(unclassified?.lineCount ?? 0);
    expect(loose.items.every((l) => (l.codes[SYSTEM]?.path.length ?? 0) === 0)).toBe(true);
    // BR-63: the sum of the measured lines when the unit is shared; no sum (not 0) when none is measured.
    for (const g of grouped.groups!) {
      if (!g.unit) continue;
      const measured = lines.filter((l) => (l.codes[SYSTEM]?.path[0]?.code ?? "") === g.path && !l.excluded && l.quantity !== null);
      if (measured.length === 0) expect(g.quantity).toBeNull();
      else expect(g.quantity).toBeCloseTo(measured.reduce((s, l) => s + l.quantity!, 0), 6);
    }
  });
});

describe("line detail (F06 §5)", () => {
  it("F06-AC2 every line's detail has its formula and parameters, and element shares that add up to the quantity", async () => {
    let checked = 0;
    for (const line of lines) {
      const { data, response } = await lineOf(line.key);
      expect(response.status).toBe(200);
      expect(data!.key).toBe(line.key);
      expect(typeof data!.trace.formula).toBe("string");
      expect(data!.trace.params).toBeTypeOf("object");
      if (line.quantity === null || line.trace.elements.length === 0) continue;
      const sum = data!.trace.elements.reduce((s, e) => s + (e.quantity ?? 0), 0);
      // "Within rounding": the line keeps the rule set's rounding, the shares don't.
      expect(Math.abs(sum - line.quantity)).toBeLessThanOrEqual(Math.max(0.01, Math.abs(line.quantity) * 0.001));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("carries the log entries of that line", async () => {
    const withLog = lines.find((l) => l.source === "measured")!;
    const { data } = await lineOf(withLog.key);
    expect(data!.log!.length).toBeGreaterThan(0);
    expect(data!.log!.every((e) => e.lineKey === withLog.key)).toBe(true);
  });

  it("answers 404 for an unknown key", async () => {
    const { response } = await lineOf("no-such-line");
    expect(response.status).toBe(404);
  });
});

describe("how it is calculated (F06 §5, EN-013; fake in phase 1)", () => {
  const stepsOf = (l: Schemas["RunLine"]) => l.trace.steps ?? [];

  it("F06-AC5 every line's steps add up to its quantity and end with the result", () => {
    for (const l of lines) {
      const steps = stepsOf(l);
      expect(steps.length, l.key).toBeGreaterThan(1);
      const result = steps.at(-1)!;
      expect(result.kind, l.key).toBe("result");
      expect(result.value, l.key).toBe(l.quantity);
      if (l.quantity === null) continue;
      const sum = steps.slice(0, -1).reduce((s, x) => s + (x.value ?? 0), 0);
      expect(Math.abs(sum - l.quantity), l.key).toBeLessThanOrEqual(0.005);
    }
  });

  it("the brick wall line has start, deduct with the opening size setting, and result", () => {
    const brick = lines.find((l) => l.ruleKind === "item" && l.description.includes("Brick on Block"))!;
    const kinds = stepsOf(brick).map((s) => s.kind);
    expect(kinds[0]).toBe("start");
    expect(kinds.at(-1)).toBe("result");
    const deduct = stepsOf(brick).find((s) => s.kind === "deduct")!;
    expect(deduct.param).toBe("wall_opening_threshold");
    expect(deduct.value).toBeLessThan(0);
    expect(deduct.elements!.length).toBeGreaterThan(0);
    expect(Object.keys(brick.trace.params)).toContain(deduct.param);
  });

  it("derived lines have a derive step naming their source lines", () => {
    const derived = lines.filter((l) => l.ruleKind === "derived");
    expect(derived.length).toBeGreaterThan(0);
    const keys = new Set(lines.map((l) => l.key));
    for (const l of derived) {
      const step = stepsOf(l).find((s) => s.kind === "derive")!;
      expect(step.params.sourceLine, l.key).toBe(l.trace.sourceLine);
      for (const key of step.params.sourceLines as string[]) expect(keys.has(key), key).toBe(true);
    }
  });
});

describe("warnings and log (F06 §8, §9)", () => {
  it("lists the run's warnings", async () => {
    const { data } = await client(owner.token).GET("/runs/{runId}/warnings", { params: { path: { runId: run.id } } });
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBe(run.stats!.warnings);
  });

  it("pages the log in order and filters it by stage and line", async () => {
    const api = client(owner.token);
    const first = (await api.GET("/runs/{runId}/log", { params: { path: { runId: run.id }, query: { limit: 50 } } })).data!;
    expect(first.items.length).toBe(50);
    const second = (await api.GET("/runs/{runId}/log", { params: { path: { runId: run.id }, query: { limit: 50, cursor: first.nextCursor! } } })).data!;
    expect(second.items[0]!.seq).toBeGreaterThan(first.items[49]!.seq);
    const stage = first.items[0]!.stage;
    const byStage = (await api.GET("/runs/{runId}/log", { params: { path: { runId: run.id }, query: { stage, limit: 1000 } } })).data!;
    expect(byStage.items.every((e) => e.stage === stage)).toBe(true);
    const key = lines.find((l) => l.source === "measured")!.key;
    const byLine = (await api.GET("/runs/{runId}/log", { params: { path: { runId: run.id }, query: { lineKey: key } } })).data!;
    expect(byLine.items.length).toBeGreaterThan(0);
    expect(byLine.items.every((e) => e.lineKey === key)).toBe(true);
  });

  it("is hidden from people outside the project (404)", async () => {
    const stranger = await signUp("Stranger", uniqueEmail("stranger"));
    const { response } = await client(stranger.token).GET("/runs/{runId}/lines", { params: { path: { runId: run.id } } });
    expect(response.status).toBe(404);
  });
});

describe("viewer data (F07 §1–5)", () => {
  const api = () => client(owner.token);
  const versionId = () => run.snapshotVersions!.models![0]!.modelVersionId;

  it("the run names the model versions it used, with the id its traces use (F07 §2)", () => {
    const models = run.snapshotVersions!.models!;
    expect(models).toHaveLength(1);
    const traceIds = new Set(lines.flatMap((l) => l.trace.elements.map((e) => e.model)).filter(Boolean));
    expect([...traceIds]).toEqual([models[0]!.traceId]);
  });

  it("serves the scene index and the geometry (a glb behind a signed URL)", async () => {
    const { data: scene } = await api().GET("/model-versions/{versionId}/scene", { params: { path: { versionId: versionId() } } });
    expect(Object.keys(scene!.elements).length).toBeGreaterThan(100);
    expect(Object.values(scene!.elements).some((e) => e.ifcClass === "IfcRoof" && (e.parts?.length ?? 0) > 0)).toBe(true);
    const { response } = await api().GET("/model-versions/{versionId}/geometry", { params: { path: { versionId: versionId() } }, redirect: "manual" } as never);
    expect(response.status).toBe(302);
    const glb = await fetch(response.headers.get("location")!);
    expect(new TextDecoder().decode((await glb.arrayBuffer()).slice(0, 4))).toBe("glTF");
  });

  it("F07-AC3 coverage: unmatched elements match the unmatched questions' occurrences; measured ones are in lines", async () => {
    const { data: coverage } = await api().GET("/runs/{runId}/coverage", { params: { path: { runId: run.id } } });
    const { data: questions } = await api().GET("/runs/{runId}/questions", { params: { path: { runId: run.id } } });
    const unmatched = questions!.filter((q) => q.kind === "unmatched");
    expect(coverage!.unmatched.length).toBe(unmatched.reduce((s, q) => s + (q.occurrences ?? q.guids?.length ?? 0), 0));
    // review B-03: every measured element is in a line (the old check filtered to those in lines first, so it could not fail)
    const inLines = new Set(lines.flatMap((l) => l.trace.elements.map((e) => e.guid)));
    expect(coverage!.measured.length).toBeGreaterThan(0);
    expect(coverage!.measured.filter((g) => !inLines.has(g))).toEqual([]);
    expect(coverage!.unmatched.filter((g) => inLines.has(g))).toEqual([]);
  });

  it("F07-AC2 an element lists every line it feeds, with its share; a roof part lists its roof's line", async () => {
    const brick = lines.find((l) => l.ruleKind === "item" && l.description.includes("Brick on Block"))!;
    const element = brick.trace.elements[0]!;
    const { data } = await api().GET("/runs/{runId}/elements/{guid}", { params: { path: { runId: run.id, guid: element.guid } } });
    expect(data!.status).toBe("measured");
    expect(data!.modelVersionId).toBe(versionId());
    const row = data!.lines.find((l) => l.lineKey === brick.key)!;
    expect(row.quantity).toBeCloseTo(element.quantity!, 6);
    const every = lines.filter((l) => l.trace.elements.some((e) => e.guid === element.guid)).map((l) => l.key);
    for (const key of every) expect(data!.lines.map((l) => l.lineKey)).toContain(key);

    const { data: scene } = await api().GET("/model-versions/{versionId}/scene", { params: { path: { versionId: versionId() } } });
    const roof = Object.entries(scene!.elements).find(([guid, e]) => e.ifcClass === "IfcRoof" && e.parts?.length && lines.some((l) => l.trace.elements.some((x) => x.guid === guid)));
    if (roof) {
      const part = roof[1].parts![0]!;
      const { data: partLines } = await api().GET("/runs/{runId}/elements/{guid}", { params: { path: { runId: run.id, guid: part } } });
      expect(partLines!.lines.length).toBeGreaterThan(0);
    }
  });
});

describe("run export (F12, FE-017)", () => {
  it("an export job writes the run's Excel, listed for the revision and downloadable", async () => {
    const api = client(owner.token);
    const { data: job, response } = await api.POST("/runs/{runId}/exports", { params: { path: { runId: run.id } }, body: { format: "xlsx", groupBy: SYSTEM } });
    expect(response.status).toBe(202);
    expect(job!.type).toBe("export_xlsx");
    const deadline = Date.now() + 60_000;
    let done = job!;
    while (done.status === "queued" || done.status === "running") {
      if (Date.now() > deadline) throw new Error("export did not finish");
      await new Promise((r) => setTimeout(r, 250));
      done = (await api.GET("/jobs/{jobId}", { params: { path: { jobId: job!.id } } })).data!;
    }
    expect(done.status).toBe("succeeded");
    const exportId = (done.output as { exportId: string }).exportId;
    const { data: meta } = await api.GET("/exports/{exportId}", { params: { path: { exportId } } });
    expect(meta).toMatchObject({ id: exportId, kind: "boq_xlsx", subjectType: "run", subjectId: run.id });
    // The run is named by when it finished (review A-41, CAS-027).
    expect(meta!.fileName).toMatch(/^Duplex_Sheet_RevA_\d{4}-\d{2}-\d{2}_run\d{8}-\d{6}\.xlsx$/);
    const { data: list } = await api.GET("/revisions/{revisionId}/exports", { params: { path: { revisionId: run.revisionId } } });
    expect(list!.map((e) => e.id)).toContain(exportId);
    const { response: download } = await api.GET("/exports/{exportId}/download", { params: { path: { exportId } }, redirect: "manual" } as never);
    expect(download.status).toBe(302);
    const bytes = new Uint8Array(await (await fetch(download.headers.get("location")!)).arrayBuffer());
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");
  });

  it("groups the Excel by storey without a classification (review C-07): storey sections, Ref and numbers unchanged", async () => {
    const api = client(owner.token);
    const { data: job, response } = await api.POST("/runs/{runId}/exports", { params: { path: { runId: run.id } }, body: { format: "xlsx", groupBy: "~storey" } });
    expect(response.status).toBe(202);
    const deadline = Date.now() + 60_000;
    let done = job!;
    while (done.status === "queued" || done.status === "running") {
      if (Date.now() > deadline) throw new Error("export did not finish");
      await new Promise((r) => setTimeout(r, 250));
      done = (await api.GET("/jobs/{jobId}", { params: { path: { jobId: job!.id } } })).data!;
    }
    expect(done.status).toBe("succeeded");
    const rows = await xlsxRows(owner, (done.output as { exportId: string }).exportId, "BoQ");
    expect(String(rows[1]![0])).toContain("Grouping: Storey");
    const lines = (await api.GET("/runs/{runId}/lines", { params: { path: { runId: run.id }, query: { limit: 20000 } } })).data!.items;
    const storeys = new Set(lines.flatMap((l) => (l.location?.storey ? [l.location.storey] : [])));
    // Section headings: no Ref, no unit, no quantity, no line key (column I).
    const headings = rows.slice(5).filter((r) => r[1] && !r[0] && !r[2] && (r[3] === null || r[3] === "") && !r[8] && !String(r[1]).startsWith("Subtotal") && r[1] !== "TOTAL").map((r) => String(r[1]));
    expect(headings.filter((h) => storeys.has(h)).length).toBe(storeys.size);
    // Every line is still there with its code in Ref and its position number (column J) from the first classification.
    const byKey = new Map(lines.map((l) => [l.key, l]));
    const lineRows = rows.slice(5).filter((r) => r[8] && byKey.has(String(r[8])));
    expect(lineRows.length).toBe(lines.filter((l) => !l.excluded).length);
    for (const r of lineRows) {
      const line = byKey.get(String(r[8]))!;
      expect(r[0] ?? "").toBe(line.codes[SYSTEM]?.code ?? "");
      if (line.positionNo) expect(String(r[9])).toBe(line.positionNo);
    }
  });

  it("refuses a groupBy that isn't one of the run's classifications", async () => {
    const { response } = await client(owner.token).POST("/runs/{runId}/exports", { params: { path: { runId: run.id } }, body: { groupBy: "nope" } });
    expect(response.status).toBe(400);
  });
});

describe("notifications (F13, FE-018)", () => {
  it("the run's creator gets its result; one or all can be marked read", async () => {
    const api = client(owner.token);
    const { data: list } = await api.GET("/notifications", { params: { query: { limit: 200 } } });
    const mine = list!.items.filter((n) => n.entityId === run.id);
    expect(mine.map((n) => n.kind)).toContain(run.status === "complete" ? "job.succeeded" : "run.needs_input");
    expect(list!.unreadCount).toBeGreaterThan(0);
    const first = list!.items[0]!;
    expect((await api.POST("/notifications/{notificationId}/read", { params: { path: { notificationId: first.id } } })).response.status).toBe(204);
    const { data: unread } = await api.GET("/notifications", { params: { query: { unreadOnly: true } } });
    expect(unread!.items.map((n) => n.id)).not.toContain(first.id);
    expect(unread!.unreadCount).toBe(list!.unreadCount - 1);
    expect((await api.POST("/notifications/read-all")).response.status).toBe(204);
    expect((await api.GET("/notifications")).data!.unreadCount).toBe(0);
  });

  it("someone else's notification is not found", async () => {
    const other = await signUp("Other", uniqueEmail("other"));
    const { data } = await client(owner.token).GET("/notifications");
    const { response } = await client(other.token).POST("/notifications/{notificationId}/read", { params: { path: { notificationId: data!.items[0]!.id } } });
    expect(response.status).toBe(404);
  });

  it("email preferences per category: all on by default, saved per category, unknown categories refused", async () => {
    const api = client(owner.token);
    const { data: prefs } = await api.GET("/me/notification-preferences");
    expect(prefs!.email).toMatchObject({ jobs: true, versions: true, reviews: true, membership: true, limits: true });
    const { data: saved } = await api.PUT("/me/notification-preferences", { body: { email: { jobs: false } } });
    expect(saved!.email).toMatchObject({ jobs: false, versions: true });
    expect((await api.GET("/me/notification-preferences")).data!.email!.jobs).toBe(false);
    const { response } = await api.PUT("/me/notification-preferences", { body: { email: { nonsense: true } } });
    expect(response.status).toBe(400);
  });
});
