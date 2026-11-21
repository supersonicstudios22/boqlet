package com.boqlet.api.boq;

import com.boqlet.api.db.StoredJson;
import com.boqlet.api.model.Models;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

@Service
class RunReads {
    private final Runs runs;
    private final BoqAccess access;
    private final StoredJson json;
    private final BoqExports positions;
    private final JdbcTemplate database;
    private final NamedParameterJdbcTemplate named;
    private final Models models;
    private final Decisions decisions;
    private final RunIndex index;

    RunReads(Runs runs, BoqAccess access, StoredJson json, BoqExports positions, JdbcTemplate database,
             NamedParameterJdbcTemplate named, Models models, Decisions decisions, RunIndex index) {
        this.runs = runs;
        this.access = access;
        this.json = json;
        this.positions = positions;
        this.database = database;
        this.named = named;
        this.models = models;
        this.decisions = decisions;
        this.index = index;
    }

    LinesPage lines(UUID id, UUID actor, String cursor, int limit, String system, Integer level, String path,
                    String source, String storey, String family, String model, String query) {
        var run = ready(id, actor);
        int offset = offset(cursor);
        int count = Math.clamp(limit, 1, 20_000);
        var args = new MapSqlParameterSource().addValue("run", id).addValue("count", count + 1).addValue("offset", offset);
        var filter = new StringBuilder(" FROM run_lines l WHERE l.run_id = :run");
        filter(filter, args, source, "source", "l.line->>'source' = :source");
        filter(filter, args, family, "family", "l.line->>'family' = :family");
        filter(filter, args, storey, "storey", """
                (l.line->'location'->>'storey' = :storey OR
                    EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.line->'location'->'storeys') s(value) WHERE s.value = :storey))
                """);
        filter(filter, args, model, "model", """
                EXISTS (SELECT 1 FROM run_line_elements e JOIN model_versions v ON v.id = e.model_version_id
                    JOIN models m ON m.id = v.model_id
                    WHERE e.run_id = l.run_id AND e.line_key = l.line_key
                        AND (e.model_version_id::text = :model OR m.id::text = :model OR m.name = :model))
                """);
        if (query != null && !query.isBlank()) {
            filter(filter, args, query.strip().toLowerCase(Locale.ROOT), "query", """
                    (strpos(lower(l.line->>'description'), :query) > 0 OR EXISTS (
                        SELECT 1 FROM jsonb_each(l.line->'codes') code
                        WHERE strpos(lower(code.value->>'code'), :query) > 0 OR strpos(lower(code.value->>'title'), :query) > 0))
                    """);
        }
        int total = named.queryForObject("SELECT count(*)" + filter, args, Integer.class);
        List<LineGroup> groups = null;
        if (system != null && level != null) {
            if (level < 1 || level > 50) throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_param", "Invalid grouping level.");
            args.addValue("system", system).addValue("depth", level);
            groups = groups(filter.toString(), args);
            if (path == null || path.isEmpty()) return new LinesPage(List.of()).groups(groups).total(total).nextCursor(null);
            args.addValue("path", path).addValue("pathDepth", path.split("/", -1).length);
            filter.append(" ").append("""
                    AND (SELECT string_agg(part.value->>'code', '/' ORDER BY part.ordinality)
                         FROM jsonb_array_elements(l.line->'codes'->CAST(:system AS text)->'path') WITH ORDINALITY part
                         WHERE part.ordinality <= :pathDepth) = :path
                    """);
        }
        var positionsByKey = positions.positions(id, system != null ? system : primary(run));
        var items = named.query("SELECT l.line::text, l.sort_index" + filter + " ORDER BY l.sort_index LIMIT :count OFFSET :offset",
                args, (row, index) -> json.read(numbered(row.getString("line"), row.getInt("sort_index"), positionsByKey).toString(),
                        RunLine.class));
        var page = new LinesPage(items.size() > count ? items.subList(0, count) : items).total(total)
                .nextCursor(items.size() > count ? Long.toString((long) offset + count) : null);
        if (groups != null) page.setGroups(groups);
        return page;
    }

