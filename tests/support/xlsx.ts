import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_URL, authentication } from "./env";
import type { TestUser } from "./users";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, "..", "..", "engine");
const python = process.env.IFC_BOQ_PYTHON ?? (existsSync(path.join(ENGINE, ".venv", "Scripts", "python.exe")) ? path.join(ENGINE, ".venv", "Scripts", "python.exe") : path.join(ENGINE, ".venv", "bin", "python"));

/** The bytes of an export, downloaded as `u`. */
export async function exportBytes(u: TestUser, exportId: string): Promise<Buffer> {
  const res = await fetch(`${API_URL}/exports/${exportId}/download`, { headers: await authentication(u.token) });
  if (!res.ok) throw new Error(`download of export ${exportId} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** One sheet of an exported workbook as rows of cell values (formulas as their text), read with openpyxl. */
export async function xlsxRows(u: TestUser, exportId: string, sheet: string): Promise<unknown[][]> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "boqlet-xlsx-"));
  try {
    const file = path.join(dir, "export.xlsx");
    writeFileSync(file, await exportBytes(u, exportId));
    const res = spawnSync(python, [path.join(HERE, "xlsx_rows.py"), file, sheet], { encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } });
    if (res.status !== 0) throw new Error(`xlsx_rows.py: ${res.stderr}`);
    return JSON.parse(res.stdout) as unknown[][];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The centre of each visible sheet's page header (where the Free-plan watermark is, review C-21), read with openpyxl. */
export async function xlsxPageHeaders(u: TestUser, exportId: string): Promise<Record<string, string | null>> {
  const code = [
    "import json, sys", "from openpyxl import load_workbook",
    "import io", "book = load_workbook(io.BytesIO(sys.stdin.buffer.read()))",
    "print(json.dumps({s.title: s.oddHeader.center.text for s in book.worksheets if s.sheet_state == 'visible'}))",
  ].join("\n");
  const res = spawnSync(python, ["-c", code], { encoding: "utf8", input: await exportBytes(u, exportId), env: { ...process.env, PYTHONUTF8: "1" } });
  if (res.status !== 0) throw new Error(`page headers: ${res.stderr}`);
  return JSON.parse(res.stdout) as Record<string, string | null>;
}
