"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Schemas } from "@ifc-boq/api";
import { api } from "@/api/client";
import { isApiError } from "@/api/errors";
import { idempotencyHeaders } from "@/api/idempotency";
import { useErrorMessage } from "@/components/errors/use-error-message";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type OrgRole = Schemas["OrgRole"];
type Row = { email: string; role: OrgRole; error?: string; sent?: boolean };
/** The roles a new owner hands out here; making someone owner waits for Settings › Members. */
const ROLES: OrgRole[] = ["member", "admin", "library_editor"];
const blank = (): Row => ({ email: "", role: "member" });

/**
 * Onboarding's optional second step (FL-1 step 3, review C-30): invite colleagues by email and org
 * role, or skip. Shown only when the org's plan has more than one seat; at most the seats left.
 */
export function InviteStep({ orgId, seatsLeft, onDone }: { orgId: string; seatsLeft: number; onDone: () => void }) {
  const t = useTranslations("orgs.inviteStep");
  const roles = useTranslations("common.roles");
  const message = useErrorMessage();
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: Math.min(3, seatsLeft) }, blank));
  const [busy, setBusy] = useState(false);
  const update = (i: number, change: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...change, error: undefined } : r)));

  async function send() {
    setBusy(true);
    const next = [...rows];
    let failed = false;
    for (const [i, row] of next.entries()) {
      const email = row.email.trim();
      if (!email || row.sent) continue;
      try {
        await api.POST("/orgs/{orgId}/invitations", {
          params: { path: { orgId } },
          body: { email, role: row.role },
          headers: idempotencyHeaders(`inviteMember:${orgId}`, { email, role: row.role }),
        });
        next[i] = { ...row, sent: true };
      } catch (e) {
        failed = true;
        // A plan limit opens the limit dialog (F14); the row says why too, and nothing after it is sent.
        next[i] = { ...row, error: message(e) };
        if (isApiError(e) && e.status === 402) break;
      }
    }
    setRows(next);
    setBusy(false);
    if (!failed) onDone();
  }

  const any = rows.some((r) => r.email.trim() && !r.sent);
  return (
    <form
      className="flex max-w-xl flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (any) void send();
        else onDone();
      }}
      data-testid="invite-step"
    >
      <div className="flex flex-col gap-3">
        <p className="label-caps text-muted-foreground">{t("step")}</p>
        <h1 className="display text-display-sm">{t("title")}</h1>
        <p className="prose-text text-muted-foreground">{t("intro", { seats: seatsLeft })}</p>
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Input
                type="email"
                aria-label={t("email", { n: i + 1 })}
                placeholder={t("emailPlaceholder")}
                value={row.email}
                disabled={row.sent || busy}
                onChange={(e) => update(i, { email: e.target.value })}
                aria-invalid={row.error ? true : undefined}
                data-testid={`invite-step-email-${i}`}
              />
              <NativeSelect
                aria-label={t("role", { n: i + 1 })}
                value={row.role}
                disabled={row.sent || busy}
                onChange={(e) => update(i, { role: e.target.value as OrgRole })}
                data-testid={`invite-step-role-${i}`}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roles(r)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {row.sent && <p className="text-muted-foreground">{t("sent", { email: row.email.trim() })}</p>}
            {row.error && (
              <p role="alert" className="text-error">
                {row.error}
              </p>
            )}
          </div>
        ))}
        {rows.length < seatsLeft && (
          <div>
            <button type="button" className="text-link hover:underline" onClick={() => setRows((all) => [...all, blank()])} data-testid="invite-step-more">
              {t("more")}
            </button>
          </div>
        )}
      </div>
      <div className="flex gap-3">
        <Button type="submit" disabled={busy} data-testid="invite-step-send">
          {any ? t("send") : t("continue")}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onDone} data-testid="invite-step-skip">
          {t("skip")}
        </Button>
      </div>
    </form>
  );
}
