package com.boqlet.api.boq;

import com.boqlet.api.identity.Login;
import com.boqlet.contract.api.DecisionsApi;
import com.boqlet.contract.model.*;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class DecisionController implements DecisionsApi {
    private final Decisions decisions;

    DecisionController(Decisions decisions) { this.decisions = decisions; }

    @Override
    public ResponseEntity<List<Decision>> listDecisions(UUID project, String kind) {
        return ResponseEntity.ok(decisions.list(project, actor(), kind));
    }

    @Override
    public ResponseEntity<UpsertDecisions200Response> upsertDecisions(UUID project, UpsertDecisionsRequest request, Boolean dryRun) {
        return ResponseEntity.ok(decisions.save(project, actor(), request, Boolean.TRUE.equals(dryRun)));
    }

    @Override
    public ResponseEntity<Void> clearDecision(UUID id) {
        decisions.clear(id, actor());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<PresetVersion> promoteDecision(UUID id, PromoteDecisionRequest request) {
        return ResponseEntity.ok(decisions.promote(id, actor(), request.getDictionaryPresetId()));
    }

    private static UUID actor() { return Login.current().userId(); }
}
