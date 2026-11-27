"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RunWarning } from "@/api/hooks/sheet";
import { useEngineMessage, withSystemName } from "@/i18n/engine-message";

/**
 * The run's warnings (F06 §8), collapsible, each with its affected elements. Closed, they are one button ("1 warning")
 * at the end of the workspace's tabs row beside the source counts (review C-01); open, the list shows above the sheet.
 */
export function WarningsToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  const t = useTranslations("boqs.warnings");
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="flex shrink-0 items-center gap-1.5 border-l-2 border-[var(--status-attention)] pl-2 hover:underline"
      aria-expanded={open}
      aria-controls="sheet-warnings"
      onClick={onToggle}
      data-testid="warnings-bar"
    >
      <TriangleAlert className="size-3.5" aria-hidden />
      {t("title", { count })}
    </button>
  );
}

/** The open list of the run's warnings. */
export function WarningsList({ warnings, systemNames }: { warnings: readonly RunWarning[]; systemNames?: ReadonlyMap<string, string> }) {
  const t = useTranslations("boqs.warnings");
  const message = useEngineMessage();
  return (
    <ul id="sheet-warnings" className="flex max-h-48 flex-col gap-1 overflow-y-auto border-l-2 border-[var(--status-attention)] pl-3" aria-label={t("title", { count: warnings.length })} data-testid="warnings-list">
      {warnings.map((w, i) => {
        // The classification by its name, not its id (TF-110).
        const shown = message(systemNames ? withSystemName(w, systemNames) : w);
        return (
          <li key={`${w.code}-${i}`} className="flex gap-3">
            <span className="flex-1" data-testid="warning-message" data-message={shown.source}>{shown.text}</span>
            {w.guids?.length ? <span className="text-muted-foreground tabular-nums">{t("elements", { count: w.guids.length })}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
