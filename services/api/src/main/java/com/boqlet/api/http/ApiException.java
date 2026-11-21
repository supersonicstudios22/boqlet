package com.boqlet.api.http;

import java.util.Map;
import org.springframework.http.HttpStatus;

public final class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final ApiError body;

    public ApiException(HttpStatus status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        this.body = new ApiError(code, message, Map.copyOf(details));
    }

    public HttpStatus status() {
        return status;
    }

    public ApiError body() {
        return body;
    }
}
