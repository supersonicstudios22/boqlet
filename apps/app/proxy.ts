import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, cspHeaderName, cspMode, newNonce, NONCE_HEADER, storageOrigins } from "@/lib/csp";

/**
 * Every page gets the Content-Security-Policy with a fresh nonce (src/lib/csp.ts, review A-38). The policy goes on
 * the request too, so Next finds the nonce for its own scripts, and the nonce in `x-nonce` for the root layout.
 */
export function proxy(request: NextRequest) {
  const mode = cspMode();
  if (mode === "off") return NextResponse.next();
  const nonce = newNonce();
  const policy = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === "development", storage: storageOrigins() });
  const name = cspHeaderName(mode);
  const headers = new Headers(request.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set(name, policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(name, policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the API proxy (`/api/v1` in development), static files, images, the report endpoint or prefetches.
      source: "/((?!api/|_next/static|_next/image|favicon.ico|csp-report).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
