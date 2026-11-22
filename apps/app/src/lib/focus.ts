"use client";

import { useEffect, useRef, type DependencyList, type RefObject } from "react";

/** Focus is nowhere useful: on the page body, or on an element that has just left the page. */
export function focusLost(doc: Document = document): boolean {
  const el = doc.activeElement;
  return !el || el === doc.body || !el.isConnected;
}

/**
 * After `deps` change, puts focus on `target` when it was lost: the control that had it went away (a
 * button replaced while a run starts, an editor closed, a wizard step changed). Focus the person put
 * somewhere else stays there (WCAG 2.4.3, TF-160).
 */
export function useRefocusWhenLost(target: RefObject<HTMLElement | null> | (() => HTMLElement | null | undefined), deps: DependencyList) {
  // Not when the page opens: only after a change.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const id = requestAnimationFrame(() => {
      if (!focusLost()) return;
      const el = typeof target === "function" ? target() : target.current;
      if (!el) return;
      // A heading or a container takes focus only programmatically.
      if (el.tabIndex < 0 && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller says when
  }, deps);
}
