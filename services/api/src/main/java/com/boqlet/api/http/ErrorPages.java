package com.boqlet.api.http;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.web.servlet.error.ErrorController;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The servlet error page (`/error`), for what fails before or outside the handlers: a request the
 * firewall rejects (`//`, `;` in the path), a failure in a filter, a container limit. It answers
 * the API's error body with the real status instead of Spring's default page, and the ERROR
 * dispatch is permitted in {@link SecurityConfiguration}, so it never turns into a `401` (TF-071).
 */
@RestController
class ErrorPages implements ErrorController {
    @RequestMapping("${server.error.path:/error}")
    ResponseEntity<ApiError> error(HttpServletRequest request) {
        Object code = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        int status = code instanceof Integer value && value >= 400 ? value : 500;
        return ResponseEntity.status(status).body(body(status));
    }

    static ApiError body(int status) {
        return switch (status) {
            case 400 -> new ApiError("invalid_request", "The request could not be understood.");
            case 401 -> new ApiError("unauthenticated", "Sign in to continue.");
            case 403 -> new ApiError("forbidden", "You don't have access to this.");
            case 404 -> new ApiError("not_found", ApiException.NOT_FOUND_MESSAGE);
            case 405 -> new ApiError("method_not_allowed", "This method is not allowed here.");
            case 406 -> new ApiError("not_acceptable", "This response type is not available.");
            case 413 -> new ApiError("too_large", "The request is too large.");
            case 415 -> new ApiError("invalid_body", "Invalid request body.");
            case 429 -> new ApiError("rate_limited", "Too many requests. Try again later.");
            default -> status >= 500 ? new ApiError("internal", "Something went wrong. Try again later.")
                    : new ApiError(HttpStatus.resolve(status) == null ? "invalid_request"
                            : HttpStatus.valueOf(status).name().toLowerCase(java.util.Locale.ROOT), "The request failed.");
        };
    }
}
