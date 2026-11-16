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
    ResponseEntity<ApiError> denied(LimitReached failure) {
        // The rejected operation has rolled back before the controller advice records this event.
        alerts.refused(failure);
        return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED).body(failure.body());
    }
}
