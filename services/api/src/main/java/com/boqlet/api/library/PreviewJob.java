package com.boqlet.api.library;

import com.boqlet.api.worker.JobHandler;
import com.boqlet.api.worker.Jobs;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
class PreviewJob implements JobHandler {
    @Override
    public String type() {
        return "preview";
    }

    @Override
    public Map<String, Object> finished(Jobs.Attempt attempt, String status, JsonNode result) {
        if (!status.equals("succeeded")) return null;
        JsonNode output = result.path("output");
        String key = output.path("previewKey").asText();
        if (!key.equals(attempt.attemptPrefix() + "preview.json")) throw new IllegalStateException("Invalid preview artifact.");
        var view = new LinkedHashMap<String, Object>();
        view.put("previewObjectKey", key);
        view.put("presetVersionId", attempt.input().path("previewReport").path("presetVersionId").asText());
        view.put("lines", output.path("lineCount").asInt());
        view.put("compare", output.path("compare").isObject() ? output.path("compare") : null);
        return view;
    }
}
