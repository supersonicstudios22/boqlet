"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useAdminHealth } from "@/api/hooks/admin";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InlineError } from "@/components/errors/inline-error";
import { LoadingLines } from "@/components/loading";

/** S36 health (F19 §7): failed jobs per day, job durations, billing webhook failures, email bounces. */
export function AdminHealthView() {
  const t = useTranslations("admin.health");
  const format = useFormatter();
  const health = useAdminHealth();
  const ms = (v: number | undefined) => (v === undefined ? "—" : v >= 1000 ? t("s", { n: format.number(v / 1000, { maximumFractionDigits: 1 }) }) : t("ms", { n: format.number(Math.round(v)) }));
  if (health.isError)
    return (
      <InlineError error={health.error} onRetry={() => health.refetch()} />
    );
  if (!health.data) return <LoadingLines />;
  const h = health.data;
  // A figure the API doesn't send isn't measured yet: say so, never "0" (TF-154).
  const tracked = (v: number | null | undefined) => (typeof v === "number" ? format.number(v) : t("notTracked"));
  const durations = Object.entries(h.jobDurationsMs ?? {});
  return (
    <div className="flex max-w-3xl flex-col gap-8" data-testid="admin-health">
      <h1 className="text-title">{t("title")}</h1>
      <dl className="flex flex-wrap gap-10">
        <div className="flex flex-col">
          <dt className="label-caps text-muted-foreground">{t("billingWebhookFailures")}</dt>
          <dd className="text-title tabular-nums" data-testid="health-webhook-failures">{tracked(h.billingWebhookFailures)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="label-caps text-muted-foreground">{t("emailBounces")}</dt>
          <dd className="text-title tabular-nums" data-testid="health-email-bounces">{tracked(h.emailBounces)}</dd>
        </div>
      </dl>
      <section className="flex flex-col gap-3">
        <h2 className="label-caps">{t("failedJobs")}</h2>
        {(h.failedJobsPerDay ?? []).length === 0 ? (
          <p className="text-muted-foreground">{t("noFailures")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("date")}</TableHead>
                <TableHead className="text-right">{t("count")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(h.failedJobsPerDay ?? []).map((d) => (
                <TableRow key={d.date}>
                  <TableCell>{d.date ? format.dateTime(new Date(`${d.date}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{format.number(d.count ?? 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="label-caps">{t("durations")}</h2>
        {durations.length === 0 ? (
          <p className="text-muted-foreground">{t("noJobs")}</p>
        ) : (
          <Table data-testid="health-durations">
            <TableHeader>
              <TableRow>
                <TableHead>{t("type")}</TableHead>
                <TableHead className="text-right">{t("p50")}</TableHead>
                <TableHead className="text-right">{t("p95")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {durations.map(([type, d]) => (
                <TableRow key={type}>
                  <TableCell>{type}</TableCell>
                  <TableCell className="text-right tabular-nums">{ms(d.p50)}</TableCell>
                  <TableCell className="text-right tabular-nums">{ms(d.p95)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
