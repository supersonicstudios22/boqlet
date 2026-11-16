import { createApiClient, type ApiClient } from "@ifc-boq/api";

/**
 * Where the suites run. `API_URL` is the API base (`http://localhost:4010/api/v1` for the mock,
 * the Java service in phase 2); the backend's root (for `/_test/*`) is derived from it.
 */
export const API_URL = (process.env.API_URL ?? "http://localhost:4010/api/v1").replace(/\/$/, "");
export const ROOT_URL = API_URL.replace(/\/api\/v1$/, "");
export const TARGET = process.env.SUITE_TARGET ?? "mock";

export async function authentication(token: string): Promise<Record<string, string>> {
  if (TARGET !== "java") return { Authorization: `Bearer ${token}` };
  const { testSessionCookie } = await import("./users");
  const cookie = testSessionCookie(token);
  return { Authorization: `Bearer ${token}`, ...(cookie ? { Cookie: cookie } : {}) };
}

/** A client as one user (or anonymous). The suites use only the generated client and HTTP. */
export function client(token?: string | null): ApiClient {
  return createApiClient({
    baseUrl: API_URL,
    getAccessToken: () => token ?? null,
    middleware: TARGET === "java" && token ? [{
      async onRequest({ request }) {
        const { Cookie } = await authentication(token);
        if (Cookie) request.headers.set("Cookie", Cookie);
        return request;
      },
    }] : [],
  });
}
