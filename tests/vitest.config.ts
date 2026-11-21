import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["contract/**/*.test.ts", "scenarios/**/*.test.ts", "perf/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One backend, shared state: files run one after another.
    fileParallelism: false,
    // The seed data the scenarios read (support/seed-java.ts).
    globalSetup: ["support/seed-java.ts"],
  },
});
