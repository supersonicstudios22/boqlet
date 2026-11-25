#!/usr/bin/env node
/**
 * Runs the Python engine from engine/.venv without activating it.
 *   node scripts/run-engine.mjs worker           -> engine worker on http://127.0.0.1:8788 (ENGINE_WORKER_PORT)
 *   node scripts/run-engine.mjs test             -> ruff check, mypy (strict, pyproject.toml baseline), then pytest;
 *                                                   with arguments (a file, -k ...) only pytest with them
 *   node scripts/run-engine.mjs cli <args>       -> python -m ifc_boq.cli <args>
 *   node scripts/run-engine.mjs corpus <folder>  -> python -m ifc_boq.corpus <folder> (summary per IFC)
 *   node scripts/run-engine.mjs catalogue        -> render fixtures/corpus/catalogue.json as docs/testing/ifc-corpus-catalogue.md
 *   node scripts/run-engine.mjs import-uniclass  -> fetch + import Uniclass 2015 EF code list
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engine = join(root, "engine");
const isWin = process.platform === "win32";
const py = isWin ? join(engine, ".venv", "Scripts", "python.exe") : join(engine, ".venv", "bin", "python");
const [, , cmd, ...rest] = process.argv;

if (!existsSync(py)) {
  console.error("[engine] engine/.venv not found. Run: npm run setup:engine");
  process.exit(1);
}

const commands = {
  worker: ["-m", "uvicorn", "ifc_boq.worker_http:app", "--host", "127.0.0.1", "--port", process.env.ENGINE_WORKER_PORT || "8788"],
  test: ["-m", "pytest", "-q", ...rest],
  cli: ["-m", "ifc_boq.cli", ...rest],
  corpus: ["-m", "ifc_boq.corpus", ...rest],
  catalogue: ["-m", "ifc_boq.catalogue", ...rest],
  "import-uniclass": ["scripts/fetch_uniclass.py", ...rest],
};
const args = commands[cmd];
if (!args) {
  console.error(`[engine] unknown command "${cmd}". Use: ${Object.keys(commands).join(" | ")}`);
  process.exit(1);
}
// CLI and corpus paths are relative to where the user ran npm; everything else runs inside engine/.
const cwd = cmd === "cli" || cmd === "corpus" ? process.env.INIT_CWD || process.cwd() : engine;
const env = { ...process.env, PYTHONUNBUFFERED: "1" };
if (cmd === "worker" && !env.ENGINE_STORAGE) {
  // A standalone worker for engine work; the local backend runs its own in Docker (ops/local).
  env.ENGINE_STORAGE = `file://${join(engine, ".cache", "blobs")}`;
}
// Review B-10: the full engine test run lints and type-checks first (engine/pyproject.toml has both configs).
const steps = cmd === "test" && rest.length === 0 ? [["-m", "ruff", "check", "."], ["-m", "mypy"], args] : [args];
let child;
const next = (index) => {
  child = spawn(py, steps[index], { cwd, stdio: "inherit", env });
  child.on("exit", (code) => (code || index === steps.length - 1 ? process.exit(code ?? 0) : next(index + 1)));
};
next(0);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
