"use client";

import { useFormatter, useTranslations } from "next-intl";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * Review A-41 (DEC-38): the sheet's Excel when edits or answers wait for the next run. "Generate and export"
 * is the default (it starts a run, then exports it); "Export the last run" writes the run as it is, and its
 * Cover says what it leaves out. Nothing is regenerated without asking (processing minutes, large models).
 */
export function ExportStaleDialog({
  pending,
  canGenerate,
  onGenerate,
  onLastRun,
  onClose,
}: {
  pending: string[] | null;
  canGenerate: boolean;
  onGenerate: () => void;
  onLastRun: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("boqs.sheet.exportStale");
  const tb = useTranslations("boqs");
  const format = useFormatter();
  const what = format.list(
    (pending ?? []).map((k) => {
      // Catalogue keys can't contain dots ("inputs.ruleSet" → "inputs_ruleSet"), as in the header's pending note.
      const key = `run.pendingItems.${k.replaceAll(".", "_")}`;
      return tb.has(key) ? tb(key) : k;
    }),
    { type: "unit" },
  );
  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent data-testid="export-stale">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("body", { what })} {canGenerate ? t("choose") : t("cannotGenerate")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <Button variant={canGenerate ? "outline" : "default"} onClick={onLastRun} data-testid="export-last-run">
            {t("lastRun")}
          </Button>
          {canGenerate && (
            <Button onClick={onGenerate} autoFocus data-testid="export-generate">
              {t("generate")}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
