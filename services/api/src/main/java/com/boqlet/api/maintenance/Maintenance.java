package com.boqlet.api.maintenance;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.model.Models;
import com.boqlet.api.storage.ObjectStorage;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class Maintenance {
    private static final Logger LOG = LoggerFactory.getLogger(Maintenance.class);
    private final JdbcTemplate database;
    private final TransactionTemplate transactions;
    private final ObjectStorage storage;
    private final StoredJson json;
    private final AuditWriter audit;
    private final long purgeHours;
    private final int indexDays;

    Maintenance(JdbcTemplate database, TransactionTemplate transactions, ObjectStorage storage, StoredJson json, AuditWriter audit,
                @Value("${BOQLET_ORG_PURGE_HOURS:24}") long purgeHours,
                @Value("${BOQLET_RUN_INDEX_DAYS:30}") int indexDays) {
        this.database = database;
        this.transactions = transactions;
        this.storage = storage;
        this.json = json;
        this.audit = audit;
        this.purgeHours = Math.clamp(purgeHours, 2, 696);
        this.indexDays = Math.max(1, indexDays);
    }

    @Scheduled(fixedDelayString = "${BOQLET_MAINTENANCE_POLL_MS:900000}", initialDelay = 30000)
    public void expire() {
        leader(1, () -> database.update("""
                WITH stale AS MATERIALIZED (
                    SELECT id FROM sessions WHERE status = 'active' AND last_seen_at <= now() - interval '12 hours'
                    LIMIT 1000 FOR NO KEY UPDATE SKIP LOCKED
                )
                UPDATE sessions SET status = 'expired', ended_at = now() FROM stale WHERE sessions.id = stale.id
                """));
        leader(2, () -> {
            database.update("""
                    UPDATE org_invitations SET status = 'expired', updated_at = now()
                    WHERE status = 'pending' AND expires_at <= now()
                    """);
            database.update("DELETE FROM realtime_events WHERE created_at < now() - interval '10 minutes'");
            database.update("DELETE FROM boq_presence WHERE expires_at <= now()");
            database.update("DELETE FROM idempotency_keys WHERE created_at <= now() - interval '24 hours'");
            database.update("DELETE FROM limit_notifications WHERE period < current_date - interval '1 year'");
            database.update("DELETE FROM provider_session_revocations WHERE created_at < now() - interval '7 days'");
        });
    }

    @Scheduled(fixedDelayString = "${BOQLET_RETENTION_POLL_MS:3600000}", initialDelay = 60000)
    public void retain() {
        leader(3, this::pruneIndex);
        leader(4, this::pruneAudit);
        leader(5, this::abandonedUploads);
        leader(6, this::expiredExports);
        leader(7, this::expiredEphemeralJobs);
        leader(8, this::purgeOrganisation);
        leader(9, this::expiredTemplates);
    }

    private void pruneIndex() {
        var runs = database.queryForList("""
                SELECT n.id FROM runs n WHERE n.result_key IS NOT NULL AND n.indexed_at < now() - (? * interval '1 day')
                    AND NOT EXISTS(SELECT 1 FROM boq_revisions r WHERE r.current_run_id = n.id OR (r.frozen->>'runId') = n.id::text)
                    AND NOT EXISTS(SELECT 1 FROM share_links s WHERE s.run_id = n.id AND s.revoked_at IS NULL)
                ORDER BY n.indexed_at, n.id LIMIT 20 FOR NO KEY UPDATE SKIP LOCKED
                """, UUID.class, indexDays);
        for (UUID run : runs) {
            database.update("DELETE FROM run_lines WHERE run_id = ?", run);
            database.update("DELETE FROM run_questions WHERE run_id = ?", run);
            database.update("DELETE FROM run_warnings WHERE run_id = ?", run);
            database.update("DELETE FROM run_log_entries WHERE run_id = ?", run);
            database.update("UPDATE runs SET indexed_at = NULL WHERE id = ?", run);
        }
    }

    private void pruneAudit() {
        database.update("""
                WITH policy AS (SELECT s.org_id, (p.entitlements || s.overrides)->'auditLogRetentionDays' AS days
                    FROM subscriptions s JOIN plans p ON p.id = s.plan_id)
                DELETE FROM audit_events WHERE id IN (
                    SELECT a.id FROM audit_events a JOIN policy r ON r.org_id = a.org_id
                    WHERE jsonb_typeof(r.days) = 'number' AND a.created_at < now() -
                        ((r.days #>> '{}')::numeric * interval '1 day')
                    ORDER BY a.created_at LIMIT 10000)
                """);
    }

    /** An upload not completed within 24 h fails (`upload_expired`, audited), it isn't hidden (TF-031). */
    private void abandonedUploads() {
        var uploads = database.query("""
                SELECT v.id, v.org_id, m.project_id, v.upload_key, v.multipart_id FROM model_versions v
                JOIN models m ON m.id = v.model_id
                WHERE v.status = 'awaiting_upload' AND v.created_at < now() - interval '24 hours' AND v.deleted_at IS NULL
                ORDER BY v.created_at LIMIT 20 FOR NO KEY UPDATE OF v SKIP LOCKED
                """, (row, index) -> new Abandoned(row.getObject("id", UUID.class), row.getObject("org_id", UUID.class),
                row.getObject("project_id", UUID.class), row.getString("upload_key"), row.getString("multipart_id")));
        for (var upload : uploads) {
            if (upload.multipart() != null) storage.abort(upload.key(), upload.multipart());
            storage.deletePrefix(ObjectStorage.orgPrefix(upload.org()) + "uploads/" + upload.id() + "/");
            Models.expireUpload(database, json, audit, upload.org(), upload.project(), upload.id());
        }
    }

    /**
     * A preset's Excel template is written to storage only to be downloaded through a 5-minute signed URL
     * (`LibraryFiles.template`): after a day it is deleted (TF-061; it was kept for ever).
     */
    private void expiredTemplates() {
        var before = java.time.Instant.now().minus(java.time.Duration.ofDays(1));
        storage.deleteOlderThan("system/templates/", before);
        for (UUID org : database.queryForList("SELECT id FROM orgs", UUID.class)) {
            storage.deleteOlderThan(ObjectStorage.orgPrefix(org) + "templates/", before);
        }
    }

    private void expiredExports() {
        var exports = database.query("""
                SELECT id, org_id FROM exports WHERE kind <> 'issued_boq_xlsx' AND storage_key IS NOT NULL
                    AND created_at < now() - interval '90 days' ORDER BY created_at LIMIT 20 FOR NO KEY UPDATE SKIP LOCKED
                """, (row, index) -> new Owned(row.getObject("id", UUID.class), row.getObject("org_id", UUID.class)));
        for (var export : exports) {
            storage.deletePrefix(ObjectStorage.orgPrefix(export.org()) + "exports/" + export.id() + "/");
            database.update("DELETE FROM exports WHERE id = ?", export.id());
        }
    }

    private void expiredEphemeralJobs() {
        var jobs = database.query("""
                SELECT id, org_id, output_prefix, input->>'fileKey' AS upload_key FROM jobs
                WHERE type IN ('preview','import_boq_edits') AND status IN ('succeeded','failed','cancelled')
                    AND finished_at < now() - interval '7 days' ORDER BY finished_at LIMIT 20 FOR NO KEY UPDATE SKIP LOCKED
                """, (row, index) -> new Ephemeral(row.getObject("id", UUID.class), row.getObject("org_id", UUID.class),
                    row.getString("output_prefix"), row.getString("upload_key")));
        for (var job : jobs) {
            String prefix = ObjectStorage.orgPrefix(job.org());
            if (job.output().startsWith(prefix)) storage.deletePrefix(job.output());
            if (job.upload() != null && job.upload().startsWith(prefix)) storage.delete(job.upload());
            database.update("DELETE FROM jobs WHERE id = ?", job.id());
        }
    }

    private void purgeOrganisation() {
        var candidates = database.queryForList("""
                SELECT o.id FROM orgs o WHERE o.status = 'deleting' AND o.deleting_at <= now() - (? * interval '1 hour')
                    AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.org_id = o.id AND j.status IN ('queued','running'))
                ORDER BY o.deleting_at LIMIT 1 FOR NO KEY UPDATE OF o SKIP LOCKED
                """, UUID.class, purgeHours);
        for (UUID org : candidates) {
            storage.deletePrefix(ObjectStorage.orgPrefix(org));
            database.update("DELETE FROM audit_events WHERE org_id = ? OR data->>'orgId' = ?", org, org.toString());
            database.update("DELETE FROM realtime_events WHERE org_id = ?", org);
            database.update("DELETE FROM orgs WHERE id = ?", org);
        }
    }

    private void leader(long task, Runnable action) {
        try {
            transactions.executeWithoutResult(status -> {
                if (Boolean.TRUE.equals(database.queryForObject("SELECT pg_try_advisory_xact_lock(?)",
                        Boolean.class, 384215000L + task))) action.run();
            });
        } catch (RuntimeException failure) {
            LOG.error("Maintenance task {} failed.", task, failure);
        }
    }

    private record Owned(UUID id, UUID org) {}
    private record Abandoned(UUID id, UUID org, UUID project, String key, String multipart) {}
    private record Ephemeral(UUID id, UUID org, String output, String upload) {}
}
