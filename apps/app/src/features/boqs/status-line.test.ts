import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import boqs from "../../../messages/en/boqs.json";
import { statusLine } from "./status-line";

const t = createTranslator({ locale: "en", messages: { boqs }, namespace: "boqs" });

describe("review C-20: one status line", () => {
  it("says complete and what is left to look at", () => {
    const s = statusLine({ status: "complete", stats: { flaggedLines: 3, blockingQuestions: 0 } }, { unanswered: 2, blocking: 0, modelsToCheck: 1 });
    expect(s).toEqual({ complete: true, blocking: 0, toConfirm: 3, optional: 2, aboutModels: 1 });
    expect(t("run.toConfirm", { count: s.toConfirm })).toBe("3 lines to confirm");
    expect(t("run.optional", { count: s.optional, models: s.aboutModels })).toBe("2 optional questions, 1 about the models");
    expect(t("run.optional", { count: 1, models: 0 })).toBe("1 optional question");
  });

  it("counts blocking questions from the questions once loaded, else from the run", () => {
    expect(statusLine({ status: "needs_input", stats: { blockingQuestions: 4 } }).blocking).toBe(4);
    expect(statusLine({ status: "needs_input", stats: { blockingQuestions: 4 } }, { unanswered: 5, blocking: 2, modelsToCheck: 0 })).toMatchObject({ complete: false, blocking: 2, optional: 3 });
  });

  it("tells a screen reader blocking from optional questions on the tab's badge", () => {
    expect(t("tabs.openCount", { blocking: 2, optional: 3 })).toBe("2 blocking questions, 3 optional");
    expect(t("tabs.openCount", { blocking: 1, optional: 0 })).toBe("1 blocking question");
    expect(t("tabs.openCount", { blocking: 0, optional: 2 })).toBe("2 optional questions, none blocking");
  });
});
