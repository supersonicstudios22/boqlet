import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import shares from "../../messages/en/shares.json";
import account from "../../messages/en/account.json";
import shell from "../../messages/en/shell.json";

/**
 * Stage 4 accessibility and widths (nfr.md WCAG 2.2 AA; ≥ 768 px read-only, share page on a phone),
 * checked in the source; the browser checks are in e2e-java/a11y-layout.spec.ts.
 */
const src = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");

describe("TF-161 the sheet is one Tab stop", () => {
  it("row checkboxes are out of the Tab order, named by their line; Space ticks the selected line", () => {
    const sheet = src("src/features/boq-sheet/sheet.tsx");
    const box = sheet.slice(sheet.indexOf('data-testid="line-check"') - 600, sheet.indexOf('data-testid="line-check"'));
    expect(box).toContain("tabIndex={-1}");
    expect(box).toContain('te("selectLine"');
    expect(sheet).toMatch(/e\.key === " " && selected && editable/);
    const all = sheet.slice(sheet.lastIndexOf("<input", sheet.indexOf('data-testid="check-all"')), sheet.indexOf('data-testid="check-all"'));
    expect(all).toContain("tabIndex={-1}");
  });
});

describe("TF-165 targets of at least 24 px", () => {
  it("the line's element list and the line links in the viewer", () => {
    const viewer = src("src/features/viewer/model-viewer.tsx");
    for (const id of ["viewer-line-element", "viewer-open-line"]) {
      const at = viewer.indexOf(`data-testid="${id}"`);
      expect(viewer.slice(viewer.lastIndexOf("<button", at), at), id).toContain("min-h-6");
    }
    expect(src("src/components/shell/app-shell.tsx")).toMatch(/focus:min-h-10/);
  });
});

describe("TF-166 names", () => {
  it("the created share link field is labelled; the account wordmark is named like the shell's", () => {
    const urlField = src("src/features/shares/share-dialog.tsx")
      .split(/\r?\n/)
      .find((l) => l.includes('data-testid="share-url"'))!;
    expect(urlField).toContain('aria-label={t("linkUrl")}');
    expect(shares.linkUrl).toBeTruthy();
    expect(account.home).toBe(shell.home);
  });
});

describe("TF-169 landmarks", () => {
  it("the share page is a <main id=main>", () => {
    expect(src("src/features/shares/public-share.tsx")).toMatch(/<main id="main"[^>]*data-testid="public-share"/);
  });
});

describe("TF-149, TF-168, TF-171, TF-172 widths", () => {
  it("long names wrap; the sidebar folds below 1024 px; the tab rows wrap; the share table wraps; the viewer can't widen the page", () => {
    expect(src("app/globals.css")).toMatch(/h1,\s*h2,\s*h3\s*\{\s*overflow-wrap: anywhere;/);
    const shell = src("src/components/shell/app-shell.tsx");
    expect(shell).toContain('className="hidden border-r border-border lg:block"');
    expect(shell).toContain("<NavMenu");
    // The tabs wrap, and so does the row they share with the project's name or the sheet's counts (review C-01).
    expect(src("src/features/projects/project-header.tsx")).toContain("flex flex-wrap items-end gap-x-8 gap-y-2 border-b");
    expect(src("src/features/projects/project-header.tsx")).toContain('className="flex flex-wrap gap-x-6 gap-y-2"');
    expect(src("app/(app)/[org]/projects/[projectId]/boqs/[boqId]/page.tsx")).toContain("flex flex-wrap items-end gap-x-6 gap-y-1 border-b");
    expect(src("app/(app)/[org]/projects/[projectId]/boqs/[boqId]/page.tsx")).toContain('className="flex flex-wrap gap-x-6 gap-y-2"');
    expect(src("src/features/shares/public-share.tsx")).toMatch(/whitespace-normal break-words/);
    expect(src("src/features/viewer/model-viewer.tsx")).toMatch(/min-w-0 flex-1 overflow-hidden/);
  });
});
