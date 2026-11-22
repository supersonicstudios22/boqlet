"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Wordmark } from "@/components/shell/wordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_BASE_URL } from "@/config";
import { useHydrated } from "@/components/hydration";

/**
 * Public sign-up and self-service password reset (P57): the person asks for a link by email, and
 * the link opens the set-password form. The answer is the same whether or not the address has an
 * account, so the page says "if".
 */

function post(path: string, body: object) {
  return fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Whether public sign-up is open (`GET /auth/sign-up`); null while asking, false when it can't be read. */
export function useSignUpOpen(): boolean | null {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${API_BASE_URL}/auth/sign-up`, { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { open: boolean }).open : false))
      .catch(() => false)
      .then((value) => live && setOpen(value));
    return () => {
      live = false;
    };
  }, []);
  return open;
}

/** The link on the sign-in page to the sign-up form, shown only while sign-up is open. */
export function SignUpLink({ returnTo }: { returnTo: string }) {
  const t = useTranslations("auth.native");
  const open = useSignUpOpen();
  if (!open) return null;
  return (
    <Link className="text-link hover:underline" href={`/sign-up?${new URLSearchParams({ returnTo })}`} data-testid="sign-up-link">
      {t("noAccount")}
    </Link>
  );
}

/** S01 without a link: the public sign-up form, or how accounts are made while sign-up is closed. */
export function SignUpRequest() {
  const t = useTranslations("auth.native");
  const open = useSignUpOpen();
  if (open === null) return <main className="min-h-dvh" aria-busy="true" />;
  if (!open)
    return (
      <Frame title={t("setPassword")}>
        <p>{t("setupLink")}</p>
        <BackToSignIn />
      </Frame>
    );
  return <LinkRequest kind="sign-up" />;
}

/** `/reset-password`: ask for a reset link. */
export function ResetRequest() {
  return <LinkRequest kind="reset" />;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-8 py-16">
      <Wordmark className="text-display-sm" />
      <h1 className="text-title">{title}</h1>
      {children}
    </main>
  );
}

function BackToSignIn({ label = "back" }: { label?: "back" | "haveAccount" }) {
  const t = useTranslations("auth.native");
  const returnTo = useSearchParams().get("returnTo");
  const search = returnTo ? new URLSearchParams({ returnTo }).toString() : "";
  return (
    <Link className="text-link hover:underline" href={`/sign-in${search ? `?${search}` : ""}`} data-testid="back-to-sign-in">
      {t(label)}
    </Link>
  );
}

function LinkRequest({ kind }: { kind: "sign-up" | "reset" }) {
  const t = useTranslations("auth.native");
  const te = useTranslations("errors");
  const locale = useLocale();
  const hydrated = useHydrated();
  const query = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  // When the form opened: a form sent within seconds is a bot's (basic bot protection, P57).
  const opened = useRef(0);
  useEffect(() => {
    opened.current = Date.now();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    try {
      const response =
        kind === "sign-up"
          ? await post("/auth/sign-up", { email, locale, website: String(data.get("website") ?? ""), elapsedMs: Math.max(0, Date.now() - opened.current) })
          : await post("/auth/password-reset", { email });
      if (response.ok) {
        setSent(email);
        return;
      }
      const failure = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
      const known = failure.code ? `codes.${failure.code}` : null;
      setError(known && te.has(known) ? te(known) : (failure.message ?? t("retry")));
    } catch {
      setError(t("unavailable"));
    } finally {
      setBusy(false);
    }
  }

  const title = t(kind === "sign-up" ? "createAccount" : "resetTitle");
  if (sent !== null)
    return (
      <Frame title={t("checkEmail")}>
        <p role="status" data-testid="link-sent">
          {t(kind === "sign-up" ? "signUpSent" : "resetSent", { email: sent })}
        </p>
        <BackToSignIn />
      </Frame>
    );
  return (
    <Frame title={title}>
      <p className="text-muted-foreground">{t(kind === "sign-up" ? "createAccountIntro" : "resetIntro")}</p>
      <form method="post" onSubmit={submit} className="relative flex flex-col gap-4" data-testid={`${kind}-form`}>
        <label className="grid gap-2">
          {t("email")} <Input type="email" name="email" autoComplete="email" defaultValue={query.get("email") ?? ""} maxLength={254} required />
        </label>
        {kind === "sign-up" && (
          // The honeypot: people don't see or reach it; a bot that fills every field gives itself away.
          <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
            {t("website")} <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        )}
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <Button type="submit" className="self-start" disabled={busy || !hydrated} data-testid="link-submit">
          {t("sendLink")}
        </Button>
      </form>
      <BackToSignIn label={kind === "sign-up" ? "haveAccount" : "back"} />
    </Frame>
  );
}