    private List<LineGroup> groups(String filter, MapSqlParameterSource args) {
        String sql = """
                SELECT grp.path, max(grp.code) AS code, max(grp.title) AS title, count(*) AS count,
                    CASE WHEN count(DISTINCT unit) = 1 THEN min(unit) END AS unit,
                    CASE WHEN count(DISTINCT unit) = 1 THEN sum(quantity) END AS quantity
                FROM (
                    SELECT coalesce((SELECT string_agg(part.value->>'code','/' ORDER BY part.ordinality)
                               FROM jsonb_array_elements(l.line->'codes'->CAST(:system AS text)->'path') WITH ORDINALITY part
                               WHERE part.ordinality <= :depth), '') AS path,
                        l.line->'codes'->CAST(:system AS text)->'path'->(LEAST(:depth,
                            jsonb_array_length(l.line->'codes'->CAST(:system AS text)->'path')) - 1)->>'code' AS code,
                        l.line->'codes'->CAST(:system AS text)->'path'->(LEAST(:depth,
                            jsonb_array_length(l.line->'codes'->CAST(:system AS text)->'path')) - 1)->>'title' AS title,
                        l.line->>'unit' AS unit,
                        CASE WHEN coalesce((l.line->>'excluded')::boolean, false) THEN 0
                             ELSE coalesce((l.line->>'quantity')::numeric, 0) END AS quantity
                """ + filter + ") grp GROUP BY grp.path ORDER BY grp.path";
        return named.query(sql, args, (row, index) -> new LineGroup(row.getString("path"),
                Objects.toString(row.getString("title"), ""), row.getInt("count")).code(Objects.toString(row.getString("code"), ""))
                .unit(row.getString("unit")).quantity(row.getBigDecimal("quantity")));
    }

    LineDetail detail(UUID id, UUID actor, String key) {
        var run = ready(id, actor);
        var numbers = positions.positions(id, primary(run));
        var line = database.query("SELECT line::text, sort_index FROM run_lines WHERE run_id = ? AND line_key = ?",
                (row, index) -> numbered(row.getString("line"), row.getInt("sort_index"), numbers), id, key)
                .stream().findFirst().orElseThrow(() -> BoqAccess.missing("line"));
        var log = database.query("""
                SELECT entry::text FROM run_log_entries WHERE run_id = ? AND entry->>'lineKey' = ? ORDER BY seq
                """, (row, index) -> json.read(row.getString(1), LineDetailAllOfLog.class), id, key);
        var detail = json.read(line.toString(), LineDetail.class);
        detail.setLog(log);
        detail.setReadableFormula(line.path("trace").path("formula").asText());
        detail.setReviewComments(access.comments(run.run().getRevisionId(), key));
        return detail;
    }

    List<ListWarnings200ResponseInner> warnings(UUID id, UUID actor) {
        ready(id, actor);
        return database.query("SELECT warning::text FROM run_warnings WHERE run_id = ? ORDER BY seq",
                (row, index) -> json.read(row.getString(1), ListWarnings200ResponseInner.class), id);
    }

    LogPage log(UUID id, UUID actor, String cursor, int limit, String stage, String level, String rule, String line, String guid) {
        ready(id, actor);
        int start = offset(cursor);
        int count = Math.clamp(limit, 1, 1000);
        var args = new MapSqlParameterSource().addValue("run", id).addValue("count", count + 1).addValue("offset", start);
        var filter = new StringBuilder("SELECT entry::text FROM run_log_entries WHERE run_id = :run");
        filter(filter, args, stage, "stage", "entry->>'stage' = :stage");
        filter(filter, args, level, "level", "entry->>'level' = :level");
        filter(filter, args, rule, "rule", "entry->>'ruleId' = :rule");
        filter(filter, args, line, "line", "entry->>'lineKey' = :line");
        filter(filter, args, guid, "guid", "entry->>'guid' = :guid");
        var items = named.query(filter + " ORDER BY seq LIMIT :count OFFSET :offset", args,
                (row, index) -> json.read(row.getString("entry"), LogPageItemsInner.class));
        return new LogPage(items.size() > count ? items.subList(0, count) : items)
                .nextCursor(items.size() > count ? Long.toString((long) start + count) : null);
    }

    List<QuestionWithDecision> questions(UUID id, UUID actor) {
        return decisions.questions(ready(id, actor));
    }

    ElementLines element(UUID id, UUID actor, String guid) {
        var run = ready(id, actor);
        var viewer = scene(run, actor);
        Seen element = viewer.elements().get(guid);
        var seenGuids = new ArrayList<String>();
        for (String current = guid; current != null && seenGuids.size() < 10 && !seenGuids.contains(current);) {
            seenGuids.add(current);
            Seen record = viewer.elements().get(current);
            current = record == null ? null : record.fields().getParent();
        }
        Map<String, ElementLinesLinesInner> linked = new LinkedHashMap<>();
        for (String candidate : seenGuids) {
            database.query("""
                    SELECT l.line_key, l.line->>'description' AS description, l.line->>'unit' AS unit,
                        (SELECT sum((part->>'quantity')::numeric) FROM jsonb_array_elements(l.line->'trace'->'elements') part
                         WHERE part->>'guid' = ?) AS quantity
                    FROM run_lines l WHERE l.run_id = ? AND EXISTS (
                        SELECT 1 FROM run_line_elements e WHERE e.run_id = l.run_id AND e.line_key = l.line_key AND e.guid = ?)
                    ORDER BY l.sort_index
                    """, row -> {
                String key = row.getString("line_key");
                linked.putIfAbsent(key, new ElementLinesLinesInner(key, row.getString("description"), row.getString("unit"),
                        candidate.equals(guid) ? row.getBigDecimal("quantity") : null));
            }, candidate, id, candidate);
        }
        if (linked.isEmpty() && element == null) throw BoqAccess.missing("element");
        var response = new ElementLines(guid, List.copyOf(linked.values()));
        if (element != null) {
            var fields = element.fields();
            response.modelVersionId(element.version()).ifcClass(fields.getIfcClass()).name(fields.getName())
                    .type(fields.getType()).storey(fields.getStorey());
        }
        if (!viewer.ignored().contains(guid)) response.setStatus(status(viewer, guid));
        return response;
    }

