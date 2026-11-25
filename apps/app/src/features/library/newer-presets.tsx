"use client";

import { useTranslations } from "next-intl";
import type { Schemas } from "@ifc-boq/api";
import { Button } from "@/components/ui/button";

export type PresetInputInfo = Schemas["PresetInputInfo"];

/** The preset inputs (or project defaults) that have a newer published version or whose preset is archived (review A-44). */
export const presetNotices = (list: PresetInputInfo[] | undefined) => (list ?? []).filter((p) => p.archived || (p.newerVersionAvailable ?? null) !== null);

type Ids = { ruleSetVersionId?: string | null; classificationVersionIds?: string[]; dictionaryVersionIds?: string[]; federationVersionId?: string | null; resolutionVersionId?: string | null };

/**
 * The change that gives one input its preset's latest version: only the field that holds it, as a Setup or
 * project-settings edit would (BR-07: nothing moves until someone asks).
 */
export function newerPatch(ids: Ids, info: PresetInputInfo): Partial<Ids> {
  const latest = info.latestVersionId;
  if (!latest) return {};
  const swap = (list: string[] | undefined) => [...new Set((list ?? []).map((id) => (id === info.versionId ? latest : id)))];
  switch (info.kind) {
    case "rule_set":
      return { ruleSetVersionId: latest };
    case "classification":
      return { classificationVersionIds: swap(ids.classificationVersionIds) };
    case "dictionary":
      return { dictionaryVersionIds: swap(ids.dictionaryVersionIds) };
    case "federation":
      return { federationVersionId: latest };
    case "resolution":
      return { resolutionVersionId: latest };
  }
}

/**
 * Review A-44 (DEC-44): "v2 available" per preset, with "Use version n" for someone who may change the inputs,
 * and a warning on an archived preset (it keeps working; choose another).
 */
export function NewerPresets({
  list,
  ids,
  editable,
  pending,
  onUse,
  testId,
}: {
  list: PresetInputInfo[] | undefined;
  ids: Ids;
  editable: boolean;
  pending?: boolean;
  onUse: (patch: Partial<Ids>) => void;
  testId: string;
}) {
  const t = useTranslations("library.newer");
  const rows = presetNotices(list);
  if (!rows.length) return null;
  return (
    <ul className="flex flex-col gap-1 border-l-2 border-[var(--status-attention)] pl-3" role="status" data-testid={testId}>
      {rows.map((p) => (
        <li key={p.versionId} className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid={`${testId}-row`} data-preset={p.presetId}>
          {p.archived ? (
            <span>{t("archived", { name: p.name, kind: t(`kinds.${p.kind}`) })}</span>
          ) : (
            <>
              <span>{t("available", { name: p.name, kind: t(`kinds.${p.kind}`), newer: p.newerVersionAvailable ?? 0, current: p.number ?? 0 })}</span>
              {editable && p.latestVersionId && (
                <Button variant="outline" size="sm" disabled={pending} onClick={() => onUse(newerPatch(ids, p))} data-testid={`${testId}-use`}>
                  {t("use", { n: p.newerVersionAvailable ?? 0 })}
                </Button>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
