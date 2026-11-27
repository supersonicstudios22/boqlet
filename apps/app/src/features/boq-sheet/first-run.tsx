"use client";

import { useTranslations } from "next-intl";
import { DimensionRule } from "@/components/dimension-rule";
import { Skeleton } from "@/components/ui/skeleton";

/** How many placeholder rows the skeleton shows: about a screen's worth. */
const ROWS = 12;

/**
 * The Sheet tab before a BoQ has any finished run (review C-05). While the first run works it shows the grid's
 * outline with "Generating…", never "Generate the BoQ" (which contradicted the progress in the header); with no
 * run at all, what to do. A later run keeps the previous sheet on screen, so this is only for the first.
 */
export function SheetPlaceholder({ generating }: { generating: boolean }) {
  const t = useTranslations("boqs.sheet");
  if (!generating) {
    return (
      <div className="flex flex-col gap-3" data-testid="sheet-empty">
        <p className="text-muted-foreground">{t("empty")}</p>
        <DimensionRule className="max-w-48" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="sheet-skeleton" aria-busy="true">
      <p role="status" className="text-muted-foreground">
        {t("generatingFirst")}
      </p>
      <div className="flex flex-col border-y border-border" aria-hidden>
        {Array.from({ length: ROWS }, (_, i) => (
          <div key={i} className="grid h-8 grid-cols-[5rem_1fr_4.5rem_8rem] items-center gap-4 border-b border-border px-2 last:border-b-0">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3" style={{ width: `${45 + ((i * 37) % 45)}%` }} />
            <Skeleton className="h-3 w-8" />
            <Skeleton className="ml-auto h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
