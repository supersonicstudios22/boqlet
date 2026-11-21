package com.boqlet.api.boq;

import com.boqlet.api.db.StoredJson;
import com.boqlet.contract.model.LinesPage;
import com.boqlet.contract.model.Run;
import com.boqlet.contract.model.RevisionRef;
import com.boqlet.contract.model.RevisionStatus;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class BoqReadService {
    private final BoqAccess boqs;
    private final RunReads lines;
    private final Runs runs;
    private final RunIndex index;
    private final JdbcTemplate database;
    private final StoredJson json;

    BoqReadService(BoqAccess boqs, RunReads lines, Runs runs, RunIndex index, JdbcTemplate database, StoredJson json) {
        this.boqs = boqs;
        this.lines = lines;
        this.runs = runs;
        this.index = index;
        this.database = database;
        this.json = json;
    }

    public LinesPage lines(UUID run, UUID actor, String cursor, int limit, String grouping) {
        return lines.lines(run, actor, cursor, limit, grouping, null, null, null, null, null, null, null);
    }

    public Run current(UUID boq, UUID actor) {
        var scope = boqs.bill(boq, actor);
        UUID run = scope.revision().run();
        return run == null ? null : runs.visible(run, actor).run();
    }

    public List<RevisionRef> saved(UUID boq, UUID actor) {
        var bill = boqs.bill(boq, actor).bill();
        return database.query("""
                SELECT id, label FROM boq_revisions WHERE boq_id = ? AND status = 'issued'
                ORDER BY number DESC
                """, (row, count) -> new RevisionRef(boq, bill.name(), row.getObject("id", UUID.class),
                row.getString("label"), RevisionStatus.ISSUED), boq);
    }

    public record Selection(List<String> lineKeys, List<String> sectionCodes, List<String> guids) {}

    public List<String> resolve(UUID run, UUID actor, String system, Selection selected) {
        runs.visible(run, actor);
        index.ensure(run);
        return database.queryForList("""
                WITH chosen AS (SELECT CAST(? AS jsonb) AS lines, CAST(? AS jsonb) AS codes, CAST(? AS jsonb) AS guids)
                SELECT l.line_key FROM run_lines l CROSS JOIN chosen c
                WHERE l.run_id = ? AND NOT coalesce((l.line->>'excluded')::boolean, false) AND
                  (jsonb_exists(c.lines, l.line_key)
                    OR EXISTS (SELECT 1 FROM jsonb_array_elements(l.line->'codes'->CAST(? AS text)->'path') p
                               WHERE jsonb_exists(c.codes, p->>'code'))
                    OR EXISTS (SELECT 1 FROM run_line_elements e
                               WHERE e.run_id = l.run_id AND e.line_key = l.line_key AND jsonb_exists(c.guids, e.guid)))
                ORDER BY l.sort_index
                """, String.class, array(selected.lineKeys()), array(selected.sectionCodes()), array(selected.guids()), run, system);
    }

    private String array(List<String> values) { return json.object(Map.of("items", values)).path("items").toString(); }
}
