/**
 * The engine's workbooks (EN-006), through the current engine: the BoQ export (F12), the change
 * report (F08 §7) and reading an edited BoQ workbook back (F12, FE-037). Only the engine worker
 * writes and reads them; another engine answers `EngineUnavailable`.
 */
import type { BoqResult } from "@ifc-boq/types";
import { engine, unsupported } from "./engine.js";

export interface ExportMeta {
  /** Classifications in grouping order: the first groups the BoQ sheet. */
  classifications: { id: string; name: string }[];
  modelName: string;
  generatedAt: string;
  dictionaries?: string[];
  /** The BoQ the file is of: the edits import (FE-037) refuses a file of another BoQ. */
  boqId?: string;
  project?: string;
  boq?: string;
  revision?: string;
  status?: string;
  issuedAt?: string;
  issuedBy?: string;
  issueNote?: string;
  locale?: string;
  watermark?: boolean;
  numberFormat?: { decimal?: string; thousands?: string };
  positionNumbers?: Record<string, string>;
}

/** The change report's title, the two versions' labels and the system its lines are grouped by. */
export interface DiffExportMeta {
  title: string;
  fromLabel: string;
  toLabel: string;
  groupBy?: string;
}

/** One line as the import compares it: its key, its codes, whether it is excluded now. */
export interface ImportLine {
  key: string;
  codes: BoqResult["lines"][number]["codes"];
  excluded?: boolean;
}

export interface ImportInfo {
  boqId: string;
  primary: string | null;
  lines: ImportLine[];
}

/** Writes the BoQ Excel of a result; returns the xlsx bytes. */
export function exportXlsx(result: BoqResult, meta: ExportMeta): Promise<Uint8Array> {
  const current = engine();
  if (!current.exportBoq) throw unsupported("write BoQ workbooks");
  return current.exportBoq(result, meta);
}

/** Writes the change report workbook of a stored diff (`DiffRec.key`); returns the xlsx bytes. */
export function exportDiffXlsx(diffKey: string, meta: DiffExportMeta): Promise<Uint8Array> {
  const current = engine();
  if (!current.exportDiff) throw unsupported("write change reports");
  return current.exportDiff(diffKey, meta);
}

/** Reads an edited BoQ workbook back against the BoQ's current lines: the EditsImportReport. */
export function readEditedXlsx(xlsx: Uint8Array, info: ImportInfo): Promise<unknown> {
  const current = engine();
  if (!current.importBoq) throw unsupported("read edited workbooks");
  return current.importBoq(xlsx, info);
}
