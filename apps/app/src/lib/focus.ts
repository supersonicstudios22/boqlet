"use client";

import { useEffect, useRef, type DependencyList, type RefObject } from "react";

/** Focus is nowhere useful: on the page body, or on an element that has just left the page. */
export function focusLost(doc: Document = document): boolean {
  const el = doc.activeElement;
  return !el || el === doc.body || !el.isConnected;
}

const sameDeps = (a: DependencyList, b: DependencyList) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/**
 * After `deps` change, puts focus on `target` when the control that had focus went away with that change (a button
 * replaced while a run starts, an editor closed, a wizard step changed). Focus the person put somewhere else stays
 * there (WCAG 2.4.3, TF-160), and nothing is focused when the page opens or when data arrives while focus was
 * nowhere: only a change that removed the focused control moves it (review C-04).
 *
 * Compares the dependency values with the last ones seen rather than counting mounts: React's StrictMode runs effects
 * twice on mount, which defeated a "mounted" flag and moved focus to "Generate again" on load in `next dev` (DEC-50).
 */
export function useRefocusWhenLost(target: RefObject<HTMLElement | null> | (() => HTMLElement | null | undefined), deps: DependencyList) {
  const previous = useRef<DependencyList | null>(null);
  // Where focus was while this render was computed, before React commits it: the control the change may remove.
  const focusedNow = typeof document === "undefined" ? null : document.activeElement;
  // The last control seen with focus at one of this component's renders: a button disabled while its request runs
  // loses focus to the page (focus fixup) before the render that replaces it.
  const lastSeen = useRef<Element | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = deps;
    // The first values seen, or the same ones again (StrictMode's second run): nothing changed.
    if (before === null || sameDeps(before, deps)) return;
    const focusedBefore = focusedNow && focusedNow !== document.body ? focusedNow : lastSeen.current;
    if (!focusedBefore) return;
    const id = requestAnimationFrame(() => {
      if (!focusLost() || focusedBefore.isConnected) return;
      const el = typeof target === "function" ? target() : target.current;
      if (!el) return;
      // A heading or a container takes focus only programmatically.
      if (el.tabIndex < 0 && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller says when
  }, deps);
  useEffect(() => {
    if (focusedNow && focusedNow !== document.body) lastSeen.current = focusedNow;
  });
}
