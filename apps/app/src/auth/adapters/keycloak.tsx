"use client";

/*
 * Rollback only (P50, review B-16): the legacy Keycloak sign-in, used only when NEXT_PUBLIC_AUTH_ADAPTER=keycloak.
 * The app signs in natively (`native.tsx`); this adapter stays until the owner confirms the OIDC path's removal.
 */

import Keycloak from "keycloak-js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Wordmark } from "@/components/shell/wordmark";
import { Button } from "@/components/ui/button";
import { safeReturnTo, type AuthAdapter, type Session } from "../AuthAdapter";

const LOGIN_HINT = "boqlet.keycloak.signed-in";
const LOADING: Session = { status: "loading" };
let state: Session = LOADING;
let client: Keycloak | undefined;
let initialisation: Promise<Keycloak | null> | undefined;
let sessionId: string | null = null;
const listeners = new Set<() => void>();

function publish(next: Session) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function clear() {
  sessionId = null;
  window.localStorage.removeItem(LOGIN_HINT);
  publish({ status: "anonymous" });
}

function initialise() {
  if (initialisation) return initialisation;
  initialisation = (async () => {
    const url = process.env.NEXT_PUBLIC_KEYCLOAK_URL;
    const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM;
    const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID;
    if (!url || !realm || !clientId) throw new Error("Keycloak configuration is incomplete.");
    const keycloak = new Keycloak({ url, realm, clientId });
    client = keycloak;
    keycloak.onAuthLogout = clear;
    const callback = new URLSearchParams(window.location.hash.slice(1)).has("state");
    const check = !callback && !window.location.pathname.startsWith("/sign-in")
      && !window.location.pathname.startsWith("/sign-up") && window.localStorage.getItem(LOGIN_HINT) === "1";
    const authenticated = await keycloak.init({
      ...(check ? { onLoad: "check-sso" as const } : {}),
      flow: "standard",
      responseMode: "fragment",
      pkceMethod: "S256",
      checkLoginIframe: false,
    });
    if (authenticated) {
      window.localStorage.setItem(LOGIN_HINT, "1");
      publish({ status: "authenticated", email: keycloak.idTokenParsed?.email, name: keycloak.idTokenParsed?.name });
    } else {
      clear();
    }
    return keycloak;
  })().catch(() => {
    clear();
    return null;
  });
  return initialisation;
}

function useKeycloakSession() {
  const session = useSyncExternalStore(subscribe, () => state, () => LOADING);
  useEffect(() => { void initialise(); }, []);
  return session;
}

function localSignIn(opts?: { returnTo?: string; email?: string; reason?: string }, registration = false) {
  const query = new URLSearchParams({ returnTo: safeReturnTo(opts?.returnTo) });
  if (opts?.email) query.set("email", opts.email);
  if (opts?.reason) query.set("reason", opts.reason);
  return `/${registration ? "sign-up" : "sign-in"}?${query}`;
}

export const keycloakAuthAdapter: AuthAdapter = {
  id: "keycloak",
  useSession: useKeycloakSession,
  async getAccessToken() {
    // Anonymous pages may fetch the API before the sign-in UI or application session mounts.
    if (!initialisation) return null;
    const keycloak = await initialisation;
    if (!keycloak?.authenticated) return null;
    try {
      await keycloak.updateToken(30);
      return keycloak.token ?? null;
    } catch {
      keycloak.clearToken();
      clear();
      return null;
    }
  },
  async signIn(opts) {
    sessionId = null;
    window.location.assign(localSignIn(opts));
  },
  async signUp(opts) {
    window.location.assign(localSignIn(opts, true));
  },
  async signOut(opts) {
    const target = new URL(localSignIn(opts), window.location.origin).href;
    const keycloak = client;
    clear();
    if (keycloak?.authenticated && !opts?.reason) {
      try {
        await keycloak.logout({ redirectUri: target });
        return;
      } catch {
        keycloak.clearToken();
      }
    }
    keycloak?.clearToken();
    window.location.assign(target);
  },
  appSession: () => sessionId === null ? null : { id: sessionId },
  bindAppSession(id) {
    sessionId = id;
    publish({ ...state });
  },
  SignInPage: KeycloakSignInPage,
  SignUpPage: KeycloakSignUpPage,
};

function KeycloakSignInPage() { return <KeycloakPage registration={false} />; }
function KeycloakSignUpPage() { return <KeycloakPage registration />; }

function KeycloakPage({ registration }: { registration: boolean }) {
  const t = useTranslations("auth.keycloak");
  const search = useSearchParams();
  const returnTo = safeReturnTo(search.get("returnTo"));
  const router = useRouter();
  const session = useKeycloakSession();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (session.status === "authenticated") router.replace(returnTo);
  }, [session.status, returnTo, router]);

  async function continueToProvider() {
    setPending(true);
    setFailed(false);
    try {
      const keycloak = await initialise();
      if (!keycloak) throw new Error("Keycloak is unavailable.");
      const options = {
        redirectUri: new URL(localSignIn({ returnTo }), window.location.origin).href,
        loginHint: search.get("email") ?? undefined,
      };
      if (registration) await keycloak.register(options);
      else await keycloak.login({ ...options, prompt: search.get("reason") ? "login" : undefined });
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-8 py-16">
      <Wordmark className="text-display-sm" />
      <h1 className="text-title">{t(registration ? "signUp" : "signIn")}</h1>
      <Button className="self-start" onClick={() => void continueToProvider()} disabled={pending || session.status !== "anonymous"}>
        {t("continue")}
      </Button>
      {failed && <p role="alert" className="text-error">{t("unavailable")}</p>}
    </main>
  );
}
