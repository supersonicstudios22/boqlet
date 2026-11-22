"use client";

import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { SheetLine } from "./edits";
import { countsBySource } from "./model";

/** The "not in the models" paragraph (P15, BR-12): the notice, the empty sheet and the "Add line" help say the same. */
export function NotInModelsText({ className }: { className?: string }) {
  const t = useTranslations("boqs.notInModels");
  return <p className={className}>{t("text")}</p>;
}

/**
 * F06 §12: the app measures only what the models contain, and says so at the top of every sheet,
 * with the counts by source and "Add line". Collapsible to the counts line; never removed.
 */
export function NotInModelsNotice({ lines, collapsed, onCollapsedChange, onAddLine }: {
  lines: readonly SheetLine[];
  /** The user's saved preference (`GET /me` preferences, F06-AC8, TF-109): the same in every browser. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onAddLine?: () => void;
}) {
  const t = useTranslations("boqs.notInModels");
  // The save updates the cached preference at once (useUpdatePreferences), so the toggle shows immediately.
  const toggle = () => onCollapsedChange(!collapsed);
  const counts = countsBySource(lines);

  return (
    <section className="flex flex-col gap-2 border-l-2 border-[var(--status-manual)] pl-3" aria-label={t("title")} data-testid="not-in-models" data-collapsed={collapsed ? "true" : "false"}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground" aria-expanded={!collapsed} onClick={toggle} data-testid="not-in-models-toggle">
          {collapsed ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
          <span className="sr-only">{collapsed ? t("expand") : t("collapse")}</span>
        </button>
        <p className="tabular-nums" data-testid="source-counts" data-measured={counts.measured} data-derived={counts.derived} data-manual={counts.manual} data-flagged={counts.flagged}>
          {t("counts", counts)}
        </p>
        {collapsed && onAddLine && (
          <button className="text-link hover:underline" onClick={onAddLine} data-testid="not-in-models-add">
            {t("addLine")}
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="flex flex-wrap items-start gap-3">
          <NotInModelsText className="max-w-prose flex-1 text-prose" />
          {onAddLine && (
            <Button variant="outline" onClick={onAddLine} data-testid="not-in-models-add">
              <Plus aria-hidden />
              {t("addLine")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
