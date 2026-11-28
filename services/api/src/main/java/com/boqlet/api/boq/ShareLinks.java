package com.boqlet.api.boq;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.GeneralSecurityException;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class ShareLinks {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String SELECT = """
            SELECT l.*, p.id AS project_id, p.org_id, p.name AS project_name, o.name AS firm_name, b.name AS boq_name,
                   CASE WHEN l.revoked_at IS NOT NULL OR o.status = 'deleting' THEN 'revoked'
                        WHEN NOT coalesce((o.settings->>'publicLinksAllowed')::boolean, true) OR o.status = 'suspended' THEN 'suspended'
                        WHEN l.expires_at <= now() THEN 'expired' ELSE 'active' END AS share_status,
                   v.current_run_id AS latest_run
            FROM share_links l JOIN boqs b ON b.id = l.boq_id JOIN projects p ON p.id = b.project_id
            JOIN orgs o ON o.id = p.org_id LEFT JOIN boq_revisions v ON v.id = b.latest_issued_revision_id
            """;

    private final JdbcTemplate database;
    private final StoredJson json;
    private final BoqAccess boqs;
    private final ProjectAccess projects;
    private final OrgAccess orgs;
    private final EntitlementService limits;
    private final AuditWriter audit;
    private final RunCatalog runCatalog;
    private final String appUrl;
    private final byte[] tokenSecret;

    ShareLinks(JdbcTemplate database, StoredJson json, BoqAccess boqs, ProjectAccess projects, OrgAccess orgs,
               EntitlementService limits, AuditWriter audit, RunCatalog runCatalog,
               @Value("${BOQLET_APP_URL:http://localhost:3000}") String appUrl,
               @Value("${boqlet.auth.invitation-secret:}") String tokenSecret) {
        this.database = database;
        this.json = json;
        this.boqs = boqs;
        this.projects = projects;
        this.orgs = orgs;
        this.limits = limits;
        this.audit = audit;
        this.runCatalog = runCatalog;
        this.appUrl = appUrl.replaceAll("/+$", "");
        this.tokenSecret = tokenSecret.getBytes(StandardCharsets.UTF_8);
    }

    record Link(ShareLink view, UUID org, UUID creator, UUID shownRun, String firm) {}
    record Shown(RunCatalog.Entry run, String label, String status) {}

    List<ShareLink> list(UUID boq, UUID actor) {
        var scope = boqs.bill(boq, actor);
        return query("l.boq_id = ?", boq).stream()
                .map(link -> view(link, actor, scope.project(), orgAdmin(link, actor))).toList();
    }

    List<ShareLink> listOrg(UUID org, UUID actor) {
        OrgAccess.checkRole(orgs.require(org, actor).role(), OrgRole.OWNER, OrgRole.ADMIN);
        return query("p.org_id = ?", org).stream()
                .map(link -> view(link, actor, projects.require(link.view().getProjectId(), actor), true)).toList();
    }

    @Transactional
    ShareLinkCreated create(UUID boq, UUID actor, ShareLinkCreate request, UUID replayKey) {
        var scope = boqs.lockBill(boq, actor, "share");
        archived(scope);
        var project = scope.project();
        UUID org = project.getOrgId();
        limits.requireFeature(org, actor, "shareLinks");
        if (Boolean.FALSE.equals(orgs.require(org, actor).org().getSettings().getPublicLinksAllowed())) {
            throw BoqAccess.failure(HttpStatus.CONFLICT, "public_links_off", "Public links are switched off for this organisation.");
        }
        UUID run = null;
        if (request.getMode() == ShareLinkCreate.ModeEnum.PINNED) {
            var version = request.getRevisionId() == null ? scope.revision() : boqs.readVersion(request.getRevisionId());
            if (!version.bill().equals(boq)) {
                // Another org's version answers like one that doesn't exist (security.md, TF-175).
                if (!Boolean.TRUE.equals(database.queryForObject("""
                        SELECT EXISTS(SELECT 1 FROM boqs b JOIN projects p ON p.id = b.project_id WHERE b.id = ? AND p.org_id = ?)
                        """, Boolean.class, version.bill(), org))) throw BoqAccess.missing("revision");
                throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_body", "That version belongs to another BoQ.");
            }
            if (version.status() != RevisionStatus.ISSUED) boqs.requireShareWorking(project, actor);
            if (version.run() == null || shown(version.run()) == null) {
                throw BoqAccess.failure(HttpStatus.CONFLICT, "no_run", "Generate the BoQ before sharing this version.");
            }
            run = version.run();
        }
        future(request.getExpiresAt().orElse(null));
        UUID id = Ids.newId();
        String token = token(id, replayKey);
        database.update("""
                INSERT INTO share_links(id, boq_id, mode, run_id, token_hash, options, label, created_by, expires_at)
                VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)
                """, id, boq, request.getMode().getValue(), run, hash(token),
                json.object(options(request.getInclude(), new ShareInclude().lineDetail(true).viewer(true).log(false).excel(false).editMarks(true))).toString(),
                label(request.getLabel()), actor, request.getExpiresAt().orElse(null));
        var link = require(id);
        record(link, actor, "created");
        ObjectNode response = json.object(view(link, actor, project, orgAdmin(link, actor)));
        response.put("url", appUrl + "/s/" + token);
        return json.read(response.toString(), ShareLinkCreated.class);
    }

    /** By the database's clock, the one that says a link is `expired`. */
    private void future(OffsetDateTime expiry) {
        if (expiry != null && !Boolean.TRUE.equals(database.queryForObject("SELECT ?::timestamptz > now()", Boolean.class, expiry))) {
            throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_body", "Choose an expiry in the future.");
        }
    }

    void authorizeCreation(UUID boq, UUID actor) { boqs.lockBill(boq, actor, "share"); }

    String replayUrl(UUID link, UUID key) { return appUrl + "/s/" + token(link, key); }

    private String token(UUID link, UUID replayKey) {
        byte[] bytes;
        if (replayKey == null) {
            bytes = new byte[32];
            RANDOM.nextBytes(bytes);
        } else {
            if (tokenSecret.length < 32) throw BoqAccess.failure(HttpStatus.SERVICE_UNAVAILABLE, "share_unavailable",
                    "The share signing secret is not configured.");
            try {
                Mac mac = Mac.getInstance("HmacSHA256");
                mac.init(new SecretKeySpec(tokenSecret, "HmacSHA256"));
                bytes = mac.doFinal(("boq-share:" + link + ":" + replayKey).getBytes(StandardCharsets.US_ASCII));
            } catch (GeneralSecurityException impossible) {
                throw new IllegalStateException(impossible);
            }
        }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    @Transactional
    ShareLink update(UUID id, UUID actor, UpdateShareLinkRequest request) {
        var link = visible(id, actor);
        var project = projects.lock(link.view().getProjectId(), actor, "share");
        archived(boqs.bill(link.view().getBoqId(), actor));
        database.queryForObject("SELECT id FROM share_links WHERE id = ? FOR NO KEY UPDATE", UUID.class, id);
        link = require(id);
        var current = link.view();
        if (current.getStatus() == ShareLink.StatusEnum.REVOKED) {
            throw Boqs.transition("The link is revoked.", current.getStatus().getValue());
        }
        // An expired link is revived by a later expiry (P54 Q46, TF-038); an expiry is never set in the past.
        if (request.getExpiresAt().isPresent()) future(request.getExpiresAt().get());
        database.update("UPDATE share_links SET options = ?::jsonb, label = ?, expires_at = ? WHERE id = ?",
                json.object(options(request.getInclude(), current.getInclude())).toString(),
                request.getLabel() == null ? current.getLabel() : label(request.getLabel()),
                request.getExpiresAt().orElse(current.getExpiresAt().orElse(null)), id);
        link = require(id);
        record(link, actor, "updated");
        return view(link, actor, project, orgAdmin(link, actor));
    }

    /**
     * An archived BoQ is not shared further (review A-39, ENG-024): no new link, and no edit that could revive or widen
     * one (an expiry, P54 Q46). Its existing links can still be revoked (P54 Q42).
     */
    private static void archived(BoqAccess.Scope scope) {
        if (scope.bill().archived()) {
            throw BoqAccess.failure(HttpStatus.CONFLICT, "boq_archived", "The BoQ is archived. Restore it to share it.");
        }
    }

    @Transactional
    void revoke(UUID id, UUID actor) {
        var link = visible(id, actor);
        var project = projects.require(link.view().getProjectId(), actor);
        if (!canRevoke(link, actor, project, orgAdmin(link, actor))) projects.role(project, "revokeShares");
        if (database.update("UPDATE share_links SET revoked_at = now() WHERE id = ? AND revoked_at IS NULL", id) > 0) {
            record(link, actor, "revoked");
        }
    }

    Link publicLink(String token) {
        if (!token.matches("[A-Za-z0-9_-]{43}")) throw BoqAccess.missing("share link");
        return query("l.token_hash = ?", hash(token)).stream()
                .filter(link -> link.view().getStatus() == ShareLink.StatusEnum.ACTIVE)
                .findFirst().orElseThrow(() -> BoqAccess.missing("share link"));
    }

    void count(Link link) {
        database.update("UPDATE share_links SET views = views + 1, last_viewed_at = now() WHERE id = ?",
                link.view().getId());
    }

    Shown shown(UUID run) {
        if (run == null) return null;
        return database.query("""
                SELECT v.label, v.status FROM runs n JOIN boq_revisions original ON original.id = n.revision_id
                JOIN boq_revisions v ON v.boq_id = original.boq_id
                WHERE n.id = ? AND n.result_key IS NOT NULL AND
                      (v.id = original.id OR (v.status = 'issued' AND v.current_run_id = n.id))
                ORDER BY (v.status = 'issued' AND v.current_run_id = n.id) DESC NULLS LAST, v.number DESC LIMIT 1
                """, (row, index) -> new Shown(runCatalog.require(run), row.getString("label"), row.getString("status")), run)
                .stream().findFirst().orElse(null);
    }

    private Link visible(UUID id, UUID actor) {
        var link = require(id);
        projects.require(link.view().getProjectId(), actor);
        return link;
    }

    private Link require(UUID id) {
        return query("l.id = ?", id).stream().findFirst().orElseThrow(() -> BoqAccess.missing("share link"));
    }

    private List<Link> query(String filter, Object value) {
        return database.query(SELECT + " WHERE " + filter + " ORDER BY l.created_at DESC, l.id", (row, index) -> {
            UUID run = row.getObject("run_id", UUID.class);
            UUID creator = row.getObject("created_by", UUID.class);
            var view = new ShareLink(row.getObject("id", UUID.class), row.getObject("boq_id", UUID.class),
                    ShareLink.ModeEnum.fromValue(row.getString("mode")), json.read(row.getString("options"), ShareInclude.class),
                    ShareLink.StatusEnum.fromValue(row.getString("share_status")), row.getObject("created_at", OffsetDateTime.class))
                    .runId(run).expiresAt(row.getObject("expires_at", OffsetDateTime.class)).label(row.getString("label"))
                    .views(row.getInt("views")).lastViewedAt(row.getObject("last_viewed_at", OffsetDateTime.class))
                    .projectId(row.getObject("project_id", UUID.class)).projectName(row.getString("project_name"))
                    .boqName(row.getString("boq_name"));
            return new Link(view, row.getObject("org_id", UUID.class), creator,
                    run == null ? row.getObject("latest_run", UUID.class) : run, row.getString("firm_name"));
        }, value);
    }

    private ShareLink view(Link link, UUID actor, Project project, boolean admin) {
        var shown = shown(link.shownRun());
        return link.view().createdBy(boqs.user(link.creator())).revisionLabel(shown == null ? null : shown.label())
                .permissions(Map.of("edit", canShare(project), "revoke", canRevoke(link, actor, project, admin)));
    }

    private boolean orgAdmin(Link link, UUID actor) {
        return Set.of(OrgRole.OWNER, OrgRole.ADMIN).contains(orgs.require(link.org(), actor).role());
    }

    private static boolean canShare(Project project) {
        return BoqAccess.allowed(project.getPermissions(), "share");
    }

    private static boolean canRevoke(Link link, UUID actor, Project project, boolean admin) {
        return admin || BoqAccess.allowed(project.getPermissions(), "revokeShares") || actor.equals(link.creator()) && canShare(project);
    }

    private static ShareInclude options(ShareInclude patch, ShareInclude base) {
        if (patch == null) return base;
        return new ShareInclude().lineDetail(Objects.requireNonNullElse(patch.getLineDetail(), base.getLineDetail()))
                .viewer(Objects.requireNonNullElse(patch.getViewer(), base.getViewer()))
                .log(Objects.requireNonNullElse(patch.getLog(), base.getLog()))
                .excel(Objects.requireNonNullElse(patch.getExcel(), base.getExcel()))
                .excelProfile(patch.getExcelProfile() == null ? base.getExcelProfile() : patch.getExcelProfile())
                .groupBy(patch.getGroupBy() == null ? base.getGroupBy() : patch.getGroupBy())
                // Review C-27: on unless the link says otherwise (P54 Q52); older links have no value and read as on.
                .editMarks(patch.getEditMarks() == null ? base.getEditMarks() : patch.getEditMarks());
    }

    private void record(Link link, UUID actor, String action) {
        audit.record(new RequestContext(actor, null, link.org(), null), AuditWriter.ActorKind.USER,
                link.view().getProjectId(), "share_link." + action, "shareLink", link.view().getId(),
                json.object(Map.of("boqId", link.view().getBoqId(), "mode", link.view().getMode())));
    }

    private static byte[] hash(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static String label(String value) { return value == null || value.isBlank() ? null : value.strip(); }
}
