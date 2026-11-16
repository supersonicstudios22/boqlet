package com.boqlet.api.billing;

import com.boqlet.api.db.Ids;
import com.boqlet.api.http.ApiError;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
class LimitErrors {
    private final JdbcTemplate database;

    LimitErrors(JdbcTemplate database) {
        this.database = database;
    }

    @ExceptionHandler(LimitReached.class)
    ResponseEntity<ApiError> denied(LimitReached failure) {
        // The rejected operation has rolled back before the controller advice records this event.
        if (failure.org != null) {
            database.update("""
                    INSERT INTO limit_events (id, org_id, user_id, limit_name, current_value, max_value, action)
                    SELECT ?, id, ?, ?, ?, ?, 'refused' FROM orgs WHERE id = ?
                    """, Ids.newId(), failure.actor, failure.key, failure.current, failure.maximum, failure.org);
        }
        return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED).body(failure.body());
    }
}
