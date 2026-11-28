"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { keys } from "@/api/keys";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRelativeTime } from "@/i18n/use-relative-time";
import { useAttention, useProjects } from "@/api/hooks/projects";
import { Poster } from "@/components/poster";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/features/orgs/org-context";
import { ProjectCard } from "@/features/projects/project-card";
import { useCreateSample } from "@/features/projects/create-sample";
import { useCanCreateProjects } from "@/features/projects/project-creation";
import { InlineError } from "@/components/errors/inline-error";
import { LoadingLines } from "@/components/loading";
import { usePageTitle } from "@/lib/page-title";
import { orgCan } from "@/lib/permissions";

/**
 * S05: what needs me, and my projects (F02 §5). Until the org's setup is finished (F16, P18) the
 * people who can finish it are sent to the wizard; members see that it isn't finished yet.
 */
export default function DashboardPage() {
  const { org, can } = useOrg();
  const router = useRouter();
  const unfinished = org.setup?.status !== "done";
  const gate = unfinished && can("finishSetup");
  useEffect(() => {
    if (gate) router.replace(`/${org.slug}/setup`);
  }, [gate, org.slug, router]);
  if (gate) return <div aria-busy="true" className="min-h-40" />;
  return <Dashboard unfinished={unfinished} />;
}

function Dashboard({ unfinished }: { unfinished: boolean }) {
  usePageTitle(2, useTranslations("shell.nav")("dashboard"), useOrg().org.name);
  const ts = useTranslations("setup");
  const t = useTranslations("projects.dashboard");
  const relativeTime = useRelativeTime();
  const { org, can } = useOrg();
  const projects = useProjects(org.id, { status: "active" });
  const attention = useAttention(org.id);
  const sample = useCreateSample(org);
  const canCreate = useCanCreateProjects();
  // Review C-32: someone who sees only their own projects and has none yet hasn't been added to one.
  const waiting = !can("seeAllProjects");

  return (
    <div className="flex flex-col gap-10">
      {unfinished && (
        <p className="rounded-[var(--radius)] border border-border bg-muted px-3 py-2" role="status" data-testid="setup-not-finished">
          {ts("notFinished")}
        </p>
      )}
      <section className="flex flex-col gap-3" data-testid="needs-you">
        <h2 className="label-caps">{t("needsYou")}</h2>
        {attention.isError && <InlineError error={attention.error} onRetry={() => attention.refetch()} />}
        {attention.isPending && <LoadingLines lines={2} />}
        {attention.data?.length === 0 && <p className="text-muted-foreground">{t("nothingNeedsYou")}</p>}
        <ul className="flex flex-col divide-y divide-border">
          {attention.data?.map((item) => (
            <li key={`${item.kind}-${item.url}`} className="flex items-center gap-4 py-2">
              <span className="flex-1" data-testid="needs-you-item" data-kind={item.kind}>
                {t.has(`attention.${item.kind}`) ? t(`attention.${item.kind}`, (item.params ?? {}) as Record<string, string | number>) : item.title}
              </span>
              <span className="text-muted-foreground">{item.projectName}</span>
              {item.at && <span className="text-muted-foreground tabular-nums">{relativeTime(item.at)}</span>}
              <Button variant="outline" render={<Link href={item.url} />} nativeButton={false}>
                {t("open")}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <h2 className="label-caps flex-1">{t("projects")}</h2>
          {canCreate && (
            <Button render={<Link href={`/${org.slug}/projects/new`} />} nativeButton={false} data-testid="new-project">
              {t("newProject")}
            </Button>
          )}
        </div>
        {projects.isError && (
          <InlineError error={projects.error} onRetry={() => projects.refetch()} />
        )}
        {projects.isPending && <LoadingLines />}
        {projects.data?.length === 0 && waiting && <NotAddedYet canCreate={canCreate} onSample={() => sample.mutate()} sampling={sample.isPending} />}
        {projects.data?.length === 0 && !waiting && (
          <div className="grid grid-cols-1 items-center gap-8 rounded-[var(--radius)] border border-border p-8 md:grid-cols-[1fr_200px]" data-testid="empty-dashboard">
            <div className="flex flex-col gap-4">
              <h3 className="display text-display-sm">{t("emptyTitle")}</h3>
              <p className="prose-text text-muted-foreground">{t("emptyBody")}</p>
              <div className="flex flex-wrap gap-3">
                {canCreate && (
                  <Button render={<Link href={`/${org.slug}/projects/new`} />} nativeButton={false}>
                    {t("createFirst")}
                  </Button>
                )}
                <Button variant="outline" onClick={() => sample.mutate()} disabled={sample.isPending} data-testid="try-sample">
                  {t("trySample")}
                </Button>
              </div>
            </div>
            <Poster variant={2} className="hidden w-full md:grid" />
          </div>
        )}
        {!!projects.data?.length && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4" data-testid="project-cards">
            {projects.data.map((p) => (
              <ProjectCard key={p.id} org={org.slug} project={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * A member with no project yet (review C-32, LEAD-013): who to ask to be added, by name, and the private
 * sample for training. Creating a project is offered after that only when the member may.
 */
function NotAddedYet({ canCreate, onSample, sampling }: { canCreate: boolean; onSample: () => void; sampling: boolean }) {
  const t = useTranslations("projects.dashboard");
  const { org } = useOrg();
  const members = useQuery({
    queryKey: keys.members(org.id),
    queryFn: async () => (await api.GET("/orgs/{orgId}/members", { params: { path: { orgId: org.id } } })).data!,
  });
  // Those who can add someone to any project (owners and admins act as lead everywhere).
  const admins = (members.data ?? []).filter((m) => orgCan(m.role, "seeAllProjects")).map((m) => m.user.name).slice(0, 3);
  return (
    <div className="grid grid-cols-1 items-center gap-8 rounded-[var(--radius)] border border-border p-8 md:grid-cols-[1fr_200px]" data-testid="not-added-yet">
      <div className="flex flex-col gap-4">
        <h3 className="display text-display-sm">{t("notAddedTitle")}</h3>
        <p className="prose-text text-muted-foreground">
          {admins.length ? t("notAddedAsk", { names: admins.join(", "), count: admins.length }) : t("notAddedAskAnyone", { org: org.name })}
        </p>
        <p className="prose-text text-muted-foreground">{t("notAddedSample")}</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={onSample} disabled={sampling} data-testid="try-sample">
            {t("trySample")}
          </Button>
          {canCreate && (
            <Button variant="outline" render={<Link href={`/${org.slug}/projects/new`} />} nativeButton={false}>
              {t("createFirst")}
            </Button>
          )}
        </div>
      </div>
      <Poster variant={2} className="hidden w-full md:grid" />
    </div>
  );
}
