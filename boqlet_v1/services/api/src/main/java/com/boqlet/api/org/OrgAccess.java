package com.boqlet.api.org;

import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.contract.model.Org;
import com.boqlet.contract.model.OrgRole;
import com.boqlet.contract.model.OrgSettings;
import com.boqlet.contract.model.OrgSetup;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class OrgAccess {
    private static final String MEMBERSHIPS = """
            SELECT o.*, s.plan_id, m.role FROM orgs o
            JOIN memberships m ON m.org_id = o.id
            JOIN subscriptions s ON s.org_id = o.id
            WHERE o.status <> 'deleting' AND m.user_id = ?
            """;

    private final JdbcTemplate database;
    private final StoredJson json;

    public OrgAccess(JdbcTemplate database, StoredJson json) {
        this.database = database;
        this.json = json;
    }

    public record MemberOrg(Org org, OrgRole role) {}

    public List<MemberOrg> list(UUID user) {
        return database.query(MEMBERSHIPS + " ORDER BY o.name, o.id", this::map, user);
    }

    public MemberOrg require(UUID org, UUID user) {
        return database.query(MEMBERSHIPS + " AND o.id = ?", this::map, user, org)
                .stream().findFirst().orElseThrow(() -> missing("organisation"));
    }

    /** All organisation and membership mutations lock the tenancy row first. */
    public MemberOrg lock(UUID org, UUID user, OrgRole... allowed) {
        require(org, user);
        lockOrg(org);
        MemberOrg access = require(org, user);
        checkRole(access.role(), allowed);
        checkActive(access.org());
        return access;
    }

    void lockOrg(UUID org) {
        if (database.queryForList("SELECT id FROM orgs WHERE id = ? AND status <> 'deleting' FOR UPDATE",
                UUID.class, org).isEmpty()) throw missing("organisation");
    }

    public static void checkActive(Org org) {
        if (org.getStatus() == Org.StatusEnum.SUSPENDED) {
            throw new ApiException(HttpStatus.CONFLICT, "org_suspended", "The organisation is suspended.", Map.of());
        }
    }

    public static void checkRole(OrgRole actual, OrgRole... allowed) {
        if (allowed.length > 0 && Arrays.stream(allowed).noneMatch(role -> role == actual)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "forbidden", "This action requires a different role.",
                    Map.of("requiredRole", allowed[0].getValue()));
        }
    }

    static ApiException missing(String type) {
        return new ApiException(HttpStatus.NOT_FOUND, "not_found", "The " + type + " was not found.", Map.of());
    }

    private MemberOrg map(ResultSet row, int ignored) throws SQLException {
        var org = new Org(row.getObject("id", UUID.class), row.getString("name"), row.getString("slug"),
                row.getString("plan_id"), json.read(row.getString("settings"), OrgSettings.class))
                .status(Org.StatusEnum.fromValue(row.getString("status")))
                .createdAt(row.getObject("created_at", OffsetDateTime.class));
        OrgSetup setup = json.read(row.getString("setup"), OrgSetup.class);
        if (setup != null) org.setSetup(setup);
        return new MemberOrg(org, OrgRole.fromValue(row.getString("role")));
    }
}
