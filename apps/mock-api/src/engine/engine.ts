/**
 * The mock's engine: the engine worker over its HTTP transport (`WorkerEngine`). The interface
 * stays so tests can swap in a stub engine (`setEngine`).
 */
import type { BoqResult, CodeListBuildRequest, CodeListBuildResponse, RunDiff, SceneIndex, TableReadResponse } from "@ifc-boq/types";
import { WorkerEngine } from "./worker.js";
import type { DiffExportMeta, ExportMeta, ImportInfo } from "./exports.js";
import type { TemplateImport, TemplateInput } from "./preset-template.js";
import type { PreviewChange } from "./preset-preview.js";

export type PresetFolder = "rules" | "dictionaries" | "classifications" | "federation" | "resolution";

export interface ParsedModelSummary {
  modelId: string;
  fileName?: string;
  schema?: string;
  elementCount?: number;
  cached?: boolean;
  [key: string]: unknown;
}

export interface RunInput {
  models: { modelId: string; discipline?: string; scope?: Record<string, unknown> }[];
  /** Engine preset ids (the mock saves resolved preset versions under `mock-<versionId>`). */
  ruleSet: string;
  dictionaries: string[];
  classifications: string[];
  decisions: { questionId: string; answer: unknown; [key: string]: unknown }[];
  manualItems?: Record<string, unknown>[];
}

export interface RunOutput {
  runId: string;
  result: BoqResult;
}

export type EngineProgress = (stage: string, pct: number) => void;

export interface DiffInputSide {
  resultKey: string;
  models: { modelId: string; versionId: string; name: string; traceId: string }[];
  decisions: unknown[];
}

export interface Engine {
  readonly name: string;
  health(): Promise<{ ok: boolean; version?: string }>;
  parseModel(file: { path: string; name?: string }, progress?: EngineProgress): Promise<ParsedModelSummary>;
  run(input: RunInput, progress?: EngineProgress): Promise<RunOutput>;
  preview?(input: RunInput, compare?: RunInput, progress?: EngineProgress): Promise<{ result: BoqResult; changes?: PreviewChange[] }>;
  /** Compares two runs (EN-002); the worker writes the diff under `prefix`. */
  diff?(from: DiffInputSide, to: DiffInputSide, inputsChanged: string[], prefix: string, progress?: EngineProgress): Promise<RunDiff>;
  /** The BoQ workbook of a result (EN-006). */
  exportBoq?(result: BoqResult, meta: ExportMeta): Promise<Uint8Array>;
  /** The change report workbook of a stored diff (EN-006). */
  exportDiff?(diffKey: string, meta: DiffExportMeta): Promise<Uint8Array>;
  /** Reads an edited BoQ workbook back against the BoQ's current lines: the EditsImportReport (EN-006). */
  importBoq?(file: Uint8Array, info: ImportInfo): Promise<unknown>;
  savePreset(kind: PresetFolder, id: string, doc: unknown): Promise<void>;
  deletePreset(kind: PresetFolder, id: string): Promise<void>;
  /** Problems in a preset document; for a rule-set patch also the flattened rule set. */
  checkPreset(kind: PresetFolder, doc: unknown, library?: unknown[]): Promise<{ ok: boolean; problems: string[]; flattened?: unknown }>;
  /** Distinct names in a parsed model and how the dictionaries (most general first) resolve them. */
  names(engineModelId: string, dictionaries: unknown[]): Promise<{ names: unknown[] }>;
  /** The verification checks of a parsed model, with their elements (F03 §5). */
  checks(engineModelId: string): Promise<unknown[]>;
  /** The display geometry of a parsed model (glb, one mesh node per GlobalId, F07 §1). */
  geometry(engineModelId: string): Promise<Uint8Array>;
  /** The scene index that links the geometry's nodes to elements (`SceneIndex`, F07 §1). */
  scene(engineModelId: string): Promise<SceneIndex>;
  /** The sheets of a code-list spreadsheet (.xlsx, .csv, .tsv), with a guess of its columns (F10 §8). */
  readCodeTable(file: Blob, fileName: string): Promise<TableReadResponse>;
  /** Codes from a sheet's rows and a column mapping: hierarchy, problems (duplicates…), stats (F10 §8). */
  buildCodeList(request: CodeListBuildRequest): Promise<CodeListBuildResponse>;
  writeTemplate(input: TemplateInput): Promise<Uint8Array>;
  readTemplate(input: TemplateInput, file: Uint8Array): Promise<TemplateImport | { error: string }>;
}

export class EngineUnavailable extends Error {}
export class EngineRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let current: Engine = new WorkerEngine();
export const engine = () => current;
/** A worker-only operation the current engine doesn't have: there is no fallback (FE-042). */
export function unsupported(operation: string) {
  return new EngineUnavailable(`The ${current.name} engine can't ${operation}: it needs the engine worker (ENGINE_URL).`);
}
/** Tests replace the engine (e.g. with a recorded one). */
export function setEngine(next: Engine) {
  current = next;
}
