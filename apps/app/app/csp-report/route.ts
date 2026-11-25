import { limiter, MAX_BYTES, reportsIn, summary } from "@/lib/csp-report";

/**
 * Content-Security-Policy violation reports (`report-uri`, src/lib/csp.ts): one log line each (`csp.violation`),
 * tokens masked, rate-limited, nothing stored. Always 204, so a browser has nothing to retry.
 */
const allow = limiter();

export async function POST(request: Request) {
  // Browsers send a length; anything without one, or larger than a report, is not read.
  const length = Number(request.headers.get("content-length") ?? "NaN");
  const text = Number.isFinite(length) && length > 0 && length <= MAX_BYTES ? await request.text().catch(() => "") : "";
  if (text.length > 0 && text.length <= MAX_BYTES) {
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    for (const report of reportsIn(body).slice(0, 10)) {
      if (!allow()) break;
      console.warn(JSON.stringify({ event: "csp.violation", ...summary(report) }));
    }
  }
  return new Response(null, { status: 204 });
}
