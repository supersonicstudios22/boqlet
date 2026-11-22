// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../../../messages/en/admin.json";

/** TF-154 (F19 §7): what the API doesn't measure yet reads "not tracked yet", never 0. */
vi.mock("next-intl", async () => {
  const { createTranslator } = await import("use-intl/core");
  return {
    useTranslations: (namespace: string) => createTranslator({ locale: "en", messages: { admin } as never, namespace: namespace as never }),
    useFormatter: () => ({ number: (n: number) => String(n), dateTime: (d: Date) => d.toISOString() }),
  };
});
const data = vi.hoisted(() => ({ health: {} as Record<string, unknown> }));
vi.mock("@/api/hooks/admin", () => ({ useAdminHealth: () => ({ data: data.health, isError: false, isPending: false }) }));
vi.mock("@/components/errors/inline-error", () => ({ InlineError: () => null }));
vi.mock("@/components/loading", () => ({ LoadingLines: () => null }));

const { AdminHealthView } = await import("./health");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});
function shown() {
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(<AdminHealthView />));
  return [host.querySelector("[data-testid=health-webhook-failures]")!.textContent, host.querySelector("[data-testid=health-email-bounces]")!.textContent];
}

describe("admin health", () => {
  it("fields the API doesn't send are not tracked", () => {
    data.health = { failedJobsPerDay: [], jobDurationsMs: {} };
    expect(shown()).toEqual([admin.health.notTracked, admin.health.notTracked]);
  });
  it("fields it sends are shown, 0 included", () => {
    data.health = { failedJobsPerDay: [], jobDurationsMs: {}, billingWebhookFailures: 0, emailBounces: 3 };
    expect(shown()).toEqual(["0", "3"]);
  });
});
