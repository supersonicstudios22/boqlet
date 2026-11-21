#!/usr/bin/env node
// Bundle budgets per route (FE-045, nfr.md): the JavaScript a route loads before it is interactive,
// gzipped, from a production build (`next build`). A route's JS is the root main files plus every
// chunk its layouts and page name in their client reference manifest (`entryJSFiles`); chunks
// loaded later (the 3D viewer, dialogs) are not counted. Budgets: `bundle-budgets.json`, in KiB.
//
//   node scripts/bundle-budget.mjs           check against the budgets (CI); exit 1 over budget
//   node scripts/bundle-budget.mjs --write   print the sizes and write budgets with 10 % headroom
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const next = path.join(app, ".next");
const budgetsFile = path.join(app, "bundle-budgets.json");

async function* manifests(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* manifests(full);
    else if (entry.name === "page_client-reference-manifest.js") yield full;
  }
}

/** "/(app)/[org]/projects/[projectId]/page" → "/[org]/projects/[projectId]" */
const routeOf = (key) => key.replace(/\/page$/, "").replace(/\/\([^)]+\)/g, "") || "/";

const sizes = new Map();
async function gz(file) {
  if (!sizes.has(file)) sizes.set(file, gzipSync(await readFile(path.join(next, file))).length);
  return sizes.get(file);
}

if (!existsSync(path.join(next, "build-manifest.json"))) {
  console.error("[bundle] no production build: run `npm run build -w @ifc-boq/app` first");
  process.exit(1);
}
const build = JSON.parse(await readFile(path.join(next, "build-manifest.json"), "utf8"));
const routes = {};
for await (const file of manifests(path.join(next, "server", "app"))) {
  globalThis.__RSC_MANIFEST = {};
  new Function(await readFile(file, "utf8"))();
  for (const [key, m] of Object.entries(globalThis.__RSC_MANIFEST)) {
    const chunks = new Set([...build.rootMainFiles, ...Object.values(m.entryJSFiles ?? {}).flat()]);
    let bytes = 0;
    for (const c of chunks) bytes += await gz(c.replace(/^\/_next\//, ""));
    routes[routeOf(key)] = Math.round(bytes / 1024);
  }
}

const sorted = Object.fromEntries(Object.entries(routes).sort(([a], [b]) => a.localeCompare(b)));
if (process.argv.includes("--write")) {
  const budgets = Object.fromEntries(Object.entries(sorted).map(([r, kib]) => [r, Math.ceil((kib * 1.1) / 10) * 10]));
  await writeFile(budgetsFile, JSON.stringify(budgets, null, 2) + "\n", "utf8");
  for (const [r, kib] of Object.entries(sorted)) console.log(`${String(kib).padStart(5)} KiB  (budget ${budgets[r]})  ${r}`);
  process.exit(0);
}

const budgets = JSON.parse(await readFile(budgetsFile, "utf8"));
const over = [];
for (const [r, kib] of Object.entries(sorted)) {
  const budget = budgets[r];
  if (budget === undefined) over.push(`${r}: ${kib} KiB, no budget (add it to bundle-budgets.json)`);
  else if (kib > budget) over.push(`${r}: ${kib} KiB > budget ${budget} KiB`);
}
if (over.length) {
  console.error(`[bundle] over budget:\n  ${over.join("\n  ")}`);
  process.exit(1);
}
console.log(`[bundle] ${Object.keys(sorted).length} routes within budget (largest ${Math.max(...Object.values(sorted))} KiB gzipped)`);
