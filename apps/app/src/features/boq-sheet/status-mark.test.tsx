// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createTranslator } from "use-intl/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import boqs from "../../../messages/en/boqs.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const t = createTranslator({ locale: "en", messages: { boqs }, namespace: namespace as "boqs" }) as unknown as ((key: string, values?: Record<string, unknown>) => string) & { has: (key: string) => boolean };
    const fn = (key: string, values?: Record<string, unknown>) => t(key, values);
    fn.has = (key: string) => t.has(key);
    return fn;
  },
}));

const { StatusMark } = await import("./status-mark");

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
  return host;
}

/** Review C-02: the status gutter marks every derived, manual and to-confirm line, never by colour alone. */
describe("StatusMark", () => {
  it("marks nothing on a measured line", () => {
    expect(render(<StatusMark source="measured" />).innerHTML).toBe("");
  });

  it.each([
    ["derived", "D", "Derived"],
    ["manual", "M", "Manual"],
    ["flagged", "!", "To confirm"],
  ])("marks a %s line with a letter and names it", (source, letter, word) => {
    const mark = render(<StatusMark source={source} />).querySelector("[data-testid=status-mark]")!;
    expect(mark.textContent).toBe(letter);
    expect(mark.getAttribute("role")).toBe("img");
    expect(mark.getAttribute("aria-label")).toBe(word);
    expect(mark.getAttribute("title")).toBe(word);
    expect(mark.getAttribute("data-mark")).toBe(source);
  });

  it("a measured line the engine marks to confirm says why (A-05)", () => {
    const mark = render(<StatusMark source="measured" toConfirm={{ elements: 3, measured: 2 }} />).querySelector("[data-testid=status-mark]")!;
    expect(mark.getAttribute("data-mark")).toBe("flagged");
    expect(mark.getAttribute("aria-label")).toBe("To confirm: 2 of 3 elements measured");
  });
});
