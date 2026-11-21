package com.boqlet.api.project;

import com.boqlet.api.boq.Boqs;
import com.boqlet.api.boq.Runs;
import com.boqlet.api.boq.Decisions;
import com.boqlet.contract.model.CreateBoqRequest;
import com.boqlet.contract.model.DecisionInput;
import com.boqlet.contract.model.UpsertDecisionsRequest;
import com.boqlet.contract.model.RevisionInputsPartial;
import com.boqlet.contract.model.RevisionModelInput;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
class SampleProjects {
    private static final Logger LOG = LoggerFactory.getLogger(SampleProjects.class);
    private final JdbcTemplate database;
    private final TransactionTemplate transactions;
    private final Boqs boqs;
    private final Runs runs;
    private final Decisions decisions;

    SampleProjects(JdbcTemplate database, TransactionTemplate transactions, Boqs boqs, Runs runs, Decisions decisions) {
        this.database = database;
        this.transactions = transactions;
        this.boqs = boqs;
        this.runs = runs;
        this.decisions = decisions;
    }

    @Scheduled(fixedDelayString = "${BOQLET_SAMPLE_POLL_MS:2000}")
    void provision() {
        var ready = database.queryForList("""
                SELECT s.project_id FROM sample_projects s JOIN model_versions v ON v.id = s.model_version_id
                JOIN projects p ON p.id = s.project_id JOIN orgs o ON o.id = p.org_id
                WHERE s.run_id IS NULL AND s.attempts < 5 AND s.available_at <= now()
                  AND v.status = 'ready' AND p.status = 'active' AND o.status = 'active'
                ORDER BY s.available_at, s.project_id LIMIT 10
                """, UUID.class);
        for (UUID project : ready) {
            try {
                transactions.executeWithoutResult(status -> createBoq(project));
            } catch (RuntimeException failure) {
                database.update("""
                        UPDATE sample_projects SET attempts = attempts + 1,
                            available_at = now() + ((attempts + 1) * interval '30 seconds')
                        WHERE project_id = ? AND run_id IS NULL
                        """, project);
                LOG.warn("Could not provision the sample BoQ in project {} ({})", project, failure.getClass().getSimpleName());
            }
        }
    }

    private void createBoq(UUID project) {
        database.query("""
                SELECT s.created_by, v.model_id, v.id FROM sample_projects s JOIN model_versions v ON v.id = s.model_version_id
                WHERE s.project_id = ? AND s.run_id IS NULL AND s.available_at <= now() FOR NO KEY UPDATE OF s SKIP LOCKED
                """, (row, index) -> new Seed(row.getObject(1, UUID.class), row.getObject(2, UUID.class),
                row.getObject(3, UUID.class)), project).stream().findFirst().ifPresent(seed -> {
            var input = new RevisionInputsPartial().models(List.of(new RevisionModelInput(seed.model(), seed.version(), "architecture")));
            var boq = boqs.create(project, seed.actor(), new CreateBoqRequest("Duplex quantities").inputs(input));
            String partyWall = ":IfcWall:Party Wall - CMU Residential Unit Dimising Wall";
            var examples = List.of(new DecisionInput("contradiction:thickness" + partyWall, "contradiction", "reported"),
                    new DecisionInput("contradiction:volume" + partyWall, "contradiction", "reported"));
            decisions.save(project, seed.actor(), new UpsertDecisionsRequest(examples).addToProjectDictionary(false), false);
            var generated = runs.generateSample(boq.getCurrentRevision().getId(), seed.actor());
            database.update("UPDATE sample_projects SET run_id = ? WHERE project_id = ?", generated.getRun().getId(), project);
        });
    }

    private record Seed(UUID actor, UUID model, UUID version) {}
}
