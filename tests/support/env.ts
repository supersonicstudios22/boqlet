import { createApiClient, type ApiClient } from "@ifc-boq/api";
import { checkResponse } from "./contract";
import { credentials, emailOf, isBrowser, isSignUpToken, newBrowser, opened201 } from "./java-sessions";
import { isLocal, localOrigin, localPassword } from "./local-stack.mjs";

/**
 * Where the suites run: `API_URL` is the Java API's base (`<root>/api/v1`); the backend's root
 * (for the test-only `/_test/*` routes) is derived from it. The suites run against a Java instance
 * that registers those routes: `NativeWorkerTest` (`services/api`), which sets `API_URL`; or, with
 * `BOQLET_TARGET=local`, against the local Docker stack (`npm run local:suites`, local-stack.mjs),
 * which has native sign-in only: requests carry the session cookie and the app's Origin, no bearer.
 */
export const API_URL = (process.env.API_URL ?? "http://localhost:8080/api/v1").replace(/\/$/, "");
export const ROOT_URL = API_URL.replace(/\/api\/v1$/, "");

/** Headers that authenticate a plain `fetch` as `token` (Java also needs the session's cookie). */
export async function authentication(token: string): Promise<Record<string, string>> {
  const { bearer, cookie } = await credentials(token);
  if (isLocal()) return { Origin: localOrigin(), ...(cookie ? { Cookie: cookie } : {}) };
  return { Authorization: `Bearer ${bearer}`, ...(cookie ? { Cookie: cookie } : {}) };
}

/**
 * Headers of a plain `fetch` without credentials, as a browser sends them: on the local stack the
 * app's Origin (its unsafe requests are refused without it before authentication); none in the harness.
 */
export const anonymous = (): Record<string, string> => (isLocal() ? { Origin: localOrigin() } : {});

/**
 * On the local stack, `POST /sessions` from a browser that has none is the app's sign-in:
 * `POST /auth/sign-in` with the person's email and password and the request's device label and takeover.
 */
async function asNativeSignIn(request: Request, token: string): Promise<Request> {
  const body = (await request.clone().json().catch(() => ({}))) as { deviceLabel?: string; takeover?: boolean };
  return new Request(`${API_URL}/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: localOrigin() },
    body: JSON.stringify({ email: emailOf(token), password: localPassword(), deviceLabel: body.deviceLabel ?? "Shared scenario suite", takeover: body.takeover ?? false }),
  });
}

/** The local stack checks the Origin of every unsafe request (NativeIdentityFilter): send the app's. */
const localOriginHeader: Middleware = {
  async onRequest({ request }) {
    if (!request.headers.has("Origin")) request.headers.set("Origin", localOrigin());
    return request;
  },
};

const signingIn = new WeakMap<Request, string>();
const isSignIn = (request: Request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/sessions");

type Middleware = NonNullable<Parameters<typeof createApiClient>[0]["middleware"]>[number];

/** Every response a suite client receives is checked against the contract (TF-078, support/contract.ts). */
const contractCheck: Middleware = {
  async onResponse({ request, response }) {
    await checkResponse(request, response);
    return response;
  },
};

/** A client as one user (or anonymous). The suites use only the generated client and HTTP. */
export function client(token?: string | null): ApiClient {
  return createApiClient({
    baseUrl: API_URL,
    // The local stack takes no bearer token (native sign-in): the session cookie is the credential.
    getAccessToken: () => (isLocal() ? null : token ?? null),
    middleware: [...(token ? [<Middleware>{
      async onRequest({ request }) {
        // A person's own token signing in is a new browser (java-sessions.ts).
        if (isSignIn(request) && isSignUpToken(token)) {
          const browser = newBrowser(token);
          if (isLocal()) {
            const signIn = await asNativeSignIn(request, token);
            signingIn.set(signIn, browser);
            return signIn;
          }
          request.headers.set("Authorization", `Bearer ${browser}`);
          request.headers.delete("Cookie");
          signingIn.set(request, browser);
          return request;
        }
        const { bearer, cookie } = await credentials(token);
        if (isLocal()) {
          request.headers.delete("Authorization");
          request.headers.set("Origin", localOrigin());
        } else {
          request.headers.set("Authorization", `Bearer ${bearer}`);
        }
        if (cookie) request.headers.set("Cookie", cookie);
        if (isSignIn(request) && isBrowser(token)) signingIn.set(request, token);
        return request;
      },
      async onResponse({ request, response }) {
        const browser = signingIn.get(request);
        if (browser && response.status === 201) {
          const session = (await response.clone().json()) as { id: string };
          opened201(browser, session.id, response.headers.get("set-cookie"));
        }
        return response;
      },
    }] : []), ...(isLocal() ? [localOriginHeader] : []), contractCheck],
  });
}
