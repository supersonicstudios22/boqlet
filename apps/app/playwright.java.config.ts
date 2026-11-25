import { defineConfig, devices } from "@playwright/test";
import { timeFactor } from "../../tests/support/time-factor.mjs";

/**
 * The browser smoke suite against the Java backend (FE-041/FE-043, `e2e-java/`): the app with the
 * native adapter (P50), proxying `/api/v1` to a Java instance with native sign-in. The JUnit test
 * `NativeWorkerTest#browserSmokeAgainstJava` starts Java (PostgreSQL, object storage, MailHog, the
 * engine workers) and runs this config with:
 *
 * - `BOQLET_JAVA_API`: the Java instance's base URL (its `/api/v1` and `/_test`);
 * - `BOQLET_JAVA_APP`: the app's origin, which Java checks on every state-changing request;
 * - `BOQLET_SUITE_MAILHOG`: MailHog's HTTP API.
 *
 * Its own dev build folder (`.next-java`), so it runs beside `npm run dev:app` on port 3000.
 *
 * On a loaded machine every timeout is multiplied by `BOQLET_TEST_TIME_FACTOR` (review B-08), and a
 * test that failed only by its timeout is tried once more (e2e-java/fixtures.ts); tests that pass on
 * the retry are listed as flaky (e2e-java/flaky-reporter.ts).
 */
const factor = timeFactor();
const app = new URL(process.env.BOQLET_JAVA_APP ?? "http://localhost:3100");
const api = process.env.BOQLET_JAVA_API;
if (!api) throw new Error("BOQLET_JAVA_API is not set: run the suite through NativeWorkerTest#browserSmokeAgainstJava.");
const node = JSON.stringify(process.env.BOQLET_NODE ?? process.execPath);
const next = JSON.stringify(require.resolve("next/dist/bin/next"));

export default defineConfig({
  testDir: "e2e-java",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Only a timeout is retried: e2e-java/fixtures.ts fails the retry of any other failure at once.
  retries: 1,
  reporter: [["list"], ["./e2e-java/flaky-reporter.ts"]],
  // The dev server compiles a route on its first visit; that can take several seconds.
  expect: { timeout: 20_000 * factor },
  timeout: 180_000 * factor,
  outputDir: "test-results/java",
  // Compiles every route the tests visit once, after the app is up (e2e-java/global-setup.ts).
  globalSetup: "./e2e-java/global-setup.ts",
  use: { baseURL: app.origin, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `${node} scripts/pseudo-locale.mjs && ${node} ${next} dev --port ${app.port}`,
    url: app.origin,
    env: {
      NEXT_PUBLIC_AUTH_ADAPTER: "native",
      API_PROXY_TARGET: api,
      NEXT_DIST_DIR: ".next-java",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    reuseExistingServer: false,
    timeout: 240_000 * factor,
    stdout: "pipe",
  },
});
