// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createFormatter, createTranslator } from "use-intl/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import boqs from "../../../messages/en/boqs.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const t = createTranslator({ locale: "en", messages: { boqs }, namespace: namespace as "boqs" }) as unknown as ((key: string, values?: object) => string) & { has: (key: string) => boolean };
    const out = (key: string, values?: object) => t(key, values as never);
    out.has = (key: string) => t.has(key as never);
    return out;
  },
  useFormatter: () => createFormatter({ locale: "en" }),
}));
vi.mock("lucide-react", () => ({ ChevronDown: () => null, ChevronRight: () => null }));
vi.mock("@/components/ui/button", () => ({
  // variant and size are styling only
  Button: (props: Record<string, unknown>) => <button {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== "variant" && k !== "size"))} />,
}));

const { PendingBanner } = await import("./pending-banner");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

type Props = Parameters<typeof PendingBanner>[0];
function render(props: Partial<Props>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onApply = vi.fn();
  act(() => root!.render(<PendingBanner edits={[]} answers={0} inputs={[]} editsChanged={false} canApply applying={false} onApply={onApply} saveWaits={false} {...props} />));
  return { host, onApply };
}
const q = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe("the pending banner (review C-08)", () => {
  it("is not there when nothing waits", () => {
    expect(q(render({}).host, "pending-banner")).toBeNull();
  });

  it("names what waits in one line, applies in one click, and says why Save version waits", () => {
    const edits = [
      { key: "a", description: "External wall", kind: "changed" as const, fields: ["quantity" as const] },
      { key: "b", description: "Skip hire", kind: "added" as const },
      { key: "c", description: "Floor slab", kind: "restored" as const },
    ];
    const { host, onApply } = render({ edits, answers: 1, editsChanged: true, inputs: ["inputs.ruleSet"], saveWaits: true });
    expect(q(host, "pending-summary")!.textContent).toBe("3 edits, 1 answer, and rule set not applied yet.");
    expect(q(host, "pending-save-waits")!.textContent).toBe("Save version waits until they are applied.");
    act(() => q(host, "pending-apply")!.click());
    expect(onApply).toHaveBeenCalledOnce();
    expect(q(host, "pending-list")).toBeNull();
    act(() => q(host, "pending-toggle")!.click());
    expect([...q(host, "pending-list")!.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Edited: External wall (quantity)",
      "Added: Skip hire",
      "Edit undone: Floor slab",
      "1 answer to questions",
      "Changed inputs: rule set",
    ]);
  });

  it("names edits it can't count, and offers no Apply to someone who can't generate", () => {
    const { host } = render({ edits: null, editsChanged: true, canApply: false });
    expect(q(host, "pending-summary")!.textContent).toBe("line edits not applied yet.");
    expect(q(host, "pending-apply")).toBeNull();
    expect(q(host, "pending-banner")!.dataset.edits).toBeUndefined();
  });
});
