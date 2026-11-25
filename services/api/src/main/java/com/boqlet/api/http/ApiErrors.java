package com.boqlet.api.http;

import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
import jakarta.validation.ConstraintViolationException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.context.request.async.AsyncRequestTimeoutException;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Every failure answers the conventions' `{code, message, details}` (api-conventions.md "Errors").
 * Nothing falls through to the servlet error page: what does (TF-071) is answered by {@link ErrorPages}.
 */
@RestControllerAdvice
class ApiErrors {
    private static final Logger log = LoggerFactory.getLogger(ApiErrors.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiError> apiFailure(ApiException failure) {
        return ResponseEntity.status(failure.status()).body(failure.body());
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMediaTypeNotSupportedException.class,
            MissingServletRequestPartException.class})
    ResponseEntity<ApiError> invalidBody() {
        return ResponseEntity.badRequest().body(new ApiError("invalid_body", "Invalid request body."));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> unreadableBody(HttpMessageNotReadableException failure) {
        if (failure.getCause() instanceof RequestSizeFilter.TooLarge tooLarge) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(RequestSizeFilter.TooLarge.body(tooLarge.limit));
        }
        if (failure.getCause() instanceof UnrecognizedPropertyException unknown) {
            return ResponseEntity.badRequest().body(new ApiError("unknown_field", "Unknown request field.",
                    Map.of("field", unknown.getPropertyName())));
        }
        return invalidBody();
    }

    @ExceptionHandler({MethodArgumentTypeMismatchException.class, MissingServletRequestParameterException.class,
            ConstraintViolationException.class})
    ResponseEntity<ApiError> invalidParameter() {
        return ResponseEntity.badRequest().body(new ApiError("invalid_parameter", "Invalid request parameter."));
    }

    /** Method validation of the generated interfaces (`@Max` on `limit`, `@Valid` bodies). */
    @ExceptionHandler(HandlerMethodValidationException.class)
    ResponseEntity<ApiError> invalidMethodArguments(HandlerMethodValidationException failure) {
        boolean body = failure.getParameterValidationResults().stream()
                .anyMatch(result -> result.getMethodParameter().hasParameterAnnotation(RequestBody.class));
        return body ? invalidBody() : invalidParameter();
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ApiError> uploadTooLarge() {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(new ApiError("too_large", "The file exceeds 20 MiB."));
    }

    @ExceptionHandler(MultipartException.class)
    ResponseEntity<ApiError> invalidUpload() {
        return ResponseEntity.badRequest().body(new ApiError("invalid_file", "The upload could not be read."));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiError> methodNotAllowed(HttpRequestMethodNotSupportedException failure) {
        var response = ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED);
        if (failure.getSupportedHttpMethods() != null) response.allow(failure.getSupportedHttpMethods().toArray(org.springframework.http.HttpMethod[]::new));
        return response.body(new ApiError("method_not_allowed", "This method is not allowed here."));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiError> notFound() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiError("not_found", ApiException.NOT_FOUND_MESSAGE));
    }

    /** An event stream that times out or whose client left: nothing to answer. */
    @ExceptionHandler({AsyncRequestTimeoutException.class, AsyncRequestNotUsableException.class})
    ResponseEntity<Void> asyncEnded() {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> internal(Exception failure) {
        // Spring's own request failures (ErrorResponse: 406, 415, a ResponseStatusException...) keep their status.
        if (failure instanceof ErrorResponse known && !known.getStatusCode().is5xxServerError()) {
            return ResponseEntity.status(known.getStatusCode()).body(ErrorPages.body(known.getStatusCode().value()));
        }
        log.error("Unhandled request failure", failure);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(ErrorPages.body(500));
    }
}
