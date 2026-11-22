import { cn } from "@/lib/utils";

/*
 * "You are here", one look everywhere (P55, design-guidelines.md "Colour"): the active tab, nav item
 * or toggle is in the brand purple (--link), semibold, with a 3 px bar; the rest is muted and gets
 * the hover fill. JetBrains Mono keeps its width across weights, so a bold active label does not
 * shift its neighbours.
 */

/** A tab in a row of tabs over a rule (`border-b border-border` on the row). */
export function tabClass(active: boolean, className?: string) {
  return cn(
    "label-caps -mb-px border-b-3 pb-2 transition-colors",
    active ? "border-link font-bold text-link" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
    className,
  );
}

/** An item of a vertical nav (the org's left nav, the admin nav). */
export function navItemClass(active: boolean, className?: string) {
  return cn(
    "flex h-row items-center border-l-3 px-4 text-ui transition-colors",
    active ? "border-link bg-selection font-semibold text-link" : "border-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
    className,
  );
}

/** One option of a small toggle group or a chip that is on or off: on is selected, never primary. */
export function segmentClass(active: boolean, className?: string) {
  return cn(
    "rounded-[var(--radius)] border transition-colors",
    active ? "border-link bg-selection font-semibold text-link" : "border-border text-muted-foreground hover:bg-hover hover:text-foreground",
    className,
  );
}
