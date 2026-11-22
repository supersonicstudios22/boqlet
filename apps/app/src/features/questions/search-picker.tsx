"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface PickItem {
  value: string;
  label: string;
  /** Muted text after the label (a term's broader terms, a code's title). */
  hint?: string;
}

/**
 * A searchable list (ARIA combobox): type to narrow, arrows and Enter to pick, Escape to close.
 * Used for terms, codes and rules, which can be too many for a plain select.
 */
export function SearchPicker({
  items,
  value,
  onPick,
  search,
  label,
  placeholder,
  empty,
  disabled,
  className,
  autoFocus,
  onDismiss,
  portal = false,
  "data-testid": testId,
}: {
  items: readonly PickItem[];
  value: string | undefined;
  onPick: (value: string) => void;
  /** Narrows the items for a query; default: label, value and hint contain every word. */
  search?: (query: string) => readonly PickItem[];
  label: string;
  placeholder?: string;
  empty: string;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  /** Called when the person leaves without picking (Escape or moving away). */
  onDismiss?: () => void;
  /**
   * Draw the list over the page (a portal at the input's place) instead of inside its parent: for a
   * picker inside a virtualised row, whose own stacking would put the list under the next rows (TF-103).
   */
  portal?: boolean;
  "data-testid"?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const chosen = items.find((i) => i.value === value);
  const shown = useMemo(() => {
    if (search) return search(query).slice(0, 50);
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => words.every((w) => `${i.label} ${i.value} ${i.hint ?? ""}`.toLowerCase().includes(w))).slice(0, 50);
  }, [items, query, search]);

  // Where the portalled list goes: under the input, following it on scroll and resize.
  const [place, setPlace] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!portal || !open) return;
    const follow = () => {
      const r = input.current?.getBoundingClientRect();
      if (!r) return;
      // Above the input when there is more room there than below (the list is at most 18rem high).
      const below = window.innerHeight - r.bottom;
      const up = below < 288 + 8 && r.top > below;
      setPlace({ position: "fixed", left: r.left, width: Math.max(r.width, 288), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    };
    follow();
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [portal, open]);

  const pick = (item: PickItem) => {
    onPick(item.value);
    setOpen(false);
    setQuery("");
    input.current?.blur();
  };

  return (
    <div className={cn("relative min-w-56", className)}>
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${id}-${active}` : undefined}
        disabled={disabled}
        placeholder={chosen ? undefined : placeholder}
        value={open ? query : (chosen?.label ?? value ?? "")}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        autoFocus={autoFocus}
        onBlur={() => {
          setOpen(false);
          onDismiss?.();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            pick(shown[active]!);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
            onDismiss?.();
          }
        }}
        className="h-8 w-full rounded-[var(--radius)] border border-input bg-transparent px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        data-testid={testId}
      />
      {open && (portal ? place && typeof document !== "undefined" && createPortal(list(place), document.body) : list(null))}
    </div>
  );

  function list(style: CSSProperties | null) {
    return (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          style={style ?? undefined}
          className={cn("max-h-72 overflow-auto rounded-[var(--radius)] border border-border bg-background py-1 shadow-sm", style ? "z-50" : "absolute top-full left-0 z-20 mt-1 w-full min-w-72")}
          data-testid={testId ? `${testId}-list` : undefined}
        >
          {shown.length === 0 && <li className="px-2 py-1 text-muted-foreground">{empty}</li>}
          {shown.map((item, i) => (
            <li
              key={item.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={item.value === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item)}
              className={cn("flex cursor-pointer items-baseline gap-2 px-2 py-1", i === active && "bg-muted", item.value === value && "font-medium")}
            >
              <span className="whitespace-nowrap">{item.label}</span>
              {item.hint && <span className="min-w-0 truncate text-muted-foreground">{item.hint}</span>}
            </li>
          ))}
        </ul>
    );
  }
}
