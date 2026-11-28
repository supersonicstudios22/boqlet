// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The splash after a sign-in: the logo animation plays once per sign-in, over the app, and fades into
 * it at the end of the animation, on a click or on any key. A reload doesn't play it again.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function stubMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce"), media: query }));
}

/** A fresh page load: the module's state starts over, as after `window.location.replace`. */
async function load() {
  vi.resetModules();
  const mod = await import("./splash");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<mod.Splash />));
  return mod;
}

const splash = () => document.querySelector('[data-testid="splash"]');

beforeEach(() => {
  vi.useFakeTimers();
  stubMotion(false);
  sessionStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sign-in splash", () => {
  it("shows nothing on a page load that doesn't follow a sign-in", async () => {
    await load();
    expect(splash()).toBeNull();
  });

  it("plays once after a sign-in, fades into the app after the animation, and not again on a reload", async () => {
    (await import("./splash")).requestSplash();
    await load();
    expect(splash()).not.toBeNull();
    expect(splash()!.getAttribute("aria-hidden")).toBe("true");
    expect(sessionStorage.length).toBe(0);

    act(() => vi.advanceTimersByTime(5300));
    expect(splash()).not.toBeNull();
    act(() => vi.advanceTimersByTime(40));
    expect(splash()).not.toBeNull(); // fading
    act(() => vi.advanceTimersByTime(300));
    expect(splash()).toBeNull();

    act(() => root?.unmount());
    await load();
    expect(splash()).toBeNull();
  });

  it("a click or any key skips it", async () => {
    const mod = await import("./splash");
    mod.requestSplash();
    await load();
    act(() => (splash() as HTMLElement).click());
    act(() => vi.advanceTimersByTime(300));
    expect(splash()).toBeNull();

    act(() => root?.unmount());
    mod.requestSplash();
    await load();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    act(() => vi.advanceTimersByTime(300));
    expect(splash()).toBeNull();
  });

  it("with reduced motion it shows the finished logo for at most 300 ms, without a fade (review C-33)", async () => {
    stubMotion(true);
    (await import("./splash")).requestSplash();
    await load();
    expect(splash()).not.toBeNull();
    act(() => vi.advanceTimersByTime(299));
    expect(splash()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(splash()).toBeNull();
  });
});
