package com.boqlet.api.boq;

import com.boqlet.api.identity.Login;
import com.boqlet.api.http.Idempotency;
import com.boqlet.contract.api.DiffsApi;
import com.boqlet.contract.model.*;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class DiffController {
    private final Diffs diffs;
    private final Runs runs;
    private final Idempotency idempotency;

    DiffController(Diffs diffs, Runs runs, Idempotency idempotency) {
        this.diffs = diffs;
        this.runs = runs;
        this.idempotency = idempotency;
    }

    // OpenAPI describes both a cached RunDiff and an accepted Job for this route.
    @PostMapping(DiffsApi.PATH_COMPARE_RUNS)
    ResponseEntity<?> compare(@PathVariable("runId") UUID run, @Valid @RequestBody CompareRunsRequest request) {
        UUID actor = actor();
        var outcome = idempotency.once(actor, idempotency.key(), 202, Diffs.Compare.class, () -> {
            runs.visible(run, actor);
            runs.visible(request.getAgainstRunId(), actor);
        }, () -> diffs.compare(run, request.getAgainstRunId(), actor));
        return outcome.diff() == null ? ResponseEntity.accepted().body(outcome.job()) : ResponseEntity.ok(outcome.diff());
    }

    @GetMapping(DiffsApi.PATH_GET_DIFF)
    RunDiff get(@PathVariable("diffId") UUID diff) { return diffs.get(diff, actor()); }

    @GetMapping(DiffsApi.PATH_LIST_DIFF_LINES)
    ListDiffLines200Response lines(@PathVariable("diffId") UUID diff, @RequestParam(required = false) String cursor,
                                   @RequestParam(defaultValue = "100") int limit, @RequestParam(required = false) String change,
                                   @RequestParam(required = false) BigDecimal minDeltaPct) {
        return diffs.lines(diff, actor(), cursor, limit, change, minDeltaPct);
    }

    @GetMapping(DiffsApi.PATH_LIST_DIFF_ELEMENTS)
    ListDiffElements200Response elements(@PathVariable("diffId") UUID diff, @RequestParam(required = false) String cursor,
                                         @RequestParam(defaultValue = "100") int limit) {
        return diffs.elements(diff, actor(), cursor, limit);
    }

    private static UUID actor() { return Login.current().userId(); }
}
