/**
 * The app's pass-through of `/api/v1/*` to the Java API outside production (`next dev`, the browser
 * smoke; `app/api/v1/[...path]/route.ts`). In production the ingress routes `/api/v1` to the API and
 * this is not reached. It replaces Next's rewrite proxy, which answers an unreachable API with a bare
 * text `500` (TF-183): here that is `503 {"code":"api_unavailable"}`, the JSON error the app reads.
 * No logic beyond forwarding.
 */

/** Hop-by-hop and recomputed headers that are not forwarded. */
const DROP_REQUEST = ["host", "connection", "keep-alive", "transfer-encoding", "content-length", "upgrade", "expect"];
/** fetch has already decoded the body, so its encoding and length no longer apply. */
const DROP_RESPONSE = ["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length"];

const errorBody = (status: number, code: string, message: string) => Response.json({ code, message }, { status, headers: { "cache-control": "no-store" } });

export async function proxyApi(request: Request, target: string | null): Promise<Response> {
  if (!target) return errorBody(404, "not_found", "No API is configured for this app.");
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const h of DROP_REQUEST) headers.delete(h);
  // As Next's rewrite did: the target's Host, the browser's host in X-Forwarded-Host.
  headers.set("x-forwarded-host", url.host);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(`${target.replace(/\/$/, "")}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return errorBody(503, "api_unavailable", "The API is not reachable.");
  }
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (key !== "set-cookie" && !DROP_RESPONSE.includes(key)) out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  // Server-sent events: nothing between here and the browser may buffer or compress them.
  if (out.get("content-type")?.startsWith("text/event-stream")) {
    out.set("cache-control", "no-cache, no-transform");
    out.set("x-accel-buffering", "no");
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}
