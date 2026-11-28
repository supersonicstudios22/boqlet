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

const { EditEntry } = await import("./review-tab");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function render(node: React.ReactNode) {
  const host = document.createElement("ul");
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const edit = {
  id: "00000000-0000-4000-8000-000000000001",
  boqId: "00000000-0000-4000-8000-000000000002",
  lineKey: "walls | brick",
  quantity: 12.5,
  reason: "Site measure",
  createdBy: { id: "00000000-0000-4000-8000-000000000003", name: "Ana Estimator" },
  createdAt: "2026-11-27T09:30:00Z",
};

/** Review C-13 (LEAD-021): the review screen names who made each edit and when. */
describe("EditEntry", () => {
  it("shows the line, the new quantity, the reason, the author and the time", () => {
    const host = render(<EditEntry edit={edit} description="Brick walls" quantity="12.5" when="yesterday" />);
    expect(host.textContent).toBe("Brick walls → 12.5 · Site measure · Ana Estimator, yesterday");
    expect(host.querySelector("[data-testid=review-edit-by]")!.textContent).toContain("Ana Estimator");
  });

  it("shows the time alone when the author is not known", () => {
    const host = render(<EditEntry edit={{ ...edit, createdBy: undefined, reason: undefined }} description="Brick walls" quantity={null} when="2 hours ago" />);
    expect(host.textContent).toBe("Brick walls · 2 hours ago");
  });
});
