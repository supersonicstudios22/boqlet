import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TF-162 / TF-169 (design-guidelines.md Accessibility: "focus is always visible (2 px --ring)";
 * WCAG 1.4.3, 1.4.11): the components' focus ring is the full --ring, and a destructive button is a
 * red fill with its foreground (no red text on a red tint).
 */
const ui = path.resolve(__dirname, "../components/ui");
const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

describe("focus and destructive", () => {
  it("no faded focus ring in the components", () => {
    const hits = readdirSync(ui).flatMap((f) => [...readFileSync(path.join(ui, f), "utf8").matchAll(/focus-visible:ring-(ring|destructive)\/\d+/g)].map((m) => `${f}: ${m[0]}`));
    expect(hits).toEqual([]);
  });
  it("the destructive button is a red fill with its foreground", () => {
    const button = readFileSync(path.join(ui, "button.tsx"), "utf8");
    const destructive = button.match(/destructive:\s*"([^"]+)"/)![1]!;
    expect(destructive).toContain("bg-destructive");
    expect(destructive).toContain("text-destructive-foreground");
    expect(destructive).not.toMatch(/bg-destructive\/\d+/);
    expect(css).toMatch(/--destructive-foreground:/);
  });
});
