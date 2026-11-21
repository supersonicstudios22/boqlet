package com.boqlet.api.admin;

import com.boqlet.contract.model.AdminUserRow;
import com.boqlet.contract.model.AdminUserRowOrgsInner;
import com.boqlet.contract.model.OrgRole;
import com.boqlet.contract.model.Session;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class AdminUsers {
    private final JdbcTemplate database;
    private final AdminOrganisations orgs;

    AdminUsers(JdbcTemplate database, AdminOrganisations orgs) {
        this.database = database;
        this.orgs = orgs;
    }

    List<AdminUserRow> list(String query, int limit, int offset) {
        return database.query("""
                SELECT u.id, u.name, u.email, u.created_at,
                    (SELECT max(created_at) FROM sessions s WHERE s.user_id = u.id) AS last_sign_in
                FROM users u WHERE u.deleted_at IS NULL AND
                    (strpos(lower(concat_ws(' ', u.name, u.email)), lower(?)) > 0 OR ? = '')
                ORDER BY lower(u.name), u.id LIMIT ? OFFSET ?
                """, (row, index) -> new AdminUserRow(row.getObject("id", UUID.class), row.getString("name"), row.getString("email"))
                .lastSignInAt(AdminOrganisations.time(row, "last_sign_in")).createdAt(AdminOrganisations.time(row, "created_at")),
                query, query, limit, offset).stream().map(user ->
                    user.orgs(memberships(user.getId())).activeSession(active(user.getId()))).toList();
    }

    @Transactional
    void end(UUID actor, UUID user) {
        if (database.queryForList("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL FOR NO KEY UPDATE",
                UUID.class, user).isEmpty()) throw AdminOrganisations.missing("user");
        var sessions = database.queryForList("""
                UPDATE sessions SET status = 'ended', ended_at = now() WHERE user_id = ? AND status = 'active'
                    AND last_seen_at > now() - interval '12 hours' RETURNING id
                """, UUID.class, user);
        if (sessions.isEmpty()) throw AdminOrganisations.missing("session");
        orgs.record(actor, null, "admin.session_ended", "session", sessions.getFirst(), Map.of("userId", user));
    }

    private List<AdminUserRowOrgsInner> memberships(UUID user) {
        return database.query("""
                SELECT o.id, o.name, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id
                WHERE m.user_id = ? AND o.status <> 'deleting' ORDER BY lower(o.name), o.id
                """, (row, index) -> new AdminUserRowOrgsInner().orgId(row.getObject("id", UUID.class))
                .orgName(row.getString("name")).role(OrgRole.fromValue(row.getString("role"))), user);
    }

    private Session active(UUID user) {
        return database.query("""
                SELECT id, device_label, place, last_seen_at, created_at FROM sessions
                WHERE user_id = ? AND status = 'active' AND last_seen_at > now() - interval '12 hours'
                """, (row, index) -> new Session(row.getObject("id", UUID.class), Session.StatusEnum.ACTIVE,
                    row.getString("device_label"), AdminOrganisations.time(row, "last_seen_at"))
                    .place(row.getString("place")).createdAt(AdminOrganisations.time(row, "created_at")), user)
                .stream().findFirst().orElse(null);
    }
}
