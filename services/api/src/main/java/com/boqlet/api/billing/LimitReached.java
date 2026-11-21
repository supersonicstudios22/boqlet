package com.boqlet.api.billing;

import com.boqlet.api.http.ApiError;
import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;

public final class LimitReached extends RuntimeException {
    final UUID org;
    final UUID actor;
    final String key;
    final BigDecimal current;
    final BigDecimal maximum;

    LimitReached(UUID org, UUID actor, String key, BigDecimal current, BigDecimal maximum) {
        super("The plan limit has been reached.");
        this.org = org;
        this.actor = actor;
        this.key = key;
        this.current = current;
        this.maximum = maximum;
    }

    ApiError body() {
        return new ApiError("limit_reached", getMessage(), Map.of("limit", key, "current", current, "max", maximum));
    }
}
