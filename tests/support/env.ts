import { createApiClient, type ApiClient } from "@ifc-boq/api";
import { credentials, isBrowser, isSignUpToken, newBrowser, opened201 } from "./java-sessions";

/**
 * Where the suites run. `API_URL` is the API base (`http://localhost:4010/api/v1` for the mock,
 * the Java service in phase 2); the backend's root (for `/_test/*`) is derived from it.
 */
export const API_URL = (process.env.API_URL ?? "http://localhost:4010/api/v1").replace(/\/$/, "");
export const ROOT_URL = API_URL.replace(/\/api\/v1$/, "");
export const TARGET = process.env.SUITE_TARGET ?? "mock";

/** Headers that authenticate a plain `fetch` as `token` (Java also needs the session's cookie). */
export async function authentication(token: string): Promise<Record<string, string>> {
  if (TARGET !== "java") return { Authorization: `Bearer ${token}` };
  const { bearer, cookie } = await credentials(token);
  return { Authorization: `Bearer ${bearer}`, ...(cookie ? { Cookie: cookie } : {}) };
}

const signingIn = new WeakMap<Request, string>();
const isSignIn = (request: Request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/sessions");

/** A client as one user (or anonymous). The suites use only the generated client and HTTP. */
export function client(token?: string | null): ApiClient {
  return createApiClient({
    baseUrl: API_URL,
    getAccessToken: () => token ?? null,
    middleware: TARGET === "java" && token ? [{
      async onRequest({ request }) {
        // A person's own token signing in is a new browser (java-sessions.ts).
        if (isSignIn(request) && isSignUpToken(token)) {
          const browser = newBrowser(token);
          request.headers.set("Authorization", `Bearer ${browser}`);
          request.headers.delete("Cookie");
          signingIn.set(request, browser);
          return request;
        }
        const { bearer, cookie } = await credentials(token);
        request.headers.set("Authorization", `Bearer ${bearer}`);
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
    }] : [],
  });
}
