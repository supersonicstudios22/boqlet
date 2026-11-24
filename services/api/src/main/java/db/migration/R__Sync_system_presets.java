package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

/**
 * Repeatable: runs after the versioned migrations whenever a shipped preset file changes (its
 * checksum covers every file under `system-presets/`), and publishes the changed presets as new
 * system versions (SystemPresetSync). On a fresh database V5 has just seeded the same files: nothing
 * is published.
 */
public class R__Sync_system_presets extends BaseJavaMigration {
    @Override
    public Integer getChecksum() {
        try {
            return new SystemPresetFiles().checksum();
        } catch (java.io.IOException e) {
            throw new IllegalStateException("The system presets cannot be read.", e);
        }
    }

    @Override
    public void migrate(Context context) throws Exception {
        new SystemPresetSync(context.getConnection()).sync(new SystemPresetFiles().read());
    }
}
