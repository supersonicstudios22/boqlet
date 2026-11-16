package com.boqlet.api.worker;

import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.api.project.ProjectAccess;
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
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class Jobs {
    private static final Set<String> METERED = Set.of("parse", "run", "preview");
    private final JdbcTemplate database;
    private final StoredJson json;
    private final EntitlementService limits;
    private final ProjectAccess projects;
    private final OrgAccess orgs;
    private final Map<String, JobHandler> handlers;

    Jobs(JdbcTemplate database, StoredJson json, EntitlementService limits, ProjectAccess projects, OrgAccess orgs,
         List<JobHandler> handlers) {
        this.database = database;
        this.json = json;
        this.limits = limits;
        this.projects = projects;
        this.orgs = orgs;
        this.handlers = handlers.stream().collect(Collectors.toUnmodifiableMap(JobHandler::type, Function.identity()));
    }

    public record Attempt(UUID id, String type, UUID org, UUID project, UUID subject, UUID actor, String prefix,
                          JsonNode input, int number, int maxAttempts, String contract, OffsetDateTime startedAt) {
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
        if (!handlers.containsKey(type)) throw new IllegalArgumentException("Unregistered job type " + type);
        if (METERED.contains(type)) {
            BigDecimal used = limits.processingMillis(org, YearMonth.now(ZoneOffset.UTC));
            limits.checkConsumption(org, actor, "processingMinutesPerMonth", used, 60_000);
        }
        UUID id = Ids.newId();
        database.update("""
                INSERT INTO jobs (id, type, org_id, project_id, created_by, subject_type, subject_id, output_prefix, input, priority)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?)
                """, id, type, org, project, actor, subjectType, subject, prefix, json.object(input).toString(), priority);
        return id;
    }

    public Job get(UUID id, UUID actor) {
        var row = record(id);
        readable(row, actor);
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
    public void reclaimHttpJobs() {
        var stale = database.query("""
                SELECT * FROM jobs WHERE transport = 'http' AND status = 'running'
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
        String status = rows.getFirst() ? "cancelled" : result.path("status").asText("failed");
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
        database.update("""
                UPDATE jobs SET status = 'queued', available_at = now() + (? * interval '10 seconds'),
                                worker_id = NULL, heartbeat_at = NULL, progress = NULL
                WHERE id = ?
                """, attempt.number(), attempt.id());
    }

    private void finishTerminal(Attempt attempt, String status, JsonNode result, OffsetDateTime finished) {
        Map<String, Object> output = handlers.get(attempt.type()).finished(attempt, status, result);
        JsonNode error = "failed".equals(status) ? result.get("error") : null;
        database.update("""
                UPDATE jobs SET status = ?, finished_at = ?, output = CAST(? AS jsonb), error = CAST(? AS jsonb),
                                worker_id = NULL, heartbeat_at = NULL WHERE id = ?
                """, status, finished, output == null ? null : json.object(output).toString(),
                error == null ? null : error.toString(), attempt.id());
        if (METERED.contains(attempt.type()) && attempt.startedAt() != null) {
            var metrics = result.path("metrics");
            long duration = result.path("durationMs").asLong(java.time.Duration.between(attempt.startedAt(), finished).toMillis());
            limits.recordUsage(attempt.org(), attempt.project(), attempt.id(), attempt.type(), attempt.startedAt(),
                    Math.max(0, duration), metric(metrics, "modelBytes"), metric(metrics, "elementCount"), status);
        }
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
                row.getString("contract_version"), row.getObject("started_at", OffsetDateTime.class));
    }

    private record JobRow(Job job, UUID org, UUID project) {}
    private record Lost(Attempt attempt, boolean cancelled) {}
}
