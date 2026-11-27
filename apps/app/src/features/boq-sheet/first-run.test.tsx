// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createTranslator } from "use-intl/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import boqs from "../../../messages/en/boqs.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const t = createTranslator({ locale: "en", messages: { boqs }, namespace: namespace as "boqs" }) as unknown as (key: string) => string;
    return (key: string) => t(key);
  },
}));
vi.mock("@/components/dimension-rule", () => ({ DimensionRule: () => null }));

const { SheetPlaceholder } = await import("./first-run");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function render(generating: boolean) {
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(<SheetPlaceholder generating={generating} />));
  return host;
}

/** Review C-05: while the first run works the sheet shows a skeleton, not "Generate the BoQ". */
describe("SheetPlaceholder", () => {
  it("shows the skeleton and says lines come when the run finishes while the first run works", () => {
    const host = render(true);
    expect(host.querySelector("[data-testid=sheet-skeleton]")!.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).toContain("Generating… lines appear when the run finishes.");
    expect(host.textContent).not.toContain(boqs.sheet.empty);
    expect(host.querySelectorAll("[data-slot=skeleton]").length).toBeGreaterThan(10);
  });

  it("says what to do when the BoQ was never generated", () => {
    const host = render(false);
    expect(host.querySelector("[data-testid=sheet-skeleton]")).toBeNull();
    expect(host.textContent).toBe(boqs.sheet.empty);
  });
});
