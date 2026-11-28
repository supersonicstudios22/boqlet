package com.boqlet.api.boq;

import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.library.PresetCatalog;
import com.boqlet.api.storage.ObjectStorage;
import com.boqlet.api.worker.WorkerClient;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
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
    private final PresetCatalog catalog;
    private final BoqExports positions;

    PublicShares(ShareLinks links, StoredJson json, EntitlementService limits, JdbcTemplate database,
                 ObjectStorage storage, WorkerClient worker, RunIndex index, PresetCatalog catalog, BoqExports positions) {
        this.links = links;
        this.json = json;
        this.limits = limits;
        this.database = database;
        this.storage = storage;
        this.worker = worker;
        this.index = index;
        this.catalog = catalog;
        this.positions = positions;
    }

    PublicShare get(String token) {
        var link = links.publicLink(token);
        var info = link.view();
        var shown = links.shown(link.shownRun());
        var response = new PublicShare(link.firm(), info.getProjectName(), info.getBoqName(), null, null, null, info.getInclude())
                .systems(List.of()).modelVersionIds(null).madeWithBadge(limits.enabled(link.org(), "exportWatermark"));
        // The firm's number and date formats, so the page shows numbers like its own exports (TF-021).
        database.query("SELECT settings->'numberFormat' AS number_format, settings->>'dateFormat' AS date_format FROM orgs WHERE id = ?",
                (row, index) -> {
                    if (row.getString("number_format") != null) {
                        response.numberFormat(json.read(row.getString("number_format"), PublicShareNumberFormat.class));
                    }
                    if (row.getString("date_format") != null) response.dateFormat(row.getString("date_format"));
                    return null;
                }, link.org());
        if (shown != null) {
            var run = shown.run().run();
            response.revisionLabel(shown.label()).revisionStatus(PublicShare.RevisionStatusEnum.fromValue(shown.status()))
                    .runAt(Objects.requireNonNullElse(run.getFinishedAt(), run.getCreatedAt()));
            if (run.getClassifications() != null) response.systems(run.getClassifications());
            boolean detail = enabled(info.getInclude().getLineDetail());
            boolean viewer = enabled(info.getInclude().getViewer());
            if (viewer) response.modelVersionIds(versions(shown));
            // Review C-25: the page names models and settings like the app does, never by an id.
            if (viewer || detail) response.models(models(shown));
            if (detail) response.slots(slots(run));
        }
        links.count(link);
        return response;
    }

    LinesPage lines(String token, String cursor, String query) {
        var link = links.publicLink(token);
        // The viewer finds a line's elements in the list, as the app's does (review C-25): each one's guid, model and share.
        boolean elements = enabled(link.view().getInclude().getViewer());
        var shown = links.shown(link.shownRun());
        if (shown == null) return new LinesPage(List.of()).total(0).nextCursor(null);
        int start = offset(cursor);
        String search = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
        String filter = """
                FROM run_lines WHERE run_id = ?
                AND (? = '' OR strpos(lower(line->>'description'), ?) > 0 OR EXISTS (
                    SELECT 1 FROM jsonb_each(line->'codes') code
                    WHERE strpos(lower(concat_ws(' ', code.value->>'code', code.value->>'title', code.value->>'text')), ?) > 0))
                """;
        UUID run = shown.run().run().getId();
        index.ensure(run);
        // Each line's position number in the page's grouping, as the app and the share's Excel number it (review C-26).
        var numbers = positions.numbers(run, grouping(link, shown));
        int total = database.queryForObject("SELECT count(*) " + filter, Integer.class, run, search, search, search);
        var items = database.query("SELECT line::text, sort_index " + filter + " ORDER BY sort_index LIMIT ? OFFSET ?",
                (row, index) -> {
                    var line = json.read(line(row.getString(1), row.getInt(2), false, elements, numbers).toString(), RunLine.class);
                    // the generated class starts `questions` as an empty list: the questions behind a line stay private (BR-56)
                    if (line.getToConfirm() != null) line.getToConfirm().setQuestions(null);
                    return line;
                },
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
        var numbers = positions.numbers(run, grouping(link, shown));
        var detail = database.query("""
                SELECT line::text, sort_index FROM run_lines WHERE run_id = ? AND line_key = ?
                """, (row, index) -> json.read(line(row.getString(1), row.getInt(2), true, true, numbers).toString(), LineDetail.class),
                run, key).stream().findFirst().orElseThrow(() -> BoqAccess.missing("line"));
        detail.setReviewComments(null);
        if (detail.getToConfirm() != null) detail.getToConfirm().setQuestions(null);
        detail.setLog(null);
        detail.setElementLog(null);
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
        // Review C-22 (DEC-40): the page offers the workbook to send unless the link says otherwise; its
        // Calculation follows "line detail". The working workbook keeps the sheets the other includes allow.
        boolean issue = options.getExcelProfile() == null || options.getExcelProfile() == ShareInclude.ExcelProfileEnum.ISSUE;
        metadata.put("profile", issue ? BoqExports.ISSUE : BoqExports.WORKING);
        if (issue && enabled(options.getLineDetail())) metadata.put("calculation", true);
        metadata.put("firm", link.firm());
        metadata.put("publicLog", enabled(options.getLog()));
        metadata.put("publicLineDetail", enabled(options.getLineDetail()));
        metadata.put("project", link.view().getProjectName());
        metadata.put("boq", link.view().getBoqName());
        metadata.put("revision", shown.label());
        metadata.put("status", "issued".equals(shown.status()) ? "issued" : "working");
        metadata.put("generatedAt", Objects.requireNonNullElse(run.getFinishedAt(), run.getCreatedAt()).toString());
        metadata.put("date", BoqExports.readableDate(Objects.requireNonNullElse(run.getFinishedAt(), run.getCreatedAt()),
                // An org without a date format reads null: the locale's long date (findFirst() refuses a null).
                database.queryForList("SELECT settings->>'dateFormat' FROM orgs WHERE id = ?", String.class, link.org())
                        .stream().filter(Objects::nonNull).findFirst().orElse(null), null));
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

    private ObjectNode line(String value, int index, boolean detail, boolean elements, String[] numbers) {
        ObjectNode source = json.read(value, ObjectNode.class);
        JsonNode edit = source.get("overridden");
        // An excluded line is shown as excluded, like the sheet shows it (TF-033); why stays private (BR-56).
        source.retain("key", "ruleId", "ruleKind", "description", "unit", "quantity", "source",
                "family", "keys", "trace", "codes", "location", "tags", "excluded", "toConfirm");
        source.put("sortIndex", index);
        if (index < numbers.length && numbers[index] != null) source.put("positionNo", numbers[index]);
        // A line to confirm is marked so, and says how many of its elements were measured (review C-26);
        // the questions behind it stay private (BR-56).
        if (source.get("toConfirm") instanceof ObjectNode confirm) confirm.retain("measured", "elements");
        source.putArray("notes"); // the team's notes stay private; the field is required (TF-085)
        // P54 Q52 (TF-086): an edited quantity is shown as edited, with the engine's value; who and why stay private.
        if (edit != null && edit.path("fields").isArray()
                && java.util.stream.StreamSupport.stream(edit.path("fields").spliterator(), false).anyMatch(f -> f.asText().equals("quantity"))) {
            var shown = source.putObject("overridden");
            shown.putArray("fields").add("quantity");
            shown.set("engineQuantity", edit.get("engineQuantity"));
            shown.set("quantity", edit.get("quantity"));
        }
        if (source.get("trace") instanceof ObjectNode trace) {
            trace.retain("formula", "params", "elements", "sourceLine", "steps");
            for (var step : trace.path("steps")) {
                if (step.path("params") instanceof ObjectNode params) params.remove(List.of("by", "reason", "note"));
            }
            for (var element : trace.path("elements")) {
                // the decisions an element rests on name who answered (A-06): private, like notes (BR-56)
                if (element instanceof ObjectNode item) item.remove(List.of("note", "decisions"));
                // its measured inputs stay (C-10), without the question that chose a value (N-07)
                for (var input : element.path("inputs")) {
                    if (input instanceof ObjectNode fields) fields.remove("question");
                }
            }
            if (!detail) {
                var summary = JsonNodeFactory.instance.arrayNode();
                if (elements) {
                    for (var element : trace.path("elements")) {
                        var item = summary.addObject();
                        item.set("guid", element.get("guid"));
                        item.set("quantity", element.get("quantity"));
                        if (element.has("model")) item.set("model", element.get("model"));
                    }
                }
                trace.set("elements", summary);
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

    /** Each shared model version with its file name (the app's `Run.models`), else its discipline, as the app's viewer names it. */
    private static List<PublicShareModelsInner> models(ShareLinks.Shown shown) {
        var names = new HashMap<String, String>();
        if (shown.run().run().getModels() != null) {
            for (var model : shown.run().run().getModels()) {
                if (model.getId() != null && model.getFileName() != null) names.put(model.getId(), model.getFileName());
            }
        }
        var out = new ArrayList<PublicShareModelsInner>();
        for (var model : shown.run().snapshot().path("inputs").path("models")) {
            String version = model.path("modelVersionId").asText();
            out.add(new PublicShareModelsInner(UUID.fromString(version),
                    names.getOrDefault(version, model.path("discipline").asText(""))));
        }
        return out;
    }

    /**
     * The run's rule-set settings as the page labels them (review C-25): params merged along the version chain as
     * the engine flattens them (by name, the child's fields over its parent's), then only label, type, unit and
     * option texts. Values stay with the line traces that used them.
     */
    private Map<String, PublicShareSlotsValue> slots(Run run) {
        var out = new TreeMap<String, PublicShareSlotsValue>();
        UUID id = run.getSnapshotVersions() == null ? null : run.getSnapshotVersions().getRuleSetVersionId();
        if (id == null) return out;
        var rules = catalog.rules(catalog.version(id));
        var chain = new ArrayList<ObjectNode>(rules.library());
        Collections.reverse(chain);
        chain.add(rules.doc());
        var params = new LinkedHashMap<String, ObjectNode>();
        for (var doc : chain) {
            doc.path("params").properties().forEach(entry -> {
                if (!(entry.getValue() instanceof ObjectNode fields)) return;
                params.computeIfAbsent(entry.getKey(), name -> JsonNodeFactory.instance.objectNode()).setAll(fields);
            });
        }
        params.forEach((name, param) -> {
            PublicShareSlotsValue.TypeEnum type;
            try {
                type = PublicShareSlotsValue.TypeEnum.fromValue(param.path("type").asText());
            } catch (IllegalArgumentException unknown) {
                return;
            }
            var slot = new PublicShareSlotsValue(param.path("label").asText(""), type);
            if (param.path("unit").isTextual()) slot.unit(param.path("unit").asText());
            if (param.path("optionLabels") instanceof ObjectNode labels) {
                var texts = new LinkedHashMap<String, String>();
                labels.properties().forEach(option -> texts.put(option.getKey(), option.getValue().asText()));
                slot.optionLabels(texts);
            }
            out.put(name, slot);
        });
        return out;
    }

    private static List<UUID> versions(ShareLinks.Shown shown) {
        var versions = new ArrayList<UUID>();
        for (var model : shown.run().snapshot().path("inputs").path("models")) {
            versions.add(UUID.fromString(model.path("modelVersionId").asText()));
        }
        return versions;
    }

    /** The share's grouping system: the link's, else the run's first classification; none numbers 1, 2, 3. */
    private static String grouping(ShareLinks.Link link, ShareLinks.Shown shown) {
        if (link.view().getInclude().getGroupBy() != null) return link.view().getInclude().getGroupBy();
        var systems = shown.run().run().getClassifications();
        return systems == null || systems.isEmpty() ? null : systems.getFirst().getId();
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
        throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_parameter", "The cursor is invalid.");
    }

    private static RuntimeException unavailable() {
        return BoqAccess.failure(HttpStatus.SERVICE_UNAVAILABLE, "artifact_unavailable", "The shared artifact is unavailable.");
    }
}
