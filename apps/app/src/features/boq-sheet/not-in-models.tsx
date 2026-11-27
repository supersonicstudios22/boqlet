"use client";

import { Info, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SheetLine } from "./edits";
import { countsBySource } from "./model";

/** The "not in the models" paragraph (P15, BR-12): the notice, the empty sheet and the "Add line" help say the same. */
export function NotInModelsText({ className }: { className?: string }) {
  const t = useTranslations("boqs.notInModels");
  return <p className={className}>{t("text")}</p>;
}

/**
 * F06 §12: the app measures only what the models contain, and says so on every sheet. A one-line bar (review C-01)
 * with the counts by source and a button that shows or hides the paragraph; collapsed to the counts it is never
 * removed. The collapse is the user's server-side preference (`GET /me` preferences, F06-AC8, Q55). "Add line" is
 * the sheet toolbar's, not repeated here.
 */
export function NotInModelsBar({ lines, collapsed, onCollapsedChange }: {
  lines: readonly SheetLine[];
  /** The user's saved preference: the same in every browser. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const t = useTranslations("boqs.notInModels");
  const counts = countsBySource(lines);
  return (
    <section className="flex min-w-0 items-center gap-2 border-l-2 border-[var(--status-manual)] pl-2" aria-label={t("title")} data-testid="not-in-models" data-collapsed={collapsed ? "true" : "false"}>
      {/* The save updates the cached preference at once (useUpdatePreferences), so the toggle shows immediately. */}
      <button
        type="button"
        className="flex shrink-0 items-center text-muted-foreground hover:text-foreground"
        aria-expanded={!collapsed}
        aria-controls="not-in-models-text"
        title={collapsed ? t("expand") : t("collapse")}
        onClick={() => onCollapsedChange(!collapsed)}
        data-testid="not-in-models-toggle"
      >
        <Info className="size-3.5" aria-hidden />
        <span className="sr-only">{collapsed ? t("expand") : t("collapse")}</span>
      </button>
      <p className="truncate tabular-nums" data-testid="source-counts" data-measured={counts.measured} data-derived={counts.derived} data-manual={counts.manual} data-flagged={counts.flagged}>
        {t("counts", counts)}
      </p>
    </section>
  );
}

/** The paragraph itself, under the bar while the notice is open. */
export function NotInModelsPanel({ onCollapse }: { onCollapse: () => void }) {
  const t = useTranslations("boqs.notInModels");
  return (
    <div id="not-in-models-text" className="flex items-start gap-3 border-l-2 border-[var(--status-manual)] pl-3" data-testid="not-in-models-text">
      <NotInModelsText className="max-w-prose flex-1 text-prose" />
      <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={t("collapse")} title={t("collapse")} onClick={onCollapse} data-testid="not-in-models-hide">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
