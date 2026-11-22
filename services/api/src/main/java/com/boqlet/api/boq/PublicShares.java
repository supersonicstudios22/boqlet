package com.boqlet.api.boq;

import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.storage.ObjectStorage;
import com.boqlet.api.worker.WorkerClient;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
class PublicShares {
    private static final int PAGE_SIZE = 5000;
    private final ShareLinks links;
    private final StoredJson json;
    private final EntitlementService limits;
    private final JdbcTemplate database;
    private final ObjectStorage storage;
    private final WorkerClient worker;
    private final RunIndex index;

    PublicShares(ShareLinks links, StoredJson json, EntitlementService limits, JdbcTemplate database,
                 ObjectStorage storage, WorkerClient worker, RunIndex index) {
        this.links = links;
        this.json = json;
        this.limits = limits;
        this.database = database;
        this.storage = storage;
        this.worker = worker;
        this.index = index;
    }

    PublicShare get(String token) {
        var link = links.publicLink(token);
        var info = link.view();
        var shown = links.shown(link.shownRun());
        var response = new PublicShare(link.firm(), info.getProjectName(), info.getBoqName(), null, null, null, info.getInclude())
                .systems(List.of()).modelVersionIds(null).madeWithBadge(limits.enabled(link.org(), "exportWatermark"));
        if (shown != null) {
            var run = shown.run().run();
            response.revisionLabel(shown.label()).revisionStatus(PublicShare.RevisionStatusEnum.fromValue(shown.status()))
                    .runAt(Objects.requireNonNullElse(run.getFinishedAt(), run.getCreatedAt()));
            if (run.getClassifications() != null) response.systems(run.getClassifications());
            if (enabled(info.getInclude().getViewer())) response.modelVersionIds(versions(shown));
        }
        links.count(link);
        return response;
    }

    LinesPage lines(String token, String cursor, String query) {
        var link = links.publicLink(token);
        var shown = links.shown(link.shownRun());
        if (shown == null) return new LinesPage(List.of()).total(0).nextCursor(null);
        int start = offset(cursor);
        String search = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
        String filter = """
                FROM run_lines WHERE run_id = ? AND NOT coalesce((line->>'excluded')::boolean, false)
                AND (? = '' OR strpos(lower(line->>'description'), ?) > 0 OR EXISTS (
                    SELECT 1 FROM jsonb_each(line->'codes') code
                    WHERE strpos(lower(concat_ws(' ', code.value->>'code', code.value->>'title', code.value->>'text')), ?) > 0))
                """;
        UUID run = shown.run().run().getId();
        index.ensure(run);
        int total = database.queryForObject("SELECT count(*) " + filter, Integer.class, run, search, search, search);
        var items = database.query("SELECT line::text, sort_index " + filter + " ORDER BY sort_index LIMIT ? OFFSET ?",
                (row, index) -> json.read(line(row.getString(1), row.getInt(2), false).toString(), RunLine.class),
                run, search, search, search, PAGE_SIZE, start);
        long next = (long) start + items.size();
        return new LinesPage(items).total(total).nextCursor(next < total ? Long.toString(next) : null);
    }

    LineDetail detail(String token, String key) {
        var link = links.publicLink(token);
        var shown = links.shown(link.shownRun());
        if (!enabled(link.view().getInclude().getLineDetail()) || shown == null) throw BoqAccess.missing("line");
        UUID run = shown.run().run().getId();
        index.ensure(run);
        var detail = database.query("""
                SELECT line::text, sort_index FROM run_lines WHERE run_id = ? AND line_key = ?
                AND NOT coalesce((line->>'excluded')::boolean, false)
                """, (row, index) -> json.read(line(row.getString(1), row.getInt(2), true).toString(), LineDetail.class),
                run, key).stream().findFirst().orElseThrow(() -> BoqAccess.missing("line"));
        detail.setReviewComments(null);
        detail.setLog(null);
        if (enabled(link.view().getInclude().getLog())) {
            detail.setLog(database.query("""
                    SELECT jsonb_build_object('seq',entry->'seq','stage',entry->'stage','level',entry->'level','code',entry->'code',
                        'message',entry->'message','lineKey',entry->'lineKey')::text
                    FROM run_log_entries WHERE run_id = ? AND entry->>'lineKey' = ?
                        AND entry->>'stage' IN ('rule','quantity','deduction') ORDER BY seq
                    """, (row, index) -> json.read(row.getString(1), LineDetailAllOfLog.class), run, key));
        }
        return detail;
    }

    SceneIndex scene(String token, UUID version) {
        String key = modelArtifact(token, version, "sceneKey");
        try (var stream = storage.open(key)) {
            return json.read(new String(stream.readAllBytes(), StandardCharsets.UTF_8), SceneIndex.class);
        } catch (IOException failure) {
            throw unavailable();
        }
    }

    URI geometry(String token, UUID version) {
        return storage.download(modelArtifact(token, version, "geometryKey"), "private, no-store", "model/gltf-binary");
    }

