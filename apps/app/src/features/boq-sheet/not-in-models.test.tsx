// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createTranslator } from "use-intl/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import boqs from "../../../messages/en/boqs.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const t = createTranslator({ locale: "en", messages: { boqs }, namespace: namespace as "boqs" }) as unknown as (key: string, values?: Record<string, unknown>) => string;
    return (key: string, values?: Record<string, unknown>) => t(key, values);
  },
}));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("lucide-react", () => ({ ChevronDown: () => null, ChevronRight: () => null, Plus: () => null }));

const { NotInModelsNotice } = await import("./not-in-models");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  window.localStorage.clear();
});

/** TF-109 (Q55, F06-AC8): the collapse is the user's server-side preference, not this browser's storage. */
describe("not in the models notice", () => {
  it("shows the saved preference and saves a toggle through the callback", () => {
    const host = document.createElement("div");
    root = createRoot(host);
    const save = vi.fn();
    act(() => root!.render(<NotInModelsNotice lines={[]} collapsed={true} onCollapsedChange={save} />));
    const notice = host.querySelector("[data-testid=not-in-models]")!;
    expect(notice.getAttribute("data-collapsed")).toBe("true");
    act(() => (host.querySelector("[data-testid=not-in-models-toggle]") as HTMLButtonElement).click());
    expect(save).toHaveBeenCalledWith(false);
    expect(Object.keys(window.localStorage)).toEqual([]);
  });
});
