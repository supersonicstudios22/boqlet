package com.boqlet.api.db;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

@Component
public class StoredJson {
    private final ObjectMapper mapper;

    public StoredJson(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public <T> T read(String encoded, Class<T> type) {
        try {
            return encoded == null ? null : mapper.readValue(encoded, type);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("Invalid stored " + type.getSimpleName(), failure);
        }
    }

    /** A tree as a typed value, without writing it out and parsing it again. */
    public <T> T convert(com.fasterxml.jackson.databind.JsonNode tree, Class<T> type) {
        try {
            return mapper.treeToValue(tree, type);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("Invalid stored " + type.getSimpleName(), failure);
        }
    }

    public ObjectNode object(Object data) {
        return data == null ? mapper.createObjectNode() : mapper.valueToTree(data);
    }

    /** Any value as JSON; null is JSON null (unlike {@link #object}, which drops null fields). */
    public com.fasterxml.jackson.databind.JsonNode tree(Object value) {
        return value == null ? com.fasterxml.jackson.databind.node.NullNode.getInstance() : mapper.valueToTree(value);
    }
}
