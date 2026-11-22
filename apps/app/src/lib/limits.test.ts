import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS } from "./limits";

/** TF-174 (C08): the inputs carry the API's request limits, so the API never has to refuse them. */

const app = path.resolve(__dirname, "../..");
// Line endings normalised: a Windows checkout has CRLF (core.autocrlf).
const text = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const openapi = text(path.resolve(app, "../../packages/api/openapi.yaml"));
const source = (file: string) => text(path.join(app, file));
/** `maxLength` of a property in a component schema of the contract. */
function contractLimit(schema: string, prop: string): number {
  const at = openapi.indexOf(`\n    ${schema}:\n`);
  expect(at, schema).toBeGreaterThan(0);
  // The schema's own lines: up to the next component at the same indentation.
  const next = openapi.slice(at + 1).search(/\n {4}[A-Za-z]/);
  const block = openapi.slice(at, next < 0 ? undefined : at + 1 + next);
  const m = block.match(new RegExp(String.raw`\n\s+${prop}: \{[^}]*maxLength: (\d+)`));
  expect(m, `${schema}.${prop}`).not.toBeNull();
  return Number(m![1]);
}

describe("request limits (C08)", () => {
  it("are the contract's", () => {
    expect(contractLimit("OrgCreate", "name")).toBe(LIMITS.name);
    expect(contractLimit("ShareLinkCreate", "label")).toBe(LIMITS.name);
    expect(contractLimit("DecisionInput", "note")).toBe(LIMITS.text);
    expect(contractLimit("LineOverrideInput", "reason")).toBe(LIMITS.text);
    expect(contractLimit("LineOverrideInput", "description")).toBe(LIMITS.lineText);
    expect(openapi).toMatch(/person names 120 characters/);
    expect(LIMITS.personName).toBe(120);
  });

  // Each form field the API limits, found by its id or test id, carries the limit.
  const fields: [file: string, anchor: string, limit: keyof typeof LIMITS][] = [
    ["src/auth/adapters/native.tsx", 'name="name"', "personName"],
    ["app/(app)/account/page.tsx", 'id="account-name"', "personName"],
    ["app/(app)/onboarding/page.tsx", 'id="org-name"', "name"],
    ["src/features/settings/general-settings.tsx", 'id="org-name"', "name"],
    ["app/(app)/[org]/projects/new/page.tsx", 'id="project-name"', "name"],
    ["app/(app)/[org]/projects/[projectId]/settings/page.tsx", 'id="p-name"', "name"],
    ["app/(app)/[org]/projects/[projectId]/models/page.tsx", 'id="model-name"', "name"],
    ["src/features/boqs/create-boq-dialog.tsx", 'id="boq-name"', "name"],
    ["src/features/boqs/create-boq-dialog.tsx", 'id="boq-description"', "text"],
    ["src/features/library/create-preset.tsx", 'id="preset-name"', "name"],
    ["src/features/library/preset-page.tsx", 'id="details-name"', "name"],
    ["src/features/library/clone-dialog.tsx", 'id="clone-name"', "name"],
    ["src/features/shares/share-dialog.tsx", 'id="share-label"', "name"],
    ["src/features/versions/version-dialogs.tsx", 'id="version-label"', "name"],
    ["src/features/versions/version-dialogs.tsx", 'id="version-note"', "text"],
    ["src/features/versions/version-dialogs.tsx", 'id="request-comment"', "text"],
    ["src/features/boq-sheet/edit-dialogs.tsx", 'data-testid="reason-input"', "text"],
    ["src/features/boq-sheet/edit-dialogs.tsx", 'data-testid="manual-description"', "lineText"],
    ["src/features/boqs/reopen-boq-dialog.tsx", 'id="reopen-reason"', "text"],
    ["src/features/decisions/decisions-table.tsx", "value={note}", "text"],
  ];
  it.each(fields)("%s %s", (file, anchor, limit) => {
    const text = source(file);
    // The input element the anchor is on (not a label or field wrapper with the same id): from its
    // opening tag to the end of the tag.
    const tags = new Map<number, string>();
    for (let at = text.indexOf(anchor); at >= 0; at = text.indexOf(anchor, at + 1)) {
      const start = text.lastIndexOf("<", at);
      if (/^<(Input|input|textarea)\b/.test(text.slice(start))) tags.set(start, text.slice(start, text.indexOf("/>", at)));
    }
    expect(tags.size, anchor).toBe(1);
    expect([...tags.values()][0]).toContain(`maxLength={LIMITS.${limit}}`);
  });
});
