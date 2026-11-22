import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import ruleSetEditor from "../../messages/en/ruleSetEditor.json";
import common from "../../messages/en/common.json";

/**
 * TF-023 (F15 §1): sentences, labels and lists come from the catalogue, not glued in code: no label
 * built from two translations in a template string, no list joined with a literal ", ".
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

describe("composed UI text", () => {
  it("no label, accessible name, placeholder or title glued from translations in a template string", () => {
    const hits = files.flatMap(({ f, text }) => [...text.matchAll(/(?:label|aria-label|placeholder|title)=\{`[^`]*\$\{t[A-Za-z]*\(/g)].map((m) => `${f}: ${m[0]}`));
    expect(hits).toEqual([]);
  });

  it("the sheet, the BoQ header and the share and review lines join lists in the person's language", () => {
    for (const f of ["boq-sheet/sheet.tsx", "boqs/boq-header.tsx", "shares/share-dialog.tsx", "versions/review-strip.tsx"]) {
      const text = files.find((x) => x.f.replaceAll("\\", "/").endsWith(f))!.text;
      expect(text, f).not.toContain('.join(", ")');
    }
  });

  it("the catalogue's line-text example and optional label read as written", () => {
    const t = createTranslator({ locale: "en", messages: { ruleSetEditor, common } });
    expect(t("ruleSetEditor.forms.lineTextExample")).toBe("Wall, {type_name}, {thickness*1000} mm");
    expect(t("common.optionalLabel", { label: "Notes" })).toBe("Notes (optional)");
  });
});
