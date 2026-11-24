package db.migration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.zip.CRC32;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

/**
 * The system presets as shipped: the repository's `presets/` folder, copied to the classpath as
 * `system-presets/` (pom.xml). Read by the seed (V5) and by the sync that publishes a new version
 * whenever a file changes (R__Sync_system_presets).
 */
final class SystemPresetFiles {
    static final String ROOT = "classpath:/system-presets/";
    private static final List<String> CLASSIFICATIONS = List.of("acme-cost-codes", "demo-trades", "uniclass2015-ef");
    private final ObjectMapper json = new ObjectMapper();
    private final PathMatchingResourcePatternResolver files = new PathMatchingResourcePatternResolver();

    record Preset(String kind, String slug, String name, JsonNode doc, String parent,
                  String description, String unavailable) {}

    List<Preset> read() throws IOException {
        var presets = new ArrayList<Preset>();
        addFolder(presets, "rule_set", "rules");
        addFolder(presets, "dictionary", "dictionaries");
        for (String slug : CLASSIFICATIONS) {
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
        return presets;
    }

    /** A checksum of every shipped preset file, so the sync runs again whenever one changes. */
    int checksum() throws IOException {
        var crc = new CRC32();
        Resource[] all = files.getResources(ROOT + "**/*.json");
        Arrays.sort(all, Comparator.comparing(SystemPresetFiles::path));
        for (Resource file : all) {
            crc.update(path(file).getBytes(StandardCharsets.UTF_8));
            try (var stream = file.getInputStream()) {
                crc.update(stream.readAllBytes());
            }
        }
        return (int) crc.getValue();
    }

    private static String path(Resource file) {
        try {
            String url = file.getURL().toString();
            int at = url.lastIndexOf("system-presets/");
            return at < 0 ? url : url.substring(at);
        } catch (IOException e) {
            throw new IllegalStateException(e);
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

    /** Version 1 keeps the seed's ids (V5); later versions are numbered the same way. */
    static UUID id(String type, String kind, String slug, int number) {
        return UUID.nameUUIDFromBytes(("boqlet:system:" + type + ":" + kind + ":" + slug + ":" + number)
                .getBytes(StandardCharsets.UTF_8));
    }
}
