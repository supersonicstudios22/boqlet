package com.boqlet.api.admin;

import com.boqlet.api.http.Csv;
import com.boqlet.api.identity.Login;
import com.boqlet.contract.api.AdminApi;
import com.boqlet.contract.model.*;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class AdminController implements AdminApi {
    private final AdminOrganisations orgs;
    private final AdminUsers users;
    private final AdminReports reports;
    private final PlanAdministration plans;

    AdminController(AdminOrganisations orgs, AdminUsers users, AdminReports reports, PlanAdministration plans) {
        this.orgs = orgs;
        this.users = users;
        this.reports = reports;
        this.plans = plans;
    }

    @Override
    public ResponseEntity<AdminOverview> adminOverview(LocalDate from, LocalDate to) {
        var overview = reports.overview(from, to);
        viewed("admin.overview_viewed", "platform", null, period(from, to));
        return ok(overview);
    }

    @Override
    public ResponseEntity<AdminFunnel> adminFunnel(LocalDate from, LocalDate to) {
        var funnel = reports.funnel(from, to);
        viewed("admin.funnel_viewed", "platform", null, period(from, to));
        return ok(funnel);
    }

    @Override
    public ResponseEntity<AdminHealth200Response> adminHealth() {
        var health = reports.health();
        viewed("admin.health_viewed", "platform", null, Map.of());
        return ok(health);
    }

    @Override
    public ResponseEntity<AdminListOrgs200Response> adminListOrgs(String cursor, Integer limit, String plan, String status,
            String country, String tag, String signal, AdminFunnelStep stuck, String query, String sort) {
        int start = offset(cursor);
        int size = size(limit);
        var rows = orgs.list(new AdminOrganisations.Filter(plan, status, country, tag, signal, stuck, query, sort), size + 1, start);
        viewed("admin.orgs_listed", "org", null, filters(plan, status, country, tag, signal, stuck, query, Math.min(rows.size(), size)));
        return ok(new AdminListOrgs200Response(rows.stream().limit(size).toList()).nextCursor(next(start, size, rows.size())));
    }

    @Override
    public ResponseEntity<String> adminExportOrgs(String plan, String status, String country, String tag, String signal,
            AdminFunnelStep stuck, String query, String sort) {
        var rows = orgs.list(new AdminOrganisations.Filter(plan, status, country, tag, signal, stuck, query, sort), null, 0);
        // Every org with its owner's email: the export is audited like every admin read (P54 Q59, TF-156).
        viewed("admin.orgs_exported", "org", null, filters(plan, status, country, tag, signal, stuck, query, rows.size()));
        // The fields of AdminOrgRow by their contract names, as the contract names them (F19 "orgs table, CSV").
        var csv = new Csv().row("id", "name", "country", "planId", "status", "subscriptionStatus", "trialEndsAt", "seatsUsed", "seatsMax",
                "activeProjects", "activeProjectsMax", "processingMinutes", "processingMinutesMax", "limitHits30d", "lastActivityAt",
                "createdAt", "ownerEmail", "tags");
        for (var row : rows) {
            csv.row(row.getId(), row.getName(), row.getCountry(), row.getPlanId(), row.getStatus(), row.getSubscriptionStatus(),
                    row.getTrialEndsAt().orElse(null), row.getSeats().getUsed(), row.getSeats().getMax().orElse(null),
                    row.getActiveProjects().getUsed(), row.getActiveProjects().getMax().orElse(null), row.getProcessingMinutes().getUsed(),
                    row.getProcessingMinutes().getMax().orElse(null), row.getLimitHits30d(), row.getLastActivityAt().orElse(null),
                    row.getCreatedAt(), row.getOwnerEmail(), String.join("; ", row.getTags()));
        }
        return csv.download("boqlet-organisations.csv");
    }

    @Override
    public ResponseEntity<AdminOrgDetail> adminGetOrg(UUID org) { return ok(orgs.view(actor(), org)); }

    @Override
    public ResponseEntity<AdminOrgDetail> adminUpdateOrg(UUID org, AdminUpdateOrgRequest request) {
        return ok(orgs.update(actor(), org, request));
    }

    @Override
    public ResponseEntity<AdminOrgDetail> adminSetSubscription(UUID org, AdminSetSubscriptionRequest request) {
        return ok(orgs.subscription(actor(), org, request));
    }

    @Override
    public ResponseEntity<AdminOrgDetail> adminSetEntitlementOverrides(UUID org, AdminSetEntitlementOverridesRequest request) {
        return ok(orgs.overrides(actor(), org, request));
    }

    @Override
    public ResponseEntity<List<AdminNote>> adminListNotes(UUID org) {
        var notes = orgs.notes(org);
        viewed("admin.notes_viewed", "org", org, Map.of("orgId", org));
        return ok(notes);
    }

    @Override
    public ResponseEntity<AdminNote> adminAddNote(UUID org, AdminAddNoteRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                .body(orgs.addNote(actor(), org, request.getText()));
    }

    @Override
    public ResponseEntity<AdminPlans> adminListPlans() {
        var list = plans.list();
        viewed("admin.plans_viewed", "plan", null, Map.of());
        return ok(list);
    }

    @Override
    public ResponseEntity<AdminPlan> adminCreatePlan(AdminPlanCreate request) {
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(plans.create(actor(), request));
    }

    @Override
    public ResponseEntity<AdminPlan> adminUpdatePlan(String plan, AdminPlanInput request) {
        return ok(plans.update(actor(), plan, request));
    }

    @Override
    public ResponseEntity<Void> adminDeletePlan(String plan, AdminPlanDelete request) {
        plans.delete(actor(), plan, request.getReason());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<PlanImpact> adminPlanImpact(String plan, AdminPlanImpactRequest request) {
        return ok(plans.impact(plan, request.getEntitlements()));
    }

    @Override
    public ResponseEntity<PlatformSettings> adminGetSettings() {
        var settings = plans.settings();
        viewed("admin.settings_viewed", "platform", null, Map.of());
        return ok(settings);
    }

    @Override
    public ResponseEntity<PlatformSettings> adminUpdateSettings(AdminUpdateSettingsRequest request) {
        return ok(plans.updateSettings(actor(), request));
    }

    @Override
    public ResponseEntity<AdminListUsers200Response> adminListUsers(String cursor, Integer limit, String query) {
        int start = offset(cursor);
        int size = size(limit);
        var rows = users.list(Objects.toString(query, "").strip(), size + 1, start);
        viewed("admin.users_listed", "user", null, Map.of("query", Objects.toString(query, ""), "rows", Math.min(rows.size(), size)));
        return ok(new AdminListUsers200Response(rows.stream().limit(size).toList()).nextCursor(next(start, size, rows.size())));
    }

    @Override
    public ResponseEntity<Void> adminEndUserSession(UUID user) {
        users.end(actor(), user);
        return ResponseEntity.noContent().build();
    }

    private static UUID actor() { return Login.current().userId(); }

    /** P54 Q59 (TF-156): every platform-admin read is audited, out of any org's log (org null), as the detail view is. */
    private void viewed(String action, String entity, UUID id, Map<String, ?> data) {
        orgs.viewed(actor(), action, entity, id, data);
    }

    private static Map<String, Object> period(LocalDate from, LocalDate to) {
        var data = new java.util.LinkedHashMap<String, Object>();
        if (from != null) data.put("from", from.toString());
        if (to != null) data.put("to", to.toString());
        return data;
    }

    private static Map<String, Object> filters(String plan, String status, String country, String tag, String signal,
                                               AdminFunnelStep stuck, String query, int rows) {
        var data = new java.util.LinkedHashMap<String, Object>();
        if (plan != null) data.put("plan", plan);
        if (status != null) data.put("status", status);
        if (country != null) data.put("country", country);
        if (tag != null) data.put("tag", tag);
        if (signal != null) data.put("signal", signal);
        if (stuck != null) data.put("stuck", stuck.getValue());
        if (query != null) data.put("query", query);
        data.put("rows", rows);
        return data;
    }

    private static <T> ResponseEntity<T> ok(T body) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body); }

    private static int size(Integer limit) { return Math.clamp(Objects.requireNonNullElse(limit, 100), 1, 1000); }

    private static String next(int start, int size, int count) { return count > size ? Long.toString((long) start + size) : null; }

    private static int offset(String cursor) {
        if (cursor == null) return 0;
        try {
            int value = Integer.parseInt(cursor);
            if (value >= 0) return value;
        } catch (NumberFormatException ignored) {
            // Report the invalid cursor below.
        }
        throw AdminOrganisations.invalid("invalid_parameter", "Invalid cursor.");
    }
}
