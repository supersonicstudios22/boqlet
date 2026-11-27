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
            SELECT v.*, u.name AS publisher_name, base.number AS base_number
            FROM preset_versions v LEFT JOIN users u ON u.id = v.published_by AND u.deleted_at IS NULL
            LEFT JOIN preset_versions base ON base.id = v.base_version_id
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
                       OffsetDateTime updated, UserRef editor, String unavailable, boolean orgDefault) {}

    public record Version(UUID id, UUID preset, Integer number, String status, ObjectNode doc, UUID parent, List<String> problems,
                          int etag, String note, OffsetDateTime publishedAt, OffsetDateTime updated, UserRef publisher,
                          UUID base, Integer baseNumber) {
        public boolean draft() { return status.equals("draft"); }
        public String tag() { return "\"" + id + "." + etag + "\""; }

        PresetVersionInfo info() {
            var result = new PresetVersionInfo(id, PresetVersionInfo.StatusEnum.fromValue(status))
                    .number(number).changeNote(note).publishedBy(publisher).publishedAt(publishedAt)
                    .updatedAt(updated).problemCount(problems.size());
            if (draft()) result.etag(tag()).baseVersionId(base).baseNumber(baseNumber);
            return result;
        }

        PresetVersion response(Object flat) {
            var result = new PresetVersion(id, PresetVersion.StatusEnum.fromValue(status), preset, doc, problems)
                    .number(number).changeNote(note).publishedBy(publisher).publishedAt(publishedAt)
                    .updatedAt(updated).problemCount(problems.size()).extendsVersionId(parent);
            if (draft()) result.etag(tag()).baseVersionId(base).baseNumber(baseNumber);
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

    /** The presets the org's Library lists (system and org presets, and a project's own with `project`). */
    public List<Head> visibleHeads(UUID org, UUID project) {
        return heads("""
                 AND (p.layer = 'system' OR (p.org_id = ? AND (p.project_id IS NULL OR p.project_id = ?)))
                 ORDER BY p.layer, lower(p.name), p.id
                """, org, project);
    }

    List<Head> heads(String suffix, Object... args) {
        return database.query(HEAD + suffix, this::headRow, args);
    }

    List<Version> versions(UUID preset) {
        return database.query(VERSION + " AND v.preset_id = ? ORDER BY v.number DESC NULLS FIRST", this::versionRow, preset);
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
        // Another org's preset answers like one that doesn't exist (security.md, TF-175).
        if (head.layer() != PresetLayer.SYSTEM && !org.equals(head.org())) throw missing();
        if (head.kind() != expected || version.draft() || head.unavailable() != null
                || (head.layer() != PresetLayer.SYSTEM && head.project() != null && !head.project().equals(project))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_preset", "The selected preset is unavailable.", Map.of());
        }
        return version;
    }

    public Rules rules(Version version) {
        ObjectNode doc = version.doc().deepCopy();
        if (version.number() != null) doc.put("version", Integer.toString(version.number()));   // "v3" in labels (A-34)
        return rules(doc, version.parent());
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
            // the published number, so a chain reads "Petra rules v3 → As modelled v1", never the id (review A-34)
            if (parent.number() != null) doc.put("version", Integer.toString(parent.number()));
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
                editor == null ? null : new UserRef(editorId, editor), row.getString("unavailable_reason"),
                row.getBoolean("org_default"));
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
                name == null ? null : new UserRef(row.getObject("published_by", UUID.class), name),
                row.getObject("base_version_id", UUID.class), row.getObject("base_number", Integer.class));
    }

    /**
     * Review A-44: each preset version with its preset, whether the preset is archived and, when `newer`, the
     * latest published version if it is newer. In the order given; unknown ids are left out.
     */
    public List<com.boqlet.contract.model.PresetInputInfo> inputs(List<UUID> versions, boolean newer) {
        var ids = versions.stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return List.of();
        var found = new java.util.HashMap<UUID, com.boqlet.contract.model.PresetInputInfo>();
        database.query("""
                SELECT v.id, v.number, p.id AS preset_id, p.kind, p.layer, p.name, p.archived,
                    p.latest_published_version_id AS latest, lv.number AS latest_number
                FROM preset_versions v JOIN presets p ON p.id = v.preset_id
                LEFT JOIN preset_versions lv ON lv.id = p.latest_published_version_id
                WHERE v.id IN (""" + String.join(",", java.util.Collections.nCopies(ids.size(), "?")) + ")", row -> {
            var info = new com.boqlet.contract.model.PresetInputInfo(row.getObject("id", UUID.class),
                    row.getObject("preset_id", UUID.class), PresetKind.fromValue(row.getString("kind")),
                    PresetLayer.fromValue(row.getString("layer")), row.getString("name"), row.getBoolean("archived"))
                    .number(row.getObject("number", Integer.class));
            Integer number = row.getObject("number", Integer.class);
            Integer latest = row.getObject("latest_number", Integer.class);
            if (newer && latest != null && number != null && latest > number) {
                info.newerVersionAvailable(latest).latestVersionId(row.getObject("latest", UUID.class));
            }
            found.put(info.getVersionId(), info);
        }, ids.toArray());
        return ids.stream().map(found::get).filter(java.util.Objects::nonNull).toList();
    }

    static ApiException missing() {
        return new ApiException(HttpStatus.NOT_FOUND, "not_found", "The preset or version was not found.", Map.of());
    }
}
