"use client";

import { useTranslations } from "next-intl";
import type { RunLine } from "@/api/hooks/sheet";
import { cn } from "@/lib/utils";
import { shownSource, type Source } from "./model";
import { toConfirmReason } from "./source-tag";

/** One letter per source the sheet marks; measured lines carry no mark. */
const MARK: Record<Exclude<Source, "measured">, { letter: string; style: string }> = {
  derived: { letter: "D", style: "border-derived text-derived" },
  manual: { letter: "M", style: "border-transparent bg-[var(--status-manual)] text-on-fill" },
  flagged: { letter: "!", style: "border-transparent bg-[var(--status-attention)] text-on-fill" },
};

/**
 * A line's source as an 18 px mark in the sheet's status gutter, next to its number (review C-02, DEC-47): derived
 * (a blue outlined "D"), manual (a yellow "M"), to confirm (an orange "!"); measured lines have none. Never colour
 * alone: a letter, the word as its accessible name and its tooltip, and the reason a line is to confirm. Always
 * shown, whatever the width or the 3D pane, unlike the old Source column; the share page uses it too (C-26).
 */
export function StatusMark({ source, toConfirm, className }: { source: string; toConfirm?: RunLine["toConfirm"]; className?: string }) {
  const t = useTranslations("boqs.sheet.sources");
  const shown = shownSource({ source: source as Source, toConfirm });
  if (shown === "measured") return null;
  const mark = MARK[shown];
  const word = t.has(shown) ? t(shown) : shown;
  const why = toConfirm && shown === "flagged" && source !== "flagged" ? toConfirmReason(t, toConfirm) : undefined;
  const label = why ? `${word}: ${why}` : word;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-grid size-4 shrink-0 place-items-center rounded-[var(--radius)] border text-[0.625rem] leading-none font-bold", mark.style, className)}
      data-testid="status-mark"
      data-mark={shown}
    >
      <span aria-hidden>{mark.letter}</span>
    </span>
  );
}
