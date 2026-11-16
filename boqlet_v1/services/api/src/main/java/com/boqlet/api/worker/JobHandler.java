package com.boqlet.api.worker;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

public interface JobHandler {
    String type();

    default void running(Jobs.Attempt attempt) {}

    /** The returned fields are the only worker output exposed to API callers. */
    Map<String, Object> finished(Jobs.Attempt attempt, String status, JsonNode result);
}
