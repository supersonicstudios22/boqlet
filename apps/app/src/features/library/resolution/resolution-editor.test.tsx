// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { fireEvent } from "@testing-library/dom";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolutionSettings } from "@ifc-boq/types";
import type { Preset } from "@/api/hooks/library";
import library from "../../../../messages/en/library.json";
import resolutionDefault from "../../../../../../presets/settings/resolution.json";
import { ResolutionEditor } from "./resolution-editor";

// As in rule-set-editor.test.tsx: the app's React with use-intl's core translator, plain buttons.
vi.mock("next-intl", async () => {
  const React = await import("react");
  const { createTranslator } = await import("use-intl/core");
  type Config = { locale: string; messages: Record<string, unknown>; onError?: (e: Error) => void };
  const Ctx = React.createContext<Config | null>(null);
  return {
    NextIntlClientProvider: ({ children, ...config }: Config & { children: React.ReactNode }) => React.createElement(Ctx.Provider, { value: config }, children),
    useTranslations: (namespace?: string) => {
      const config = React.useContext(Ctx)!;
      return React.useMemo(() => createTranslator({ locale: config.locale, messages: config.messages as never, namespace: namespace as never, onError: config.onError as never }), [config, namespace]);
    },
  };
});
vi.mock("@/components/ui/button", async () => {
  const React = await import("react");
  const Button = (props: Record<string, unknown>) => React.createElement("button", Object.fromEntries(Object.entries(props).filter(([k]) => k !== "variant" && k !== "size")));
  return { Button };
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(start: ResolutionSettings) {
  const seen: ResolutionSettings[] = [];
  function Host() {
    const [doc, setDoc] = useState(start);
    return (
      <ResolutionEditor
        preset={{} as Preset}
        parent={null}
        doc={doc}
        onChange={(d) => {
          seen.push(d);
          setDoc(d);
        }}
      />
    );
  }
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  act(() =>
    root!.render(
      <NextIntlClientProvider locale="en" messages={{ library }} onError={(e) => { throw e; }}>
        <Host />
      </NextIntlClientProvider>,
    ),
  );
  return { el, seen };
}

describe("resolution settings editor (WP-A1 A-04)", () => {
  it("edits the contradiction thresholds and leaves the rest of the document alone", () => {
    const { el, seen } = mount(resolutionDefault as unknown as ResolutionSettings);
    const warn = el.querySelector<HTMLInputElement>('[data-testid="contradiction-warn-pct"]')!;
    const block = el.querySelector<HTMLInputElement>('[data-testid="contradiction-block-pct"]')!;
    expect(warn.value).toBe("");
    expect(warn.placeholder).toBe("10");
    expect(block.placeholder).toBe("50");
    act(() => fireEvent.change(block, { target: { value: "30" } }));
    act(() => fireEvent.change(warn, { target: { value: "5" } }));
    const last = seen.at(-1)!;
    expect(last.contradictionBlockPct).toBe(30);
    expect(last.contradictionWarnPct).toBe(5);
    expect(last.askFor).toEqual((resolutionDefault as unknown as ResolutionSettings).askFor);
    act(() => fireEvent.change(block, { target: { value: "" } }));
    expect("contradictionBlockPct" in seen.at(-1)!).toBe(false);
  });
});
