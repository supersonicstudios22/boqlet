// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRefocusWhenLost } from "./focus";

/** TF-160: when the focused control goes away, focus lands on a sensible place, not on the page body. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function Runner() {
  const [running, setRunning] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  useRefocusWhenLost(cancel, [running]);
  return running ? <button ref={cancel} data-testid="cancel" /> : <button data-testid="generate" onClick={() => setRunning(true)} />;
}
const start = () => document.querySelector<HTMLButtonElement>("[data-testid=generate]")!.click();

describe("useRefocusWhenLost", () => {
  it("doesn't take focus when the page opens", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    function Opened() {
      const ref = useRef<HTMLButtonElement>(null);
      useRefocusWhenLost(ref, []);
      return <button ref={ref} />;
    }
    act(() => root!.render(<Opened />));
    act(() => vi.advanceTimersToNextFrame());
    expect(document.activeElement).toBe(document.body);
    vi.useRealTimers();
  });

  it("moves focus to the new control when the focused one was replaced", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<Runner />));
    host.querySelector<HTMLButtonElement>("[data-testid=generate]")!.focus();
    act(() => start());
    act(() => vi.advanceTimersToNextFrame());
    expect(document.activeElement).toBe(host.querySelector("[data-testid=cancel]"));
    vi.useRealTimers();
  });

  it("leaves focus the person put elsewhere", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const host = document.createElement("div");
    const other = document.createElement("input");
    document.body.append(host, other);
    root = createRoot(host);
    act(() => root!.render(<Runner />));
    other.focus();
    act(() => start());
    act(() => vi.advanceTimersToNextFrame());
    expect(document.activeElement).toBe(other);
    vi.useRealTimers();
  });
});
