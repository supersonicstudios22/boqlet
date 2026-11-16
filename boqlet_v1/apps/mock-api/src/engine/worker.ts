import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { BoqResult, CodeListBuildRequest, CodeListBuildResponse, SceneIndex, TableReadResponse } from "@ifc-boq/types";
import { blobPath, getBlob } from "../blobs.js";
import { PRESETS_DIR } from "../paths.js";
import { EngineRefused, EngineUnavailable, type Engine, type EngineProgress, type ParsedModelSummary, type PresetFolder, type RunInput } from "./engine.js";

type Preset = { id: string; extends?: string };
type JobOutput = { status: string; output?: unknown; error?: { message: string; code: string } };

export class WorkerEngine implements Engine {
  readonly name = "worker";
  private readonly drafts = new Map<string, unknown>();

  constructor(private readonly baseUrl = process.env.ENGINE_URL ?? `http://127.0.0.1:${process.env.ENGINE_WORKER_PORT ?? 8788}`) {}

  private async send(route: string, input?: unknown) {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + route, input === undefined ? undefined : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
    } catch (error) {
      throw new EngineUnavailable(`Engine worker unavailable at ${this.baseUrl}: ${(error as Error).message}`);
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { detail?: unknown };
      throw new EngineRefused(response.status, typeof detail.detail === "string" ? detail.detail : response.statusText);
    }
    return response;
  }

  private async json<T>(route: string, input?: unknown): Promise<T> {
    return (await this.send(route, input)).json() as Promise<T>;
  }

  private async job<T>(type: "parse" | "run", input: unknown, outputPrefix: string, progress?: EngineProgress): Promise<T> {
    const response = await this.send(`/jobs/${type}`, {
      jobId: randomUUID(), contract: "1", type, input, outputPrefix, orgId: "mock", attempt: 1,
    });
    let result: JobOutput | undefined;
    let pending = "";
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        const lines = pending.split("\n");
        pending = lines.pop()!;
        for (const line of lines) {
          const event = JSON.parse(line) as Partial<JobOutput> & { stage?: string; pct?: number };
          if (event.status) result = event as JobOutput;
          else if (event.stage && event.pct !== undefined) progress?.(event.stage, event.pct);
        }
      }
    } finally {
      await reader.cancel();
    }
    if (!result) throw new EngineUnavailable("Worker stream ended without a job result");
    if (result.status !== "succeeded") {
      throw new EngineRefused(422, result.error?.message ?? `Worker job ${result.status}`);
    }
    return result.output as T;
  }

  health() {
    return this.json<{ ok: boolean; version?: string }>("/health");
  }

  private modelKey(id: string, file: string) {
    if (!/^[0-9a-f]{32}$/.test(id)) throw new EngineRefused(404, "Unknown worker model");
    return `_engine/models/${id}/${file}`;
  }

  async parseModel(file: { path: string; name?: string }, progress?: EngineProgress) {
    const id = randomUUID().replaceAll("-", "");
    const sourceKey = this.modelKey(id, "source.ifc");
    const source = blobPath(sourceKey);
    await mkdir(path.dirname(source), { recursive: true });
    await copyFile(file.path, source);
    try {
      const { summary } = await this.job<{ summary: Omit<ParsedModelSummary, "modelId"> }>(
        "parse", { modelVersionId: id, sourceKey, fileName: file.name ?? path.basename(file.path) },
        this.modelKey(id, ""), progress,
      );
      return { ...summary, modelId: id, cached: false };
    } finally {
      await rm(source, { force: true });
    }
  }

  private async preset<T>(kind: PresetFolder, id: string): Promise<T> {
    const draft = this.drafts.get(`${kind}/${id}`);
    if (draft !== undefined) return draft as T;
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new EngineRefused(400, "Invalid preset id");
    const read = async (name: string) => JSON.parse(await readFile(path.join(PRESETS_DIR, name), "utf8"));
    if (kind === "classifications") {
      return { codeList: await read(`classifications/${id}/codelist.json`),
        map: await read(`classifications/${id}/map.json`) } as T;
    }
    const folder = kind === "resolution" || kind === "federation" ? "settings" : kind;
    return read(`${folder}/${id}.json`) as Promise<T>;
  }

  async run(input: RunInput, progress?: EngineProgress) {
    const doc = await this.preset<Preset>("rules", input.ruleSet);
    const parents = new Map<string, Preset>([[doc.id, doc]]);
    for (let id = doc.extends; id; ) {
      if (parents.has(id)) throw new EngineRefused(400, "The preset parent chain is circular");
      const parent = await this.preset<Preset>("rules", id);
      parents.set(id, parent);
      id = parent.extends;
    }
    parents.delete(doc.id);
    const runId = randomUUID();
    const { resultKey } = await this.job<{ resultKey: string }>("run", {
      models: input.models.map(({ modelId, ...model }) => ({
        ...model, id: modelId, parsedKey: this.modelKey(modelId, "parsed.json.gz"),
        meshesKey: this.modelKey(modelId, "meshes.npz"),
      })),
      ruleSet: { doc, library: [...parents.values()] },
      dictionaries: await Promise.all((input.dictionaries.length ? input.dictionaries : ["global-seed"]).map(
        (id) => this.preset("dictionaries", id),
      )),
      classifications: await Promise.all(input.classifications.map((id) => this.preset("classifications", id))),
      resolution: await this.preset("resolution", "resolution"),
      federation: await this.preset("federation", "federation"),
      decisions: input.decisions,
    }, `_engine/runs/${runId}/`, progress);
    try {
      const result = JSON.parse(gunzipSync(await getBlob(resultKey)).toString("utf8")) as BoqResult;
      return { runId, result };
    } finally {
      await rm(blobPath(resultKey), { force: true });
    }
  }

  async savePreset(kind: PresetFolder, id: string, doc: unknown) {
    const checked = await this.checkPreset(kind, doc, [...this.drafts.entries()]
      .filter(([key]) => key.startsWith(`${kind}/`)).map(([, preset]) => preset));
    if (!checked.ok) throw new EngineRefused(400, checked.problems.join("; "));
    this.drafts.set(`${kind}/${id}`, doc);
  }

  async deletePreset(kind: PresetFolder, id: string) {
    this.drafts.delete(`${kind}/${id}`);
  }

  checkPreset(kind: PresetFolder, doc: unknown, library: unknown[] = []) {
    return this.json<{ ok: boolean; problems: string[]; flattened?: unknown }>("/rpc/check", { kind, doc, library });
  }

  names(id: string, dictionaries: unknown[]) {
    return this.json<{ names: unknown[] }>("/rpc/names", { parsedKey: this.modelKey(id, "parsed.json.gz"), dictionaries });
  }

  async checks(id: string) {
    const doc = JSON.parse(gunzipSync(await getBlob(this.modelKey(id, "parsed.json.gz"))).toString("utf8")) as {
      verification: { checks: unknown[] };
    };
    return doc.verification.checks;
  }

  geometry(id: string) {
    return getBlob(this.modelKey(id, "geometry.glb"));
  }

  async scene(id: string) {
    return JSON.parse((await getBlob(this.modelKey(id, "scene.json"))).toString("utf8")) as SceneIndex;
  }

  async readCodeTable(file: Blob, fileName: string) {
    const fileKey = `_engine/tables/${randomUUID()}`;
    const target = blobPath(fileKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(await file.arrayBuffer()));
    try {
      return await this.json<TableReadResponse>("/rpc/codelist-read", { fileKey, fileName });
    } finally {
      await rm(target, { force: true });
    }
  }

  buildCodeList(request: CodeListBuildRequest) {
    return this.json<CodeListBuildResponse>("/rpc/codelist-build", request);
  }
}
