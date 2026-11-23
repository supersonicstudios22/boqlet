"use client";

import { useTranslations } from "next-intl";
import type { RunLine } from "@/api/hooks/sheet";
import { cn } from "@/lib/utils";
import { shownSource, type Source } from "./model";

/**
 * A line's source as the design guidelines show it: measured plain, derived with a blue outline,
 * manual on yellow, "to confirm" on orange. Always a word, never colour alone. A line the engine marks
 * `toConfirm` (review A-05) shows "To confirm" with the reason as its title and accessible name
 * ("2 of 3 elements measured", "rests on an open question").
 */
export function SourceTag({ source, toConfirm, className }: { source: string; toConfirm?: RunLine["toConfirm"]; className?: string }) {
  const t = useTranslations("boqs.sheet.sources");
  const shown = shownSource({ source: source as Source, toConfirm });
  if (shown === "measured") return <span className={cn("text-muted-foreground", className)}>{t("measured")}</span>;
  const style =
    shown === "derived"
      ? "border-derived text-derived"
      : shown === "manual"
        ? "border-transparent bg-[var(--status-manual)] text-on-fill"
        : shown === "flagged"
          ? "border-transparent bg-[var(--status-attention)] text-on-fill"
          : "border-border";
  const label = t.has(shown) ? t(shown) : shown;
  const why = toConfirm && shown === "flagged" && source !== "flagged" ? toConfirmReason(t, toConfirm) : undefined;
  return (
    <span className={cn("label-caps rounded-[var(--radius)] border px-1", style, className)} title={why} aria-label={why ? `${label}: ${why}` : undefined} data-to-confirm={why ? "" : undefined}>
      {label}
    </span>
  );
}

/** Why a line with a quantity is to confirm, in words. */
export function toConfirmReason(t: ReturnType<typeof useTranslations<"boqs.sheet.sources">>, c: NonNullable<RunLine["toConfirm"]>): string {
  const parts: string[] = [];
  if (c.measured < c.elements) parts.push(t("partial", { measured: c.measured, elements: c.elements }));
  if (c.questions?.length) parts.push(t("openQuestion", { count: c.questions.length }));
  return parts.join("; ");
}
