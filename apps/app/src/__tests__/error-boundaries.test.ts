import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** TF-026 (screens.md error state): every route group has a translated error view with retry, not the bare global one. */
const app = path.resolve(__dirname, "../../app");
describe("error boundaries", () => {
  it.each(["error.tsx", "(public)/error.tsx", "(app)/error.tsx", "(admin)/admin/error.tsx"])("%s shows ErrorView", (file) => {
    const f = path.join(app, file);
    expect(existsSync(f), file).toBe(true);
    expect(readFileSync(f, "utf8")).toContain("<ErrorView");
  });
});
