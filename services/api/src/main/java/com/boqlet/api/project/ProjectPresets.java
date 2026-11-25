package com.boqlet.api.project;

import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.contract.model.ProjectDefaults;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
class ProjectPresets {
    private final JdbcTemplate database;
    private final StoredJson json;

    ProjectPresets(JdbcTemplate database, StoredJson json) {
        this.database = database;
        this.json = json;
    }

    ProjectDefaults defaults(UUID org) {
        // Review A-45: the presets library editors chose as "Default for new projects" (one rule set), not the starred ones.
        List<UUID> rules = chosen(org, "rule_set", "name, id");
        var dictionaries = new ArrayList<>(system("dictionary", "global-seed"));
        dictionaries.addAll(chosen(org, "dictionary", "name, id"));
        return new ProjectDefaults()
                .ruleSetVersionId((rules.isEmpty() ? system("rule_set", "as-modelled") : rules).stream().findFirst().orElse(null))
                .classificationVersionIds(chosen(org, "classification", "name, id"))
                .dictionaryVersionIds(dictionaries).federationVersionId(null);
    }

    ProjectDefaults sampleDefaults() {
        return new ProjectDefaults().ruleSetVersionId(system("rule_set", "as-modelled").getFirst())
                .classificationVersionIds(system("classification", "acme-cost-codes"))
                .dictionaryVersionIds(system("dictionary", "global-seed"));
    }

    void validate(UUID org, UUID project, ProjectDefaults defaults) {
        if (defaults.getRuleSetVersionId().isPresent()) require(org, project, "rule_set", defaults.getRuleSetVersionId().get());
        if (defaults.getFederationVersionId().isPresent()) require(org, project, "federation", defaults.getFederationVersionId().get());
        if (defaults.getClassificationVersionIds() != null) {
            defaults.getClassificationVersionIds().forEach(id -> require(org, project, "classification", id));
        }
        if (defaults.getDictionaryVersionIds() != null) {
            defaults.getDictionaryVersionIds().forEach(id -> require(org, project, "dictionary", id));
        }
    }

    void createDictionary(UUID org, UUID project, UUID actor, UUID preset, String name) {
        UUID version = Ids.newId();
        String slug = "project-" + project;
        String dictionaryName = name + " names";
        database.update("""
                INSERT INTO presets (id, org_id, project_id, layer, kind, slug, name, latest_published_version_id, updated_by)
                VALUES (?, ?, ?, 'project', 'dictionary', ?, ?, ?, ?)
                """, preset, org, project, slug, dictionaryName, version, actor);
        String doc = json.object(Map.of("schemaVersion", "1.0", "id", slug, "name", dictionaryName,
                "version", "1", "layer", "project", "entries", List.of())).toString();
        database.update("""
                INSERT INTO preset_versions (id, preset_id, number, status, doc, published_by, published_at, updated_by)
                VALUES (?, ?, 1, 'published', CAST(? AS jsonb), ?, now(), ?)
                """, version, preset, doc, actor, actor);
    }

    private List<UUID> chosen(UUID org, String kind, String order) {
        return database.queryForList("""
                SELECT latest_published_version_id FROM presets
                WHERE org_id = ? AND layer = 'org' AND kind = ? AND org_default AND NOT archived
                    AND latest_published_version_id IS NOT NULL ORDER BY
                """ + " " + order, UUID.class, org, kind);
    }

    private List<UUID> system(String kind, String slug) {
        return database.queryForList("""
                SELECT latest_published_version_id FROM presets WHERE layer = 'system' AND kind = ? AND slug = ?
                    AND latest_published_version_id IS NOT NULL
                """, UUID.class, kind, slug);
    }

    private void require(UUID org, UUID project, String kind, UUID version) {
        if (version == null) return;
        if (!Boolean.TRUE.equals(database.queryForObject("""
                SELECT EXISTS (
                    SELECT 1 FROM preset_versions v JOIN presets p ON p.id = v.preset_id
                    WHERE v.id = ? AND v.status = 'published' AND p.kind = ?
                      AND (p.layer = 'system' OR (p.org_id = ? AND (p.project_id IS NULL OR p.project_id = ?)))
                )
                """, Boolean.class, version, kind, org, project))) {
            throw ProjectAccess.error(HttpStatus.BAD_REQUEST, "invalid_preset", "A preset input is unavailable for this project.");
        }
    }
}
