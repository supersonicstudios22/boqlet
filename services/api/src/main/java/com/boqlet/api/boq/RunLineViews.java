package com.boqlet.api.boq;

import com.boqlet.api.db.StoredJson;
import com.boqlet.contract.model.RunLine;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.ser.std.StdSerializer;
import java.io.IOException;
import org.springframework.stereotype.Component;

/**
 * A run line as the API writes it (TF-179). When a run is indexed each line is written once as a
 * `RunLine` with a placeholder sort index and no position number; a page then puts the line's sort
 * index and position number in place of the placeholder and sends the text as it is. The result is
 * byte for byte what writing the `RunLine` gives (same mapper, same fields, same order): `positionNo`
 * directly follows `sortIndex` in `RunLine` and is left out when it is null.
 */
@Component
class RunLineViews {
    /** Not a sort index any run has; `,"sortIndex":` can't occur unescaped inside a string. */
    private static final String PLACEHOLDER = ",\"sortIndex\":-424242";
    private final ObjectMapper mapper;
    private final StoredJson json;

    RunLineViews(ObjectMapper mapper, StoredJson json) {
        this.mapper = mapper;
        this.json = json;
    }

    /** The stored view of an engine line, or null when the contract can't hold it (it is then read the old way). */
    String render(JsonNode line) {
        try {
            // Written from the line as PostgreSQL gives it back (jsonb's key order), as the old read did, so free
            // maps (`keys`, `trace.params`) keep the order the response always had.
            var copy = ((ObjectNode) inJsonbOrder(line)).put("sortIndex", -424242);
            copy.remove("positionNo");
            String text = mapper.writeValueAsString(mapper.treeToValue(copy, RunLine.class));
            int at = text.indexOf(PLACEHOLDER);
            return at < 0 || text.indexOf(PLACEHOLDER, at + 1) >= 0 ? null : text;
        } catch (JsonProcessingException | IllegalArgumentException | ClassCastException unusable) {
            return null;
        }
    }

    /** A copy with every object's keys in jsonb's order: shorter keys first, then by their UTF-8 bytes. */
    static JsonNode inJsonbOrder(JsonNode node) {
        if (node.isObject()) {
            var names = new java.util.ArrayList<String>();
            node.fieldNames().forEachRemaining(names::add);
            names.sort(RunLineViews::compareJsonbKeys);
            var out = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
            for (String name : names) out.set(name, inJsonbOrder(node.get(name)));
            return out;
        }
        if (node.isArray()) {
            var out = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.arrayNode(node.size());
            for (JsonNode item : node) out.add(inJsonbOrder(item));
            return out;
        }
        return node;
    }

    private static int compareJsonbKeys(String a, String b) {
        byte[] x = a.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] y = b.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if (x.length != y.length) return Integer.compare(x.length, y.length);
        return java.util.Arrays.compareUnsigned(x, y);
    }

    /** The page's line: the stored view with its place in the run, else the line read and written again. */
    RunLine line(String view, String stored, int sortIndex, String positionNo) {
        if (view == null) {
            var line = json.read(stored, ObjectNode.class).put("sortIndex", sortIndex);
            if (positionNo != null) line.put("positionNo", positionNo);
            return json.convert(line, RunLine.class);
        }
        int at = view.indexOf(PLACEHOLDER);
        try {
            String place = ",\"sortIndex\":" + sortIndex + (positionNo == null ? "" : ",\"positionNo\":" + mapper.writeValueAsString(positionNo));
            return new Written(view.substring(0, at) + place + view.substring(at + PLACEHOLDER.length()));
        } catch (JsonProcessingException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** A line already written as JSON. Only for responses: its getters are empty. */
    @JsonSerialize(using = Written.Writer.class)
    static final class Written extends RunLine {
        final String text;

        Written(String text) {
            this.text = text;
        }

        static final class Writer extends StdSerializer<Written> {
            Writer() {
                super(Written.class);
            }

            @Override
            public void serialize(Written line, JsonGenerator out, SerializerProvider provider) throws IOException {
                out.writeRawValue(line.text);
            }
        }
    }
}
