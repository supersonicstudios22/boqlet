import { appendFileSync } from "node:fs";
import type { Reporter, TestCase } from "vitest/node";

/**
 * Lists the tests that passed only on their retry (review B-08): the suites retry a test once when it
 * failed by a timeout alone (vitest.config.ts), so a slow moment on a loaded machine doesn't turn the
 * build red, but every such test is named, here and in the CI job's summary, so real slowness is seen.
 */
export default class FlakyReporter implements Reporter {
  private readonly flaky: string[] = [];

  onTestCaseResult(test: TestCase) {
    if (test.result().state === "passed" && test.diagnostic()?.flaky) {
      this.flaky.push(`${test.module.moduleId.replace(/^.*[\/](contract|scenarios|perf)[\/]/, "$1/")} > ${test.fullName}`);
    }
  }

  onTestRunEnd() {
    if (!this.flaky.length) return;
    const lines = this.flaky.map((name) => `[flaky] passed on its retry after a timeout: ${name}`);
    console.log(["", ...lines, ""].join("\n"));
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      appendFileSync(summary, `\n### Flaky shared-suite tests (passed on the retry after a timeout)\n\n${this.flaky.map((n) => `- ${n}`).join("\n")}\n`);
    }
  }
}
