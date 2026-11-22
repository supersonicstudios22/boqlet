import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import projects from "../../../messages/en/projects.json";
import { AUDIT_ACTIONS } from "./audit-view";

/**
 * TF-127 / TF-145 (BR-51, F15-AC1): every audit action Java writes has a label, and the "What" filter
 * offers the actions Java writes (not names it never uses, so a filter finds the events).
 */
const java = path.resolve(__dirname, "../../../../../services/api/src/main/java");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n);
    return statSync(f).isDirectory() ? files(f) : n.endsWith(".java") ? [f] : [];
  });
const PREFIX = /^"(admin|org|member|session|project|model|model_version|boq|revision|version|run|decision|line|manual_line|export|preset|share_link|user)\.[a-z_]+"$/;
/** Literals with an audit-like shape that are not audit actions: realtime events, notification kinds, a state. */
const NOT_ACTIONS = new Set(["boq.presence", "boq.new_version_available", "run.needs_input", "revision.review_requested", "session.revoked", "org.deleting", "export.xlsx"]);

function javaActions(): string[] {
  const out = new Set<string>();
  for (const f of files(java)) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/"[a-z_]+\.[a-z_]+"/g)) if (PREFIX.test(m[0])) out.add(m[0].slice(1, -1));
    // Share links write "share_link." + their action.
    if (text.includes('"share_link." + action')) for (const m of text.matchAll(/record\([^)]*"(created|updated|revoked)"\)/g)) out.add(`share_link.${m[1]}`);
  }
  return [...out].filter((a) => !NOT_ACTIONS.has(a)).sort();
}
const labels = projects.activity.actions as Record<string, string>;

describe("audit actions", () => {
  const written = javaActions();
  it("reads what Java writes", () => {
    expect(written).toEqual(expect.arrayContaining(["run.completed", "revision.inputs_updated", "model_version.ready", "share_link.created"]));
  });
  it("each has a label", () => {
    expect(written.filter((a) => !labels[a.replaceAll(".", "_")])).toEqual([]);
  });
  it("the filter offers only actions Java writes", () => {
    expect(AUDIT_ACTIONS.filter((a) => !written.includes(a))).toEqual([]);
  });
});

describe("TF-145: element families have labels (the sheet's Family filter)", () => {
  it("every family of the engine type", async () => {
    const { readFileSync: read } = await import("node:fs");
    const boqs = (await import("../../../messages/en/boqs.json")).default as { sheet: { families: Record<string, string> } };
    const src = read(path.resolve(__dirname, "../../../../../packages/types/src/families.ts"), "utf8");
    const families = [...src.slice(src.indexOf("export type ElementFamily"), src.indexOf(";", src.indexOf("export type ElementFamily"))).matchAll(/"([a-z]+)"/g)].map((m) => m[1]!);
    expect(families.length).toBeGreaterThan(5);
    expect(families.filter((f) => !boqs.sheet.families[f])).toEqual([]);
  });
});
