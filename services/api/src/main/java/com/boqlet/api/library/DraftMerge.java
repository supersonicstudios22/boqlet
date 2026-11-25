package com.boqlet.api.library;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;

/**
 * Review A-43: a three-way merge of a dictionary draft (mine) with the versions published since it started
 * (theirs), against the version it started from (base). Top-level fields are compared whole; the lists of
 * `terms`, `entries` and `extractors` entry by entry (by `id`). A change on one side only is taken; the same
 * change on both sides is fine; different changes to one field or entry are a conflict, named
 * `field:<name>` or `<list>:<id>`, which a choice settles (otherwise theirs stands in the result, and the
 * caller refuses). Rule sets and the other kinds are never merged (refused as `draft_stale` instead).
 */
public final class DraftMerge {
    public enum Side { MINE, THEIRS }

    /** The merged document, what was taken from theirs, and the conflicts no choice settled. */
    public record Result(ObjectNode doc, SortedSet<String> taken, SortedSet<String> conflicts) {}

    private static final Set<String> KEYED = Set.of("terms", "entries", "extractors");

    private DraftMerge() {}

    public static Result merge(ObjectNode base, ObjectNode mine, ObjectNode theirs, Map<String, Side> choices) {
        var taken = new TreeSet<String>();
        var conflicts = new TreeSet<String>();
        var doc = JsonNodeFactory.instance.objectNode();
        var fields = new LinkedHashSet<String>();
        mine.fieldNames().forEachRemaining(fields::add);
        theirs.fieldNames().forEachRemaining(fields::add);
        base.fieldNames().forEachRemaining(fields::add);
        for (String field : fields) {
            JsonNode b = base.get(field), m = mine.get(field), t = theirs.get(field);
            JsonNode value;
            if (KEYED.contains(field) && keyed(b) && keyed(m) && keyed(t)) {
                value = list(field, b, m, t, choices, taken, conflicts);
            } else {
                value = pick("field:" + field, b, m, t, choices, taken, conflicts);
            }
            if (value != null) doc.set(field, value);
        }
        return new Result(doc, taken, conflicts);
    }

    private static JsonNode list(String field, JsonNode base, JsonNode mine, JsonNode theirs, Map<String, Side> choices,
                                 Set<String> taken, Set<String> conflicts) {
        if (Objects.equals(theirs, base)) return copy(mine);
        if (Objects.equals(mine, base)) {
            if (theirs != null) byId(theirs).forEach((id, entry) -> { if (!Objects.equals(entry, byId(base).get(id))) taken.add(field + ":" + id); });
            if (base != null) byId(base).keySet().forEach(id -> { if (theirs == null || !byId(theirs).containsKey(id)) taken.add(field + ":" + id); });
            return copy(theirs);
        }
        var b = byId(base);
        var m = byId(mine);
        var t = byId(theirs);
        var order = new LinkedHashSet<String>(t.keySet());
        order.addAll(m.keySet());
        var out = JsonNodeFactory.instance.arrayNode();
        for (String id : order) {
            JsonNode value = pick(field + ":" + id, b.get(id), m.get(id), t.get(id), choices, taken, conflicts);
            if (value != null) out.add(value);
        }
        // A base entry both sides removed is in neither list, so it is gone; one side's removal is decided by pick.
        return out;
    }

    /** One field or entry: null means absent in the result. */
    private static JsonNode pick(String key, JsonNode base, JsonNode mine, JsonNode theirs, Map<String, Side> choices,
                                 Set<String> taken, Set<String> conflicts) {
        if (Objects.equals(mine, theirs)) return copy(mine);
        if (Objects.equals(theirs, base)) return copy(mine);
        if (Objects.equals(mine, base)) {
            taken.add(key);
            return copy(theirs);
        }
        Side choice = choices.get(key);
        if (choice == Side.MINE) return copy(mine);
        if (choice == null) conflicts.add(key);
        else taken.add(key);
        return copy(theirs);
    }

    private static boolean keyed(JsonNode list) {
        if (list == null) return true;
        if (!list.isArray()) return false;
        var seen = new HashSet<String>();
        for (JsonNode entry : list) {
            if (!entry.isObject() || !entry.path("id").isTextual() || !seen.add(entry.path("id").asText())) return false;
        }
        return true;
    }

    private static Map<String, JsonNode> byId(JsonNode list) {
        var out = new LinkedHashMap<String, JsonNode>();
        if (list != null) list.forEach(entry -> out.put(entry.path("id").asText(), entry));
        return out;
    }

    private static JsonNode copy(JsonNode node) {
        return node == null ? null : node.deepCopy();
    }

    static ArrayNode ids(Collection<String> values) {
        var out = JsonNodeFactory.instance.arrayNode();
        values.forEach(out::add);
        return out;
    }
}
