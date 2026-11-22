import { describe, expect, it } from "vitest";
import { can, orgCan } from "./permissions";

describe("can", () => {
  it("is true only for actions the API marks true", () => {
    expect(can({ approve: true, edit: false }, "approve")).toBe(true);
    expect(can({ approve: true, edit: false }, "edit")).toBe(false);
    expect(can({ approve: true }, "delete")).toBe(false);
    expect(can(undefined, "approve")).toBe(false);
  });
});

describe("orgCan (docs/domain/permissions.md, org roles)", () => {
  it("lets only the owner handle billing and make owners", () => {
    expect(orgCan("owner", "manageBilling")).toBe(true);
    expect(orgCan("admin", "manageBilling")).toBe(false);
    expect(orgCan("admin", "makeOwner")).toBe(false);
  });
  it("lets library editors edit the library but not members", () => {
    expect(orgCan("library_editor", "editLibrary")).toBe(true);
    expect(orgCan("member", "editLibrary")).toBe(false);
    expect(orgCan("member", "viewLibrary")).toBe(true);
  });
  it("lets everyone create projects and nobody without a role do anything", () => {
    for (const role of ["owner", "admin", "library_editor", "member"] as const) expect(orgCan(role, "createProjects")).toBe(true);
    expect(orgCan(undefined, "createProjects")).toBe(false);
  });
});

describe("TF-024: roles become permissions in one place", () => {
  it("no component compares an org role with a role name to gate an action", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const f = path.join(dir, n);
        return statSync(f).isDirectory() ? (n === "testing" ? [] : walk(f)) : /\.tsx?$/.test(n) && !/\.test\./.test(n) && !f.endsWith("permissions.ts") ? [f] : [];
      });
    const hits = walk(root).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/(?:myRole|membership\?\.role|\brole) === "owner"/g)].map((m) => `${path.relative(root, f)}: ${m[0]}`));
    expect(hits).toEqual([]);
  });
});
