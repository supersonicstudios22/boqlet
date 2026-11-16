package com.boqlet.api.library;

import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.contract.model.PresetKind;
import com.boqlet.contract.model.PresetLayer;
import com.boqlet.contract.model.PresetVersion;
import com.boqlet.contract.model.PresetVersionInfo;
import com.boqlet.contract.model.UserRef;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.stream.StreamSupport;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class PresetCatalog {
    private static final String HEAD = """
            SELECT p.*, u.name AS editor_name
            FROM presets p LEFT JOIN users u ON u.id = p.updated_by AND u.deleted_at IS NULL
            WHERE true
            """;
    private static final String VERSION = """
            SELECT v.*, u.name AS publisher_name
            FROM preset_versions v LEFT JOIN users u ON u.id = v.published_by AND u.deleted_at IS NULL
            WHERE true
            """;

    private final JdbcTemplate database;
    private final StoredJson json;

    PresetCatalog(JdbcTemplate database, StoredJson json) {
        this.database = database;
        this.json = json;
    }

    public record Head(UUID id, UUID org, UUID project, PresetKind kind, PresetLayer layer, String slug, String name,
                       String description, String basedOn, boolean starred, boolean archived, UUID published, UUID draft,
                       OffsetDateTime updated, UserRef editor, String unavailable) {}

    public record Version(UUID id, UUID preset, Integer number, String status, ObjectNode doc, UUID parent, List<String> problems,
                          int etag, String note, OffsetDateTime publishedAt, OffsetDateTime updated, UserRef publisher) {
        public boolean draft() { return status.equals("draft"); }
        public String tag() { return "\"" + id + "." + etag + "\""; }

        PresetVersionInfo info() {
            var result = new PresetVersionInfo(id, PresetVersionInfo.StatusEnum.fromValue(status))
                    .number(number).changeNote(note).publishedBy(publisher).publishedAt(publishedAt)
                    .updatedAt(updated).problemCount(problems.size());
            if (draft()) result.setEtag(tag());
            return result;
        }

        PresetVersion response(Object flat) {
            var result = new PresetVersion(id, PresetVersion.StatusEnum.fromValue(status), preset, doc, problems)
                    .number(number).changeNote(note).publishedBy(publisher).publishedAt(publishedAt)
                    .updatedAt(updated).problemCount(problems.size()).extendsVersionId(parent);
            if (draft()) result.setEtag(tag());
            if (flat != null) result.flattened(flat);
            return result;
        }
    }

    public record Rules(ObjectNode doc, List<ObjectNode> library) {
        public Map<String, Object> payload() { return Map.of("doc", doc, "library", library); }
    }

    public Head head(UUID id) {
        return heads(" AND p.id = ?", id).stream().findFirst().orElseThrow(PresetCatalog::missing);
    }

    List<Head> visibleHeads(UUID org, UUID project) {
        return heads("""
                 AND (p.layer = 'system' OR (p.org_id = ? AND (p.project_id IS NULL OR p.project_id = ?)))
                 ORDER BY p.layer, lower(p.name), p.id
                """, org, project);
    }

    List<Head> heads(String suffix, Object... args) {
        return database.query(HEAD + suffix, this::headRow, args);
    }

    List<Version> versions(UUID preset) {
        return database.query(VERSION + " AND v.preset_id = ? ORDER BY number DESC NULLS FIRST", this::versionRow, preset);
    }

    public Version version(UUID id) {
        return database.query(VERSION + " AND v.id = ?", this::versionRow, id)
                .stream().findFirst().orElseThrow(PresetCatalog::missing);
    }

    public Version system(PresetKind kind, String slug) {
        Head head = heads(" AND layer = 'system' AND kind = ? AND slug = ?", kind.getValue(), slug).stream().findFirst()
                .orElseThrow(PresetCatalog::missing);
        return version(head.published());
    }

    public Version selected(UUID org, UUID project, UUID id, PresetKind expected) {
        Version version = version(id);
        Head head = head(version.preset());
        if (head.kind() != expected || version.draft() || head.unavailable() != null
                || (head.layer() != PresetLayer.SYSTEM
                    && (!org.equals(head.org()) || (head.project() != null && !head.project().equals(project))))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_preset", "The selected preset is unavailable.", Map.of());
        }
        return version;
    }

    public Rules rules(Version version) {
        return rules(version.doc(), version.parent());
    }

    public Rules rules(ObjectNode source, UUID parentId) {
        ObjectNode root = source.deepCopy();
        var library = new ArrayList<ObjectNode>();
        var seen = new HashSet<UUID>();
        ObjectNode child = root;
        while (parentId != null) {
            if (!seen.add(parentId)) throw new IllegalStateException("Circular rule-set versions.");
            Version parent = version(parentId);
            ObjectNode doc = parent.doc().deepCopy();
            String id = "version-" + parent.id();
            doc.put("id", id);
            child.put("extends", id);
            library.add(doc);
            child = doc;
            parentId = parent.parent();
        }
        return new Rules(root, library);
    }

    public List<Version> dictionaries(UUID org, UUID project, List<UUID> ids, UUID projectDictionary) {
        var result = new ArrayList<Version>();
        if (ids != null) for (UUID id : ids) result.add(selected(org, project, id, PresetKind.DICTIONARY));
        if (projectDictionary != null) {
            Head head = head(projectDictionary);
            if (head.published() != null && result.stream().noneMatch(version -> version.id().equals(head.published()))) {
                result.add(selected(org, project, head.published(), PresetKind.DICTIONARY));
            }
        }
        return result;
    }

    private Head headRow(ResultSet row, int ignored) throws SQLException {
        UUID editorId = row.getObject("updated_by", UUID.class);
        String editor = row.getString("editor_name");
        return new Head(row.getObject("id", UUID.class), row.getObject("org_id", UUID.class), row.getObject("project_id", UUID.class),
                PresetKind.fromValue(row.getString("kind")), PresetLayer.fromValue(row.getString("layer")), row.getString("slug"),
                row.getString("name"), row.getString("description"), row.getString("based_on"), row.getBoolean("starred"),
                row.getBoolean("archived"), row.getObject("latest_published_version_id", UUID.class),
                row.getObject("draft_version_id", UUID.class), row.getObject("updated_at", OffsetDateTime.class),
                editor == null ? null : new UserRef(editorId, editor), row.getString("unavailable_reason"));
    }

    private Version versionRow(ResultSet row, int ignored) throws SQLException {
        String name = row.getString("publisher_name");
        JsonNode issues = json.read(row.getString("problems"), JsonNode.class);
        return new Version(row.getObject("id", UUID.class), row.getObject("preset_id", UUID.class),
                row.getObject("number", Integer.class), row.getString("status"), json.read(row.getString("doc"), ObjectNode.class),
                row.getObject("extends_version_id", UUID.class),
                StreamSupport.stream(issues.spliterator(), false).map(JsonNode::asText).toList(),
                row.getInt("etag"), row.getString("change_note"), row.getObject("published_at", OffsetDateTime.class),
                row.getObject("updated_at", OffsetDateTime.class),
                name == null ? null : new UserRef(row.getObject("published_by", UUID.class), name));
    }

    static ApiException missing() {
        return new ApiException(HttpStatus.NOT_FOUND, "not_found", "The preset or version was not found.", Map.of());
    }
}
