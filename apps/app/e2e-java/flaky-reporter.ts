import { appendFileSync } from "node:fs";
import type { Reporter, TestCase } from "@playwright/test/reporter";

/** Names the browser tests that passed only on their retry after a timeout (review B-08; e2e-java/fixtures.ts). */
export default class FlakyReporter implements Reporter {
  private readonly flaky = new Set<string>();

  onTestEnd(test: TestCase) {
    if (test.outcome() === "flaky") this.flaky.add(test.titlePath().filter(Boolean).join(" > "));
  }

  onEnd() {
    if (!this.flaky.size) return;
    console.log(["", ...[...this.flaky].map((name) => `[flaky] passed on its retry after a timeout: ${name}`), ""].join("\n"));
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      appendFileSync(summary, `\n### Flaky browser tests (passed on the retry after a timeout)\n\n${[...this.flaky].map((n) => `- ${n}`).join("\n")}\n`);
    }
  }
}
