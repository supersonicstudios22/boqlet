/**
 * F08 §3–7 change report (FE-030): `POST /runs/{runId}/compare` starts a `diff` job (or answers the
 * cached diff), `GET /diffs/{id}` with its lines and elements (paged, filtered in memory) and the change
 * report export. The engine worker compares the runs (EN-002) and writes the report's Excel (EN-006).
 */
import { gunzipSync } from "node:zlib";
import type { RunDiff } from "@ifc-boq/types";
import { audit } from "../audit.js";
import { getBlob, putBlob } from "../blobs.js";
import { nowIso } from "../clock.js";
import { engine, unsupported, type DiffInputSide } from "../engine/engine.js";
import { exportDiffXlsx } from "../engine/exports.js";
import { HttpError, notFound } from "../http.js";
import { newId } from "../ids.js";
import { createJob, jobView, runJob } from "../jobs.js";
import { notify } from "../notify.js";
import { visibleProject } from "../projects.js";
import { json, type Handlers } from "../router.js";
import { db, persist, type DiffRec, type ExportRec, type RunRec, type UserRec } from "../store.js";
import { revisionLabel } from "./boqs.js";
import { exportFileName } from "./exports.js";
import { runFor } from "./lines.js";

const bodies = new Map<string, Pick<RunDiff, "lines" | "elements">>();

async function bodyOf(diff: DiffRec) {
  const hit = bodies.get(diff.id);
  if (hit) return hit;
  const body = JSON.parse(gunzipSync(await getBlob(diff.key)).toString("utf8")) as Pick<RunDiff, "lines" | "elements">;
  bodies.set(diff.id, body);
  if (bodies.size > 8) bodies.delete(bodies.keys().next().value!);
  return body;
}

const diffView = (d: DiffRec) => ({ id: d.id, fromRunId: d.fromRunId, toRunId: d.toRunId, summary: d.summary, questions: d.questions });

function projectOfRun(run: RunRec) {
  const revision = db().revisions.find((r) => r.id === run.revisionId)!;
  const boq = db().boqs.find((b) => b.id === revision.boqId)!;
  return { revision, boq, project: db().projects.find((p) => p.id === boq.projectId)! };
}

function diffOf(user: UserRec, diffId: string) {
  const diff = db().diffs.find((d) => d.id === diffId);
  if (!diff) throw notFound("diff");
  visibleProject(user, diff.projectId);
  return diff;
}

type RunRequest = RunRec["request"];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A request's line edits by line key, without who made them and when. */
const overrideKey = (request: RunRequest) =>
  new Map((request.adjustments?.overrides ?? []).map((o) => {
    const { lineKey, id: _i, createdAt: _c, createdBy: _b, updatedAt: _u, updatedBy: _ub, boqId: _bq, ...content } = o as typeof o & Record<string, unknown>;
    return [lineKey, JSON.stringify(content)];
  }));

