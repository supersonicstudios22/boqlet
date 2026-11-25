import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, cspHeaderName, cspMode, newNonce, storageOrigins } from "./csp";
import { limiter, maskUrl, reportsIn, summary } from "./csp-report";

/** Review A-38 (FM-73): the Content-Security-Policy the proxy sends, and the violation reports it asks for. */
const directives = (policy: string) => Object.fromEntries(policy.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));

describe("Content-Security-Policy", () => {
  it("scripts only with the nonce, no eval in production, never framed, reports to /csp-report", () => {
    const d = directives(contentSecurityPolicy({ nonce: "abc", dev: false, storage: ["https://files.example.test"] }));
    expect(d["script-src"]).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["connect-src"]).toEqual(["'self'", "https://files.example.test"]);
    expect(d["img-src"]).toEqual(["'self'", "data:", "blob:", "https://files.example.test"]);
    expect(d["worker-src"]).toEqual(["'self'", "blob:"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["report-uri"]).toEqual(["/csp-report"]);
    expect(Object.values(d).flat()).not.toContain("'unsafe-eval'");
  });

  it("`next dev` adds eval for React's error stacks", () => {
    expect(directives(contentSecurityPolicy({ nonce: "n", dev: true, storage: [] }))["script-src"]).toContain("'unsafe-eval'");
  });

  it("reports only in a production build until told to enforce; development enforces", () => {
    expect(cspMode({ NODE_ENV: "production" })).toBe("report-only");
    expect(cspMode({ NODE_ENV: "production", BOQLET_CSP: "enforce" })).toBe("enforce");
    expect(cspMode({ NODE_ENV: "development" })).toBe("enforce");
    expect(cspMode({ NODE_ENV: "development", BOQLET_CSP: "off" })).toBe("off");
    expect(cspMode({ NODE_ENV: "production", BOQLET_CSP: "nonsense" })).toBe("report-only");
    expect(cspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
  });

  it("the storage origins come from BOQLET_STORAGE_ORIGIN, as origins only", () => {
    expect(storageOrigins({ BOQLET_STORAGE_ORIGIN: "https://files.example.test/bucket, http://localhost:8333" })).toEqual(["https://files.example.test", "http://localhost:8333"]);
    expect(storageOrigins({ BOQLET_STORAGE_ORIGIN: "javascript:alert(1) not-a-url", NODE_ENV: "production" })).toEqual(["https:"]);
    expect(storageOrigins({ NODE_ENV: "development" })).toEqual(["http://localhost:*", "http://127.0.0.1:*"]);
  });

  it("a nonce is new every time and long enough", () => {
    const a = newNonce();
    expect(a).not.toBe(newNonce());
    expect(atob(a)).toHaveLength(16);
  });
});

describe("violation reports", () => {
  it("reads both report formats and masks bearer tokens", () => {
    const legacy = { "csp-report": { "document-uri": "https://app.example.test/s/SECRETTOKEN?x=1", "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example/x.js" } };
    const modern = [{ type: "csp-violation", body: { documentURL: "https://app.example.test/invite/TOKEN2", effectiveDirective: "connect-src", blockedURL: "https://files.example.test/b/k?X-Amz-Signature=s", disposition: "report" } }, { type: "deprecation", body: {} }];
    const [a] = reportsIn(legacy).map(summary);
    expect(a).toMatchObject({ directive: "script-src-elem", page: "https://app.example.test/s/***", blocked: "https://evil.example/x.js" });
    const got = reportsIn(modern).map(summary);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ directive: "connect-src", page: "https://app.example.test/invite/***", blocked: "https://files.example.test/b/k", disposition: "report" });
    expect(maskUrl("inline")).toBe("inline");
    expect(reportsIn("nonsense")).toEqual([]);
  });

  it("logs at most so many a minute", () => {
    let now = 0;
    const allow = limiter(2, () => now);
    expect([allow(), allow(), allow()]).toEqual([true, true, false]);
    now = 61_000;
    expect(allow()).toBe(true);
  });
});
