import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import errors from "../../messages/en/errors.json";
import notifications from "../../messages/en/notifications.json";

/**
 * TF-098 / TF-129 (F14 "a dialog says which limit, current/max", F15-AC1): every plan limit has a
 * name in words, used by the limit dialog and the limit notifications, never the API's key.
 */
const t = createTranslator({ locale: "en", messages: { errors, notifications } });
const openapi = readFileSync(path.resolve(__dirname, "../../../../packages/api/openapi.yaml"), "utf8").replace(/\r\n/g, "\n"); // CRLF on a Windows checkout
const block = openapi.slice(openapi.indexOf("\n    Entitlements:\n"), openapi.indexOf("\n    Plan:\n"));
const limits = [...block.matchAll(/\n {8}(\w+): \{ type:/g)].map((m) => m[1]!);

describe("plan limit names", () => {
  it("reads the contract's limits", () => {
    expect(limits).toEqual(expect.arrayContaining(["seats", "activeProjects", "maxModelsPerBoq", "approvalWorkflow", "shareLinks"]));
  });
  it.each(limits)("%s has a name", (limit) => {
    const name = t("errors.limit.name", { limit });
    expect(name).not.toBe(t("errors.limit.name", { limit: "unknown" }));
    expect(name).not.toContain(limit);
  });
  it("the dialog and the notification say it in words", () => {
    const name = t("errors.limit.name", { limit: "activeProjects" });
    expect(t("errors.limit.detail", { limit: name, current: 1, max: 1 })).toBe("Active projects: 1 of 1 in use.");
    expect(t("errors.limit.feature", { limit: t("errors.limit.name", { limit: "approvalWorkflow" }) })).toBe("Review and approval isn't part of your plan.");
    expect(t("notifications.kinds.limit_reached", { limit: name, current: 1, max: 1 })).toBe("Your plan's limit is reached: Active projects, 1 of 1");
  });
});
