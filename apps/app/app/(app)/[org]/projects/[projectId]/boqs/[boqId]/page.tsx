"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useBoqFormat } from "@/i18n/boq-format";
import { useBoq, useRuns, type Run } from "@/api/hooks/boqs";
import { DimensionRule } from "@/components/dimension-rule";
import { BoqHeader } from "@/features/boqs/boq-header";
import { BoqPresenceProvider, PresenceAvatars } from "@/features/boqs/presence";
import { WorkspaceSlotsProvider } from "@/features/boqs/workspace-slots";
import { useRevisions } from "@/api/hooks/diffs";
import { ReviewTab } from "@/features/versions/review-tab";
import { VersionsTab } from "@/features/versions/versions-tab";
import { ExportsTab } from "@/features/exports/exports-tab";
import { SetupTab } from "@/features/boqs/setup-tab";
import { ChangesTab } from "@/features/changes/changes-tab";
import { LogTab } from "@/features/boq-sheet/log-tab";
import { Sheet } from "@/features/boq-sheet/sheet";
import { useOrg } from "@/features/orgs/org-context";
import { QuestionsTab } from "@/features/questions/questions-tab";
import { useOpenQuestions } from "@/features/questions/use-open-questions";
import { ViewerTab } from "@/features/viewer/viewer-tab";
import { useProjectScope } from "@/features/projects/project-context";
import { extensions } from "@/extensions";
import { InlineError } from "@/components/errors/inline-error";
import { LoadingLines } from "@/components/loading";
import { usePageTitle } from "@/lib/page-title";
import { tabClass } from "@/components/nav-styles";
import { cn } from "@/lib/utils";

const TABS = ["review", "sheet", "questions", "viewer", "changes", "log", "setup", "exports", "versions"] as const;
/** Tabs that show a saved version opened read-only (`?version=`, F09 §3). */
const VERSION_TABS: readonly Tab[] = ["sheet", "viewer", "log"];
type Tab = (typeof TABS)[number];

/**
 * S12: the BoQ workspace: header, Sheet (FE-009), Questions (FE-010), Viewer (FE-016), Changes
 * (FE-030; leads, estimators and approvers, S12d), Log, Setup and the run history (FE-008).
 */
