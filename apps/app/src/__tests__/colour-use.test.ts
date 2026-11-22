import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TF-022 (P43, design-guidelines.md "Status colours", "What may be text, and what only fill"): orange
 * and yellow are fills or markers with ink text, never small text; colours come from tokens, not hex;
 * an edited cell has a blue dot, not an orange corner.
 */
const app = path.resolve(__dirname, "../..");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : sources(full);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}
const files = [...sources(path.join(app, "src")), ...sources(path.join(app, "app"))].map((f) => ({ f: path.relative(app, f), text: readFileSync(f, "utf8") }));

describe("colour use in components", () => {
  it("no orange or yellow text", () => {
    const hits = files.flatMap(({ f, text }) => [...text.matchAll(/text-\[var\(--(orange|yellow|status-attention|status-manual|highlight)\)\]/g)].map((m) => `${f}: ${m[0]}`));
    expect(hits).toEqual([]);
  });
  it("no hex colours in class names", () => {
    const hits = files.flatMap(({ f, text }) => [...text.matchAll(/(?:text|bg|border|fill|stroke)-\[#[0-9a-fA-F]{3,6}\]/g)].map((m) => `${f}: ${m[0]}`));
    expect(hits).toEqual([]);
  });
  it("an edited cell is marked with a blue dot, and presence is not orange", () => {
    const sheet = files.find((x) => x.f.endsWith(path.join("boq-sheet", "sheet.tsx")))!.text;
    expect(sheet).not.toMatch(/after:border-t-\[var\(--status-attention\)\]/);
    expect(sheet).not.toMatch(/inset_3px_0_0_var\(--orange\)/);
    const presence = files.find((x) => x.f.endsWith(path.join("boqs", "presence.tsx")))!.text;
    expect(presence).not.toMatch(/bg-\[var\(--orange\)\]/);
  });
});
