"use client";

import { useEffect, useId } from "react";
import { APP_NAME } from "@/config";

/**
 * The browser tab's title (WCAG 2.4.2, TF-167): "BoQ name · Sheet · Project · boqlet". Layouts and pages
 * each name their level; the deepest one shown wins, and when it goes the one above it is back.
 */
const titles = new Map<string, { depth: number; parts: string[] }>();

function apply() {
  let best: { depth: number; parts: string[] } | null = null;
  for (const entry of titles.values()) if (!best || entry.depth >= best.depth) best = entry;
  document.title = [...(best?.parts ?? []), APP_NAME].join(" · ");
}

/** `parts` most specific first; `depth` 1 for an org, 2 for a project or a top-level page, 3 inside a project page. */
export function usePageTitle(depth: number, ...parts: (string | null | undefined | false)[]) {
  const id = useId();
  const shown = parts.filter((p): p is string => !!p).join("\u0000");
  useEffect(() => {
    titles.set(id, { depth, parts: shown ? shown.split("\u0000") : [] });
    apply();
    return () => {
      titles.delete(id);
      apply();
    };
  }, [id, depth, shown]);
}

/** For tests. */
export const pageTitleFor = (entries: { depth: number; parts: string[] }[]) => {
  titles.clear();
  entries.forEach((e, i) => titles.set(String(i), e));
  apply();
  return document.title;
};
