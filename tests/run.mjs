#!/usr/bin/env node
// Runs a shared suite: `node run.mjs contract|scenarios|perf [file,file]` (perf: TS-002 API latency).
// Against API_URL=<base>/api/v1, a Java instance with the test-only routes: NativeWorkerTest
// (services/api) starts one and runs this script (docs/testing/README.md).
// Plain Node so it runs the same on Windows and in CI.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const suite = process.argv[2];
if (suite !== "contract" && suite !== "scenarios" && suite !== "perf") {
  console.error("usage: node run.mjs contract|scenarios|perf [file,file]");
  process.exit(2);
}

// The suites need the test harness: its test-only routes (SuiteSupport), test sign-in and the six
// seeded users with open sessions, which NativeWorkerTest passes as BOQLET_JAVA_SUITE_USERS. The
// local Docker stack runs the product image without them, so fail clearly instead of in setup.
if (!process.env.BOQLET_JAVA_SUITE_USERS) {
  console.error(
    `[tests] the ${suite} suite runs only inside the Java test harness (NativeWorkerTest), not against the local stack.\n` +
      "  Run it with: mvn -f services/api/pom.xml verify, with BOQLET_NATIVE_WORKER_PYTHON, BOQLET_NATIVE_NODE\n" +
      "  (and BOQLET_NATIVE_SCENARIOS=1 for the scenarios, BOQLET_API_PERF=1 for perf). See docs/testing/README.md.",
  );
  process.exit(2);
}

// Vitest needs one spelling of the path on Windows (see apps/app/scripts/vitest.mjs).
if (/^[a-z]:/.test(process.cwd())) process.chdir(process.cwd()[0].toUpperCase() + process.cwd().slice(1));

let code = 1;
try {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const { startVitest } = await import(pathToFileURL(require.resolve("vitest/node")).href);
  // An optional file filter after the suite: `node run.mjs scenarios library`; several are comma-separated.
  const only = process.argv.slice(3).find((a) => !a.startsWith("--"));
  const filters = only ? only.split(",").filter(Boolean).map((name) => `${suite}/${name}`) : [`${suite}/`];
  const vitest = await startVitest("test", filters, { run: true, root: here, config: path.join(here, "vitest.config.ts") });
  code = process.exitCode ?? (vitest?.state.getCountOfFailedTests() ? 1 : 0);
  await vitest?.close();
} catch (failed) {
  console.error(failed);
}
process.exit(code);
