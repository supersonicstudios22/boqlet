package com.boqlet.api.http;

import java.util.Map;
import org.springframework.http.HttpStatus;

public final class ApiException extends RuntimeException {
    /**
     * What every `404 not_found` says, whichever resource or which of its scope checks failed: another org's BoQ and
     * a random id answer the same (security.md, review A-37, ENG-014). The specific text stays the exception's
     * message, for the server log only.
     */
    public static final String NOT_FOUND_MESSAGE = "The resource was not found.";

    private final HttpStatus status;
    private final ApiError body;

    public ApiException(HttpStatus status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        boolean missing = status == HttpStatus.NOT_FOUND && "not_found".equals(code);
        this.body = missing ? new ApiError(code, NOT_FOUND_MESSAGE, Map.of()) : new ApiError(code, message, Map.copyOf(details));
    }

    public HttpStatus status() {
        return status;
    }

    public ApiError body() {
        return body;
    }
}
