"use client";

import { useEffect, useLayoutEffect, useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** What a toolbar's arrows move between: its buttons, selects and links that can be used and are on screen. */
const ITEMS = "button, select, a[href], [role=button]";

/** Shown: neither it nor a parent inside the toolbar is `display: none` (the actions that fold into "⋯"). */
function shown(el: HTMLElement, bar: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== bar; n = n.parentElement) if (getComputedStyle(n).display === "none") return false;
  return true;
}

function itemsOf(bar: HTMLElement): HTMLElement[] {
  return [...bar.querySelectorAll<HTMLElement>(ITEMS)].filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true" && el.closest("[role=toolbar]") === bar && shown(el, bar),
  );
}

/**
 * A row of controls that is one Tab stop (WAI-ARIA toolbar, review C-04): Tab enters at the control used last (the
 * first at the start) and leaves the row; ArrowLeft/ArrowRight, Home and End move between its controls. A text input
 * doesn't belong in it (its arrows move the caret): keep the search outside. The arrows don't change a select's value
 * here; Alt+ArrowDown or Space opens it.
 */
export function RovingToolbar({ label, className, children, ...rest }: Omit<ComponentProps<"div">, "role"> & { label: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const active = useRef(0);

  // Every control but the active one leaves the Tab order; done after each render, and when controls come, go or
  // are enabled (an Undo that becomes possible), without re-rendering the controls.
  const sync = () => {
    const el = bar.current;
    if (!el) return;
    const items = itemsOf(el);
    if (!items.length) return;
    const at = Math.min(active.current, items.length - 1);
    active.current = at;
    for (const [i, item] of items.entries()) item.tabIndex = i === at ? 0 : -1;
    // A disabled control is out of the arrows' way but keeps its own -1.
    for (const off of el.querySelectorAll<HTMLElement>(`${ITEMS.split(", ").map((s) => `${s}[disabled]`).join(", ")}`)) off.tabIndex = -1;
  };
  useLayoutEffect(sync);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const watch = new MutationObserver(sync);
    watch.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "class", "hidden"] });
    // Below 1280 px the actions fold into "⋯": a media query, so no mutation tells.
    window.addEventListener("resize", sync);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn(className)}
      onFocus={(e) => {
        const items = itemsOf(e.currentTarget);
        const at = items.indexOf(e.target as HTMLElement);
        if (at >= 0 && at !== active.current) {
          active.current = at;
          sync();
        }
      }}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
        const target = e.target as HTMLElement;
        // Inside an open menu or popover (they portal out, but not every widget does): leave its keys alone.
        if (target.closest("[role=menu], [role=listbox], [role=dialog]") || target.matches("input:not([type=checkbox]):not([type=radio]), textarea")) return;
        const items = itemsOf(e.currentTarget);
        if (!items.length) return;
        const at = Math.max(0, items.indexOf(target));
        const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
        // Also stops a closed select from changing its value on the arrows.
        e.preventDefault();
        active.current = next;
        sync();
        items[next]!.focus();
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
