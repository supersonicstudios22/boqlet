package com.boqlet.api.boq;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.library.PresetCatalog;
import com.boqlet.api.realtime.Realtime;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class Adjustments {
    private final JdbcTemplate database;
    private final StoredJson json;
    private final BoqAccess access;
    private final Boqs boqs;
    private final BoqInputs inputs;
    private final PresetCatalog catalog;
    private final AuditWriter audit;
    private final Realtime realtime;

    Adjustments(JdbcTemplate database, StoredJson json, BoqAccess access, Boqs boqs, BoqInputs inputs,
                PresetCatalog catalog, AuditWriter audit, Realtime realtime) {
        this.database = database;
        this.json = json;
        this.access = access;
        this.boqs = boqs;
        this.inputs = inputs;
        this.catalog = catalog;
        this.audit = audit;
        this.realtime = realtime;
    }

    List<LineOverride> overrides(UUID boq, UUID actor) {
        var scope = access.bill(boq, actor);
        if (scope.revision().status() == RevisionStatus.ISSUED && scope.revision().frozen() != null) {
            return scope.revision().frozen().getAdjustments().getOverrides();
        }
        return inputs.overrides(boq, true).stream().map(doc -> json.read(doc.toString(), LineOverride.class)).toList();
    }

    List<ManualItemRecord> manual(UUID boq, UUID actor) {
        var scope = access.bill(boq, actor);
        if (scope.revision().status() == RevisionStatus.ISSUED && scope.revision().frozen() != null) {
            return scope.revision().frozen().getAdjustments().getManualItems();
        }
        return inputs.manualItems(boq, true).stream().map(doc -> json.read(doc.toString(), ManualItemRecord.class)).toList();
    }

    @Transactional
    public LineOverride write(UUID boq, UUID actor, LineOverrideInput input) {
        var scope = edit(boq, actor);
        var normalized = override(scope, input);
        UUID id = storeOverride(boq, actor, normalized);
        change(scope, actor, "line.edited", Map.of("lineKey", input.getLineKey(), "lineKeys", List.of(input.getLineKey())));
        return findOverride(boq, id);
    }

    @Transactional
    public ApplyLineEdits200Response batch(UUID boq, UUID actor, ApplyLineEditsRequest input) {
        var scope = edit(boq, actor);
        var overrides = new LinkedHashMap<String, ObjectNode>();
        for (var row : safe(input.getOverrides())) {
            if (overrides.putIfAbsent(row.getLineKey(), override(scope, row)) != null) {
                throw bad("invalid_body", "A line is edited twice in the same request.");
            }
        }
        var manual = new LinkedHashMap<String, ObjectNode>();
        for (var row : safe(input.getManualItems())) {
            var edit = manual(scope, null, row);
            if (manual.putIfAbsent(edit.path("item").path("id").asText(), edit) != null) {
                throw duplicateManual();
            }
        }
        for (String line : safe(input.getRemoveOverrideLineKeys())) {
            database.update("DELETE FROM line_overrides WHERE boq_id = ? AND line_key = ?", boq, line);
        }
        var written = overrides.values().stream().map(value -> storeOverride(boq, actor, value)).toList();
        var added = manual.values().stream().map(value -> storeManual(boq, null, actor, value)).toList();
        var keys = new LinkedHashSet<>(overrides.keySet());
        keys.addAll(safe(input.getRemoveOverrideLineKeys()));
        keys.addAll(manual.keySet());
        change(scope, actor, "line.edited", Map.of("lines", written.size(), "manualLines", added.size(), "lineKeys", keys));
        return new ApplyLineEdits200Response().overrides(written.stream().map(id -> findOverride(boq, id)).toList())
                .manualItems(added.stream().map(id -> findManual(boq, id)).toList());
    }

    @Transactional
    public void removeOverride(UUID id, UUID actor) {
        UUID boq = target(id, "line_overrides");
        var scope = edit(boq, actor);
        String key = database.query("DELETE FROM line_overrides WHERE id = ? RETURNING line_key",
                (row, index) -> row.getString(1), id).stream().findFirst().orElseThrow(() -> BoqAccess.missing("line edit"));
        change(scope, actor, "line.restored", Map.of("overrideId", id, "lineKeys", List.of(key)));
    }

    @Transactional
    public ManualItemRecord add(UUID boq, UUID actor, ManualItemInput input) {
        var scope = edit(boq, actor);
        UUID id = storeManual(boq, null, actor, manual(scope, null, input));
        change(scope, actor, "manual_line.added", Map.of("manualItemId", id, "lineKeys", List.of(input.getItem().get("id"))));
        return findManual(boq, id);
    }

    @Transactional
    public ManualItemRecord update(UUID id, UUID actor, ManualItemInput input) {
        UUID boq = target(id, "manual_items");
        var scope = edit(boq, actor);
        storeManual(boq, id, actor, manual(scope, id, input));
        change(scope, actor, "manual_line.updated", Map.of("manualItemId", id, "lineKeys", List.of(input.getItem().get("id"))));
        return findManual(boq, id);
    }

    @Transactional
    public void removeManual(UUID id, UUID actor) {
        UUID boq = target(id, "manual_items");
        var scope = edit(boq, actor);
        String key = database.query("DELETE FROM manual_items WHERE id = ? RETURNING item->'item'->>'id'",
                (row, index) -> row.getString(1), id).stream().findFirst().orElseThrow(() -> BoqAccess.missing("manual item"));
        change(scope, actor, "manual_line.removed", Map.of("manualItemId", id, "lineKeys", List.of(key)));
    }

    @Transactional
    public BoqPresence presence(UUID boq, UUID actor, String line) {
        var scope = access.bill(boq, actor);
        database.update("""
                INSERT INTO boq_presence (boq_id, user_id, line_key, expires_at) VALUES (?, ?, ?, now() + interval '45 seconds')
                ON CONFLICT (boq_id, user_id) DO UPDATE SET line_key = excluded.line_key, expires_at = excluded.expires_at
                """, boq, actor, line);
        var presence = present(scope);
        realtime.project(scope.project().getOrgId(), scope.project().getId(), "boq.presence", presence);
        return presence;
    }

    private BoqPresence present(BoqAccess.Scope scope) {
        return new BoqPresence(scope.bill().id(), database.query("""
                SELECT p.user_id, u.name, p.line_key FROM boq_presence p JOIN users u ON u.id = p.user_id
                JOIN memberships m ON m.user_id = p.user_id AND m.org_id = ?
                LEFT JOIN project_members pm ON pm.project_id = ? AND pm.user_id = p.user_id
                WHERE p.boq_id = ? AND p.expires_at > now() AND u.deleted_at IS NULL
                    AND (m.role IN ('owner','admin') OR pm.user_id IS NOT NULL) ORDER BY u.name, u.id
                """, (row, index) -> new BoqPresenceUsersInner(row.getObject("user_id", UUID.class), row.getString("name"))
                .lineKey(row.getString("line_key")), scope.project().getOrgId(), scope.project().getId(), scope.bill().id()));
    }

    @Transactional
    public void leave(UUID boq, UUID actor) {
        var scope = access.bill(boq, actor);
        if (database.update("DELETE FROM boq_presence WHERE boq_id = ? AND user_id = ?", boq, actor) > 0) {
            realtime.project(scope.project().getOrgId(), scope.project().getId(), "boq.presence", present(scope));
        }
    }

    private BoqAccess.Scope edit(UUID boq, UUID actor) {
        var scope = access.lockBill(boq, actor, "editLines");
        access.checkOpen(scope, true);
        return scope;
    }

    private ObjectNode override(BoqAccess.Scope scope, LineOverrideInput input) {
        String key = required(input.getLineKey(), "A line edit needs a line key.");
        var output = json.object(Map.of("lineKey", key));
        boolean suppliedQuantity = input.getQuantity().isPresent();
        if (suppliedQuantity) {
            var quantity = input.getQuantity().get();
            if (quantity == null) output.putNull("quantity");
            else if (quantity.signum() < 0) throw bad("invalid_quantity", "Enter a quantity of zero or more.");
            else output.put("quantity", quantity);
        }
        if (input.getUnit() != null) {
            if (!suppliedQuantity) throw BoqAccess.failure(HttpStatus.CONFLICT, "unit_needs_quantity", "A unit change needs a quantity.");
            output.put("unit", required(input.getUnit(), "The unit can't be empty."));
        }
        if (input.getDescription() != null) output.put("description", required(input.getDescription(), "The description can't be empty."));
        if (input.getCodes() != null && !input.getCodes().isEmpty()) {
            codes(scope, input.getCodes());
            output.set("codes", json.object(input.getCodes()));
        }
        if (input.getSortAfter().isPresent()) {
            String after = input.getSortAfter().get();
            if (key.equals(after)) throw bad("invalid_body", "A line cannot follow itself.");
            output.put("sortAfter", after);
        }
        boolean exclude = Boolean.TRUE.equals(input.getExcluded());
        if (exclude) output.put("excluded", true);
        if (output.size() == 1) throw bad("invalid_body", "There is no change to save.");
        if ((exclude || suppliedQuantity) && (input.getReason() == null || input.getReason().isBlank())) {
            throw bad("reason_required", "A quantity edit or exclusion needs a reason.");
        }
        if (input.getReason() != null && !input.getReason().isBlank()) output.put("reason", input.getReason().strip());
        return output;
    }

    private ObjectNode manual(BoqAccess.Scope scope, UUID id, ManualItemInput input) {
        var item = json.object(input.getItem());
        String code = required(item.path("id").asText(), "A manual line needs an ID.");
        required(item.path("description").asText(), "A manual line needs a description.");
        required(item.path("unit").asText(), "A manual line needs a unit.");
        required(item.path("kind").asText(), "A manual line needs a kind.");
        if (item.hasNonNull("quantity") && (!item.get("quantity").isNumber() || item.get("quantity").decimalValue().signum() < 0)) {
            throw bad("invalid_quantity", "Enter a quantity of zero or more.");
        }
        if (Boolean.TRUE.equals(database.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM manual_items WHERE boq_id = ? AND item->'item'->>'id' = ?
                    AND id IS DISTINCT FROM CAST(? AS uuid))
                """, Boolean.class, scope.bill().id(), code, id))) throw duplicateManual();
        var output = json.object(Map.of("item", item));
        if (input.getCodes() != null && !input.getCodes().isEmpty()) {
            codes(scope, input.getCodes());
            output.set("codes", json.object(input.getCodes()));
        }
        if (input.getSortHint() != null) output.put("sortHint", input.getSortHint());
        return output;
    }

    private void codes(BoqAccess.Scope scope, Map<String, String> values) {
        var available = new HashMap<String, Set<String>>();
        for (UUID version : scope.revision().inputs().getClassificationVersionIds()) {
            JsonNode list = catalog.version(version).doc().path("codeList");
            var codes = new HashSet<String>();
            for (JsonNode code : list.path("codes")) codes.add(code.path("code").asText());
            available.put(list.path("id").asText(), codes);
        }
        values.forEach((system, code) -> {
            if (!available.getOrDefault(system, Set.of()).contains(code)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "unknown_code", "The code is unavailable in this BoQ.",
                        Map.of("system", system, "code", code));
            }
        });
    }

    private UUID storeOverride(UUID boq, UUID actor, ObjectNode edit) {
        return database.queryForObject("""
                INSERT INTO line_overrides (id, boq_id, line_key, edit, created_by)
                VALUES (?, ?, ?, CAST(? AS jsonb), ?)
                ON CONFLICT (boq_id, line_key) DO UPDATE SET edit = excluded.edit, created_by = excluded.created_by,
                    updated_at = now() RETURNING id
                """, UUID.class, Ids.newId(), boq, edit.path("lineKey").asText(), edit.toString(), actor);
    }

    private UUID storeManual(UUID boq, UUID prior, UUID actor, ObjectNode item) {
        if (prior != null) {
            if (database.update("UPDATE manual_items SET item = CAST(? AS jsonb), updated_at = now() WHERE id = ?",
                    item.toString(), prior) != 1) throw BoqAccess.missing("manual item");
            return prior;
        }
        UUID id = Ids.newId();
        database.update("INSERT INTO manual_items (id, boq_id, item, created_by) VALUES (?, ?, CAST(? AS jsonb), ?)",
                id, boq, item.toString(), actor);
        return id;
    }

    private LineOverride findOverride(UUID boq, UUID id) {
        return json.read(find(inputs.overrides(boq, true), id).toString(), LineOverride.class);
    }

    private ManualItemRecord findManual(UUID boq, UUID id) {
        return json.read(find(inputs.manualItems(boq, true), id).toString(), ManualItemRecord.class);
    }

    private static ObjectNode find(List<ObjectNode> items, UUID id) {
        return items.stream().filter(item -> item.path("id").asText().equals(id.toString())).findFirst().orElseThrow();
    }

    private UUID target(UUID id, String table) {
        return database.query("SELECT boq_id FROM " + table + " WHERE id = ?", (row, index) -> row.getObject(1, UUID.class), id)
                .stream().findFirst().orElseThrow(() -> BoqAccess.missing("adjustment"));
    }

    private void change(BoqAccess.Scope scope, UUID actor, String action, Map<String, Object> data) {
        database.update("UPDATE boqs SET updated_at = now() WHERE id = ?", scope.bill().id());
        boqs.withdrawIfReview(scope, actor, "edited");
        audit.record(new RequestContext(actor, null, scope.project().getOrgId(), null), AuditWriter.ActorKind.USER,
                scope.project().getId(), action, "boq", scope.bill().id(), json.object(data));
    }

    private static String required(String text, String message) {
        if (text == null || text.isBlank()) throw bad("invalid_body", message);
        return text.strip();
    }

    private static ApiException duplicateManual() {
        return BoqAccess.failure(HttpStatus.CONFLICT, "duplicate_id", "Another manual item uses that ID.");
    }

    private static ApiException bad(String code, String message) {
        return BoqAccess.failure(HttpStatus.BAD_REQUEST, code, message);
    }

    private static <T> List<T> safe(List<T> list) { return list == null ? List.of() : list; }
}
