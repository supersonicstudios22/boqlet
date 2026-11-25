/**
 * The app's Content-Security-Policy (security.md "Web security", review A-38). `proxy.ts` sends it on every page
 * with a fresh nonce; Next puts the nonce on its own scripts (it reads it from the request's policy header) and
 * the root layout gives it to the theme script. Scripts run only with the nonce ('strict-dynamic': what they load
 * may load more); styles may be inline (React writes `style` attributes); the browser talks to the app's own
 * origin (the API is under `/api/v1` on it) and to the object storage that signed URLs point at.
 *
 * Modes (`BOQLET_CSP`): `enforce`, `report-only` (violations are reported to `/csp-report`, nothing is blocked) or
 * `off`. A production build reports only until the pilot has run one deploy without reports; development
 * (`next dev`, the browser smoke) enforces.
 */

export type CspMode = "enforce" | "report-only" | "off";

/** Where browsers send violation reports (`app/csp-report/route.ts`). */
export const CSP_REPORT_PATH = "/csp-report";
/** The request header the proxy passes the nonce in (read by the root layout). */
export const NONCE_HEADER = "x-nonce";

type Env = Record<string, string | undefined>;

export function cspMode(env: Env = process.env): CspMode {
  const value = env.BOQLET_CSP?.trim();
  if (value === "enforce" || value === "report-only" || value === "off") return value;
  return env.NODE_ENV === "production" ? "report-only" : "enforce";
}

export function cspHeaderName(mode: Exclude<CspMode, "off">): string {
  return mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

/**
 * Origins of the object storage the browser uploads to and downloads from (signed URLs: model uploads, the
 * viewer's geometry, Excel files). `BOQLET_STORAGE_ORIGIN`: one or more origins, separated by spaces or commas
 * (the API's `BOQLET_S3_PUBLIC_ENDPOINT`). Unset: any https origin in production, localhost in development.
 */
export function storageOrigins(env: Env = process.env): string[] {
  const listed = (env.BOQLET_STORAGE_ORIGIN ?? "").split(/[\s,]+/).filter(Boolean);
  const origins = listed.flatMap((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? [url.origin] : [];
    } catch {
      return [];
    }
  });
  if (origins.length) return origins;
  return env.NODE_ENV === "production" ? ["https:"] : ["http://localhost:*", "http://127.0.0.1:*"];
}

export function contentSecurityPolicy({ nonce, dev, storage }: { nonce: string; dev: boolean; storage: string[] }): string {
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    // 'unsafe-eval' only for `next dev` (React rebuilds server error stacks with eval); never in production.
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:", ...storage],
    ["font-src", "'self'", "data:"],
    ["connect-src", "'self'", ...storage],
    ["worker-src", "'self'", "blob:"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["report-uri", CSP_REPORT_PATH],
  ];
  return directives.map((d) => d.join(" ")).join("; ");
}

/** 128 random bits, base64: unguessable and new for every response. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
