"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useProjectAudit } from "@/api/hooks/projects";
import { InlineError } from "@/components/errors/inline-error";

/** The project's audit log, newest first (S18). An action without a label reads "Another change". */
export function ActivityList({ projectId, limit }: { projectId: string; limit?: number }) {
  const t = useTranslations("projects.activity");
  const format = useFormatter();
  const audit = useProjectAudit(projectId);
  if (audit.isError) {
    return (
      <InlineError error={audit.error} onRetry={() => audit.refetch()} />
    );
  }
  // Audit codes contain dots (`project.created`); catalogue keys can't, so they use underscores.
  const actionText = (action: string) => {
    const key = `actions.${action.replaceAll(".", "_")}`;
    return t.has(key) ? t(key) : t("unknownAction");
  };
  const items = (audit.data?.items ?? []).slice(0, limit);
  if (audit.data && items.length === 0) return <p className="text-muted-foreground">{t("empty")}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border" data-testid="activity-list">
      {items.map((e) => (
        <li key={e.id} className="flex items-center gap-4 py-2">
          <span className="w-40 shrink-0 tabular-nums text-muted-foreground">{format.dateTime(new Date(e.at), { dateStyle: "medium", timeStyle: "short" })}</span>
          <span className="w-40 shrink-0 truncate">{e.actor?.name ?? t("system")}</span>
          <span className="flex-1" title={e.action}>{actionText(e.action)}</span>
        </li>
      ))}
    </ul>
  );
}
