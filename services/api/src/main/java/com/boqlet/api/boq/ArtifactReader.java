package com.boqlet.api.boq;

import com.boqlet.api.storage.ObjectStorage;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.zip.GZIPInputStream;
import org.springframework.stereotype.Component;

@Component
class ArtifactReader {
    private final ObjectStorage storage;
    private final ObjectMapper json;

    ArtifactReader(ObjectStorage storage, ObjectMapper json) {
        this.storage = storage;
        this.json = json;
    }

    <T> T read(String key, Class<T> type) {
        try (var raw = storage.open(key); var decoded = new GZIPInputStream(raw)) {
            return json.readValue(decoded, type);
        } catch (IOException failure) {
            throw new IllegalStateException("Could not read job output.", failure);
        }
    }

    JsonNode read(String key) {
        return read(key, JsonNode.class);
    }
}
