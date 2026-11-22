package com.boqlet.api.identity;

import com.boqlet.api.http.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.WebUtils;

public final class NativeIdentityFilter extends OncePerRequestFilter {
    private static final Set<String> SAFE = Set.of("GET", "HEAD", "OPTIONS");
    private final NativeCredentials credentials;
    private final IdentityService identities;
    private final ObjectMapper json;
    private final String origin;

    public NativeIdentityFilter(NativeCredentials credentials, IdentityService identities, ObjectMapper json, String origin) {
        this.credentials = credentials;
        this.identities = identities;
        this.json = json;
        this.origin = origin.replaceAll("/+$", "");
        if (this.origin.isBlank()) throw new IllegalArgumentException("Native auth requires BOQLET_APP_URL");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = com.boqlet.api.http.RequestPaths.of(request);
        String method = request.getMethod();
        if (path.startsWith("/api/v1/") && !path.startsWith("/api/v1/webhooks/billing/")) {
            boolean admin = path.startsWith("/api/v1/admin/");
            try {
                if (!SAFE.contains(method) && !origin.equals(request.getHeader("Origin"))) {
                    throw IdentityService.failure(HttpStatus.FORBIDDEN, "invalid_origin", "Request must come from Boqlet.");
                }
                boolean publicRead = com.boqlet.api.http.RequestPaths.publicRead(request);
                boolean loginAction = "POST".equals(method) && (path.equals("/api/v1/auth/sign-in")
                        || path.equals("/api/v1/auth/set-password"));
                if (!publicRead && !loginAction) {
                    var cookie = WebUtils.getCookie(request, SessionController.COOKIE);
                    Login login = credentials.session(cookie == null ? null : cookie.getValue());
                    if (admin && !identities.platformAdmin(login.userId())) {
                        throw IdentityService.failure(HttpStatus.NOT_FOUND, "not_found", "The resource was not found.");
                    }
                    request.setAttribute(Login.ATTRIBUTE, login);
                    com.boqlet.api.http.LogContext.user(login.userId());
                    SecurityContextHolder.getContext().setAuthentication(
                            UsernamePasswordAuthenticationToken.authenticated(login.userId(), null, List.of()));
                }
            } catch (ApiException failure) {
                if (admin) failure = IdentityService.failure(HttpStatus.NOT_FOUND, "not_found", "The resource was not found.");
                response.setStatus(failure.status().value());
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                json.writeValue(response.getOutputStream(), failure.body());
                return;
            }
        }
        chain.doFilter(request, response);
    }
}
