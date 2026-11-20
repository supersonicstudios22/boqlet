package com.boqlet.api.billing;

import com.boqlet.api.http.ApiError;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
class LimitErrors {
    private final LimitAlerts alerts;

    LimitErrors(LimitAlerts alerts) {
        this.alerts = alerts;
    }

    @ExceptionHandler(LimitReached.class)
    ResponseEntity<ApiError> denied(LimitReached failure, org.springframework.web.method.HandlerMethod handler) {
        // The rejected operation has rolled back before the controller advice records this event. Its
        // action is the refused operation: controller methods carry the contract's operationId.
        alerts.refused(failure, handler == null ? "refused" : handler.getMethod().getName());
        return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED).body(failure.body());
    }
}
