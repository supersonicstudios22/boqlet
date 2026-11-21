package com.boqlet.api.http;

import java.util.UUID;

/** Identity plus resource permissions resolved by a request's policy. */
public record RequestContext(UUID userId, UUID sessionId, UUID orgId, String projectRole) {}
