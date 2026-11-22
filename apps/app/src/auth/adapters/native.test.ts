// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/** TF-019: an API that doesn't answer while the session is restored is "unavailable", not a sign-out. */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function restoreWith(respond: (path: string) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => respond(String(url))));
  const { restoreSession } = await import("./native");
  return restoreSession();
}

describe("native session restore", () => {
  it("a 401 is signed out", async () => {
    expect((await restoreWith(() => new Response("{}", { status: 401 }))).status).toBe("anonymous");
  });
  it("no answer, or a 502/503 from the gateway, is unavailable, not signed out", async () => {
    expect((await restoreWith(() => Promise.reject(new TypeError("Failed to fetch")))).status).toBe("unavailable");
    vi.resetModules();
    expect((await restoreWith(() => new Response("Bad Gateway", { status: 502 }))).status).toBe("unavailable");
  });
  it("a session and /me restore it", async () => {
    const session = await restoreWith((url) =>
      url.endsWith("/sessions/current") ? Response.json({ id: "s1" }) : Response.json({ user: { name: "Ada", email: "ada@example.test" } }),
    );
    expect(session).toMatchObject({ status: "authenticated", email: "ada@example.test" });
  });
});
