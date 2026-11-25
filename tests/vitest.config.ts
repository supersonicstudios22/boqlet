import { defineConfig } from "vitest/config";
import { timeFactor } from "./support/time-factor.mjs";

const factor = timeFactor();

export default defineConfig({
  test: {
    include: ["contract/**/*.test.ts", "scenarios/**/*.test.ts", "perf/**/*.test.ts"],
    // Scaled on a loaded machine (BOQLET_TEST_TIME_FACTOR, review B-08).
    testTimeout: 60_000 * factor,
    hookTimeout: 60_000 * factor,
    // One more try for a test that failed only by its timeout; any other failure fails at once.
    // Tests that pass on the retry are listed as flaky (support/flaky-reporter.ts).
    retry: { count: 1, condition: /^(Test|Hook) timed out in \d+ms/ },
    reporters: ["default", "./support/flaky-reporter.ts"],
    // One backend, shared state: files run one after another.
    fileParallelism: false,
    // The seed data the scenarios read (support/seed-java.ts).
    globalSetup: ["support/seed-java.ts"],
  },
});
