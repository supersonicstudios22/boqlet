import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/*
 * `/api/v1` outside production goes to the Java backend (`API_PROXY_TARGET`, by default the local one,
 * docs/development/local-setup.md) through the route handler `app/api/v1/[...path]/route.ts`, not a
 * rewrite: Next's rewrite proxy answers an unreachable API with a bare text 500, the handler with
 * `503 api_unavailable` (TF-183). In production the ingress routes `/api/v1` to the API on the same domain.
 */

/**
 * Module build flags (P36): `MODULE_PRICING=1` builds the app with the pricing module, registered in
 * `src/modules.ts`. The module is for a later phase (P48), so the flag can't be set yet.
 */
const MODULE_PRICING = process.env.MODULE_PRICING ?? "";
if (MODULE_PRICING === "1") throw new Error("MODULE_PRICING=1: the pricing module (packages/pricing-ui, FE-P1) is not built yet (P48).");
/** First URL segments of the modules' areas in this build (`area.routes`): `/{area}/…` is served by `/areas/{area}/…`. */
const MODULE_AREAS: string[] = [];

const nextConfig: NextConfig = {
  output: "standalone",
  // A second dev server beside `npm run dev:app` (the browser smoke against Java, playwright.java.config.ts) builds in its own folder.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  env: { MODULE_PRICING },
  transpilePackages: ["@ifc-boq/api"],
  // No "X-Powered-By: Next.js" (TF-046).
  poweredByHeader: false,
  // Every page (TF-046, security.md "Web security"): no MIME sniffing, never framed, the origin only as
  // referrer elsewhere, and HSTS in a production build (browsers ignore it over plain http). Later
  // entries win for the same header: bearer links (share links F18, invitations, setup links) are
  // never indexed and never leak their token through the referrer.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
      { source: "/sign-up/:rest*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      {
        source: "/invite/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/s/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  async rewrites() {
    // Before the file system, so an area wins over the `[org]` segment (org slugs never take it).
    const beforeFiles = MODULE_AREAS.flatMap((a) => [
      { source: `/${a}`, destination: `/areas/${a}` },
      { source: `/${a}/:path*`, destination: `/areas/${a}/:path*` },
    ]);
    return { beforeFiles, afterFiles: [], fallback: [] };
  },
};

export default withNextIntl(nextConfig);
