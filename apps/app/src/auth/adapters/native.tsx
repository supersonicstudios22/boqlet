"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Wordmark } from "@/components/shell/wordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_BASE_URL } from "@/config";
import { safeReturnTo, type AuthAdapter, type Session } from "../AuthAdapter";
import { LIMITS } from "@/lib/limits";
import { useHydrated } from "@/components/hydration";
import { useRelativeTime } from "@/i18n/use-relative-time";

const LOADING: Session = { status: "loading" };
const ANONYMOUS: Session = { status: "anonymous" };
const UNAVAILABLE: Session = { status: "unavailable" };
/** Asked again this long after the API couldn't be reached. */
const RETRY_MS = 5000;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** The API didn't answer (no answer, or a 5xx gateway or server error): not a signed-out session. */
class Unavailable extends Error {}
let state = LOADING;
let sessionId: string | null = null;
let restoring: Promise<void> | undefined;
const listeners = new Set<() => void>();

function publish(next: Session) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function request(path: string, init?: RequestInit) {
  return fetch(`${API_BASE_URL}${path}`, { ...init, credentials: "same-origin", cache: "no-store" });
}

function authPost(path: string, body: object) {
  return request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/**
 * Restores the session: a 4xx means signed out; no answer or a 5xx means the API is away (a restart, a
 * deploy), which must not sign anyone out: "unavailable", asked again shortly (TF-019).
 */
function restore() {
  restoring ??= (async () => {
    const session = await request("/sessions/current").catch(() => null);
    if (!session || session.status >= 500) throw new Unavailable();
    if (!session.ok) return publish(ANONYMOUS);
    const me = await request("/me").catch(() => null);
    if (!me || me.status >= 500) throw new Unavailable();
    if (!me.ok) return publish(ANONYMOUS);
    const { user } = await me.json() as { user: { name: string; email: string } };
    sessionId = (await session.json() as { id: string }).id;
    publish({ status: "authenticated", email: user.email, name: user.name });
  })().catch((e) => {
    if (!(e instanceof Unavailable)) return publish(ANONYMOUS);
    publish(UNAVAILABLE);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(retrySession, RETRY_MS);
  });
  return restoring;
}

/** For tests: restore once and read the session. */
export const restoreSession = () => restore().then(() => state);

function retrySession() {
  clearTimeout(retryTimer);
  restoring = undefined;
  publish(LOADING);
  void restore();
}

function useNativeSession() {
  const current = useSyncExternalStore(subscribe, () => state, () => LOADING);
  useEffect(() => { void restore(); }, []);
  return current;
}

type SignInOptions = { returnTo?: string; email?: string; reason?: string };

function localAuthUrl(opts?: SignInOptions, setup = false) {
  const query = new URLSearchParams({ returnTo: safeReturnTo(opts?.returnTo) });
  if (opts?.email) query.set("email", opts.email);
  if (opts?.reason) query.set("reason", opts.reason);
  return `/${setup ? "sign-up" : "sign-in"}?${query}`;
}

export const nativeAuthAdapter: AuthAdapter = {
  id: "native",
  useSession: useNativeSession,
  async getAccessToken() { return null; },
  async signIn(opts) { window.location.assign(localAuthUrl(opts)); },
  async signUp(opts) { window.location.assign(localAuthUrl(opts, true)); },
  async signOut(opts) {
    try {
      if (!opts?.reason) await request("/sessions/current", { method: "DELETE" });
    } finally {
      window.location.assign(localAuthUrl(opts));
    }
  },
  appSession: () => sessionId === null ? null : { id: sessionId },
  bindAppSession(id) { sessionId = id; },
  retrySession,
  SignInPage: NativeSignIn,
  SignUpPage: NativeSetup,
};

function NativeSignIn() { return <NativeForm setup={false} />; }
function NativeSetup() { return <NativeForm setup />; }

function NativeForm({ setup }: { setup: boolean }) {
  const t = useTranslations("auth.native");
  const te = useTranslations("errors");
  const query = useSearchParams();
  const returnTo = safeReturnTo(query.get("returnTo"));
  const email = query.get("email") ?? "";
  const invite = /^\/invite\/([A-Za-z0-9_-]{43})\/?$/.exec(returnTo)?.[1];
  const token = query.get("token") ?? invite;
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  // The session open elsewhere (409 session_active): where and when, as S31 says it (TF-113).
  const [active, setActive] = useState<{ deviceLabel: string; place?: string; lastSeenAt: string } | null>(null);
  const ts = useTranslations("auth.session");
  const relative = useRelativeTime();
  const [error, setError] = useState("");
  const session = useNativeSession();
  // Until React runs the form, its submit would be a native GET with the password in the URL (TF-188).
  const hydrated = useHydrated();
  useEffect(() => {
    if (!setup && session.status === "authenticated") window.location.replace(returnTo);
  }, [returnTo, session.status, setup]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = setup
        ? await authPost("/auth/set-password", { token, password: data.get("password"), name: data.get("name") })
        : await authPost("/auth/sign-in", {
            email: data.get("email"), password: data.get("password"), takeover: conflict, deviceLabel: "Web browser",
          });
      if (response.ok) {
        window.location.replace(setup ? localAuthUrl({ returnTo, email }) : returnTo);
        return;
      }
      const failure = await response.json().catch(() => ({})) as { code?: string; message?: string; activeSession?: { deviceLabel: string; place?: string; lastSeenAt: string } };
      setConflict(failure.code === "session_active");
      if (failure.code === "session_active" && failure.activeSession) {
        setActive(failure.activeSession);
        return;
      }
      // By code from the catalogue (api-conventions.md, TF-077); the server's English only as a last resort.
      const known = failure.code ? `codes.${failure.code}` : null;
      setError(failure.code === "unauthenticated" ? t("invalidLogin") : known && te.has(known) ? te(known) : (failure.message ?? t("retry")));
    } catch {
      setError(t("unavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-8 py-16">
      <Wordmark className="text-display-sm" />
      <h1 className="text-title">{t(setup ? "setPassword" : "signIn")}</h1>
      {/* Why one was signed out (`?reason=`) is shown above the form by the sign-in page. */}
      {setup && !token ? <p>{t("setupLink")}</p> : (
        <form method="post" onSubmit={submit} onChange={() => {
          setConflict(false);
          setActive(null);
        }} className="flex flex-col gap-4">
          {setup ? (
            <label className="grid gap-2">{t("name")} <Input name="name" autoComplete="name" maxLength={LIMITS.personName} /></label>
          ) : (
            <label className="grid gap-2">{t("email")} <Input type="email" name="email" autoComplete="username" defaultValue={email} required /></label>
          )}
          <label className="grid gap-2">
            {t("password")}
            <Input type="password" name="password" autoComplete={setup ? "new-password" : "current-password"}
              minLength={setup ? 15 : undefined} maxLength={256} required />
          </label>
          {setup && <p className="text-muted-foreground">{t("passwordLength")}</p>}
          {error && <p role="alert" className="text-error">{error}</p>}
          {conflict && active && (
            <div role="alert" className="flex flex-col gap-2 border-l-2 border-[var(--status-attention)] pl-3" data-testid="takeover-question">
              <p>
                {active.place
                  ? ts("openElsewherePlace", { device: active.deviceLabel, place: active.place, when: relative(active.lastSeenAt) })
                  : ts("openElsewhere", { device: active.deviceLabel, when: relative(active.lastSeenAt) })}
              </p>
              <p className="text-muted-foreground">{ts("explain")}</p>
            </div>
          )}
          <div className="flex gap-3">
            <Button type="submit" className="self-start" disabled={busy || !hydrated} data-testid="auth-submit">
              {t(setup ? "setPassword" : conflict ? "takeover" : "signIn")}
            </Button>
            {conflict && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConflict(false);
                  setActive(null);
                }}
                data-testid="takeover-cancel"
              >
                {ts("cancel")}
              </Button>
            )}
          </div>
        </form>
      )}
      {!setup && invite && <Link className="text-link hover:underline" href={localAuthUrl({ returnTo, email }, true)}>{t("invited")}</Link>}
      {setup && <Link className="text-link hover:underline" href={localAuthUrl({ returnTo, email })}>{t("back")}</Link>}
    </main>
  );
}