/** Which inputs differ between the two runs' requests (the keys of `pendingChanges`), for the worker's diff. */
export function inputsChanged(from: RunRequest, to: RunRequest) {
  const models = (r: RunRequest) => r.inputs.models.map((m) => `${m.modelId}:${m.modelVersionId}`).sort();
  const out: string[] = [];
  if (!same(models(from), models(to))) out.push("inputs.models");
  if (from.inputs.ruleSetVersionId !== to.inputs.ruleSetVersionId) out.push("inputs.ruleSet");
  if (!same(from.inputs.classificationVersionIds, to.inputs.classificationVersionIds)) out.push("inputs.classifications");
  if (!same(from.inputs.dictionaryVersionIds, to.inputs.dictionaryVersionIds) || (from.projectDictionaryVersionId ?? null) !== (to.projectDictionaryVersionId ?? null)) out.push("inputs.dictionaries");
  if ((from.inputs.federationVersionId ?? null) !== (to.inputs.federationVersionId ?? null)) out.push("inputs.federation");
  if ((from.inputs.resolutionVersionId ?? null) !== (to.inputs.resolutionVersionId ?? null)) out.push("inputs.resolution");
  const answers = (r: RunRequest) => (r.decisions ?? []).map((d) => [d.questionId, d.answer]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (!same(answers(from), answers(to))) out.push("decisions");
  const edits = (r: RunRequest) => [[...overrideKey(r).entries()].sort(), (r.adjustments?.manualItems ?? []).map((m) => JSON.stringify(m.item)).sort()];
  if (!same(edits(from), edits(to))) out.push("adjustments");
  return out;
}

function workerSide(run: RunRec): DiffInputSide {
  return {
    resultKey: run.resultKey!,
    decisions: run.request.decisions ?? [],
    models: run.request.inputs.models.map((input) => ({
      modelId: input.modelId,
      versionId: input.modelVersionId,
      traceId: db().modelVersions.find((version) => version.id === input.modelVersionId)!.engineModelId!,
      name: db().models.find((model) => model.id === input.modelId)?.name ?? input.modelId,
    })),
  };
}

export const diffHandlers: Handlers = {
  compareRuns({ user, params, body }) {
    const to = runFor(user!, params.runId!);
    const againstRunId = (body as { againstRunId?: string } | undefined)?.againstRunId;
    if (!againstRunId) throw new HttpError(400, "invalid_body", "Say which run to compare with (againstRunId).");
    const from = runFor(user!, againstRunId);
    const { project } = projectOfRun(to);
    if (projectOfRun(from).project.id !== project.id) throw new HttpError(400, "invalid_body", "Runs of different projects can't be compared.");
    for (const r of [to, from]) if (!r.resultKey) throw new HttpError(409, "run_not_finished", "The run has no result yet.", { runId: r.id, status: r.status });
    const cached = db().diffs.find((d) => d.fromRunId === from.id && d.toRunId === to.id);
    if (cached) return json(diffView(cached));

    const job = createJob({ type: "diff", subjectType: "run", subjectId: to.id, projectId: project.id, orgId: project.orgId, createdBy: user!.id });
    void runJob(job, async (ctx) => {
      // Two requests for the same pair may both start a job: the second answers the first's diff.
      const done = db().diffs.find((d) => d.fromRunId === from.id && d.toRunId === to.id);
      if (done) return { diffId: done.id };
      ctx.progress("load", 10);
      const id = newId();
      const prefix = `orgs/${project.orgId}/diffs/${id}/`;
      // The worker writes the diff at `<prefix>diff.json.gz`.
      const key = prefix + "diff.json.gz";
      const backend = engine();
      if (!backend.diff) throw unsupported("compare runs");
      const result = await backend.diff(workerSide(from), workerSide(to),
        inputsChanged(from.request, to.request), prefix, (stage, pct) => ctx.progress(stage, pct));
      const rec: DiffRec = { id, fromRunId: from.id, toRunId: to.id, projectId: project.id, orgId: project.orgId, summary: { ...result.summary }, questions: result.questions, key, jobId: job.id, createdAt: nowIso() };
      db().diffs.push(rec);
      bodies.set(id, { lines: result.lines, elements: result.elements });
      persist();
      ctx.progress("diff", 100);
      return { diffId: id };
    });
    return json(jobView(job), 202);
  },

  getDiff({ user, params }) {
    return json(diffView(diffOf(user!, params.diffId!)));
  },

  async listDiffLines({ user, params, query }) {
    const diff = diffOf(user!, params.diffId!);
    const { lines } = await bodyOf(diff);
    const change = query.change as string | undefined;
    if (change && !["added", "removed", "changed"].includes(change)) throw new HttpError(400, "invalid_param", "change is added, removed or changed.");
    const min = query.minDeltaPct === undefined ? null : Number(query.minDeltaPct);
    if (min !== null && !Number.isFinite(min)) throw new HttpError(400, "invalid_param", "minDeltaPct must be a number.");
    // The threshold applies to changed lines; added and removed lines always pass it (they change by 100 %).
    const items = lines.filter((l) => (!change || l.change === change) && (min === null || l.change !== "changed" || l.deltaPct === null || Math.abs(l.deltaPct) >= min));
    return json(page(items, query));
  },

  async listDiffElements({ user, params, query }) {
    const diff = diffOf(user!, params.diffId!);
    const { elements } = await bodyOf(diff);
    return json(page(elements, query));
  },

  exportDiff({ user, params }) {
    const diff = diffOf(user!, params.diffId!);
    const to = db().runs.find((r) => r.id === diff.toRunId)!;
    const from = db().runs.find((r) => r.id === diff.fromRunId)!;
    const { revision, boq, project } = projectOfRun(to);
    const fromRevision = projectOfRun(from).revision;
    const job = createJob({ type: "export_xlsx", subjectType: "diff", subjectId: diff.id, projectId: project.id, orgId: project.orgId, createdBy: user!.id });
    const org = db().orgs.find((o) => o.id === project.orgId)!;
    void runJob(job, async (ctx) => {
      ctx.progress("export", 10);
      const system = (to.classifications ?? [])[0]?.id;
      const label = (r: typeof revision) => `${revisionLabel(r.number)}${r.status === "draft" ? " (working)" : ""}`;
      const bytes = await exportDiffXlsx(diff.key, { title: `${project.name} / ${boq.name}: changes`, fromLabel: label(fromRevision), toLabel: label(revision), groupBy: system });
      const id = newId();
      const createdAt = nowIso();
      const fileName = exportFileName(project.code || project.name, boq.name, revisionLabel(revision.number), createdAt).replace(/\.xlsx$/, "_changes.xlsx");
      const storageKey = `orgs/${project.orgId}/exports/${id}/${fileName}`;
      await putBlob(storageKey, bytes);
      const rec: ExportRec = { id, kind: "changes_xlsx", subjectType: "diff", subjectId: diff.id, revisionId: revision.id, projectId: project.id, orgId: project.orgId, fileName, storageKey, sizeBytes: bytes.byteLength, jobId: job.id, createdBy: user!.id, createdAt };
      db().exports.push(rec);
      persist();
      audit({ orgId: project.orgId, projectId: project.id, actorId: user!.id, action: "export.created", subjectType: "export", subjectId: id, data: { boq: boq.name, fileName, kind: "changes_xlsx" } });
      ctx.progress("export", 100);
      notify({ userId: user!.id, orgId: project.orgId, kind: "job.succeeded", params: { boq: boq.name, type: "export", file: fileName, jobId: job.id }, url: `/${org.slug}/projects/${project.id}/boqs/${boq.id}?tab=changes`, entity: { type: "export", id } });
      return { exportId: id };
    });
    return json(jobView(job), 202);
  },
};

function page<T>(items: T[], query: Record<string, unknown>) {
  const start = query.cursor ? Number.parseInt(String(query.cursor), 10) : 0;
  if (!Number.isInteger(start) || start < 0) throw new HttpError(400, "invalid_param", "Bad cursor.");
  const limit = Math.min(Number(query.limit ?? 100), 1000);
  return { items: items.slice(start, start + limit), nextCursor: start + limit < items.length ? String(start + limit) : null };
}