export default function BoqWorkspacePage({ params }: { params: Promise<{ boqId: string }> }) {
  const { boqId } = use(params);
  const t = useTranslations("boqs");
  const orgScope = useOrg();
  const { org } = orgScope;
  const boqFormat = useBoqFormat();
  const { project, can } = useProjectScope();
  const search = useSearchParams();
  const boq = useBoq(boqId);
  const runs = useRuns(boq.data?.currentRevision.id);
  // P55: the Questions tab shows how many of the working version's questions wait for an answer;
  // orange when some block the BoQ, a quiet outline when all are optional.
  const questionCounts = useOpenQuestions(boq.data?.currentRevision.currentRun?.id);
  const openQuestions = questionCounts.open;
  const revisions = useRevisions(boqId);
  const requested = search.get("tab") as Tab | null;
  // F09 §3: a saved version opened read-only.
  const versionId = search.get("version");
  const viewing = versionId ? revisions.data?.find((r) => r.id === versionId && r.status === "issued") : undefined;
  const status = boq.data?.currentRevision.status;
  // S12d: the change report is for leads, estimators and approvers (seeAudit: lead, approver). The
  // review screen shows while a version is in review or approved (F09 §4).
  const tabs = TABS.filter(
    (k) => (k !== "changes" || can("seeAudit") || can("editBoqs")) && (k !== "review" || status === "in_review" || status === "approved") && (!viewing || VERSION_TABS.includes(k)),
  );
  // Module tabs (`boq.workspaceTabs`, P36) after the core's; not on a saved version opened read-only.
  const moduleTabs = viewing ? [] : extensions("boq.workspaceTabs").filter((m) => !m.visible || m.visible({ ...orgScope, projectPermissions: project.permissions ?? {} }));
  const moduleTab = moduleTabs.find((m) => m.id === requested);
  const tab: Tab | null = moduleTab ? null : requested && (tabs as readonly string[]).includes(requested) ? requested : "sheet";
  const base = `/${org.slug}/projects/${project.id}/boqs/${boqId}`;
  const approval = org.settings?.approvalRequired === true;
  // The end of the tabs row, which the sheet fills with its one-line bar (review C-01).
  const [tabsEnd, setTabsEnd] = useState<HTMLDivElement | null>(null);

  // A failed refetch (the API restarting, TF-183) keeps the page and its unsaved edits on screen; it
  // refetches when the API answers again (the realtime provider). Only a BoQ never loaded is an error.
  usePageTitle(3, boq.data?.name, tab ? t(`tabs.${tab}`) : null, project.name);
  if (boq.isError && !boq.data)
    return (
      <div data-testid="boq-error">
        <InlineError error={boq.error} onRetry={() => boq.refetch()} />
      </div>
    );
  if (!boq.data) return <LoadingLines />;
  const current = viewing ? viewing.currentRun : boq.data.currentRevision.currentRun;
  const href = (key: string) => `${base}?${new URLSearchParams({ tab: key, ...(viewing ? { version: viewing.id } : {}) }).toString()}`;
  return (
    // F06 §14: everyone with the BoQ open sees who else is in it.
    <BoqPresenceProvider boqId={boqId}>
    <WorkspaceSlotsProvider value={{ tabsEnd }}>
    {/* On the sheet the workspace fills the screen and the grid takes the rest of it (review C-01). */}
    <div className="flex flex-col gap-6 has-[[data-workspace-fill]]:min-h-0 has-[[data-workspace-fill]]:flex-1 has-[[data-workspace-fill]]:gap-2" data-testid="boq-workspace">
      <BoqHeader boq={boq.data} runs={runs.data} base={base} canArchive={can("archive")} approval={approval} />
      {viewing && (
        <p className="flex flex-wrap items-center gap-x-3 border-l-2 border-foreground pl-3" role="status" data-testid="viewing-version" data-label={viewing.label}>
          <span>{t("versions.viewing", { label: viewing.label, when: viewing.issuedAt ? boqFormat.dateTime(new Date(viewing.issuedAt), { dateStyle: "medium", timeStyle: "short" }) : "", by: viewing.issuedBy?.name ?? "" })}</span>
          <Link href={`${base}?tab=sheet`} className="text-link hover:underline" data-testid="back-to-working">
            {t("versions.backToWorking")}
          </Link>
        </p>
      )}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-1 border-b border-border">
      <nav aria-label={t("tabs.label")} className="flex flex-wrap gap-x-6 gap-y-2">
        {tabs.map((key) => (
          <Link
            key={key}
            href={href(key)}
            aria-current={tab === key ? "page" : undefined}
            className={tabClass(tab === key)}
            data-testid={`tab-${key}`}
          >
            {t(`tabs.${key}`)}
            {key === "questions" && !viewing && openQuestions > 0 && (
              <>
                <span aria-hidden className={cn("ml-1.5 inline-grid h-4 min-w-4 place-items-center rounded-[var(--radius)] border px-1 font-bold tracking-normal", questionCounts.blocking > 0 ? "border-attention bg-attention text-on-fill" : "border-muted-foreground text-muted-foreground")} data-testid="open-questions-count">
                  {openQuestions}
                </span>
                <span className="sr-only">{" "}{t("tabs.openCount", { n: openQuestions })}</span>
              </>
            )}
          </Link>
        ))}
        {moduleTabs.map((m) => (
          <Link
            key={m.id}
            href={href(m.id)}
            aria-current={moduleTab === m ? "page" : undefined}
            className={tabClass(moduleTab === m)}
            data-testid={`tab-${m.id}`}
          >
            <m.Label />
          </Link>
        ))}
      </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3 pb-1.5">
          <div ref={setTabsEnd} className="flex min-w-0 items-center gap-3 empty:hidden" data-testid="workspace-tabs-end" />
          <PresenceAvatars />
        </div>
      </div>
      {moduleTab && <moduleTab.Panel boqId={boqId} projectId={project.id} runId={current?.id ?? null} />}
      {tab === "review" && <ReviewTab boq={boq.data} runs={runs.data} base={base} />}
      {tab === "sheet" && (current ? <Sheet key={`${current.id}|${viewing?.id ?? ""}`} run={current} boq={boq.data} readOnly={!!viewing} {...(viewing ? { frozen: { overrides: viewing.frozen?.adjustments?.overrides ?? [], manualItems: viewing.frozen?.adjustments?.manualItems ?? [] } } : {})} /> : <RunFigures run={current} />)}
      {tab === "viewer" && <ViewerTab run={current} base={base} />}
      {tab === "changes" && <ChangesTab boq={boq.data} runs={runs.data} base={base} />}
      {tab === "log" && <LogTab key={current?.id ?? "none"} run={current} />}
      {tab === "questions" && <QuestionsTab boq={boq.data} />}
      {tab === "setup" && <SetupTab boq={boq.data} orgId={org.id} />}
      {tab === "exports" && <ExportsTab boq={boq.data} />}
      {tab === "versions" && <VersionsTab boq={boq.data} runs={runs.data} base={base} canCompare={tabs.includes("changes")} />}
    </div>
    </WorkspaceSlotsProvider>
    </BoqPresenceProvider>
  );
}

/** Before the first run: what to do; the sheet appears once a run is complete. */
function RunFigures({ run }: { run: Run | undefined }) {
  const t = useTranslations("boqs.sheet");
  const format = useFormatter();
  if (!run?.stats) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground">{t("empty")}</p>
        <DimensionRule className="max-w-48" />
      </div>
    );
  }
  const s = run.stats;
  const figures: [string, string][] = [
    [t("lines"), format.number(s.lines ?? 0)],
    [t("flagged"), format.number(s.flaggedLines ?? 0)],
    [t("elements"), format.number(s.elements ?? 0)],
    [t("measured"), format.number(s.measuredElements ?? 0)],
    [t("questions"), format.number(s.questions ?? 0)],
    [t("blocking"), format.number(s.blockingQuestions ?? 0)],
    [t("warnings"), format.number(s.warnings ?? 0)],
    [t("duration"), t("seconds", { s: format.number((s.durationMs ?? 0) / 1000, { maximumFractionDigits: 1 }) })],
  ];
  return (
    <dl className="grid max-w-3xl grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-6 gap-y-4" data-testid="run-figures">
      {figures.map(([label, value]) => (
        <div key={label} className="flex flex-col">
          <dt className="label-caps text-muted-foreground">{label}</dt>
          <dd className="text-title tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
