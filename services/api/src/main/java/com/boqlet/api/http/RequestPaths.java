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
}
