import { describe, expect, it } from "vitest";
import { setupRedirect } from "./setup-gate";

/** TF-139 (Q57, P54, F16 §1): until setup is finished every org page but settings and the wizard leads to the wizard. */
describe("setup gate", () => {
  const unfinished = { slug: "firm", finished: false, canFinish: true };
  it("leads every org page to the wizard", () => {
    for (const pathname of ["/firm", "/firm/projects", "/firm/projects/p1/boqs/b1", "/firm/library", "/firm/library/rule_set/new"]) {
      expect(setupRedirect({ ...unfinished, pathname }), pathname).toBe("/firm/setup");
    }
  });
  it("keeps the wizard and the settings", () => {
    for (const pathname of ["/firm/setup", "/firm/settings", "/firm/settings/general", "/firm/settings/members"]) {
      expect(setupRedirect({ ...unfinished, pathname }), pathname).toBeNull();
    }
    expect(setupRedirect({ ...unfinished, pathname: "/firm/settingsx" })).toBe("/firm/setup");
  });
  it("lets everything through once setup is done, and for people who can't finish it", () => {
    expect(setupRedirect({ ...unfinished, finished: true, pathname: "/firm/projects" })).toBeNull();
    expect(setupRedirect({ ...unfinished, canFinish: false, pathname: "/firm/projects" })).toBeNull();
  });
});
