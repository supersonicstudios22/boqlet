// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import shares from "../../../messages/en/shares.json";

/*
 * TF-158: the share page's lines are reachable by keyboard (WCAG 2.1.1). The data hooks, the viewer, the
 * line detail and the UI packages hoisted to the workspace root are replaced with plain stand-ins.
 */
vi.mock("next-intl", async () => {
  const { createTranslator } = await import("use-intl/core");
  return {
    useTranslations: (namespace: string) => createTranslator({ locale: "en", messages: { shares } as never, namespace: namespace as never }),
    useLocale: () => "en",
  };
});
vi.mock("@tanstack/react-query", () => ({ useMutation: () => ({ mutate: () => {}, isPending: false, error: null }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("lucide-react", () => ({ Download: () => <span />, X: () => <span /> }));
// variant and size are styling only
vi.mock("@/components/ui/button", () => ({
  Button: (props: Record<string, unknown>) => <button {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== "variant" && k !== "size"))} />,
}));
vi.mock("@/components/ui/input", () => ({ Input: (props: Record<string, unknown>) => <input {...(props as object)} /> }));
vi.mock("@/components/shell/wordmark", () => ({ Wordmark: () => <span /> }));
vi.mock("@/components/errors/use-error-message", () => ({ useErrorMessage: () => () => "" }));
vi.mock("@/i18n/units", () => ({ useUnit: () => (u: string) => u }));
vi.mock("@/features/viewer/model-viewer", () => ({ ModelViewer: () => null }));
vi.mock("@/features/boq-sheet/line-detail", () => ({ LineDetailBody: () => <div data-testid="detail-body" /> }));
vi.mock("@/api/hooks/exports", () => ({ saveFile: () => {} }));

const line = (key: string, description: string) => ({ key, description, unit: "m2", quantity: 12.5, source: "measured", codes: {} });
const data = vi.hoisted(() => ({ lines: [] as unknown[] }));
vi.mock("@/api/hooks/shares", () => ({
  publicExport: async () => new Blob(),
  usePublicShare: () => ({
    isError: false,
    data: { firmName: "F", projectName: "P", boqName: "B", revisionLabel: "A", revisionStatus: "issued", runAt: null, include: { lineDetail: true, excel: false, viewer: false, log: false }, systems: [], modelVersionIds: [], madeWithBadge: false },
  }),
  usePublicLines: () => ({ data: data.lines }),
  usePublicLine: (_t: string, key: string | null) => ({ data: key ? (data.lines as { key: string }[]).find((l) => l.key === key) : undefined }),
}));

const { PublicSharePage } = await import("./public-share");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
});

function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<PublicSharePage token="t" />));
  return host;
}

describe("TF-158 share page: lines by keyboard", () => {
  it("each line has a focusable control that opens its explanation and takes focus into it", () => {
    data.lines = [line("a", "Wall, exterior"), line("b", "Slab")];
    const page = mount();
    const rows = page.querySelectorAll<HTMLTableRowElement>("[data-testid=share-line]");
    expect(rows).toHaveLength(2);
    const open = rows[1].querySelector<HTMLButtonElement>("button");
    expect(open, "a button in the line").not.toBeNull();
    expect(open!.textContent).toBe("Slab");
    expect(open!.getAttribute("aria-expanded")).toBe("false");
    open!.focus();
    expect(document.activeElement).toBe(open);

    act(() => open!.click());
    const detail = page.querySelector("[data-testid=share-detail]");
    expect(detail).not.toBeNull();
    expect(open!.getAttribute("aria-expanded")).toBe("true");
    expect(open!.getAttribute("aria-controls")).toBe(detail!.id);
    expect(detail!.contains(document.activeElement), "focus moves into the detail").toBe(true);

    // Closing it returns focus to the line that opened it.
    const close = detail!.querySelector<HTMLButtonElement>(`button[aria-label="${shares.public.close}"]`)!;
    act(() => close.click());
    expect(page.querySelector("[data-testid=share-detail]")).toBeNull();
    expect(document.activeElement).toBe(page.querySelectorAll("[data-testid=share-line]")[1].querySelector("button"));
  });
});
