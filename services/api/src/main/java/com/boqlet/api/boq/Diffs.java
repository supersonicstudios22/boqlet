package com.boqlet.api.boq;

import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.api.storage.ObjectStorage;
import com.boqlet.api.worker.Jobs;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class Diffs {
    private final JdbcTemplate database;
    private final NamedParameterJdbcTemplate named;
    private final StoredJson json;
    private final Runs runs;
    private final ProjectAccess projects;
    private final BoqAccess boqs;
    private final BoqInputs inputs;
    private final BoqExports exports;
    private final Jobs jobs;

    Diffs(JdbcTemplate database, NamedParameterJdbcTemplate named, StoredJson json, Runs runs, ProjectAccess projects,
          BoqAccess boqs, BoqInputs inputs, BoqExports exports, Jobs jobs) {
        this.database = database;
        this.named = named;
        this.json = json;
        this.runs = runs;
        this.projects = projects;
        this.boqs = boqs;
        this.inputs = inputs;
        this.exports = exports;
        this.jobs = jobs;
    }

    record Compare(RunDiff diff, Job job) {}
    private record Entry(UUID id, UUID from, UUID to, UUID job, String key, String summary, String questions) {}

    @Transactional
    public Compare compare(UUID toId, UUID fromId, UUID actor) {
        var to = runs.visible(toId, actor);
        var from = runs.visible(fromId, actor);
        if (!to.project().equals(from.project())) {
            throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_inputs", "Compare runs from the same project.");
        }
        if (to.resultKey() == null || from.resultKey() == null) {
            throw BoqAccess.failure(HttpStatus.CONFLICT, "run_not_ready", "Both runs must finish before comparing.");
        }
        database.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", row -> {}, fromId + ":" + toId);
        var saved = database.query("SELECT * FROM run_diffs WHERE from_run_id = ? AND to_run_id = ?", this::row, fromId, toId)
                .stream().findFirst().orElse(null);
        if (saved != null) {
            if (saved.key() != null) return new Compare(view(saved), null);
            var job = jobs.get(saved.job(), actor);
            if (job.getStatus() == JobStatus.RUNNING || job.getStatus() == JobStatus.QUEUED) return new Compare(null, job);
        }
        UUID diff = saved == null ? Ids.newId() : saved.id();
        UUID job = jobs.enqueue("diff", to.org(), to.project(), actor, "diff", diff,
                ObjectStorage.orgPrefix(to.org()) + "diffs/" + diff + "/" + Ids.newId() + "/",
                Map.of("fromResultKey", from.resultKey(), "toResultKey", to.resultKey(), "fromModels", manifest(from),
                        "toModels", manifest(to), "inputsChanged", inputs.changes(from.snapshot(), to.snapshot()),
                        "fromDecisions", from.snapshot().path("decisions"), "toDecisions", to.snapshot().path("decisions")), 2);
        database.update("""
                INSERT INTO run_diffs (id, from_run_id, to_run_id, job_id) VALUES (?, ?, ?, ?)
                ON CONFLICT (from_run_id, to_run_id) DO UPDATE SET job_id = excluded.job_id
                """, diff, fromId, toId, job);
        return new Compare(null, jobs.get(job, actor));
    }

    RunDiff get(UUID id, UUID actor) { return view(ready(id, actor)); }

    ListDiffElements200Response elements(UUID id, UUID actor, String cursor, int limit) {
        ready(id, actor);
        int start = RunReads.offset(cursor);
        var items = rows("diff_elements", id, start, limit, null, null, ElementChange.class);
        return new ListDiffElements200Response(slice(items, limit)).nextCursor(next(items, start, limit));
    }

    ListDiffLines200Response lines(UUID id, UUID actor, String cursor, int limit, String change, BigDecimal minimum) {
        ready(id, actor);
        int start = RunReads.offset(cursor);
        if (change != null && !Set.of("added", "removed", "changed").contains(change)) {
            throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_param", "Choose added, removed or changed.");
        }
        var items = rows("diff_lines", id, start, limit, change, minimum, LineChange.class);
        return new ListDiffLines200Response(slice(items, limit)).nextCursor(next(items, start, limit));
    }

    @Transactional
    public Job export(UUID id, UUID actor) {
        var diff = ready(id, actor);
        var target = runs.visible(diff.to(), actor);
        var project = projects.require(target.project(), actor);
        var revision = boqs.revision(target.run().getRevisionId(), actor);
        String fromLabel = boqs.revision(runs.visible(diff.from(), actor).run().getRevisionId(), actor).revision().label();
        var metadata = new LinkedHashMap<String, Object>(Map.of("title", project.getName() + " / " + revision.bill().name(),
                "fromLabel", fromLabel, "toLabel", revision.revision().label()));
        if (target.run().getClassifications() != null && !target.run().getClassifications().isEmpty()) {
            metadata.put("groupBy", target.run().getClassifications().getFirst().getId());
        }
        var registered = exports.enqueue(project, actor, revision.revision().id(), "changes_xlsx", "diff", id,
                BoqExports.fileName(project.getCode() == null ? project.getName() : project.getCode(), revision.bill().name(),
                        revision.revision().label(), java.time.LocalDate.now(java.time.ZoneOffset.UTC)).replaceFirst("\\.xlsx$", "_changes.xlsx"),
                Map.of("diffKey", diff.key(), "meta", metadata));
        return jobs.get(registered.job(), actor);
    }

    private List<Map<String, Object>> manifest(RunCatalog.Entry run) {
        var payload = database.queryForObject("SELECT input::text FROM jobs WHERE id = ?", String.class, run.run().getJobId());
        var models = new ArrayList<Map<String, Object>>();
        for (JsonNode model : json.read(payload, JsonNode.class).path("models")) {
            models.add(Map.of("modelId", model.path("modelId").asText(), "versionId", model.path("id").asText(),
                    "traceId", model.path("id").asText(), "name", model.path("name").asText(),
                    "parsedKey", model.path("parsedKey").asText()));
        }
        return models;
    }

    private Entry ready(UUID id, UUID actor) {
        var entry = database.query("SELECT * FROM run_diffs WHERE id = ?", this::row, id)
                .stream().findFirst().orElseThrow(() -> BoqAccess.missing("change report"));
        runs.visible(entry.to(), actor);
        if (entry.key() == null) throw BoqAccess.missing("change report");
        return entry;
    }

    private <T> List<T> rows(String table, UUID id, int start, int size, String change, BigDecimal minimum, Class<T> type) {
        var args = new MapSqlParameterSource().addValue("id", id).addValue("max", Math.clamp(size, 1, 1000) + 1).addValue("start", start);
        var sql = new StringBuilder("SELECT row_data::text FROM " + table + " WHERE diff_id = :id");
        if (change != null) {
            sql.append(" AND row_data->>'change' = :change");
            args.addValue("change", change);
        }
        if (minimum != null) {
            sql.append("""
                     AND (row_data->>'change' <> 'changed' OR row_data->>'deltaPct' IS NULL
                     OR abs((row_data->>'deltaPct')::numeric) >= :minimum)
                    """);
            args.addValue("minimum", minimum);
        }
        return named.query(sql + " ORDER BY seq LIMIT :max OFFSET :start", args,
                (row, index) -> json.read(row.getString(1), type));
    }

    private static <T> List<T> slice(List<T> items, int requested) {
        return items.subList(0, Math.min(items.size(), Math.clamp(requested, 1, 1000)));
    }

    private static String next(List<?> items, int start, int requested) {
        int limit = Math.clamp(requested, 1, 1000);
        return items.size() > limit ? Long.toString((long) start + limit) : null;
    }

    private RunDiff view(Entry row) {
        return new RunDiff(row.id(), row.from(), row.to(), json.read(row.summary(), DiffSummary.class))
                .questions(json.read(row.questions(), RunDiffQuestions.class));
    }

    private Entry row(java.sql.ResultSet row, int index) throws java.sql.SQLException {
        return new Entry(row.getObject("id", UUID.class), row.getObject("from_run_id", UUID.class),
                row.getObject("to_run_id", UUID.class), row.getObject("job_id", UUID.class),
                row.getString("diff_key"), row.getString("summary"), row.getString("questions"));
    }
}
