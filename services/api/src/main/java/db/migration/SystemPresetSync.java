package db.migration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import db.migration.SystemPresetFiles.Preset;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Publishes the shipped system presets into a database seeded earlier (V5 seeds version 1 once).
 * A preset whose file differs from its latest published version, or whose parent (`extends`) has a
 * newer version than the one it extends, gets the next published version; the preset then points at
 * it. Parents go first, so a change to as-modelled re-publishes everything built on it. Versions
 * already published are never changed: BoQs and org presets that pinned one keep their numbers.
 * A preset that is new in the files is created at version 1.
 */
final class SystemPresetSync {
    private final ObjectMapper json = new ObjectMapper();
    private final Connection connection;

    SystemPresetSync(Connection connection) {
        this.connection = connection;
    }

    /** Returns the slugs that got a new version (kind:slug). */
    List<String> sync(List<Preset> presets) throws SQLException {
        var published = new ArrayList<String>();
        var latest = new HashMap<String, UUID>();          // kind:slug -> latest published version
        for (Preset preset : parentsFirst(presets)) {
            String key = preset.kind() + ":" + preset.slug();
            UUID parent = preset.parent() == null ? null : latest.get(preset.kind() + ":" + preset.parent());
            if (preset.parent() != null && parent == null) parent = latestOf(preset.kind(), preset.parent());
            Head head = head(preset.kind(), preset.slug());
            if (head == null) {
                UUID presetId = SystemPresetFiles.id("preset", preset.kind(), preset.slug(), 1);
                UUID version = SystemPresetFiles.id("version", preset.kind(), preset.slug(), 1);
                insertPreset(presetId, preset, version);
                insertVersion(version, presetId, 1, preset, parent);
                latest.put(key, version);
                published.add(key);
                continue;
            }
            Current current = current(head.latest());
            boolean same = current != null && current.doc().equals(preset.doc()) && Objects.equals(current.parent(), parent);
            if (same && Objects.equals(head.unavailable(), preset.unavailable())) {
                latest.put(key, head.latest());
                continue;
            }
            UUID version = head.latest();
            if (!same) {
                int number = nextNumber(head.id());
                version = SystemPresetFiles.id("version", preset.kind(), preset.slug(), number);
                insertVersion(version, head.id(), number, preset, parent);
                published.add(key);
            }
            try (var update = connection.prepareStatement("""
                    UPDATE presets SET latest_published_version_id = ?, name = ?, description = ?, based_on = ?,
                                       unavailable_reason = ?, updated_at = now()
                    WHERE id = ?
                    """)) {
                update.setObject(1, version);
                update.setString(2, preset.name());
                update.setString(3, preset.description());
                update.setString(4, preset.parent());
                update.setString(5, preset.unavailable());
                update.setObject(6, head.id());
                update.executeUpdate();
            }
            latest.put(key, version);
        }
        return published;
    }

    /** Presets ordered so that each comes after the preset it extends (same kind). */
    static List<Preset> parentsFirst(List<Preset> presets) {
        var byKey = new LinkedHashMap<String, Preset>();
        for (Preset preset : presets) byKey.put(preset.kind() + ":" + preset.slug(), preset);
        var ordered = new LinkedHashMap<String, Preset>();
        for (Preset preset : presets) add(preset, byKey, ordered, new ArrayList<>());
        return new ArrayList<>(ordered.values());
    }

    private static void add(Preset preset, Map<String, Preset> byKey, Map<String, Preset> ordered, List<String> path) {
        String key = preset.kind() + ":" + preset.slug();
        if (ordered.containsKey(key)) return;
        if (path.contains(key)) throw new IllegalStateException("Circular system presets: " + path);
        path.add(key);
        Preset parent = preset.parent() == null ? null : byKey.get(preset.kind() + ":" + preset.parent());
        if (parent != null) add(parent, byKey, ordered, path);
        ordered.put(key, preset);
    }

    private record Head(UUID id, UUID latest, String unavailable) {}

    private record Current(JsonNode doc, UUID parent) {}

    private Head head(String kind, String slug) throws SQLException {
        try (var query = connection.prepareStatement("""
                SELECT id, latest_published_version_id, unavailable_reason FROM presets
                WHERE layer = 'system' AND kind = ? AND slug = ?
                """)) {
            query.setString(1, kind);
            query.setString(2, slug);
            try (var row = query.executeQuery()) {
                return row.next() ? new Head(row.getObject(1, UUID.class), row.getObject(2, UUID.class), row.getString(3)) : null;
            }
        }
    }

    private UUID latestOf(String kind, String slug) throws SQLException {
        Head head = head(kind, slug);
        return head == null ? null : head.latest();
    }

    private Current current(UUID version) throws SQLException {
        if (version == null) return null;
        try (var query = connection.prepareStatement("SELECT doc::text, extends_version_id FROM preset_versions WHERE id = ?")) {
            query.setObject(1, version);
            try (var row = query.executeQuery()) {
                if (!row.next()) return null;
                String doc = row.getString(1);
                return new Current(doc == null ? null : json.readTree(doc), row.getObject(2, UUID.class));
            }
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("Unreadable system preset version " + version, e);
        }
    }

    private int nextNumber(UUID preset) throws SQLException {
        try (var query = connection.prepareStatement("SELECT coalesce(max(number), 0) + 1 FROM preset_versions WHERE preset_id = ?")) {
            query.setObject(1, preset);
            try (var row = query.executeQuery()) {
                row.next();
                return row.getInt(1);
            }
        }
    }

    private void insertPreset(UUID id, Preset preset, UUID version) throws SQLException {
        try (var insert = connection.prepareStatement("""
                INSERT INTO presets (id, layer, kind, slug, name, description, based_on, latest_published_version_id,
                                     unavailable_reason)
                VALUES (?, 'system', ?, ?, ?, ?, ?, ?, ?)
                """)) {
            insert.setObject(1, id);
            insert.setString(2, preset.kind());
            insert.setString(3, preset.slug());
            insert.setString(4, preset.name());
            insert.setString(5, preset.description());
            insert.setString(6, preset.parent());
            insert.setObject(7, version);
            insert.setString(8, preset.unavailable());
            insert.executeUpdate();
        }
    }

    private void insertVersion(UUID id, UUID preset, int number, Preset source, UUID parent) throws SQLException {
        try (var insert = connection.prepareStatement("""
                INSERT INTO preset_versions (id, preset_id, number, status, doc, extends_version_id, published_at)
                VALUES (?, ?, ?, 'published', CAST(? AS jsonb), ?, now())
                """)) {
            insert.setObject(1, id);
            insert.setObject(2, preset);
            insert.setInt(3, number);
            insert.setString(4, source.doc().toString());
            insert.setObject(5, parent);
            insert.executeUpdate();
        }
    }
}
