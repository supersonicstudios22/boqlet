"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAdminSettings, useAdminUpdateSettings, type PlatformSettings } from "@/api/hooks/admin";
import { InlineError } from "@/components/errors/inline-error";
import { Field } from "@/components/field";
import { LoadingLines } from "@/components/loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReasonDialog } from "./reason-dialog";

/** S36 platform settings (F19 §9, P57): the currency of every plan price, and whether public sign-up is open. */
export function AdminSettingsView() {
  const settings = useAdminSettings();
  if (settings.isError) return <InlineError error={settings.error} onRetry={() => settings.refetch()} />;
  if (!settings.data) return <LoadingLines />;
  return <SettingsForm key={`${settings.data.currency}:${settings.data.publicSignUp}`} saved={settings.data} />;
}

function SettingsForm({ saved }: { saved: PlatformSettings }) {
  const t = useTranslations("admin.settings");
  const update = useAdminUpdateSettings();
  const [currency, setCurrency] = useState(saved.currency);
  const [open, setOpen] = useState(saved.publicSignUp);
  const validCurrency = /^[A-Z]{3}$/.test(currency);
  const changed = currency !== saved.currency || open !== saved.publicSignUp;
  return (
    <div className="flex max-w-2xl flex-col gap-6" data-testid="admin-settings">
      <h1 className="text-title">{t("title")}</h1>
      <Field id="platform-currency" label={t("currency")} hint={t("currencyHint")} error={validCurrency ? undefined : t("currencyInvalid")}>
        <Input
          id="platform-currency"
          className="w-28 uppercase"
          maxLength={3}
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          data-testid="platform-currency"
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="accent-[var(--link)]" data-testid="platform-public-sign-up" />
          {t("publicSignUp")}
        </label>
        <p className="text-muted-foreground">{t(open ? "publicSignUpOn" : "publicSignUpOff")}</p>
      </div>
      <ReasonDialog
        testId="platform-settings-save"
        trigger={
          <Button className="self-start" disabled={!changed || !validCurrency} data-testid="platform-settings-save">
            {t("save")}
          </Button>
        }
        title={t("save")}
        body={open !== saved.publicSignUp ? t(open ? "openingBody" : "closingBody") : undefined}
        submit={t("save")}
        canSubmit={changed && validCurrency}
        onSubmit={async (reason) => {
          await update.mutateAsync({ currency, publicSignUp: open, reason });
          toast.success(t("saved"));
        }}
      />
    </div>
  );
}
