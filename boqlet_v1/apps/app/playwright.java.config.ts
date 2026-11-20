import { defineConfig, devices } from "@playwright/test";

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
 */
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
  retries: 0,
  reporter: "list",
  // The dev server compiles a route on its first visit; that can take several seconds.
  expect: { timeout: 20_000 },
  timeout: 180_000,
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
    timeout: 240_000,
    stdout: "pipe",
  },
});
