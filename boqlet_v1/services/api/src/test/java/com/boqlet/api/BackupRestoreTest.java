package com.boqlet.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.MountableFile;

/**
 * BE-025 restore test (deployment.md "Backups and recovery"; P51: on the local stack, never the
 * pilot). A Postgres set up as the pilot's (its image, `ops/pilot/init-db.sh` and roles, the
 * migrations as `boqlet_app`, the queue grants) is dumped with the command of `ops/pilot/backup.sh`
 * and restored into a fresh database as `ops/pilot/restore-check.sh` does; every table, the
 * migration history and the queue functions come back.
 */
@Testcontainers
class BackupRestoreTest {
    private static final Path PILOT = Path.of("../../ops/pilot").toAbsolutePath().normalize();

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withUsername("boqlet_admin").withPassword("admin-test").withDatabaseName("boqlet_admin")
            .withEnv("BOQLET_DB_PASSWORD", "app-test").withEnv("BOQLET_QUEUE_PASSWORD", "queue-test")
            .withEnv("BOQLET_IDENTITY_DB_PASSWORD", "identity-test")
            .withCopyFileToContainer(MountableFile.forHostPath(PILOT.resolve("init-db.sh"), 0755),
                    "/docker-entrypoint-initdb.d/01-boqlet.sh")
            .withCopyFileToContainer(MountableFile.forHostPath(PILOT.resolve("queue-grants.sql")), "/tmp/queue-grants.sql");

    private static String url(String database) {
        return "jdbc:postgresql://" + POSTGRES.getHost() + ":" + POSTGRES.getMappedPort(5432) + "/" + database;
    }

    private static void sh(String command) throws Exception {
        var result = POSTGRES.execInContainer("sh", "-c", command);
        assertThat(result.getExitCode()).as("%s: %s", command, result.getStderr()).isZero();
    }

    private static Map<String, Long> counts(Connection connection) throws Exception {
        var counts = new LinkedHashMap<String, Long>();
        var tables = new java.util.ArrayList<String>();
        try (var rows = connection.createStatement().executeQuery("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name
                """)) {
            while (rows.next()) tables.add(rows.getString(1));
        }
        for (String table : tables) {
            try (var rows = connection.createStatement().executeQuery("SELECT count(*) FROM public.\"" + table + "\"")) {
                rows.next();
                counts.put(table, rows.getLong(1));
            }
        }
        return counts;
    }

    @Test
    void aDumpOfThePilotDatabaseRestoresEveryTable() throws Exception {
        Flyway.configure().dataSource(url("boqlet"), "boqlet_app", "app-test").locations("classpath:db/migration").load().migrate();
        sh("psql -U boqlet_admin -d boqlet -v ON_ERROR_STOP=1 -f /tmp/queue-grants.sql");
        try (var app = DriverManager.getConnection(url("boqlet"), "boqlet_app", "app-test")) {
            app.createStatement().execute("INSERT INTO users (id, auth_subject, email, name) VALUES ('"
                    + UUID.randomUUID() + "', 'restore-test', 'restore@example.test', 'Restore Test')");
        }

        // backup.sh, then restore-check.sh's restore.
        sh("pg_dump -U boqlet_admin -Fc boqlet > /tmp/boqlet.dump");
        sh("psql -U boqlet_admin -d boqlet_admin -v ON_ERROR_STOP=1 -c 'CREATE DATABASE boqlet_restore_check OWNER boqlet_app'");
        sh("pg_restore -U boqlet_admin --exit-on-error -d boqlet_restore_check /tmp/boqlet.dump");

        try (var live = DriverManager.getConnection(url("boqlet"), "boqlet_admin", "admin-test");
             var restored = DriverManager.getConnection(url("boqlet_restore_check"), "boqlet_admin", "admin-test")) {
            var before = counts(live);
            assertThat(before).containsKeys("users", "orgs", "jobs", "runs", "flyway_schema_history");
            assertThat(before.get("users")).isPositive();
            assertThat(counts(restored)).isEqualTo(before);
            try (var functions = restored.createStatement().executeQuery(
                    "SELECT count(*) FROM pg_proc WHERE proname IN ('queue_claim', 'queue_renew', 'queue_finish')")) {
                functions.next();
                assertThat(functions.getInt(1)).isEqualTo(3);
            }
            try (var grants = restored.createStatement().executeQuery(
                    "SELECT has_function_privilege('boqlet_queue', 'public.queue_claim(uuid, text, text[])', 'EXECUTE')")) {
                grants.next();
                assertThat(grants.getBoolean(1)).as("queue grants survive the restore").isTrue();
            }
        }
    }
}
