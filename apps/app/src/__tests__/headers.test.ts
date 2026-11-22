import { describe, expect, it } from "vitest";
import config from "../../next.config";

/** TF-046 (security.md "Web security"): the app's response headers. */
type Rule = { source: string; headers: { key: string; value: string }[] };
const headersFor = async (path: string) => {
  const rules = (await config.headers!()) as Rule[];
  const out: Record<string, string> = {};
  for (const rule of rules) {
    const prefix = rule.source.replace(/\/:[a-z]+\*$/, "");
    if (rule.source === "/:path*" || path === prefix || path.startsWith(`${prefix}/`)) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
};

describe("app headers", () => {
  it("every page: nosniff, never framed, no X-Powered-By", async () => {
    const h = await headersFor("/acme/projects");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(config.poweredByHeader).toBe(false);
  });
  it("bearer links: invitations and share links are not indexed and send no referrer", async () => {
    for (const path of ["/invite/abc", "/s/abc"]) {
      const h = await headersFor(path);
      expect(h["Referrer-Policy"], path).toBe("no-referrer");
      expect(h["X-Robots-Tag"], path).toBe("noindex, nofollow");
    }
    expect((await headersFor("/sign-up"))["Referrer-Policy"]).toBe("no-referrer");
  });
});
