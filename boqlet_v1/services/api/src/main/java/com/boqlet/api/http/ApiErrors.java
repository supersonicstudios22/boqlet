package com.boqlet.api.http;

import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiError> apiFailure(ApiException failure) {
        return ResponseEntity.status(failure.status()).body(failure.body());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> invalidBody() {
        return ResponseEntity.badRequest().body(new ApiError("invalid_body", "Invalid request body."));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> unreadableBody(HttpMessageNotReadableException failure) {
        if (failure.getCause() instanceof UnrecognizedPropertyException unknown) {
            return ResponseEntity.badRequest().body(new ApiError("unknown_field", "Unknown request field.",
                    Map.of("field", unknown.getPropertyName())));
        }
        return invalidBody();
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiError> invalidParameter() {
        return ResponseEntity.badRequest().body(new ApiError("invalid_parameter", "Invalid request parameter."));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiError> notFound() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiError("not_found", "Resource not found."));
    }
}
