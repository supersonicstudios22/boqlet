package db.migration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.node.ObjectNode;
import db.migration.SystemPresetFiles.Preset;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * System presets reach a database seeded earlier (review WP-A3: the preset changes of A-10..A-13 never
 * left the seed). A fresh database publishes nothing beyond version 1; a changed file publishes the
 * next version and re-publishes the presets built on it; published versions never change.
 */
@Testcontainers
class SystemPresetSyncTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    private Connection connect() throws Exception {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private static Object one(Connection db, String sql, Object... args) throws Exception {
        try (var query = db.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) query.setObject(i + 1, args[i]);
            try (var row = query.executeQuery()) {
                return row.next() ? row.getObject(1) : null;
            }
        }
    }

    private static Object latestNumber(Connection db, String slug) throws Exception {
        return one(db, """
                SELECT v.number FROM presets p JOIN preset_versions v ON v.id = p.latest_published_version_id
                WHERE p.layer = 'system' AND p.kind = 'rule_set' AND p.slug = ?
                """, slug);
    }

    private static UUID latestId(Connection db, String slug) throws Exception {
        return (UUID) one(db, "SELECT latest_published_version_id FROM presets WHERE layer = 'system' AND kind = 'rule_set' AND slug = ?", slug);
    }

    @Test
    void aChangedFilePublishesTheNextVersionAndEverythingBuiltOnIt() throws Exception {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").load().migrate();
        try (var db = connect()) {
            // a fresh database: the seed and the files agree, the sync published nothing
            assertThat(latestNumber(db, "as-modelled")).isEqualTo(1);
            assertThat(new SystemPresetSync(db).sync(new SystemPresetFiles().read())).isEmpty();
            UUID asModelledV1 = latestId(db, "as-modelled");
            UUID standardV1 = latestId(db, "standard-style-example");
            String v1Doc = (String) one(db, "SELECT doc::text FROM preset_versions WHERE id = ?", asModelledV1);

            // as-modelled changes: it, and every rule set built on it, get version 2
            var files = new ArrayList<Preset>();
            for (Preset p : new SystemPresetFiles().read()) {
                if (p.kind().equals("rule_set") && p.slug().equals("as-modelled")) {
                    ObjectNode doc = p.doc().deepCopy();
                    ((ObjectNode) doc.path("params").path("formwork_separate")).put("value", false);
                    p = new Preset(p.kind(), p.slug(), p.name(), doc, p.parent(), p.description(), p.unavailable());
                }
                files.add(p);
            }
            List<String> published = new SystemPresetSync(db).sync(files);
            assertThat(published).contains("rule_set:as-modelled", "rule_set:standard-style-example",
                    "rule_set:acme-house-rules", "rule_set:demo-tweaked").doesNotContain("dictionary:global-seed");
            assertThat(latestNumber(db, "as-modelled")).isEqualTo(2);
            assertThat(one(db, "SELECT extends_version_id FROM preset_versions WHERE id = ?", latestId(db, "standard-style-example")))
                    .isEqualTo(latestId(db, "as-modelled"));
            assertThat(one(db, "SELECT extends_version_id FROM preset_versions WHERE id = ?", latestId(db, "acme-house-rules")))
                    .isEqualTo(latestId(db, "standard-style-example"));
            // version 1 is untouched: what pinned it keeps its numbers
            assertThat(one(db, "SELECT doc::text FROM preset_versions WHERE id = ?", asModelledV1)).isEqualTo(v1Doc);
            assertThat(one(db, "SELECT extends_version_id FROM preset_versions WHERE id = ?", standardV1)).isEqualTo(asModelledV1);

            // the same files again: nothing to publish
            assertThat(new SystemPresetSync(db).sync(files)).isEmpty();
        }
    }
}