    Coverage coverage(UUID id, UUID actor) {
        var viewer = scene(ready(id, actor), actor);
        var result = new Coverage(new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
        for (String guid : viewer.elements().keySet()) {
            if (viewer.ignored().contains(guid)) continue;
            switch (status(viewer, guid)) {
                case MEASURED -> result.addMeasuredItem(guid);
                case UNMATCHED -> result.addUnmatchedItem(guid);
                case COVERED_BY_PARENT -> result.addCoveredByParentItem(guid);
                case EXCLUDED -> result.addExcludedItem(guid);
            }
        }
        for (String guid : viewer.unmatched()) if (!viewer.elements().containsKey(guid)) result.addUnmatchedItem(guid);
        return result;
    }

    private Viewer scene(RunCatalog.Entry run, UUID actor) {
        var elements = new LinkedHashMap<String, Seen>();
        var ignored = new HashSet<String>();
        for (var version : run.run().getSnapshotVersions().getModels()) {
            UUID id = version.getModelVersionId();
            SceneIndex scene = models.scene(id, actor);
            scene.getElements().forEach((guid, item) -> elements.putIfAbsent(guid, new Seen(id, item)));
            ignored.addAll(scene.getSpaces());
            ignored.addAll(scene.getOpenings());
        }
        var measured = new HashSet<>(database.queryForList("SELECT DISTINCT guid FROM run_line_elements WHERE run_id = ?",
                String.class, run.run().getId()));
        var unmatched = new HashSet<>(database.queryForList("""
                SELECT DISTINCT g FROM run_questions q
                CROSS JOIN LATERAL jsonb_array_elements_text(q.question->'guids') g
                WHERE q.run_id = ? AND q.question->>'kind' = 'unmatched'
                """, String.class, run.run().getId()));
        return new Viewer(elements, ignored, measured, unmatched);
    }

    private static ElementLines.StatusEnum status(Viewer view, String guid) {
        if (view.measured().contains(guid)) return ElementLines.StatusEnum.MEASURED;
        if (view.unmatched().contains(guid)) return ElementLines.StatusEnum.UNMATCHED;
        Seen part = view.elements().get(guid);
        for (int depth = 0; part != null && part.fields().getParent() != null && depth < 10; depth++) {
            String parent = part.fields().getParent();
            if (view.measured().contains(parent)) return ElementLines.StatusEnum.COVERED_BY_PARENT;
            part = view.elements().get(parent);
        }
        return ElementLines.StatusEnum.EXCLUDED;
    }

    private ObjectNode numbered(String encoded, int index, Map<String, String> positions) {
        var line = json.read(encoded, ObjectNode.class).put("sortIndex", index);
        String number = positions.get(line.path("key").asText());
        if (number != null) line.put("positionNo", number);
        return line;
    }

    private RunCatalog.Entry ready(UUID id, UUID actor) {
        var run = runs.visible(id, actor);
        if (run.resultKey() == null) throw BoqAccess.failure(HttpStatus.CONFLICT, "run_not_ready", "The run has no results yet.");
        index.ensure(id);
        return run;
    }

    private static String primary(RunCatalog.Entry run) {
        var systems = run.run().getClassifications();
        return systems == null || systems.isEmpty() ? null : systems.getFirst().getId();
    }

    static int offset(String value) {
        if (value == null) return 0;
        try {
            int start = Integer.parseInt(value);
            if (start >= 0) return start;
        } catch (NumberFormatException ignored) {
            // Leave bad offsets on the same API error path.
        }
        throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_param", "Invalid page cursor.");
    }

    private static void filter(StringBuilder sql, MapSqlParameterSource args, String value, String name, String predicate) {
        if (value != null && !value.isBlank()) {
            sql.append(" AND ").append(predicate);
            args.addValue(name, value);
        }
    }

    private record Viewer(Map<String, Seen> elements, Set<String> ignored, Set<String> measured, Set<String> unmatched) {}
    private record Seen(UUID version, SceneIndexElementsValue fields) {}
}
