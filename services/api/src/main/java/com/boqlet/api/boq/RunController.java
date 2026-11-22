package com.boqlet.api.boq;

import com.boqlet.api.identity.Login;
import com.boqlet.api.http.Idempotency;
import com.boqlet.contract.api.RunsApi;
import com.boqlet.contract.model.*;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class RunController implements RunsApi {
    private final Runs runs;
    private final RunReads reads;
    private final BoqAccess access;
    private final Idempotency idempotency;

    RunController(Runs runs, RunReads reads, BoqAccess access, Idempotency idempotency) {
        this.runs = runs;
        this.reads = reads;
        this.access = access;
        this.idempotency = idempotency;
    }

    @Override
    public ResponseEntity<GenerateRun202Response> generateRun(UUID revision, UUID idempotencyKey) {
        UUID actor = actor();
        return ResponseEntity.accepted().body(idempotency.once(actor, idempotencyKey, 202, GenerateRun202Response.class,
                () -> access.lockRevision(revision, actor, "editBoqs"), () -> runs.generate(revision, actor)));
    }

    @Override
    public ResponseEntity<Run> getRun(UUID run) { return ResponseEntity.ok(runs.visible(run, actor()).run()); }

    @Override
    public ResponseEntity<List<Run>> listRuns(UUID revision) { return ResponseEntity.ok(runs.list(revision, actor())); }

    @Override
    public ResponseEntity<Void> getRunResult(UUID run) {
        return ResponseEntity.status(HttpStatus.FOUND).cacheControl(CacheControl.noStore()).location(runs.result(run, actor())).build();
    }

    @Override
    public ResponseEntity<LinesPage> listLines(UUID run, String cursor, Integer limit, String groupBy, Integer level,
                                                String groupPath, String source, String storey, String family, String model, String query) {
        return ResponseEntity.ok(reads.written(run, actor(), cursor, limit, groupBy, level, groupPath, source, storey, family, model, query));
    }

    @Override
    public ResponseEntity<LineDetail> getLine(String key, UUID run) { return ResponseEntity.ok(reads.detail(run, actor(), key)); }

    @Override
    public ResponseEntity<List<QuestionWithDecision>> listQuestions(UUID run) { return ResponseEntity.ok(reads.questions(run, actor())); }

    @Override
    public ResponseEntity<List<ListWarnings200ResponseInner>> listWarnings(UUID run) {
        return ResponseEntity.ok(reads.warnings(run, actor()));
    }

    @Override
    public ResponseEntity<LogPage> listLog(UUID run, String cursor, Integer limit, String stage, String level,
                                           String rule, String line, String guid) {
        return ResponseEntity.ok(reads.log(run, actor(), cursor, limit, stage, level, rule, line, guid));
    }

    @Override
    public ResponseEntity<ElementLines> getElementLines(UUID run, String guid) {
        return ResponseEntity.ok(reads.element(run, actor(), guid));
    }

    @Override
    public ResponseEntity<Coverage> getCoverage(UUID run) { return ResponseEntity.ok(reads.coverage(run, actor())); }

    private static UUID actor() { return Login.current().userId(); }
}
