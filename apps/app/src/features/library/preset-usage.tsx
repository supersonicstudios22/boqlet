"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMovePresetToLatest, usePresetUsage, type Preset } from "@/api/hooks/library";
import { useErrorMessage } from "@/components/errors/use-error-message";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrg } from "@/features/orgs/org-context";
import { InlineError } from "@/components/errors/inline-error";
import { LoadingLines } from "@/components/loading";

/** Where used (F10 §9): the BoQ revisions that use a version of the preset, in projects I can see. */
export function PresetUsage({ preset }: { preset: Preset }) {
  const t = useTranslations("library.usage");
  const tr = useTranslations("library");
  const { org } = useOrg();
  const usage = usePresetUsage(preset.id);
  if (usage.isError) {
    return (
      <InlineError error={usage.error} onRetry={() => usage.refetch()} />
    );
  }
  if (!usage.data) return <LoadingLines />;
  if (usage.data.length === 0) return <p className="text-muted-foreground">{t("none")}</p>;
  const latest = preset.latestPublishedVersion?.number ?? null;
  const behind = latest !== null && usage.data.some((u) => u.presetVersionNumber < latest && u.revisionStatus !== "issued");
  return (
    <div className="flex flex-col gap-4">
      {behind && preset.layer !== "system" && <MoveToLatest preset={preset} n={latest} />}
      <Table data-testid="preset-usage">
      <TableHeader>
        <TableRow>
          <TableHead className="label-caps">{t("project")}</TableHead>
          <TableHead className="label-caps">{t("boq")}</TableHead>
          <TableHead className="label-caps">{t("revision")}</TableHead>
          <TableHead className="label-caps">{t("status")}</TableHead>
          <TableHead className="label-caps">{t("version")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {usage.data.map((u) => (
          <TableRow key={u.revisionId} data-testid="usage-row" data-boq={u.boqId}>
            <TableCell>
              <Link href={`/${org.slug}/projects/${u.projectId}`} className="hover:underline">
                {u.projectName}
              </Link>
            </TableCell>
            <TableCell>
              <Link href={`/${org.slug}/projects/${u.projectId}/boqs/${u.boqId}?tab=setup`} className="hover:underline">
                {u.boqName}
              </Link>
            </TableCell>
            <TableCell className="tabular-nums">{u.revisionLabel}</TableCell>
            <TableCell>{t.has(`statuses.${u.revisionStatus}`) ? t(`statuses.${u.revisionStatus}`) : u.revisionStatus}</TableCell>
            <TableCell className="tabular-nums">{tr("preset.versionN", { n: u.presetVersionNumber })}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      </Table>
    </div>
  );
}

/**
 * Review A-44 (DEC-44): "Move working BoQs to version n" (and, if ticked, the projects' defaults). Saved versions
 * never move; what was skipped (in review, no rights, archived project) is listed.
 */
function MoveToLatest({ preset, n }: { preset: Preset; n: number }) {
  const t = useTranslations("library.usage");
  const message = useErrorMessage();
  const move = useMovePresetToLatest(preset.id);
  const [defaults, setDefaults] = useState(true);
  const result = move.data;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border px-3 py-2" data-testid="move-to-latest">
      <p>{t("moveIntro", { n })}</p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={defaults} onChange={(e) => setDefaults(e.target.checked)} data-testid="move-defaults" />
        {t("moveDefaults")}
      </label>
      <div>
        <Button variant="outline" onClick={() => move.mutate(defaults)} disabled={move.isPending} data-testid="move-to-latest-run">
          {t("move", { n })}
        </Button>
      </div>
      {move.error ? (
        <p role="alert" className="text-error">
          {message(move.error)}
        </p>
      ) : null}
      {result && (
        <div role="status" data-testid="move-result">
          <p>{t("moved", { boqs: result.moved.length, projects: result.projects.length })}</p>
          {result.skipped.length > 0 && (
            <ul className="list-disc pl-5 text-muted-foreground">
              {result.skipped.map((s) => (
                <li key={`${s.projectId}:${s.boqId ?? ""}`}>{t(`skipped.${s.reason}`, { name: s.boqName ? `${s.projectName} › ${s.boqName}` : s.projectName })}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
