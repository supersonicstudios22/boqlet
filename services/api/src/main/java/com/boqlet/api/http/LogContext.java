package com.boqlet.api.http;

import java.util.UUID;
import org.slf4j.MDC;

/**
 * The fields every log line carries (deployment.md "Observability", BE-025): `requestId` (set by
 * {@link RequestIdFilter}), `userId` once the identity is known, `orgId` once a request's
 * organisation is resolved, and `jobId` while a job result is handled. Structured logging
 * (`BOQLET_LOG_FORMAT=ecs`) writes them as JSON fields. Request fields are cleared when the request ends.
 */
public final class LogContext {
    private LogContext() {}

    public static void user(UUID user) {
        if (user != null) MDC.put("userId", user.toString());
    }

    public static void org(UUID org) {
        if (org != null) MDC.put("orgId", org.toString());
    }

    /** A log-context scope; closing it restores the fields it changed. */
    public interface Scope extends AutoCloseable {
        @Override
        void close();
    }

    /** Job fields for the duration of the returned scope. */
    public static Scope job(UUID job, UUID org) {
        String previousOrg = MDC.get("orgId");
        MDC.put("jobId", job.toString());
        org(org);
        return () -> {
            MDC.remove("jobId");
            if (previousOrg == null) MDC.remove("orgId");
            else MDC.put("orgId", previousOrg);
        };
    }

    static void clearRequest() {
        MDC.remove("userId");
        MDC.remove("orgId");
    }
}
