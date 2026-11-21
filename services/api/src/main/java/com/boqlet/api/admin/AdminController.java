package com.boqlet.api.admin;

import com.boqlet.api.identity.Login;
import com.boqlet.contract.api.AdminApi;
import com.boqlet.contract.model.*;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class AdminController implements AdminApi {
    private final AdminOrganisations orgs;
    private final AdminUsers users;
    private final AdminReports reports;

    AdminController(AdminOrganisations orgs, AdminUsers users, AdminReports reports) {
        this.orgs = orgs;
        this.users = users;
        this.reports = reports;
    }

    @Override
    public ResponseEntity<AdminOverview> adminOverview(LocalDate from, LocalDate to) { return ok(reports.overview(from, to)); }

    @Override
    public ResponseEntity<AdminFunnel> adminFunnel(LocalDate from, LocalDate to) { return ok(reports.funnel(from, to)); }

    @Override
    public ResponseEntity<AdminHealth200Response> adminHealth() { return ok(reports.health()); }

    @Override
    public ResponseEntity<AdminListOrgs200Response> adminListOrgs(String cursor, Integer limit, String plan, String status,
            String country, String tag, String signal, AdminFunnelStep stuck, String query, String sort) {
        int start = offset(cursor);
        int size = size(limit);
        var rows = orgs.list(new AdminOrganisations.Filter(plan, status, country, tag, signal, stuck, query, sort), size + 1, start);
        return ok(new AdminListOrgs200Response(rows.stream().limit(size).toList()).nextCursor(next(start, size, rows.size())));
    }

    @Override
    public ResponseEntity<String> adminExportOrgs(String plan, String status, String country, String tag, String signal,
            AdminFunnelStep stuck, String query, String sort) {
        var rows = orgs.list(new AdminOrganisations.Filter(plan, status, country, tag, signal, stuck, query, sort), null, 0);
        // The fields of AdminOrgRow by their contract names, as the mock writes them (F19 "orgs table, CSV").
        var csv = new StringBuilder("﻿id,name,country,planId,status,subscriptionStatus,trialEndsAt,seatsUsed,seatsMax,activeProjects,")
                .append("activeProjectsMax,processingMinutes,processingMinutesMax,limitHits30d,lastActivityAt,createdAt,ownerEmail,tags\r\n");
        for (var row : rows) {
            csv.append(Stream.of(row.getId(), row.getName(), row.getCountry(), row.getPlanId(), row.getStatus(), row.getSubscriptionStatus(),
                    row.getTrialEndsAt().orElse(null), row.getSeats().getUsed(), row.getSeats().getMax().orElse(null),
                    row.getActiveProjects().getUsed(), row.getActiveProjects().getMax().orElse(null), row.getProcessingMinutes().getUsed(),
                    row.getProcessingMinutes().getMax().orElse(null), row.getLimitHits30d(), row.getLastActivityAt().orElse(null),
                    row.getCreatedAt(), row.getOwnerEmail(), String.join("; ", row.getTags()))
                    .map(AdminController::csvCell).collect(Collectors.joining(","))).append("\r\n");
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=boqlet-organisations.csv").body(csv.toString());
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
    public ResponseEntity<List<AdminNote>> adminListNotes(UUID org) { return ok(orgs.notes(org)); }

    @Override
    public ResponseEntity<AdminNote> adminAddNote(UUID org, AdminAddNoteRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                .body(orgs.addNote(actor(), org, request.getText()));
    }

    @Override
    public ResponseEntity<AdminListUsers200Response> adminListUsers(String cursor, Integer limit, String query) {
        int start = offset(cursor);
        int size = size(limit);
        var rows = users.list(Objects.toString(query, "").strip(), size + 1, start);
        return ok(new AdminListUsers200Response(rows.stream().limit(size).toList()).nextCursor(next(start, size, rows.size())));
    }

    @Override
    public ResponseEntity<Void> adminEndUserSession(UUID user) {
        users.end(actor(), user);
        return ResponseEntity.noContent().build();
    }

    private static UUID actor() { return Login.current().userId(); }

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
        throw AdminOrganisations.invalid("invalid_param", "Invalid cursor.");
    }

    private static String csvCell(Object value) {
        String text = Objects.toString(value, "");
        if (value instanceof String && text.stripLeading().matches("(?s)^[=+@-].*")) text = "'" + text;
        return "\"" + text.replace("\"", "\"\"") + "\"";
    }
}
