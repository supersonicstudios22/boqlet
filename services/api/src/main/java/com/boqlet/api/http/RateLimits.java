package com.boqlet.api.http;

import java.time.Duration;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Fixed-window counters shared by every instance (security.md "Rate limits"), in the
 * `native_auth_limits` table that native sign-in uses. Call it outside the request's transaction, so a
 * refused attempt still counts. Over the limit: `429 rate_limited` with `Retry-After` (seconds to the
 * window's end).
 */
@Service
public class RateLimits {
    private static final String PREFIX = "rate:";
    private final JdbcTemplate database;

    public RateLimits(JdbcTemplate database) {
        this.database = database;
    }

    public void take(String bucket, int maximum, Duration window) {
        String interval = window.toSeconds() + " seconds";
        var counted = database.queryForMap("""
                INSERT INTO native_auth_limits (bucket, window_start, attempts)
                VALUES (?, date_bin(CAST(? AS interval), now(), timestamptz '2000-01-01'), 1)
                ON CONFLICT (bucket, window_start) DO UPDATE SET attempts = native_auth_limits.attempts + 1
                RETURNING attempts, ceil(extract(epoch FROM window_start + CAST(? AS interval) - now()))::int AS retry
                """, PREFIX + bucket, interval, interval);
        if (((Number) counted.get("attempts")).intValue() > maximum) {
            throw tooMany(Math.max(1, ((Number) counted.get("retry")).longValue()));
        }
    }

    /** `429 rate_limited` with `Retry-After` set on the current response. */
    public static ApiException tooMany(long retryAfterSeconds) {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes
                && attributes.getResponse() != null) {
            attributes.getResponse().setHeader(HttpHeaders.RETRY_AFTER, Long.toString(retryAfterSeconds));
        }
        return new ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", "Too many requests. Try again later.",
                Map.of("retryAfterSeconds", retryAfterSeconds));
    }

    @Scheduled(fixedDelay = 3_600_000)
    void forgetOldWindows() {
        database.update("DELETE FROM native_auth_limits WHERE bucket LIKE 'rate:%' AND window_start < now() - interval '1 day'");
    }
}
