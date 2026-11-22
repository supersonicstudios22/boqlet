// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import library from "../../../../messages/en/library.json";

/** TF-134: a save that lands while a preview runs gets its own preview once that one ends (F16-AC2). */

vi.mock("next-intl", async () => {
  const { createTranslator } = await import("use-intl/core");
  return {
    useTranslations: (namespace: string) => createTranslator({ locale: "en", messages: { library } as never, namespace: namespace as never }),
    useFormatter: () => ({ number: (n: number) => String(n) }),
  };
});
vi.mock("@/components/ui/button", () => ({
  // variant and size are styling only
  Button: (props: Record<string, unknown>) => <button {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== "variant" && k !== "size"))} />,
}));
vi.mock("@/components/errors/use-error-message", () => ({ useErrorMessage: () => () => "" }));
vi.mock("./model-version-picker", () => ({ ModelVersionPicker: () => null }));
const preview = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
vi.mock("@/api/hooks/library", () => ({
  usePreview: () => ({ mutate: preview.mutate, isPending: preview.isPending, isError: false, data: undefined }),
}));

const { PreviewPanel } = await import("./preview-panel");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  preview.mutate.mockReset();
  preview.isPending = false;
});

const preset = { id: "p1", kind: "rule_set", projectId: null } as never;
const model = { versionId: "v1", projectId: "pr1", label: "Duplex" } as never;

describe("TF-134 PreviewPanel follows every save", () => {
  it("runs once more after a preview that was running when a save landed", () => {
    const host = document.createElement("div");
    root = createRoot(host);
    const render = (saves: number) => act(() => root!.render(<PreviewPanel preset={preset} saves={saves} fixed={model} />));
    render(0);
    // The fixed model runs at once.
    expect(preview.mutate).toHaveBeenCalledTimes(1);

    // Save 1 while that preview runs: it must not be lost.
    preview.isPending = true;
    render(1);
    expect(preview.mutate).toHaveBeenCalledTimes(1);
    // Save 2, still running: still one trailing run, not two.
    render(2);
    // The preview ends: the trailing run starts, for the latest save.
    preview.isPending = false;
    render(2);
    expect(preview.mutate).toHaveBeenCalledTimes(2);
    // Nothing more without another save.
    render(2);
    expect(preview.mutate).toHaveBeenCalledTimes(2);

    // A save when nothing runs previews at once.
    render(3);
    expect(preview.mutate).toHaveBeenCalledTimes(3);
  });
});
