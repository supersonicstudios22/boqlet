package db.migration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

public class V5__Seed_system_presets extends BaseJavaMigration {
    private static final String ROOT = "classpath:/system-presets/";
    private final ObjectMapper json = new ObjectMapper();
    private final PathMatchingResourcePatternResolver files = new PathMatchingResourcePatternResolver();

    @Override
    public void migrate(Context context) throws Exception {
        var presets = new ArrayList<Preset>();
        addFolder(presets, "rule_set", "rules");
        addFolder(presets, "dictionary", "dictionaries");
        for (String slug : List.of("acme-cost-codes", "demo-trades", "uniclass2015-ef")) {
            String folder = ROOT + "classifications/" + slug + "/";
            var map = read(files.getResource(folder + "map.json"));
            var codeList = files.getResource(folder + "codelist.json");
            ObjectNode doc = json.createObjectNode().set("map", map);
            var codes = codeList.exists() ? read(codeList) : json.nullNode();
            doc.set("codeList", codes);
            presets.add(new Preset("classification", slug, codes.path("name").asText(map.path("name").asText(slug)),
                    doc, null, null, codes.isNull() ? "code_list_not_downloaded" : null));
        }
        presets.add(readPreset("federation", files.getResource(ROOT + "settings/federation.json"),
                "federation-default", "Default discipline ownership"));
        presets.add(readPreset("resolution", files.getResource(ROOT + "settings/resolution.json"),
                "resolution-default", "Default resolution settings"));
        if (presets.stream().noneMatch(preset -> preset.slug().equals("as-modelled"))
                || presets.stream().noneMatch(preset -> preset.slug().equals("global-seed"))) {
            throw new IllegalStateException("The built-in project defaults are missing.");
        }

        try (var insertPreset = context.getConnection().prepareStatement("""
                     INSERT INTO presets (id, layer, kind, slug, name, description, based_on, latest_published_version_id,
                                          unavailable_reason)
                     VALUES (?, 'system', ?, ?, ?, ?, ?, ?, ?)
                     """);
             var insertVersion = context.getConnection().prepareStatement("""
                     INSERT INTO preset_versions (id, preset_id, number, status, doc, published_at)
                     VALUES (?, ?, 1, 'published', CAST(? AS jsonb), now())
                     """);
             var updateParent = context.getConnection().prepareStatement("""
                     UPDATE preset_versions SET extends_version_id = ? WHERE id = ?
                     """)) {
            for (Preset preset : presets) insert(preset, insertPreset, insertVersion);
            for (Preset preset : presets) {
                if (preset.parent() != null) {
                    updateParent.setObject(1, id("version", preset.kind(), preset.parent()));
                    updateParent.setObject(2, id("version", preset.kind(), preset.slug()));
                    updateParent.executeUpdate();
                }
            }
        }
    }

    private void addFolder(List<Preset> presets, String kind, String folder) throws IOException {
        for (Resource file : files.getResources(ROOT + folder + "/*.json")) {
            presets.add(readPreset(kind, file, null, null));
        }
    }

    private Preset readPreset(String kind, Resource file, String fallbackSlug, String fallbackName) throws IOException {
        JsonNode document = read(file);
        String slug = document.path("id").asText(fallbackSlug);
        String name = document.path("name").asText(fallbackName);
        if (slug == null || name == null) throw new IllegalStateException("Missing preset ID or name in " + file.getFilename());
        return new Preset(kind, slug, name, document, document.path("extends").asText(null),
                document.path("meta").path("description").asText(null), null);
    }

    private JsonNode read(Resource file) throws IOException {
        try (var stream = file.getInputStream()) {
            return json.readTree(stream);
        }
    }

    private static void insert(Preset preset, PreparedStatement insertPreset, PreparedStatement insertVersion) throws SQLException {
        UUID id = id("preset", preset.kind(), preset.slug());
        UUID version = id("version", preset.kind(), preset.slug());
        insertPreset.setObject(1, id);
        insertPreset.setString(2, preset.kind());
        insertPreset.setString(3, preset.slug());
        insertPreset.setString(4, preset.name());
        insertPreset.setString(5, preset.description());
        insertPreset.setString(6, preset.parent());
        insertPreset.setObject(7, version);
        insertPreset.setString(8, preset.unavailable());
        insertPreset.executeUpdate();
        insertVersion.setObject(1, version);
        insertVersion.setObject(2, id);
        insertVersion.setString(3, preset.doc().toString());
        insertVersion.executeUpdate();
    }

    private static UUID id(String type, String kind, String slug) {
        return UUID.nameUUIDFromBytes(("boqlet:system:" + type + ":" + kind + ":" + slug + ":1")
                .getBytes(StandardCharsets.UTF_8));
    }

    private record Preset(String kind, String slug, String name, JsonNode doc, String parent,
                          String description, String unavailable) {}
}
