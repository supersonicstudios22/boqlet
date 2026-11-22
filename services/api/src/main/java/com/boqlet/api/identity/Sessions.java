package com.boqlet.api.identity;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.db.Ids;
import com.boqlet.api.http.RequestContext;
import com.boqlet.contract.model.Session;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class Sessions {
    private static final String VIEW = "id, status, device_label, place, last_seen_at, created_at";

    private final JdbcTemplate database;
    private final AuditWriter audit;
    private final ObjectMapper json;

    public Sessions(JdbcTemplate database, AuditWriter audit, ObjectMapper json) {
        this.database = database;
        this.audit = audit;
        this.json = json;
    }

    @Transactional
    public Session open(Login login, String device, boolean takeover) {
        database.queryForObject("SELECT id FROM users WHERE id = ? FOR NO KEY UPDATE", UUID.class, login.userId());
        database.update("""
                UPDATE sessions SET status = 'expired', ended_at = now()
                WHERE user_id = ? AND status = 'active' AND last_seen_at <= now() - interval '12 hours'
                """, login.userId());
        var active = database.query("SELECT provider_session, " + VIEW + """
                 FROM sessions WHERE user_id = ? AND status = 'active' FOR UPDATE
                """, (row, index) -> new Active(row.getString("provider_session"), map(row, index)), login.userId());
        var previous = active.isEmpty() ? null : active.getFirst();
        if (previous != null && previous.providerSession().equals(login.providerSession())) {
            return require(login, previous.view().getId());
        }
        boolean retired = Boolean.TRUE.equals(database.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM sessions WHERE user_id = ? AND provider_session = ? AND status <> 'active')
                """, Boolean.class, login.userId(), login.providerSession()));
        if (retired) {
            throw IdentityService.failure(HttpStatus.UNAUTHORIZED, "session_expired", "Sign in again to start a new session.");
        }
        if (previous != null && !takeover) {
            throw new SessionConflict(previous.view());
        }
        if (device == null || device.isBlank() || device.length() > 120) {
            throw IdentityService.failure(HttpStatus.BAD_REQUEST, "invalid_body", "A valid session device is required.");
        }
        UUID id = Ids.newId();
        if (previous != null) {
            database.update("UPDATE sessions SET status = 'replaced', ended_at = now() WHERE id = ?",
                    previous.view().getId());
        }
        Session created = database.queryForObject("""
                INSERT INTO sessions (id, user_id, provider_session, status, device_label)
                VALUES (?, ?, ?, 'active', ?) RETURNING
                """ + VIEW, Sessions::map, id, login.userId(), login.providerSession(), device.trim());
        record(login.userId(), id, "session.opened", id, json.createObjectNode()
                .put("deviceLabel", created.getDeviceLabel()).put("takeover", previous != null));
        if (previous != null) {
            UUID replaced = previous.view().getId();
            database.update("UPDATE sessions SET replaced_by_session_id = ? WHERE id = ?", id, replaced);
            var data = json.createObjectNode().put("replacementId", id.toString())
                    .put("replacedDeviceLabel", previous.view().getDeviceLabel())
                    .put("replacementDeviceLabel", created.getDeviceLabel());
            // F01 §10: an owner sees an account being passed around, so the takeover is in each of the user's orgs.
            var orgs = database.queryForList("SELECT org_id FROM memberships WHERE user_id = ? ORDER BY org_id",
                    UUID.class, login.userId());
            if (orgs.isEmpty()) {
                record(login.userId(), id, "session.replaced", replaced, data);
            }
            for (UUID org : orgs) {
                audit.record(new RequestContext(login.userId(), id, org, null), AuditWriter.ActorKind.USER, null,
                        "session.replaced", "session", replaced, data);
            }
        }
        return created;
    }

    /** An account event without an org (BR-51, TF-044): sessions, passwords, failed sign-ins. */
    void record(UUID user, UUID session, String action, UUID entity, com.fasterxml.jackson.databind.JsonNode data) {
        audit.record(new RequestContext(user, session, null, null), AuditWriter.ActorKind.USER, null,
                action, action.startsWith("session.") ? "session" : "user", entity, data);
    }

    public Session require(Login login, UUID id) {
        if (id != null) {
            // The members table's "last active" (TF-118): written with the session's last_seen_at, at most
            // every five minutes per membership.
            var current = database.query("""
                    WITH seen AS (
                        UPDATE sessions SET last_seen_at = now()
                        WHERE id = ? AND user_id = ? AND provider_session = ? AND status = 'active'
                            AND last_seen_at > now() - interval '12 hours'
                        RETURNING
                    """ + VIEW + """
                    ), active AS (
                        UPDATE memberships SET last_active_at = now()
                        WHERE user_id = ? AND EXISTS (SELECT 1 FROM seen)
                            AND (last_active_at IS NULL OR last_active_at < now() - interval '5 minutes')
                    )
                    SELECT * FROM seen
                    """, Sessions::map, id, login.userId(), login.providerSession(), login.userId());
            if (!current.isEmpty()) {
                return current.getFirst();
            }
            var state = database.query("""
                    SELECT CASE WHEN status = 'active' AND last_seen_at <= now() - interval '12 hours'
                        THEN 'expired' ELSE status END AS effective
                    FROM sessions WHERE id = ? AND user_id = ? AND provider_session = ?
                    """, (row, index) -> row.getString("effective"), id, login.userId(), login.providerSession())
                    .stream().findFirst().orElse("");
            if ("replaced".equals(state)) {
                throw IdentityService.failure(HttpStatus.UNAUTHORIZED, "session_replaced", "This session was replaced.");
            }
            if ("expired".equals(state)) {
                throw IdentityService.failure(HttpStatus.UNAUTHORIZED, "session_expired", "This session expired.");
            }
        }
        throw IdentityService.failure(HttpStatus.UNAUTHORIZED, "unauthenticated", "Open a new session to continue.");
    }

    @Transactional
    public void close(Login login) {
        int ended = database.update("""
                UPDATE sessions SET status = 'ended', ended_at = now()
                WHERE id = ? AND user_id = ? AND provider_session = ? AND status = 'active'
                """, login.session().getId(), login.userId(), login.providerSession());
        if (ended == 1) {
            record(login.userId(), login.session().getId(), "session.ended", login.session().getId(),
                    json.createObjectNode().put("reason", "signed_out"));
        }
    }

    private static Session map(ResultSet row, int index) throws SQLException {
        return new Session(row.getObject("id", UUID.class), Session.StatusEnum.fromValue(row.getString("status")),
                row.getString("device_label"), row.getObject("last_seen_at", OffsetDateTime.class))
                .place(row.getString("place")).createdAt(row.getObject("created_at", OffsetDateTime.class));
    }

    private record Active(String providerSession, Session view) {}
}
