"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { PendingEdit } from "./pending";

/** How many pending lines the expanded list names before "and N more". */
const SHOWN = 8;

/**
 * One banner for everything the current run doesn't have yet (review C-08, DEC-38): "3 edits, 1 answer not applied
 * yet — Apply now (generate again)", the list on expand, and why Save version waits. Edits already show their value
 * in the sheet; only the engine computes, so a run applies them (rule 4), never the browser.
 *
 * `edits` null: the line edits changed but couldn't be counted (a very large BoQ, still loading) — named, not counted.
 */
export function PendingBanner({
  edits,
  answers,
  answeredBy = [],
  inputs,
  editsChanged,
  canApply,
  applying,
  onApply,
  saveWaits,
}: {
  edits: readonly PendingEdit[] | null;
  answers: number;
  /** Who gave the answers not applied yet (review C-17). */
  answeredBy?: readonly string[];
  /** Other inputs that changed (`BoqRevision.pendingChanges` keys besides decisions and adjustments). */
  inputs: readonly string[];
  /** `pendingChanges` has "adjustments": the line edits differ from the run's. */
  editsChanged: boolean;
  canApply: boolean;
  applying: boolean;
  onApply: () => void;
  /** Save version is blocked until a run applies these. */
  saveWaits: boolean;
}) {
  const t = useTranslations("boqs.pending");
  const tr = useTranslations("boqs.run");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const editCount = edits?.length ?? 0;
  const parts = [
    ...(editsChanged && edits !== null && editCount > 0 ? [t("edits", { count: editCount })] : editsChanged ? [t("someEdits")] : []),
    ...(answers > 0 ? [t("answers", { count: answers })] : []),
    ...inputs.map((k) => {
      // Catalogue keys can't contain dots ("inputs.ruleSet" → "inputs_ruleSet").
      const key = `pendingItems.${k.replaceAll(".", "_")}`;
      return tr.has(key) ? tr(key) : k;
    }),
  ];
  if (parts.length === 0) return null;
  const listed = edits ?? [];
  return (
    <div className="flex flex-col gap-1 border-l-2 border-[var(--status-attention)] pl-3" role="status" data-testid="pending-banner" data-edits={edits === null ? undefined : editCount} data-answers={answers}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span data-testid="pending-summary">{t("summary", { what: format.list(parts, { type: "conjunction" }) })}</span>
        {canApply && (
          <Button size="sm" onClick={onApply} disabled={applying} data-testid="pending-apply">
            {t("apply")}
          </Button>
        )}
        {(listed.length > 0 || answers > 0 || inputs.length > 0) && (
          <button type="button" className="flex items-center gap-1 text-link hover:underline" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="pending-toggle">
            {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
            {open ? t("hide") : t("show")}
          </button>
        )}
        {saveWaits && (
          <span className="text-muted-foreground" data-testid="pending-save-waits">
            {t("saveWaits")}
          </span>
        )}
      </div>
      {open && (
        <ul className="flex flex-col gap-0.5 text-muted-foreground" data-testid="pending-list">
          {listed.slice(0, SHOWN).map((e) => (
            <li key={`${e.kind}:${e.key}`}>
              {t(`kinds.${e.kind}`, { line: e.description })}
              {e.fields?.length ? ` (${format.list(e.fields.map((f) => t(`fields.${f}`)), { type: "unit" })})` : ""}
            </li>
          ))}
          {listed.length > SHOWN && <li>{t("more", { count: listed.length - SHOWN })}</li>}
          {answers > 0 && (
            <li data-testid="pending-answers">
              {answeredBy.length ? t("answersBy", { count: answers, names: format.list(answeredBy, { type: "conjunction" }) }) : t("answersLine", { count: answers })}
            </li>
          )}
          {inputs.length > 0 && <li>{t("inputsLine", { what: format.list(parts.slice(parts.length - inputs.length), { type: "unit" }) })}</li>}
        </ul>
      )}
    </div>
  );
}
