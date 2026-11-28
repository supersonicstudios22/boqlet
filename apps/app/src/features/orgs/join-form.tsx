"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useAuth } from "@/auth";
import { MIN_PASSWORD, passwordLength } from "@/auth/password-rule";
import { useHydrated } from "@/components/hydration";
import { useErrorMessage } from "@/components/errors/use-error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LIMITS } from "@/lib/limits";

/**
 * Joining from an invitation in one screen (review C-31): an address without an account gives a name
 * and a password, and the account is made, signed in and joined at once; then the org's page.
 */
export function JoinForm({ token, onSignIn }: { token: string; onSignIn: () => void }) {
  const t = useTranslations("orgs.invite");
  const ta = useTranslations("auth.native");
  const te = useTranslations("errors");
  const message = useErrorMessage();
  const auth = useAuth();
  const hydrated = useHydrated();
  const [length, setLength] = useState(0);
  const [tooShort, setTooShort] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const count = passwordLength(password);
    if (count < MIN_PASSWORD) {
      setLength(count);
      setTooShort(true);
      return;
    }
    setBusy(true);
    setError("");
    const made = await auth.createAccountFromInvitation!(token, String(data.get("name") ?? ""), password);
    if (!made.ok) {
      const known = made.code ? `codes.${made.code}` : null;
      setError(known && te.has(known) ? te(known) : ta("retry"));
      setBusy(false);
      return;
    }
    try {
      await api.POST("/invitations/{token}/accept", { params: { path: { token } } });
      const me = (await api.GET("/me")).data!;
      // A new account belongs to this one org only.
      const slug = me.memberships[0]?.org.slug;
      // A full load, so the app starts with the new session (and its sign-in animation).
      window.location.assign(slug ? `/${slug}` : "/app");
    } catch (e) {
      // The account is made and signed in; joining failed (a seat limit, a withdrawn invitation): say why.
      setError(message(e));
      setBusy(false);
    }
  }

  return (
    <form method="post" noValidate onSubmit={submit} className="flex flex-col gap-4" data-testid="join-form">
      <p className="prose-text">{t("createIntro")}</p>
      <label className="grid gap-2">
        {ta("name")} <Input name="name" autoComplete="name" maxLength={LIMITS.personName} data-testid="join-name" />
      </label>
      <label className="grid gap-2">
        {ta("password")}
        <Input
          type="password"
          name="password"
          autoComplete="new-password"
          maxLength={256}
          aria-invalid={tooShort ? true : undefined}
          aria-describedby="join-password-rule"
          onChange={(e) => {
            const count = passwordLength(e.currentTarget.value);
            setLength(count);
            if (count >= MIN_PASSWORD) setTooShort(false);
          }}
          data-testid="join-password"
        />
      </label>
      <p id="join-password-rule" aria-live="polite" className={tooShort ? "text-error" : "text-muted-foreground"} data-testid="join-password-rule">
        {tooShort ? ta("passwordShort", { min: MIN_PASSWORD, count: length }) : ta("passwordCount", { min: MIN_PASSWORD, count: length })}
      </p>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={busy || !hydrated} data-testid="join-submit">
          {t("createAndJoin")}
        </Button>
        <button type="button" className="text-link hover:underline" onClick={onSignIn} data-testid="invite-sign-in">
          {t("haveAccount")}
        </button>
      </div>
    </form>
  );
}
