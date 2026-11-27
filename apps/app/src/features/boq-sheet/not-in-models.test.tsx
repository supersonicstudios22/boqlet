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
vi.mock("lucide-react", () => ({ Info: () => null, X: () => null }));

const { NotInModelsBar, NotInModelsPanel } = await import("./not-in-models");

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
    act(() => root!.render(<NotInModelsBar lines={[]} collapsed={true} onCollapsedChange={save} />));
    const notice = host.querySelector("[data-testid=not-in-models]")!;
    expect(notice.getAttribute("data-collapsed")).toBe("true");
    act(() => (host.querySelector("[data-testid=not-in-models-toggle]") as HTMLButtonElement).click());
    expect(save).toHaveBeenCalledWith(false);
    expect(Object.keys(window.localStorage)).toEqual([]);
  });

  it("is one line of counts: no paragraph and no second \"Add line\" in the bar (review C-01)", () => {
    const host = document.createElement("div");
    root = createRoot(host);
    act(() => root!.render(<NotInModelsBar lines={[]} collapsed={false} onCollapsedChange={() => {}} />));
    const notice = host.querySelector("[data-testid=not-in-models]")!;
    expect(notice.querySelector("[data-testid=source-counts]")!.textContent).toBe("0 measured · 0 derived · 0 manual · 0 to confirm");
    expect(notice.querySelectorAll("p")).toHaveLength(1);
    expect(host.querySelector("[data-testid=not-in-models-add]")).toBeNull();
    expect(host.querySelector("[data-testid=not-in-models-toggle]")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("the open paragraph collapses the notice to its counts line", () => {
    const host = document.createElement("div");
    root = createRoot(host);
    const collapse = vi.fn();
    act(() => root!.render(<NotInModelsPanel onCollapse={collapse} />));
    expect(host.textContent).toContain("This BoQ contains what the models contain.");
    act(() => (host.querySelector("[data-testid=not-in-models-hide]") as HTMLButtonElement).click());
    expect(collapse).toHaveBeenCalledOnce();
  });
});
