package com.boqlet.api.identity;

import com.boqlet.api.http.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

public final class IdentityFilter extends OncePerRequestFilter {
    private final IdentityService identities;
    private final Sessions sessions;
    private final ObjectMapper json;

    public IdentityFilter(IdentityService identities, Sessions sessions, ObjectMapper json) {
        this.identities = identities;
        this.sessions = sessions;
        this.json = json;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = com.boqlet.api.http.RequestPaths.of(request);
        boolean admin = path.startsWith("/api/v1/admin/");
        boolean publicRead = com.boqlet.api.http.RequestPaths.publicRead(request);
        if (SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken auth
                && path.startsWith("/api/v1/") && !publicRead) {
            try {
                Login login = identities.authenticate(auth.getToken());
                boolean opening = request.getMethod().equals("POST") && path.equals("/api/v1/sessions");
                if (!opening) {
                    login = new Login(login.userId(), login.providerSession(), sessions.require(login, cookieId(request)));
                }
                if (admin && !identities.platformAdmin(login.userId())) {
                    throw IdentityService.failure(org.springframework.http.HttpStatus.NOT_FOUND, "not_found", "The resource was not found.");
                }
                request.setAttribute(Login.ATTRIBUTE, login);
                com.boqlet.api.http.LogContext.user(login.userId());
            } catch (ApiException failure) {
                if (admin) failure = IdentityService.failure(org.springframework.http.HttpStatus.NOT_FOUND,
                        "not_found", "The resource was not found.");
                response.setStatus(failure.status().value());
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                json.writeValue(response.getOutputStream(), failure.body());
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private static UUID cookieId(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie cookie : cookies) {
                if (SessionController.COOKIE.equals(cookie.getName())) {
                    try {
                        return UUID.fromString(cookie.getValue());
                    } catch (IllegalArgumentException ignored) {
                        return null;
                    }
                }
            }
        }
        return null;
    }
}
