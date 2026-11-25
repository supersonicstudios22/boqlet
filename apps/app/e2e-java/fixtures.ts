import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";
export type { BrowserContext, Locator, Page } from "@playwright/test";

/**
 * The browser suite's `test` (review B-08): Playwright's, with one rule for its single retry
 * (`retries: 1` in playwright.java.config.ts). A test is tried again only when its first attempt ended
 * by its timeout, the false red a loaded machine gives; an attempt that failed any other way makes the
 * retry fail at once with the reason, so a genuine failure still fails. (A test that passed runs again
 * when another test of its serial group failed: that rerun goes ahead.) Tests that pass on the retry
 * are reported as flaky (e2e-java/flaky-reporter.ts).
 */
export const test = base.extend<{ timeoutOnlyRetry: void }>({
  timeoutOnlyRetry: [
    async ({}, use, testInfo) => {
      const record = path.join(testInfo.project.outputDir, ".attempts", `${testInfo.testId}.txt`);
      if (testInfo.retry > 0) {
        let previous = "unknown";
        try {
          previous = readFileSync(record, "utf8");
        } catch {
          /* the first attempt left no record: it did not get to its teardown */
        }
        // "passed" or "skipped": the test runs again because another test of its serial group failed.
        if (!["timedOut", "passed", "skipped"].includes(previous)) {
          throw new Error(`Not retried: the first attempt ended "${previous}", not by its timeout (only timeouts are retried, review B-08).`);
        }
      }
      await use();
      mkdirSync(path.dirname(record), { recursive: true });
      writeFileSync(record, testInfo.status ?? "unknown");
    },
    { auto: true },
  ],
});
