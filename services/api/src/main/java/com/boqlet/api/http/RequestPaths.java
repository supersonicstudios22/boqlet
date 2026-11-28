package com.boqlet.api.http;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.util.UrlPathHelper;

/**
 * The request's path as Spring MVC routes it: without the context path, percent-decoded, `;`
 * parameters removed, double slashes collapsed. Every decision about a route made before the
 * dispatcher (public routes, sign-in routes, the admin gate) must use this, not the raw
 * `getRequestURI()`: `/api/v1/%61dmin/orgs` is routed to the admin handlers, but its raw URI
 * doesn't start with `/api/v1/admin/` (TF-011).
 */
public final class RequestPaths {
    private static final UrlPathHelper PATHS = new UrlPathHelper();

    private RequestPaths() {}

    public static String of(HttpServletRequest request) {
        return PATHS.getPathWithinApplication(request);
    }

    /**
     * The routes anyone may read without a session (permissions.md): `/plans`, `/public/*`,
     * `/invitations/*`. HEAD is a GET without the body (RFC 9110), so it is public too (TF-083).
     */
    public static boolean publicRead(HttpServletRequest request) {
        String method = request.getMethod();
        if (!"GET".equals(method) && !"HEAD".equals(method)) return false;
        String path = of(request);
        return path.equals("/api/v1/plans") || path.equals("/api/v1/auth/sign-up") || path.startsWith("/api/v1/public/")
                || path.startsWith("/api/v1/invitations/");
    }

    /** The native sign-in routes anyone may POST to without a session (P50, P57); the Origin check still applies. */
    public static final java.util.List<String> AUTH_ACTIONS = java.util.List.of(
            "/api/v1/auth/sign-in", "/api/v1/auth/set-password", "/api/v1/auth/setup-link", "/api/v1/auth/sign-up",
            "/api/v1/auth/password-reset");

    public static boolean authAction(String path) { return AUTH_ACTIONS.contains(path); }
}
