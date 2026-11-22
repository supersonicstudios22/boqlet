package com.boqlet.api.admin;

import com.boqlet.api.billing.EntitlementCatalogue;
import com.boqlet.api.billing.PlatformConfig;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.extension.CoreModule.EntitlementType;
import com.boqlet.api.http.ApiException;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Plans and the platform settings, configured by the platform admin (P57, F19 §9). A plan is data:
 * name, description, price, order, whether customers see it, whether new orgs start on it, and its
 * entitlements (only the catalogue's keys). A change applies to every org on the plan at once;
 * nothing is deleted, and use past a lowered limit is refused from then on.
 */
@Service
class PlanAdministration {
    private static final String SELECT = """
            SELECT p.id, p.name, p.description, p.public, p.default_plan, p.position, p.price_amount, p.price_period,
                   p.entitlements::text, p.created_at, p.updated_at, s.currency,
                   (SELECT count(*) FROM subscriptions x JOIN orgs o ON o.id = x.org_id
                    WHERE x.plan_id = p.id AND o.status <> 'deleting') AS org_count
            FROM plans p CROSS JOIN platform_settings s
            """;
    /** The metered limits whose use can be over a new maximum, and how each org's use is read. */
    private static final Map<String, String> USE = Map.of(
            "seats", "seats", "activeProjects", "active_projects", "processingMinutesPerMonth", "processing_minutes");

    private final JdbcTemplate database;
    private final StoredJson json;
    private final EntitlementCatalogue catalogue;
    private final PlatformConfig platform;
    private final AdminOrganisations audit;

    PlanAdministration(JdbcTemplate database, StoredJson json, EntitlementCatalogue catalogue, PlatformConfig platform, AdminOrganisations audit) {
        this.database = database;
        this.json = json;
        this.catalogue = catalogue;
        this.platform = platform;
        this.audit = audit;
    }

    com.boqlet.contract.model.AdminPlans list() {
        var keys = catalogue.keys().entrySet().stream().map(e -> new EntitlementKey(e.getKey(),
                e.getValue() == EntitlementType.BOOLEAN ? EntitlementKey.TypeEnum.BOOLEAN : EntitlementKey.TypeEnum.NUMBER)).toList();
        return new com.boqlet.contract.model.AdminPlans(platform.read().currency(), keys,
                database.query(SELECT + " ORDER BY p.position, p.created_at, p.id", (row, index) -> plan(row)));
    }

    @Transactional
    AdminPlan create(UUID actor, AdminPlanCreate request) {
        String id = request.getId();
        if (id == null || !id.matches("[a-z0-9][a-z0-9-]{0,62}") || id.equals("new")) throw AdminOrganisations.invalid("invalid_body", "Use lowercase letters, digits and dashes for the plan id.");
        var input = new Input(request.getName(), request.getDescription(), request.getPublic(), request.getDefaultPlan(),
                request.getPosition(), request.getPrice(), request.getEntitlements(), request.getReason());
        var values = validate(input);
        lockPlans();
        try {
            database.update("""
                    INSERT INTO plans (id, name, description, public, default_plan, position, price_amount, price_period, entitlements)
                    VALUES (?, ?, ?, ?, false, ?, ?, ?, CAST(? AS jsonb))
                    """, id, values.name(), values.description(), values.visible(), values.position(), values.amount(), values.period(),
                    values.entitlements().toString());
        } catch (DuplicateKeyException taken) {
            throw new ApiException(HttpStatus.CONFLICT, "plan_exists", "A plan with this id exists.", Map.of());
        }
        if (Boolean.TRUE.equals(input.defaultPlan())) makeDefault(id);
        var created = require(id);
        audit.record(actor, null, "plan.created", "plan", null, Map.of("planId", id, "plan", snapshot(created), "reason", values.reason()));
        return created;
    }

    @Transactional
    AdminPlan update(UUID actor, String id, AdminPlanInput request) {
        var input = new Input(request.getName(), request.getDescription(), request.getPublic(), request.getDefaultPlan(),
                request.getPosition(), request.getPrice(), request.getEntitlements(), request.getReason());
        var values = validate(input);
        lockPlans();
        var before = require(id);
        if (before.getDefaultPlan() && !Boolean.TRUE.equals(input.defaultPlan())) throw defaultRequired();
        database.update("""
                UPDATE plans SET name = ?, description = ?, public = ?, position = ?, price_amount = ?, price_period = ?,
                    entitlements = CAST(? AS jsonb), updated_at = now() WHERE id = ?
                """, values.name(), values.description(), values.visible(), values.position(), values.amount(), values.period(),
                values.entitlements().toString(), id);
        if (Boolean.TRUE.equals(input.defaultPlan()) && !before.getDefaultPlan()) makeDefault(id);
        var after = require(id);
        audit.record(actor, null, "plan.updated", "plan", null,
                Map.of("planId", id, "from", snapshot(before), "to", snapshot(after), "reason", values.reason()));
        return after;
    }

    @Transactional
    void delete(UUID actor, String id, String reason) {
        String why = reason(reason);
        lockPlans();
        var plan = require(id);
        if (plan.getDefaultPlan()) throw defaultRequired();
        if (database.queryForObject("SELECT count(*) FROM subscriptions WHERE plan_id = ?", Long.class, id) > 0) {
            throw new ApiException(HttpStatus.CONFLICT, "plan_in_use", "Move the orgs on this plan to another plan first.",
                    Map.of("orgs", plan.getOrgCount()));
        }
        database.update("DELETE FROM plans WHERE id = ?", id);
        audit.record(actor, null, "plan.deleted", "plan", null, Map.of("planId", id, "plan", snapshot(plan), "reason", why));
    }

    /** What saving `proposed` would do to the orgs on the plan; changes nothing. */
    PlanImpact impact(String id, Map<String, Object> proposed) {
        require(id);
        ObjectNode limits = entitlements(proposed);
        var affected = new LinkedHashMap<String, Integer>();
        var orgs = database.query("""
                SELECT r.seats, r.active_projects, r.processing_minutes, s.overrides::text, p.entitlements::text
                FROM admin_org_rows r JOIN subscriptions s ON s.org_id = r.id JOIN plans p ON p.id = s.plan_id WHERE r.plan_id = ?
                """, (row, index) -> new Org(Map.of("seats", row.getBigDecimal("seats"), "active_projects", row.getBigDecimal("active_projects"),
                        "processing_minutes", row.getBigDecimal("processing_minutes")),
                        json.read(row.getString(4), ObjectNode.class), json.read(row.getString(5), ObjectNode.class)), id);
        for (var org : orgs) {
            ObjectNode now = org.current().deepCopy().setAll(org.overrides());
            ObjectNode next = limits.deepCopy().setAll(org.overrides());
            catalogue.keys().forEach((key, type) -> {
                if (type == EntitlementType.BOOLEAN) {
                    if (now.path(key).asBoolean(false) && !next.path(key).asBoolean(false)) affected.merge(key, 1, Integer::sum);
                } else if (USE.containsKey(key) && next.path(key).isNumber()) {
                    BigDecimal used = org.use().get(USE.get(key));
                    if (used != null && used.compareTo(next.path(key).decimalValue()) > 0) affected.merge(key, 1, Integer::sum);
                }
            });
        }
        return new PlanImpact(orgs.size(), affected);
    }

    PlatformSettings settings() {
        var values = platform.read();
        return new PlatformSettings(values.currency(), values.publicSignUp());
    }

    @Transactional
    PlatformSettings updateSettings(UUID actor, AdminUpdateSettingsRequest request) {
        String why = reason(request.getReason());
        var before = platform.lock();
        String currency = request.getCurrency() == null ? before.currency() : request.getCurrency();
        if (!currency.matches("[A-Z]{3}")) throw AdminOrganisations.invalid("invalid_body", "Use a three-letter ISO 4217 currency code.");
        boolean open = request.getPublicSignUp() == null ? before.publicSignUp() : request.getPublicSignUp();
        var after = new PlatformConfig.Values(currency, open);
        if (!after.equals(before)) {
            platform.write(after);
            audit.record(actor, null, "platform.settings_changed", "platform", null, Map.of(
                    "from", Map.of("currency", before.currency(), "publicSignUp", before.publicSignUp()),
                    "to", Map.of("currency", currency, "publicSignUp", open), "reason", why));
        }
        return settings();
    }

    private record Input(String name, String description, Boolean visible, Boolean defaultPlan, Integer position,
                         AdminPlanPriceInput price, Map<String, Object> entitlements, String reason) {}

    private record Values(String name, String description, boolean visible, int position, BigDecimal amount, String period,
                          ObjectNode entitlements, String reason) {}

    private record Org(Map<String, BigDecimal> use, ObjectNode overrides, ObjectNode current) {}

    private Values validate(Input input) {
        String name = input.name() == null ? "" : input.name().strip();
        if (name.isEmpty() || name.length() > 200) throw AdminOrganisations.invalid("invalid_body", "Enter a plan name of up to 200 characters.");
        String description = input.description() == null ? "" : input.description().strip();
        if (description.length() > 4000) throw AdminOrganisations.invalid("invalid_body", "The description is too long.");
        if (input.visible() == null || input.defaultPlan() == null) throw AdminOrganisations.invalid("invalid_body", "Say whether the plan is public and default.");
        int position = input.position() == null ? -1 : input.position();
        if (position < 0 || position > 10_000) throw AdminOrganisations.invalid("invalid_body", "The position is 0 to 10000.");
        BigDecimal amount = null;
        String period = null;
        if (input.price() != null) {
            amount = input.price().getAmount();
            if (amount == null || amount.signum() < 0 || amount.compareTo(BigDecimal.valueOf(1_000_000_000)) > 0 || amount.stripTrailingZeros().scale() > 2) {
                throw AdminOrganisations.invalid("invalid_body", "Enter a price of 0 or more, with at most two decimals.");
            }
            if (input.price().getPeriod() == null) throw AdminOrganisations.invalid("invalid_body", "Say whether the price is per month or per year.");
            period = input.price().getPeriod().getValue();
        }
        return new Values(name, description, input.visible(), position, amount, period, entitlements(input.entitlements()), reason(input.reason()));
    }

    /** Only the catalogue's keys, each with a valid value; null leaves a key out (unlimited, or a feature off). */
    private ObjectNode entitlements(Map<String, Object> requested) {
        if (requested == null) throw AdminOrganisations.invalid("invalid_body", "Send the plan's entitlements.");
        ObjectNode result = json.object(Map.of());
        requested.forEach((key, value) -> {
            if (value == null) {
                if (!catalogue.keys().containsKey(key)) throw AdminOrganisations.invalid("invalid_body", "Invalid entitlement " + key + ".");
                return;
            }
            JsonNode node = json.object(Map.of("value", value)).path("value");
            if (!catalogue.valid(key, node)) throw AdminOrganisations.invalid("invalid_body", "Invalid entitlement " + key + ".");
            result.set(key, node);
        });
        return result;
    }

    private void makeDefault(String id) {
        database.update("UPDATE plans SET default_plan = false, updated_at = now() WHERE default_plan AND id <> ?", id);
        database.update("UPDATE plans SET default_plan = true, updated_at = now() WHERE id = ?", id);
    }

    /** Plan changes are serialised: the default moves between plans in one step, and a delete sees every subscription. */
    private void lockPlans() {
        database.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended('plans', 0))::text", String.class);
    }

    private AdminPlan require(String id) {
        return database.query(SELECT + " WHERE p.id = ?", (row, index) -> plan(row), id).stream().findFirst()
                .orElseThrow(() -> AdminOrganisations.missing("plan"));
    }

    private AdminPlan plan(java.sql.ResultSet row) throws java.sql.SQLException {
        var plan = new AdminPlan().id(row.getString("id")).name(row.getString("name")).description(row.getString("description"))
                ._public(row.getBoolean("public")).defaultPlan(row.getBoolean("default_plan")).position(row.getInt("position"))
                .entitlements(json.read(row.getString("entitlements"), Entitlements.class)).orgCount(row.getInt("org_count"))
                .createdAt(row.getObject("created_at", OffsetDateTime.class)).updatedAt(row.getObject("updated_at", OffsetDateTime.class));
        BigDecimal amount = row.getBigDecimal("price_amount");
        if (amount != null) plan.price(new PlanPrice(amount, row.getString("currency"), PlanPrice.PeriodEnum.fromValue(row.getString("price_period"))));
        return plan;
    }

    private Map<String, Object> snapshot(AdminPlan plan) {
        var data = new LinkedHashMap<String, Object>();
        data.put("name", plan.getName());
        data.put("description", plan.getDescription());
        data.put("public", plan.getPublic());
        data.put("defaultPlan", plan.getDefaultPlan());
        data.put("position", plan.getPosition());
        data.put("price", plan.getPrice() == null ? null : Map.of("amount", plan.getPrice().getAmount(), "period", plan.getPrice().getPeriod().getValue()));
        data.put("entitlements", json.object(plan.getEntitlements()));
        return data;
    }

    private static String reason(String value) {
        if (value == null || value.isBlank() || value.length() > 4000) throw AdminOrganisations.invalid("invalid_body", "Enter a valid reason.");
        return value.strip();
    }

    private static ApiException defaultRequired() {
        return new ApiException(HttpStatus.CONFLICT, "default_plan_required", "Make another plan the default first.", Map.of());
    }
}