    URI workbook(String token) {
        var link = links.publicLink(token);
        var shown = links.shown(link.shownRun());
        var options = link.view().getInclude();
        if (shown == null || !enabled(options.getExcel())) throw BoqAccess.missing("export");
        var run = shown.run().run();
        var metadata = new LinkedHashMap<String, Object>();
        metadata.put("publicShare", true);
        metadata.put("publicLog", enabled(options.getLog()));
        metadata.put("publicLineDetail", enabled(options.getLineDetail()));
        metadata.put("project", link.view().getProjectName());
        metadata.put("boq", link.view().getBoqName());
        metadata.put("revision", shown.label());
        metadata.put("status", "issued".equals(shown.status()) ? "issued" : "working");
        metadata.put("generatedAt", Objects.requireNonNullElse(run.getFinishedAt(), run.getCreatedAt()).toString());
        metadata.put("classifications", run.getClassifications() == null ? List.of() : run.getClassifications());
        metadata.put("watermark", limits.enabled(link.org(), "exportWatermark"));
        if (options.getGroupBy() != null) metadata.put("groupBy", options.getGroupBy());
        UUID variant = UUID.nameUUIDFromBytes(json.object(metadata).toString().getBytes(StandardCharsets.UTF_8));
        String prefix = ObjectStorage.orgPrefix(link.org()) + "share-links/" + link.view().getId()
                + "/" + run.getId() + "/" + variant + "/";
        String key = prefix + "export.xlsx";
        if (!storage.exists(key)) {
            try {
                var result = worker.run("export_xlsx", Map.of("jobId", Ids.newId(), "type", "export_xlsx",
                        "orgId", link.org(), "attempt", 1, "contract", "1", "outputPrefix", prefix,
                        "input", Map.of("resultKey", shown.run().resultKey(), "meta", metadata)), ignored -> {});
                if (!"succeeded".equals(result.path("status").asText())
                        || !key.equals(result.path("output").path("xlsxKey").asText())) throw unavailable();
            } catch (InterruptedException failure) {
                Thread.currentThread().interrupt();
                throw unavailable();
            } catch (IOException failure) {
                throw unavailable();
            }
        }
        var current = links.publicLink(token);
        if (!options.equals(current.view().getInclude()) || !run.getId().equals(current.shownRun())) throw BoqAccess.missing("export");
        return storage.downloadAttachment(key, BoqExports.XLSX, "BoQ.xlsx");
    }

    private ObjectNode line(String value, int index, boolean detail) {
        ObjectNode source = json.read(value, ObjectNode.class);
        source.retain("key", "ruleId", "ruleKind", "description", "unit", "quantity", "source",
                "family", "keys", "trace", "codes", "location", "tags");
        source.put("sortIndex", index);
        source.putArray("notes"); // the team's notes stay private; the field is required (TF-085)
        if (source.get("trace") instanceof ObjectNode trace) {
            trace.retain("formula", "params", "elements", "sourceLine", "steps");
            for (var step : trace.path("steps")) {
                if (step.path("params") instanceof ObjectNode params) params.remove(List.of("by", "reason", "note"));
            }
            for (var element : trace.path("elements")) {
                if (element instanceof ObjectNode item) item.remove("note");
            }
            if (!detail) {
                trace.putArray("elements");
                trace.remove("steps");
            }
        }
        return source;
    }

    private String modelArtifact(String token, UUID requested, String artifact) {
        var link = links.publicLink(token);
        var shown = links.shown(link.shownRun());
        if (!enabled(link.view().getInclude().getViewer()) || shown == null) throw BoqAccess.missing("model");
        var versions = versions(shown);
        UUID version = requested == null ? versions.stream().findFirst().orElse(null) : requested;
        if (version == null || !versions.contains(version)) throw BoqAccess.missing("model");
        return database.query("""
                SELECT v.artifacts->>CAST(? AS text) FROM model_versions v JOIN models m ON m.id = v.model_id
                WHERE v.id = ? AND m.project_id = ? AND v.org_id = ? AND v.status = 'ready'
                """, (row, index) -> row.getString(1), artifact, version, link.view().getProjectId(), link.org())
                .stream().filter(Objects::nonNull).findFirst().orElseThrow(() -> BoqAccess.missing("model"));
    }

    private static List<UUID> versions(ShareLinks.Shown shown) {
        var versions = new ArrayList<UUID>();
        for (var model : shown.run().snapshot().path("inputs").path("models")) {
            versions.add(UUID.fromString(model.path("modelVersionId").asText()));
        }
        return versions;
    }

    private static boolean enabled(Boolean value) { return Boolean.TRUE.equals(value); }

    private static int offset(String cursor) {
        if (cursor == null) return 0;
        try {
            int value = Integer.parseInt(cursor);
            if (value >= 0) return value;
        } catch (NumberFormatException ignored) {
            // Return the contract's invalid cursor error.
        }
        throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_param", "The cursor is invalid.");
    }

    private static RuntimeException unavailable() {
        return BoqAccess.failure(HttpStatus.SERVICE_UNAVAILABLE, "artifact_unavailable", "The shared artifact is unavailable.");
    }
}
