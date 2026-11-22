// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createTranslator } from "use-intl/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import common from "../../../messages/en/common.json";
import errors from "../../../messages/en/errors.json";

const messages = { common, errors };
vi.mock("next-intl", () => ({
  useTranslations: (namespace: keyof typeof messages) => {
    const t = createTranslator({ locale: "en", messages, namespace }) as unknown as ((key: string, values?: Record<string, unknown>) => string) & { has: (key: string) => boolean };
    return Object.assign((key: string, values?: Record<string, unknown>) => t(key, values), { has: (key: string) => t.has(key) });
  },
}));

vi.mock("./not-found-view", () => ({ NotFoundView: () => null }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));

const { ApiError } = await import("@/api/errors");
const { InlineError } = await import("./inline-error");
const { ErrorView } = await import("./error-view");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});
function render(node: React.ReactNode) {
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(node));
  return host.querySelector("[data-testid=error-reference]")?.textContent ?? null;
}

/** TF-185: a server failure shows its request id, so a user's screenshot leads to the API's log line. */
describe("error reference", () => {
  const failure = new ApiError(500, "internal", "", undefined, undefined, "s4res-rid-500");
  it("inline errors show it for a server failure", () => {
    expect(render(<InlineError error={failure} />)).toContain("s4res-rid-500");
  });
  it("the error page shows it too", () => {
    expect(render(<ErrorView error={failure} reset={() => {}} />)).toContain("s4res-rid-500");
  });
  it("a refusal shows none", () => {
    expect(render(<InlineError error={new ApiError(409, "conflict", "", undefined, undefined, "rid")} />)).toBeNull();
  });
});
