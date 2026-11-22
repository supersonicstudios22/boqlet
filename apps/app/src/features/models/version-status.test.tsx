// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import models from "../../../messages/en/models.json";

/** TF-020: Retry on a failed parse only for people who may upload (`editModels`) and failures that can be retried. */

vi.mock("next-intl", async () => {
  const { createTranslator } = await import("use-intl/core");
  return { useTranslations: (namespace: string) => createTranslator({ locale: "en", messages: { models } as never, namespace: namespace as never }) };
});
vi.mock("@tanstack/react-query", () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }), useQueryClient: () => ({}) }));
vi.mock("@/api/hooks/models", () => ({ useJobProgress: () => ({ data: undefined }) }));
vi.mock("@/components/dimension-rule", () => ({ DimensionRule: () => null }));
vi.mock("@/components/ui/button", () => ({
  // variant and size are styling only
  Button: (props: Record<string, unknown>) => <button {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== "variant" && k !== "size"))} />,
}));
const scope = vi.hoisted(() => ({ editModels: false }));
vi.mock("@/features/projects/project-context", () => ({ useOptionalProjectScope: () => ({ can: (p: string) => p === "editModels" && scope.editModels }) }));

const { VersionStatus } = await import("./version-status");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});
const failed = (error: Record<string, unknown>) => ({ id: "v1", status: "failed", error }) as never;
function retryShown(version: never) {
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(<VersionStatus version={version} detailed />));
  return [...host.querySelectorAll("button")].some((b) => b.textContent === models.status.retry);
}

describe("TF-020 VersionStatus retry", () => {
  it("is not offered to someone who can't upload", () => {
    scope.editModels = false;
    expect(retryShown(failed({ code: "engine_unavailable", message: "x" }))).toBe(false);
  });
  it("is offered to an uploader for a failure that can be retried", () => {
    scope.editModels = true;
    expect(retryShown(failed({ code: "engine_unavailable", message: "x" }))).toBe(true);
    expect(retryShown(failed({ code: "timeout", message: "x", details: { retryable: true } }))).toBe(true);
  });
  it("is not offered when the API says the failure is final, or the file is wrong", () => {
    scope.editModels = true;
    expect(retryShown(failed({ code: "parse_failed", message: "x", details: { retryable: false } }))).toBe(false);
    expect(retryShown(failed({ code: "not_ifc", message: "x" }))).toBe(false);
  });
});
