package com.boqlet.api.http;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
final class RequestIdFilter extends OncePerRequestFilter {
    static final String HEADER = "X-Request-Id";
    /** One line per API request (BE-025): method, path without the query (it can hold search text), status, time. */
    private static final org.slf4j.Logger access = org.slf4j.LoggerFactory.getLogger("com.boqlet.api.access");
    private static final Pattern SAFE_ID = Pattern.compile("[a-zA-Z0-9_-]{1,64}");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var incoming = request.getHeader(HEADER);
        var requestId = incoming != null && SAFE_ID.matcher(incoming).matches()
                ? incoming
                : UUID.randomUUID().toString();
        response.setHeader(HEADER, requestId);
        long started = System.nanoTime();
        try (var ignored = MDC.putCloseable("requestId", requestId)) {
            try {
                chain.doFilter(request, response);
            } finally {
                String path = request.getRequestURI();
                if (path.startsWith("/api/")) {
                    long ms = (System.nanoTime() - started) / 1_000_000;
                    access.atInfo().addKeyValue("http.method", request.getMethod()).addKeyValue("url.path", path)
                            .addKeyValue("http.status", response.getStatus()).addKeyValue("durationMs", ms)
                            .log("{} {} {} {} ms", request.getMethod(), path, response.getStatus(), ms);
                }
            }
        } finally {
            LogContext.clearRequest();
        }
    }
}
