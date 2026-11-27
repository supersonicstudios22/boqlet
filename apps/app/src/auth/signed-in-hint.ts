/**
 * A hint, readable by the server, that this browser was signed in when it last asked. The session cookie
 * itself is scoped to `/api/v1` (httpOnly), so a page request to `/` can't see it; with this hint the
 * landing page sends a signed-in visitor straight to the app (`APP_HOME`) with nothing drawn first.
 *
 * It is not a credential and proves nothing: the app checks the real session as always. A stale hint (the
 * session ended while the browser was closed) leads to the app, which finds no session, clears the hint
 * and asks for a sign-in.
 */
export const SIGNED_IN_HINT = "boqlet-signed-in";

/** 30 days, longer than any session: a hint that outlives its session is cleared on the next visit. */
const MAX_AGE_S = 30 * 24 * 60 * 60;

export function setSignedInHint(signedIn: boolean) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = signedIn
    ? `${SIGNED_IN_HINT}=1; Path=/; Max-Age=${MAX_AGE_S}; SameSite=Lax${secure}`
    : `${SIGNED_IN_HINT}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
