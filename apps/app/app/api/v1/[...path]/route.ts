import { proxyApi } from "@/api/proxy";

/**
 * `/api/v1/*` outside production: passed to the Java API (`API_PROXY_TARGET`, default the local one on
 * :8080, docs/development/local-setup.md). In production the ingress routes `/api/v1` to the API; a
 * production build answers here only when `API_PROXY_TARGET` is set. See `src/api/proxy.ts`.
 */
const target = process.env.API_PROXY_TARGET ?? (process.env.NODE_ENV === "production" ? null : "http://localhost:8080");

const handle = (request: Request) => proxyApi(request, target);

export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS };
