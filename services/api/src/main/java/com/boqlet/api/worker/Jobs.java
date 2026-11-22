package com.boqlet.api.worker;

import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.api.realtime.Notifications;
import com.boqlet.api.storage.ObjectStorage;
import com.boqlet.contract.model.Job;
import com.boqlet.contract.model.JobError;
import com.boqlet.contract.model.JobProgress;
import com.boqlet.contract.model.JobStatus;
import com.fasterxml.jackson.databind.JsonNode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.math.BigDecimal;
import java.util.List;
import java.util.Objects;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class Jobs {
    private static final Set<String> METERED = Set.of("parse", "run", "preview");
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(Jobs.class);
    private final io.micrometer.core.instrument.MeterRegistry meters;
    private final JdbcTemplate database;
    private final StoredJson json;
    private final EntitlementService limits;
    private final ProjectAccess projects;
    private final OrgAccess orgs;
    private final ObjectStorage storage;
    private final Notifications notifications;
    private final Map<String, JobHandler> handlers;
    private final String transport;
    private final String modelPool;
    private final String generalPool;

    Jobs(JdbcTemplate database, StoredJson json, EntitlementService limits, ProjectAccess projects, OrgAccess orgs, ObjectStorage storage,
         List<JobHandler> handlers, Notifications notifications, io.micrometer.core.instrument.MeterRegistry meters,
         @Value("${BOQLET_ENGINE_TRANSPORT:http}") String transport,
         @Value("${BOQLET_ENGINE_MODEL_POOL:default}") String modelPool,
         @Value("${BOQLET_ENGINE_GENERAL_POOL:default}") String generalPool) {
        this.database = database;
        this.json = json;
        this.limits = limits;
        this.projects = projects;
        this.orgs = orgs;
        this.storage = storage;
        this.notifications = notifications;
        this.meters = meters;
        if (!Set.of("http", "postgres").contains(transport)) throw new IllegalArgumentException("Invalid BOQLET_ENGINE_TRANSPORT.");
        this.transport = transport;
        this.modelPool = modelPool;
        this.generalPool = generalPool;
        this.handlers = handlers.stream().collect(Collectors.toUnmodifiableMap(JobHandler::type, Function.identity()));
    }

    public record Attempt(UUID id, String type, UUID org, UUID project, UUID subject, UUID actor, String prefix,
                          JsonNode input, int number, int maxAttempts, String contract, OffsetDateTime startedAt, boolean metered) {
        public String attemptPrefix() {
            return prefix.replaceAll("/+$", "") + "/attempt-" + number + "/";
        }

        Map<String, Object> envelope() {
            return Map.of("jobId", id, "type", type, "orgId", org, "input", input,
                    "outputPrefix", attemptPrefix(), "attempt", number, "contract", contract);
        }
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public UUID enqueue(String type, UUID org, UUID project, UUID actor, String subjectType, UUID subject,
                        String prefix, Map<String, ?> input, int priority) {
        return enqueue(type, org, project, actor, subjectType, subject, prefix, input, priority, true);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public UUID enqueue(String type, UUID org, UUID project, UUID actor, String subjectType, UUID subject,
                        String prefix, Map<String, ?> input, int priority, boolean metered) {
        if (!handlers.containsKey(type)) throw new IllegalArgumentException("Unregistered job type " + type);
        if (metered && METERED.contains(type)) {
            BigDecimal used = limits.processingMillis(org, YearMonth.now(ZoneOffset.UTC));
            limits.checkConsumption(org, actor, "processingMinutesPerMonth", used, 60_000);
        }
        UUID id = Ids.newId();
        database.update("""
                INSERT INTO jobs (id, type, org_id, project_id, created_by, subject_type, subject_id, output_prefix,
                                  input, priority, metered, transport, pool)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, ?)
                """, id, type, org, project, actor, subjectType, subject, prefix, json.object(input).toString(), priority,
                metered, transport, METERED.contains(type) || type.equals("diff") ? modelPool : generalPool);
        return id;
    }

    public Job get(UUID id, UUID actor) {
        var row = record(id);
        readable(row, actor);
        var output = row.job().getOutput();
        if (output != null && output.remove("previewObjectKey") instanceof String key) {
            output.put("previewResultUrl", storage.download(key, "private, no-store", "application/json").toString());
        }
        return row.job();
    }

    @Transactional
    public Job cancel(UUID id, UUID actor) {
        var row = record(id);
        readable(row, actor);
        if (row.project() != null) {
            projects.lock(row.project(), actor, switch (row.job().getType()) {
                case "parse" -> "editModels";
                case "preview" -> "editPresets";
                default -> "editBoqs";
            });
        } else {
            orgs.lock(row.org(), actor, com.boqlet.contract.model.OrgRole.OWNER, com.boqlet.contract.model.OrgRole.ADMIN);
        }
        var attempts = database.query("SELECT * FROM jobs WHERE id = ? FOR UPDATE", this::attempt, id);
        var current = record(id).job().getStatus();
        if (current == JobStatus.QUEUED) {
            finishTerminal(attempts.getFirst(), "cancelled", json.object(Map.of()), OffsetDateTime.now(ZoneOffset.UTC));
        } else if (current == JobStatus.RUNNING) {
            database.update("UPDATE jobs SET cancel_requested = true WHERE id = ?", id);
        } else {
            throw new ApiException(HttpStatus.CONFLICT, "invalid_transition", "This job has already finished.", Map.of());
        }
        return record(id).job();
    }

    @Transactional
    public Attempt claim(UUID dispatcher) {
        var available = database.query("""
                UPDATE jobs SET status = 'running', attempts = attempts + 1, worker_id = ?,
                                heartbeat_at = now(), started_at = now(), error = NULL, progress = NULL
                WHERE id = (
                    SELECT id FROM jobs WHERE status = 'queued' AND transport = 'http' AND available_at <= now()
                    ORDER BY priority, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
                ) RETURNING *
                """, this::attempt, dispatcher);
        if (available.isEmpty()) return null;
        Attempt claimed = available.getFirst();
        handlers.get(claimed.type()).running(claimed);
        return claimed;
    }

    public boolean heartbeat(Attempt attempt, UUID dispatcher) {
        return database.update("""
                UPDATE jobs SET heartbeat_at = now()
                WHERE id = ? AND status = 'running' AND attempts = ? AND worker_id = ? AND NOT cancel_requested
                """, attempt.id(), attempt.number(), dispatcher) == 1;
    }

    public void progress(Attempt attempt, JsonNode progress) {
        var publicProgress = json.object(progress);
        publicProgress.remove("jobId");
        database.update("""
                UPDATE jobs SET progress = CAST(? AS jsonb)
                WHERE id = ? AND attempts = ? AND status = 'running' AND NOT cancel_requested
                """, publicProgress.toString(), attempt.id(), attempt.number());
    }

    @Transactional
    public void reclaimLostJobs() {
        var stale = database.query("""
                SELECT * FROM jobs WHERE status = 'running' AND worker_result IS NULL
                    AND heartbeat_at < now() - interval '30 seconds'
                ORDER BY heartbeat_at LIMIT 20 FOR UPDATE SKIP LOCKED
                """, (row, index) -> new Lost(attempt(row, index), row.getBoolean("cancel_requested")));
        for (Lost lost : stale) {
            Attempt attempt = lost.attempt();
            if (!lost.cancelled() && attempt.number() < attempt.maxAttempts()) {
                requeue(attempt);
            } else {
                finishTerminal(attempt, lost.cancelled() ? "cancelled" : "failed",
                        json.object(Map.of("error", Map.of("code", "worker_lost",
                                "message", "The worker stopped before completing the job.", "retryable", true))),
                        OffsetDateTime.now(ZoneOffset.UTC));
            }
        }
    }

    @Transactional
    public void finish(Attempt attempt, UUID dispatcher, JsonNode result) {
        var rows = database.queryForList("""
                SELECT cancel_requested FROM jobs WHERE id = ? AND attempts = ? AND worker_id = ? AND status = 'running'
                FOR UPDATE
                """, Boolean.class, attempt.id(), attempt.number(), dispatcher);
        if (rows.isEmpty()) return;
        complete(attempt, rows.getFirst(), result);
    }

    List<UUID> pendingQueueJobs() {
        return database.queryForList("""
                SELECT id FROM jobs WHERE status = 'running' AND transport = 'postgres'
                    AND (worker_result IS NOT NULL OR NOT worker_announced)
                ORDER BY created_at, id LIMIT 20
                """, UUID.class);
    }

    @Transactional
    public void ingestQueueJob(UUID id, boolean failedIngestion) {
        database.query("""
                SELECT * FROM jobs WHERE id = ? AND status = 'running' AND transport = 'postgres'
                    AND (worker_result IS NOT NULL OR NOT worker_announced) FOR NO KEY UPDATE SKIP LOCKED
                """, (row, index) -> new Delivery(attempt(row, index), row.getBoolean("worker_announced"),
                row.getBoolean("cancel_requested"), json.read(row.getString("worker_result"), JsonNode.class)), id)
                .stream().findFirst().ifPresent(delivery -> {
            var attempt = delivery.attempt();
            if (failedIngestion) {
                var failure = json.object(Map.of("status", "failed", "error", Map.of(
                        "code", "ingestion_failed", "message", "The server could not ingest the worker result.", "retryable", true)));
                complete(attempt, delivery.cancelled(), failure);
                return;
            }
            if (!delivery.announced()) {
                handlers.get(attempt.type()).running(attempt);
                database.update("UPDATE jobs SET worker_announced = true WHERE id = ?", id);
            }
            if (delivery.result() != null) complete(attempt, delivery.cancelled(), delivery.result());
        });
    }

    private record Delivery(Attempt attempt, boolean announced, boolean cancelled, JsonNode result) {}

    private void complete(Attempt attempt, boolean cancelled, JsonNode result) {
        String status = cancelled ? "cancelled" : result.path("status").asText("failed");
        if (!Set.of("succeeded", "failed", "cancelled").contains(status)) {
            throw new IllegalStateException("Invalid terminal job status.");
        }
        if ("failed".equals(status) && result.path("error").path("retryable").asBoolean(false)
                && attempt.number() < attempt.maxAttempts()) {
            requeue(attempt);
            return;
        }
        finishTerminal(attempt, status, result, OffsetDateTime.now(ZoneOffset.UTC));
    }

    private void requeue(Attempt attempt) {
        // The failed attempt's processing time counts (BR-62, TF-036); the wait for the retry doesn't: started_at
        // is cleared until the next claim sets it again.
        database.update("""
                UPDATE jobs SET status = 'queued', available_at = now() + (? * interval '10 seconds'),
                                processing_ms = processing_ms + coalesce(greatest(0, (extract(epoch FROM now() - started_at) * 1000)::bigint), 0),
                                started_at = NULL,
                                worker_id = NULL, heartbeat_at = NULL, progress = NULL, worker_result = NULL, worker_announced = false
                WHERE id = ?
                """, attempt.number(), attempt.id());
    }

    private void finishTerminal(Attempt attempt, String status, JsonNode result, OffsetDateTime finished) {
        try (var scope = com.boqlet.api.http.LogContext.job(attempt.id(), attempt.org())) {
            finishTerminalLogged(attempt, status, result, finished);
        }
    }

    /**
     * Size class of a job by its model (nfr.md "Model processing"): small < 20 MB, medium up to
     * 300 MB, large above; runs and other jobs without a model size are "none".
     */
    static String sizeClass(JsonNode metrics) {
        long bytes = metrics.path("modelBytes").asLong(-1);
        if (bytes < 0) return "none";
        return bytes < 20L << 20 ? "small" : bytes <= 300L << 20 ? "medium" : "large";
    }

    private void finishTerminalLogged(Attempt attempt, String status, JsonNode result, OffsetDateTime finished) {
        if (attempt.startedAt() != null) {
            var took = java.time.Duration.between(attempt.startedAt(), finished);
            meters.timer("boqlet.jobs.duration", "type", attempt.type(), "status", status, "size", sizeClass(result.path("metrics")))
                    .record(took);
            log.atInfo().addKeyValue("jobType", attempt.type()).addKeyValue("jobStatus", status)
                    .addKeyValue("attempt", attempt.number()).addKeyValue("durationMs", took.toMillis())
                    .log("Job {} {} after {} ms", attempt.type(), status, took.toMillis());
        }
        Map<String, Object> output = handlers.get(attempt.type()).finished(attempt, status, result);
        JsonNode error = "failed".equals(status) ? result.get("error") : null;
        database.update("""
                UPDATE jobs SET status = ?, finished_at = ?, output = CAST(? AS jsonb), error = CAST(? AS jsonb),
                                worker_id = NULL, heartbeat_at = NULL, worker_result = NULL WHERE id = ?
                """, status, finished, output == null ? null : json.object(output).toString(),
                error == null ? null : error.toString(), attempt.id());
        // A usage event for every parse, run and preview that ends, cancelled ones too (BR-62, TF-036): the
        // earlier attempts' processing time plus this attempt's (none for a job cancelled while it waited).
        if (attempt.metered() && METERED.contains(attempt.type())) {
            var metrics = result.path("metrics");
            long earlier = Objects.requireNonNullElse(database.queryForObject("SELECT processing_ms FROM jobs WHERE id = ?",
                    Long.class, attempt.id()), 0L);
            long current = attempt.startedAt() == null ? 0
                    : result.path("durationMs").asLong(java.time.Duration.between(attempt.startedAt(), finished).toMillis());
            limits.recordUsage(attempt.org(), attempt.project(), attempt.id(), attempt.type(),
                    attempt.startedAt() == null ? finished : attempt.startedAt(),
                    Math.max(0, earlier) + Math.max(0, current), metric(metrics, "modelBytes"), metric(metrics, "elementCount"), status);
        }
        notifyFinished(attempt, status, result);
    }

    private void notifyFinished(Attempt attempt, String status, JsonNode result) {
        if (attempt.project() == null || status.equals("cancelled")) return;
        String link = notifications.projectUrl(attempt.org(), attempt.project());
        String type = attempt.type();
        var params = new java.util.LinkedHashMap<String, Object>(Map.of("jobId", attempt.id(), "type", type));
        if (type.equals("run")) {
            var bills = database.query("""
                    SELECT b.id, b.name FROM runs n JOIN boq_revisions r ON r.id = n.revision_id
                    JOIN boqs b ON b.id = r.boq_id WHERE n.id = ?
                    """, (row, index) -> Map.entry(row.getString("id"), row.getString("name")), attempt.subject());
            if (!bills.isEmpty()) {
                params.put("boq", bills.getFirst().getValue());
                link += "/boqs/" + bills.getFirst().getKey();
            }
        }
        String kind;
        String category = null;
        if (status.equals("failed")) {
            kind = "job.failed";
            category = "jobs";
        } else if (type.equals("parse")) {
            kind = "model_version.ready";
            params.put("fileName", attempt.input().path("fileName").asText());
            // The app's text is "{model} v{version} is ready"; the link opens the version.
            var versions = database.query("""
                    SELECT m.id, m.name, v.number FROM model_versions v JOIN models m ON m.id = v.model_id WHERE v.id = ?
                    """, (row, index) -> new Object[]{row.getString("id"), row.getString("name"), row.getInt("number")}, attempt.subject());
            if (!versions.isEmpty()) {
                params.put("model", versions.getFirst()[1]);
                params.put("version", versions.getFirst()[2]);
                link += "/models/" + versions.getFirst()[0] + "/versions/" + attempt.subject();
            }
        } else if (type.equals("run") && result.path("output").path("counts").path("blockingQuestions").asInt() > 0) {
            kind = "run.needs_input";
            params.put("count", result.path("output").path("counts").path("blockingQuestions").asInt());
            link += "?tab=questions";
        } else {
            kind = "job.succeeded";
        }
        notifications.send(attempt.actor(), attempt.org(), attempt.project(), kind, category, params, link, type, attempt.subject());
    }

    private static Long metric(JsonNode metrics, String key) {
        return metrics.path(key).canConvertToLong() ? metrics.path(key).asLong() : null;
    }

    private JobRow record(UUID id) {
        return database.query("SELECT * FROM jobs WHERE id = ?", (row, index) -> {
            var result = new Job(row.getObject("id", UUID.class), row.getString("type"),
                    JobStatus.fromValue(row.getString("status")), row.getObject("created_at", OffsetDateTime.class))
                    .subjectId(row.getString("subject_id")).subjectType(row.getString("subject_type"))
                    .progress(json.read(row.getString("progress"), JobProgress.class))
                    .error(json.read(row.getString("error"), JobError.class))
                    .startedAt(row.getObject("started_at", OffsetDateTime.class))
                    .finishedAt(row.getObject("finished_at", OffsetDateTime.class));
            if (row.getString("output") != null) result.setOutput(json.read(row.getString("output"), Map.class));
            return new JobRow(result, row.getObject("org_id", UUID.class), row.getObject("project_id", UUID.class));
        }, id).stream().findFirst().orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found", "The job was not found.", Map.of()));
    }

    private void readable(JobRow row, UUID actor) {
        if (row.project() == null) orgs.require(row.org(), actor);
        else projects.require(row.project(), actor);
    }

    private Attempt attempt(ResultSet row, int ignored) throws SQLException {
        return new Attempt(row.getObject("id", UUID.class), row.getString("type"), row.getObject("org_id", UUID.class),
                row.getObject("project_id", UUID.class), row.getObject("subject_id", UUID.class),
                row.getObject("created_by", UUID.class), row.getString("output_prefix"),
                json.read(row.getString("input"), JsonNode.class), row.getInt("attempts"), row.getInt("max_attempts"),
                row.getString("contract_version"), row.getObject("started_at", OffsetDateTime.class), row.getBoolean("metered"));
    }

    private record JobRow(Job job, UUID org, UUID project) {}
    private record Lost(Attempt attempt, boolean cancelled) {}
}
