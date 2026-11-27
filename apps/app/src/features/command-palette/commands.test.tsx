// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { byMatch, commandsSnapshot, matches, subscribeCommands, useRegisterCommands, type PaletteCommand } from "./commands";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function Register({ owner, commands }: { owner: string; commands: PaletteCommand[] }) {
  useRegisterCommands(owner, commands);
  return null;
}

describe("the command palette's matching (review C-09)", () => {
  it("finds labels by any part, ignoring case and accents, those that start with the text first", () => {
    expect(matches("Generate again", "GEN")).toBe(true);
    expect(matches("Béton armé", "beton")).toBe(true);
    expect(matches("Export Excel", "pdf")).toBe(false);
    expect(matches("Anything", "  ")).toBe(true);
    const items = [{ label: "Settings: billing" }, { label: "Billing page" }, { label: "Projects" }];
    expect(byMatch(items, "bill").map((i) => i.label)).toEqual(["Billing page", "Settings: billing"]);
  });
});

describe("actions in context (review C-09)", () => {
  it("lists a page's actions while it is mounted, each running its latest handler, and drops them after", () => {
    const host = document.createElement("div");
    root = createRoot(host);
    const first = vi.fn();
    const second = vi.fn();
    const heard = vi.fn();
    const off = subscribeCommands(heard);
    act(() => root!.render(<Register owner="boq" commands={[{ id: "generate", label: "Generate again", run: first }]} />));
    expect(commandsSnapshot().map((c) => c.label)).toEqual(["Generate again"]);
    const calls = heard.mock.calls.length;
    // A new handler with the same label: no change for the palette, but the latest handler runs.
    act(() => root!.render(<Register owner="boq" commands={[{ id: "generate", label: "Generate again", run: second }]} />));
    expect(heard.mock.calls.length).toBe(calls);
    commandsSnapshot()[0]!.run();
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([0, 1]);
    // A changed label or reason does change it.
    act(() => root!.render(<Register owner="boq" commands={[{ id: "generate", label: "Generate again", disabledReason: "Running", run: second }]} />));
    expect(commandsSnapshot()[0]!.disabledReason).toBe("Running");
    act(() => root!.unmount());
    root = null;
    expect(commandsSnapshot()).toEqual([]);
    off();
  });
});
