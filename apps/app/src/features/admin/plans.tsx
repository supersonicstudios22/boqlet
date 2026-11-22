"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  useAdminCreatePlan,
  useAdminDeletePlan,
  useAdminPlanImpact,
  useAdminPlans,
  useAdminUpdatePlan,
  type AdminPlan,
  type EntitlementKey,
} from "@/api/hooks/admin";
import { InlineError } from "@/components/errors/inline-error";
import { Field } from "@/components/field";
import { LoadingLines } from "@/components/loading";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLimitName } from "@/i18n/limits";
import { LIMITS } from "@/lib/limits";
import { ReasonDialog } from "./reason-dialog";
import { draftEntitlements, parsePrice, savedEntitlements, type EntitlementDraft } from "./values";

/** The limits shown in the plans table; every key is in the editor. */
const COLUMNS = ["seats", "ownedOrgsPerUser", "activeProjects", "processingMinutesPerMonth"] as const;

function usePrice() {
  const format = useFormatter();
  const t = useTranslations("admin.plans");
  return (plan: Pick<AdminPlan, "price">) =>
    plan.price
      ? t("price", { amount: format.number(plan.price.amount, { style: "currency", currency: plan.price.currency }), period: plan.price.period })
      : t("noPrice");
}

/** S36 plans (F19 §9, P57): every plan with its order, visibility, price, orgs and main limits. */
export function AdminPlansView() {
  const t = useTranslations("admin.plans");
  const limitName = useLimitName();
  const format = useFormatter();
  const price = usePrice();
  const plans = useAdminPlans();
  if (plans.isError) return <InlineError error={plans.error} onRetry={() => plans.refetch()} />;
  if (!plans.data) return <LoadingLines />;
  return (
    <div className="flex max-w-6xl flex-col gap-6" data-testid="admin-plans">
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-title">{t("title")}</h1>
        <span className="text-muted-foreground">{t("currency", { currency: plans.data.currency })}</span>
        <Button render={<Link href="/admin/plans/new" />} nativeButton={false} className="ml-auto" data-testid="admin-plan-new">
          {t("new")}
        </Button>
      </div>
      <p className="max-w-3xl text-muted-foreground">{t("intro")}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("visibility")}</TableHead>
            <TableHead>{t("priceColumn")}</TableHead>
            <TableHead className="text-right">{t("orgs")}</TableHead>
            {COLUMNS.map((key) => (
              <TableHead key={key} className="text-right">
                {limitName(key)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.data.plans.map((p) => {
            const e = p.entitlements as Record<string, unknown>;
            return (
              <TableRow key={p.id} data-testid="admin-plan-row" data-plan={p.id}>
                <TableCell>
                  <Link href={`/admin/plans/${encodeURIComponent(p.id)}`} className="text-link hover:underline">
                    {p.name}
                  </Link>
                  <span className="ml-2 text-muted-foreground">{p.id}</span>
                  {p.defaultPlan && (
                    <Badge variant="outline" className="ml-2" data-testid="admin-plan-default">
                      {t("default")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{p.public ? t("public") : t("hidden")}</TableCell>
                <TableCell>{price(p)}</TableCell>
                <TableCell className="text-right tabular-nums">{format.number(p.orgCount)}</TableCell>
                {COLUMNS.map((key) => (
                  <TableCell key={key} className="text-right tabular-nums">
                    {typeof e[key] === "number" ? format.number(e[key] as number) : t("unlimited")}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

interface Draft {
  id: string;
  name: string;
  description: string;
  position: string;
  public: boolean;
  defaultPlan: boolean;
  price: string;
  period: "month" | "year";
  entitlements: EntitlementDraft;
}

function startDraft(keys: EntitlementKey[], plan: AdminPlan | undefined, position: number): Draft {
  return {
    id: plan?.id ?? "",
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    position: String(plan?.position ?? position),
    public: plan?.public ?? false,
    defaultPlan: plan?.defaultPlan ?? false,
    price: plan?.price ? String(plan.price.amount) : "",
    period: plan?.price?.period ?? "month",
    entitlements: draftEntitlements(keys, (plan?.entitlements ?? {}) as Record<string, unknown>),
  };
}

/** S36 plan editor (P57): everything a plan holds; `planId` null makes a new plan. */
export function AdminPlanEditor({ planId }: { planId: string | null }) {
  const t = useTranslations("admin.plans");
  const plans = useAdminPlans();
  if (plans.isError) return <InlineError error={plans.error} onRetry={() => plans.refetch()} />;
  if (!plans.data) return <LoadingLines />;
  const plan = planId === null ? undefined : plans.data.plans.find((p) => p.id === planId);
  if (planId !== null && !plan) return <p className="text-muted-foreground">{t("missing")}</p>;
  const next = Math.max(0, ...plans.data.plans.map((p) => p.position)) + 10;
  return <Editor key={plan?.updatedAt ?? "new"} plan={plan} keys={plans.data.entitlementKeys} currency={plans.data.currency} position={next} />;
}

function Editor({ plan, keys, currency, position }: { plan: AdminPlan | undefined; keys: EntitlementKey[]; currency: string; position: number }) {
  const t = useTranslations("admin.plans");
  const limitName = useLimitName();
  const router = useRouter();
  const create = useAdminCreatePlan();
  const update = useAdminUpdatePlan(plan?.id ?? "");
  const remove = useAdminDeletePlan(plan?.id ?? "");
  const [draft, setDraft] = useState(() => startDraft(keys, plan, position));
  const set = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }));
  const setEntitlement = (key: string, value: EntitlementDraft[string]) => setDraft((d) => ({ ...d, entitlements: { ...d.entitlements, [key]: value } }));

  const entitlements = useMemo(() => savedEntitlements(draft.entitlements), [draft.entitlements]);
  const amount = parsePrice(draft.price);
  const positionValue = /^\d{1,5}$/.test(draft.position.trim()) ? Number(draft.position.trim()) : undefined;
  const idValid = plan !== undefined || (/^[a-z0-9][a-z0-9-]{0,62}$/.test(draft.id) && draft.id !== "new");
  const valid = idValid && draft.name.trim() !== "" && entitlements !== undefined && amount !== undefined && positionValue !== undefined && positionValue <= 10_000;
  // Asked once typing pauses, not on every keystroke.
  const [asked, setAsked] = useState(entitlements);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(entitlements), 400);
    return () => clearTimeout(timer);
  }, [entitlements]);
  const impact = useAdminPlanImpact(plan && asked ? plan.id : null, asked ?? {});

  const body = () => ({
    name: draft.name.trim(),
    description: draft.description.trim(),
    public: draft.public,
    defaultPlan: draft.defaultPlan,
    position: positionValue!,
    ...(amount !== null && amount !== undefined ? { price: { amount, period: draft.period } } : {}),
    entitlements: entitlements!,
  });

  return (
    <div className="flex max-w-4xl flex-col gap-8" data-testid="admin-plan-editor">
      <div className="flex flex-col gap-2">
        <Link href="/admin/plans" className="text-link hover:underline">
          {t("back")}
        </Link>
        <h1 className="text-title">{plan ? plan.name : t("new")}</h1>
        {plan && <p className="text-muted-foreground">{t("orgsOn", { n: plan.orgCount })}</p>}
      </div>

      <section className="grid max-w-2xl gap-4">
        {!plan && (
          <Field id="plan-id" label={t("id")} hint={t("idHint")}>
            <Input id="plan-id" value={draft.id} maxLength={63} onChange={(e) => set({ id: e.target.value.toLowerCase() })} data-testid="plan-id" />
          </Field>
        )}
        <Field id="plan-name" label={t("name")}>
          <Input id="plan-name" value={draft.name} maxLength={LIMITS.name} onChange={(e) => set({ name: e.target.value })} data-testid="plan-name" />
        </Field>
        <Field id="plan-description" label={t("description")} hint={t("descriptionHint")}>
          <Input id="plan-description" value={draft.description} maxLength={LIMITS.text} onChange={(e) => set({ description: e.target.value })} data-testid="plan-description" />
        </Field>
        <div className="grid grid-cols-[1fr_10rem] gap-4">
          <Field id="plan-price" label={t("priceField", { currency })} hint={t("priceHint")} error={amount === undefined ? t("priceInvalid") : undefined}>
            <Input id="plan-price" inputMode="decimal" value={draft.price} onChange={(e) => set({ price: e.target.value })} data-testid="plan-price" />
          </Field>
          <Field id="plan-period" label={t("period")}>
            <NativeSelect id="plan-period" value={draft.period} onChange={(e) => set({ period: e.target.value as Draft["period"] })} disabled={amount === null} data-testid="plan-period">
              <option value="month">{t("perMonth")}</option>
              <option value="year">{t("perYear")}</option>
            </NativeSelect>
          </Field>
        </div>
        <Field id="plan-position" label={t("position")} hint={t("positionHint")}>
          <Input id="plan-position" inputMode="numeric" className="w-32" value={draft.position} onChange={(e) => set({ position: e.target.value })} data-testid="plan-position" />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.public} onChange={(e) => set({ public: e.target.checked })} className="accent-[var(--link)]" data-testid="plan-public" />
          {t("publicField")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.defaultPlan}
            // The default plan can only be replaced, never unset (default_plan_required).
            disabled={plan?.defaultPlan}
            onChange={(e) => set({ defaultPlan: e.target.checked })}
            className="accent-[var(--link)]"
            data-testid="plan-default"
          />
          {t("defaultField")}
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="label-caps">{t("limits")}</h2>
        <p className="max-w-2xl text-muted-foreground">{t("limitsIntro")}</p>
        <div className="grid max-w-2xl gap-2">
          {keys.map(({ key }) => {
            const entry = draft.entitlements[key]!;
            return (
              <div key={key} className="grid grid-cols-[1fr_8rem_9rem] items-center gap-3" data-testid={`plan-entitlement-${key}`}>
                <span>{limitName(key)}</span>
                {typeof entry === "boolean" ? (
                  <label className="col-span-2 flex items-center gap-2">
                    <input type="checkbox" checked={entry} onChange={(e) => setEntitlement(key, e.target.checked)} className="accent-[var(--link)]" data-testid={`plan-feature-${key}`} />
                    {t("included")}
                  </label>
                ) : (
                  <>
                    <Input
                      aria-label={limitName(key)}
                      inputMode="numeric"
                      value={entry.unlimited ? "" : entry.value}
                      disabled={entry.unlimited}
                      aria-invalid={!entry.unlimited && !/^\d{1,15}$/.test(entry.value.trim())}
                      onChange={(e) => setEntitlement(key, { unlimited: false, value: e.target.value })}
                      data-testid={`plan-limit-${key}`}
                    />
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={entry.unlimited}
                        onChange={(e) => setEntitlement(key, { unlimited: e.target.checked, value: entry.value })}
                        className="accent-[var(--link)]"
                        data-testid={`plan-unlimited-${key}`}
                      />
                      {t("unlimited")}
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {plan && (
        <section className="flex flex-col gap-2" data-testid="plan-impact">
          <h2 className="label-caps">{t("impact")}</h2>
          {impact.data && Object.keys(impact.data.affected).length === 0 && <p className="text-muted-foreground">{t("impactNone", { n: impact.data.orgs })}</p>}
          {impact.data && Object.keys(impact.data.affected).length > 0 && (
            <ul className="flex flex-col gap-1" role="status">
              {Object.entries(impact.data.affected).map(([key, n]) => (
                <li key={key} data-testid="plan-impact-line" data-key={key}>
                  {t(keys.find((k) => k.key === key)?.type === "boolean" ? "impactFeature" : "impactOver", { n, limit: limitName(key) })}
                </li>
              ))}
            </ul>
          )}
          <p className="max-w-2xl text-muted-foreground">{t("impactRule")}</p>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <ReasonDialog
          testId="plan-save"
          trigger={<Button disabled={!valid} data-testid="plan-save">{plan ? t("save") : t("create")}</Button>}
          title={plan ? t("saveTitle", { name: plan.name }) : t("create")}
          body={plan ? t("saveBody", { n: plan.orgCount }) : undefined}
          submit={plan ? t("save") : t("create")}
          canSubmit={valid}
          onSubmit={async (reason) => {
            if (plan) await update.mutateAsync({ ...body(), reason });
            else {
              const created = await create.mutateAsync({ id: draft.id, ...body(), reason });
              router.replace(`/admin/plans/${encodeURIComponent(created.id)}`);
            }
            toast.success(t("saved"));
          }}
        />
        {plan && !plan.defaultPlan && plan.orgCount === 0 && (
          <ReasonDialog
            testId="plan-delete"
            destructive
            trigger={<Button variant="destructive" data-testid="plan-delete">{t("delete")}</Button>}
            title={t("deleteTitle", { name: plan.name })}
            body={t("deleteBody")}
            submit={t("delete")}
            onSubmit={async (reason) => {
              await remove.mutateAsync(reason);
              toast.success(t("deleted"));
              router.replace("/admin/plans");
            }}
          />
        )}
      </div>
    </div>
  );
}
