// @vitest-environment jsdom
import { act, StrictMode, useRef, useState } from "react";
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

  it("doesn't take focus on load under StrictMode, whose effects run twice (review C-04, DEC-50)", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    function Header({ kind }: { kind: string }) {
      const ref = useRef<HTMLButtonElement>(null);
      useRefocusWhenLost(ref, [kind]);
      return <button ref={ref} data-testid="generate-again" />;
    }
    act(() =>
      root!.render(
        <StrictMode>
          <Header kind="complete" />
        </StrictMode>,
      ),
    );
    act(() => vi.advanceTimersToNextFrame());
    expect(document.activeElement).toBe(document.body);
    // Data arriving later (the run's state while nobody is in the page) doesn't pull focus either.
    act(() =>
      root!.render(
        <StrictMode>
          <Header kind="needs_input" />
        </StrictMode>,
      ),
    );
    act(() => vi.advanceTimersToNextFrame());
    expect(document.activeElement).toBe(document.body);
    vi.useRealTimers();
  });

  it("still follows a replaced control under StrictMode", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <StrictMode>
          <Runner />
        </StrictMode>,
      ),
    );
    act(() => vi.advanceTimersToNextFrame());
    expect(document.activeElement).toBe(document.body);
    host.querySelector<HTMLButtonElement>("[data-testid=generate]")!.focus();
    act(() => start());
    act(() => vi.advanceTimersToNextFrame());
    expect(document.activeElement).toBe(host.querySelector("[data-testid=cancel]"));
    vi.useRealTimers();
  });

  it("follows a control that was disabled (focus went to the page) before it was replaced", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    function Pending({ phase }: { phase: "idle" | "pending" | "running" }) {
      const cancel = useRef<HTMLButtonElement>(null);
      useRefocusWhenLost(cancel, [phase === "running"]);
      return phase === "running" ? <button key="cancel" ref={cancel} data-testid="cancel" /> : <button key="generate" data-testid="generate" disabled={phase === "pending"} />;
    }
    act(() => root!.render(<Pending phase="idle" />));
    host.querySelector<HTMLButtonElement>("[data-testid=generate]")!.focus();
    act(() => root!.render(<Pending phase="pending" />));
    // The browser's focus fixup: a disabled control loses focus to the page.
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    act(() => root!.render(<Pending phase="running" />));
    act(() => vi.advanceTimersToNextFrame());
    expect(document.activeElement).toBe(host.querySelector("[data-testid=cancel]"));
    vi.useRealTimers();
  });
});
