// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RovingToolbar } from "./roving-toolbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function render(disabledUndo = true) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <RovingToolbar label="Sheet actions">
        <button data-testid="undo" disabled={disabledUndo} />
        <button data-testid="add" />
        <select data-testid="group" defaultValue="a">
          <option value="a" />
          <option value="b" />
        </select>
        <button data-testid="columns" />
      </RovingToolbar>,
    ),
  );
  return (id: string) => host.querySelector<HTMLElement>(`[data-testid=${id}]`)!;
}
const key = (el: HTMLElement, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));

/** Review C-04: each toolbar is one Tab stop; the arrows move inside it. */
describe("RovingToolbar", () => {
  it("is a toolbar with one Tab stop, on its first usable control", () => {
    const get = render();
    expect(document.querySelector("[role=toolbar]")!.getAttribute("aria-label")).toBe("Sheet actions");
    expect([get("undo"), get("add"), get("group"), get("columns")].map((e) => e.tabIndex)).toEqual([-1, 0, -1, -1]);
  });

  it("moves with the arrows, wraps, and jumps with Home and End; the select keeps its value", () => {
    const get = render();
    act(() => get("add").focus());
    key(get("add"), "ArrowRight");
    expect(document.activeElement).toBe(get("group"));
    key(get("group"), "ArrowRight");
    expect((get("group") as HTMLSelectElement).value).toBe("a");
    expect(document.activeElement).toBe(get("columns"));
    key(get("columns"), "ArrowRight");
    expect(document.activeElement).toBe(get("add"));
    key(get("add"), "End");
    expect(document.activeElement).toBe(get("columns"));
    key(get("columns"), "Home");
    expect(document.activeElement).toBe(get("add"));
    key(get("add"), "ArrowLeft");
    expect(document.activeElement).toBe(get("columns"));
    // The Tab stop follows the control used last.
    expect([get("add"), get("group"), get("columns")].map((e) => e.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("brings a control that becomes usable into the arrows' reach", async () => {
    const get = render(true);
    act(() => get("add").focus());
    get("undo").removeAttribute("disabled");
    await act(async () => {
      await Promise.resolve();
    });
    key(get("add"), "ArrowLeft");
    expect(document.activeElement).toBe(get("undo"));
  });
});
