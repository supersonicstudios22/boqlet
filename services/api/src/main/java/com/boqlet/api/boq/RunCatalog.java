package com.boqlet.api.boq;

import com.boqlet.api.db.StoredJson;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class RunCatalog {
    private static final String SELECT = """
            SELECT n.*, b.project_id, b.id AS boq_id, u.name AS creator_name, u.email AS creator_email
            FROM runs n JOIN boq_revisions r ON r.id = n.revision_id
            JOIN boqs b ON b.id = r.boq_id LEFT JOIN users u ON u.id = n.created_by AND u.deleted_at IS NULL
            WHERE true
            """;
    private final JdbcTemplate database;
    private final StoredJson json;

    RunCatalog(JdbcTemplate database, StoredJson json) {
        this.database = database;
        this.json = json;
    }

    public record Entry(Run run, UUID project, UUID org, UUID boq, String resultKey, String workbook, ObjectNode snapshot) {}

    public Entry require(UUID run) {
        return database.query(SELECT + " AND n.id = ?", this::map, run).stream().findFirst()
                .orElseThrow(() -> BoqAccess.missing("run"));
    }

    /** Many runs at once (review B-20); a run that isn't found is simply not in the map. */
    java.util.Map<UUID, Entry> requireAll(java.util.Collection<UUID> ids) {
        var out = new java.util.HashMap<UUID, Entry>();
        if (ids.isEmpty()) return out;
        for (var entry : database.query(SELECT + " AND n.id = ANY(CAST(? AS uuid[]))", this::map, BoqInputs.uuidArray(ids))) {
            out.put(entry.run().getId(), entry);
        }
        return out;
    }

    List<Entry> revisions(UUID revision) {
        return database.query(SELECT + " AND n.revision_id = ? ORDER BY n.created_at DESC, n.id DESC", this::map, revision);
    }

    private Entry map(ResultSet row, int ignored) throws SQLException {
        var run = new Run(row.getObject("id", UUID.class), row.getObject("revision_id", UUID.class),
                RunStatus.fromValue(row.getString("status")), row.getObject("created_at", OffsetDateTime.class))
                .jobId(row.getObject("job_id", UUID.class)).finishedAt(row.getObject("finished_at", OffsetDateTime.class))
                .stats(json.read(row.getString("stats"), RunStats.class)).engineVersion(row.getString("engine_version"))
                .building(json.read(row.getString("building"), RunBuilding.class))
                .snapshotVersions(json.read(row.getString("snapshot_versions"), RunSnapshotVersions.class));
        if (row.getString("classifications") != null) {
            run.setClassifications(List.of(json.read(row.getString("classifications"), PublicShareSystemsInner[].class)));
        }
        if (row.getString("models") != null) run.setModels(List.of(json.read(row.getString("models"), RunModelsInner[].class)));
        if (row.getString("error") != null) {
            var err = json.read(row.getString("error"), ObjectNode.class);
            run.setError(new com.boqlet.contract.model.Error(err.path("code").asText(), err.path("message").asText()));
        }
        if (row.getString("creator_name") != null) {
            run.setCreatedBy(new UserRef(row.getObject("created_by", UUID.class), row.getString("creator_name"))
                    .email(row.getString("creator_email")));
        }
        return new Entry(run, row.getObject("project_id", UUID.class), row.getObject("org_id", UUID.class),
                row.getObject("boq_id", UUID.class), row.getString("result_key"), row.getString("xlsx_key"),
                json.read(row.getString("input_snapshot"), ObjectNode.class));
    }
}
