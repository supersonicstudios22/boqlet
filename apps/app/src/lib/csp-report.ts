/**
 * Content-Security-Policy violation reports (`app/csp-report/route.ts`, review A-38), as one short log line each,
 * so the operator sees in the web container's log what a policy in report-only mode would block. Bearer tokens in
 * reported URLs (share links, invitations, sign-up links) are masked; at most `PER_MINUTE` lines a minute per process.
 */

export const MAX_BYTES = 16 * 1024;
export const PER_MINUTE = 60;

type Report = Record<string, unknown>;

const BEARER = /\/(s|invite|sign-up)\/[^/?#\s"]+/g;

/** A URL as it may be logged: path only for the app's own pages, tokens masked, at most 200 characters. */
export function maskUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  let text = value;
  try {
    const url = new URL(value);
    text = url.protocol === "http:" || url.protocol === "https:" ? `${url.origin}${url.pathname}` : url.protocol.replace(/:$/, "");
  } catch {
    // keywords such as "inline" or "eval"
  }
  return text.replace(BEARER, "/$1/***").slice(0, 200);
}

/** The reports in a body: the `report-uri` format (`{"csp-report": {...}}`) or the Reporting API's list. */
export function reportsIn(body: unknown): Report[] {
  const list = Array.isArray(body) ? body : [body];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const legacy = (item as Report)["csp-report"];
    if (legacy && typeof legacy === "object") return [legacy as Report];
    const modern = (item as Report).body;
    return (item as Report).type === "csp-violation" && modern && typeof modern === "object" ? [modern as Report] : [];
  });
}

/** The fields worth a log line, whichever format the browser used. */
export function summary(report: Report) {
  const pick = (...keys: string[]) => keys.map((k) => report[k]).find((v) => typeof v === "string" && v) as string | undefined;
  return {
    directive: pick("effective-directive", "effectiveDirective", "violated-directive")?.slice(0, 60),
    blocked: maskUrl(pick("blocked-uri", "blockedURL")),
    page: maskUrl(pick("document-uri", "documentURL")),
    disposition: pick("disposition")?.slice(0, 20),
    source: maskUrl(pick("source-file", "sourceFile")),
    line: typeof (report["line-number"] ?? report.lineNumber) === "number" ? (report["line-number"] ?? report.lineNumber) : undefined,
  };
}

/** A fixed window: true while this minute has room for another line. */
export function limiter(perMinute = PER_MINUTE, now: () => number = Date.now) {
  let window = 0;
  let used = 0;
  return () => {
    const minute = Math.floor(now() / 60_000);
    if (minute !== window) {
      window = minute;
      used = 0;
    }
    used += 1;
    return used <= perMinute;
  };
}
