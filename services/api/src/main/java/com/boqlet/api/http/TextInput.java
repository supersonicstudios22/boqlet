package com.boqlet.api.http;

import com.fasterxml.jackson.databind.JsonNode;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.openapitools.jackson.nullable.JsonNullable;
import org.springframework.http.HttpStatus;

/**
 * Text that reaches the database from a request body (TF-176, security.md "Input handling").
 * Every string: no NUL (PostgreSQL can't store it) and no unpaired surrogate (stored as `?`).
 * Names and labels (`name`, `label`, `deviceLabel`): also no control characters (C0, DEL, C1, line and
 * paragraph separators) and no bidirectional formatting characters, which spoof text in member lists,
 * mails and exports ("abc‮txt.exe"). The same rule as model file names.
 */
public final class TextInput {
    static final Set<String> NAME_FIELDS = Set.of("name", "label", "deviceLabel");
    private static final int MAX_DEPTH = 64;
    private static final ClassValue<List<Field>> FIELDS = new ClassValue<>() {
        @Override
        protected List<Field> computeValue(Class<?> type) {
            var fields = new ArrayList<Field>();
            for (Class<?> at = type; at != null && at != Object.class; at = at.getSuperclass()) {
                for (Field field : at.getDeclaredFields()) {
                    if (Modifier.isStatic(field.getModifiers()) || field.isSynthetic()) continue;
                    field.setAccessible(true);
                    fields.add(field);
                }
            }
            return List.copyOf(fields);
        }
    };

    private TextInput() {}

    /** The name as given, or `400 invalid_body` when it holds a character a name can't hold. */
    public static String name(String value, String field) {
        if (value != null) check(value, field, true);
        return value;
    }

    /** Checks a deserialized request body: every string in it, and the name rule on name fields. */
    static void body(Object body) {
        walk(body, null, 0);
    }

    private static void walk(Object value, String field, int depth) {
        if (value == null || depth > MAX_DEPTH) return;
        switch (value) {
            case String text -> check(text, field, field != null && NAME_FIELDS.contains(field));
            case JsonNode node -> tree(node);
            case JsonNullable<?> nullable -> {
                if (nullable.isPresent()) walk(nullable.get(), field, depth + 1);
            }
            case Optional<?> optional -> optional.ifPresent(inner -> walk(inner, field, depth + 1));
            case Collection<?> items -> items.forEach(item -> walk(item, field, depth + 1));
            case Map<?, ?> map -> map.forEach((key, inner) -> {
                walk(key, null, depth + 1);
                walk(inner, null, depth + 1);
            });
            case Object[] items -> {
                for (Object item : items) walk(item, field, depth + 1);
            }
            default -> {
                Class<?> type = value.getClass();
                if (type.isEnum() || !type.getName().startsWith("com.boqlet.")) return;
                for (Field member : FIELDS.get(type)) {
                    try {
                        walk(member.get(value), member.getName(), depth + 1);
                    } catch (IllegalAccessException failure) {
                        throw new IllegalStateException(failure);
                    }
                }
            }
        }
    }

    /** JSON documents (preset docs, settings) can be deep: walked without recursion. */
    private static void tree(JsonNode root) {
        var pending = new ArrayDeque<JsonNode>();
        pending.push(root);
        while (!pending.isEmpty()) {
            JsonNode node = pending.pop();
            if (node.isTextual()) {
                check(node.textValue(), null, false);
            } else if (node.isObject()) {
                node.properties().forEach(entry -> {
                    check(entry.getKey(), null, false);
                    pending.push(entry.getValue());
                });
            } else if (node.isArray()) {
                node.forEach(pending::push);
            }
        }
    }

    private static void check(String text, String field, boolean name) {
        for (int index = 0; index < text.length(); index++) {
            char at = text.charAt(index);
            if (Character.isHighSurrogate(at) && index + 1 < text.length() && Character.isLowSurrogate(text.charAt(index + 1))) {
                index++;
                continue;
            }
            if (at == 0 || Character.isSurrogate(at)) throw refused(field, "The text holds a character that can't be stored.");
            if (name && forbiddenInName(at)) {
                throw refused(field, "A name can't hold control or text-direction characters.");
            }
        }
    }

    private static boolean forbiddenInName(char at) {
        return Character.getType(at) == Character.CONTROL || at == ' ' || at == ' '
                || at == '؜' || at == '‎' || at == '‏'
                || (at >= '‪' && at <= '‮') || (at >= '⁦' && at <= '⁩');
    }

    private static ApiException refused(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "invalid_body", message,
                field == null ? Map.of() : Map.of("field", field));
    }
}
