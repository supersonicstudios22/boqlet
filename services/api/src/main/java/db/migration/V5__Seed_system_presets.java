package db.migration;

import db.migration.SystemPresetFiles.Preset;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.UUID;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

/** Seeds version 1 of every system preset; later file changes are published by R__Sync_system_presets. */
public class V5__Seed_system_presets extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        var presets = new SystemPresetFiles().read();

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
        return SystemPresetFiles.id(type, kind, slug, 1);
    }
}
