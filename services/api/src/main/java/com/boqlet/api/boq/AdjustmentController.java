package com.boqlet.api.boq;

import com.boqlet.api.identity.Login;
import com.boqlet.contract.api.AdjustmentsApi;
import com.boqlet.contract.model.*;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class AdjustmentController implements AdjustmentsApi {
    private final Adjustments adjustments;

    AdjustmentController(Adjustments adjustments) { this.adjustments = adjustments; }

    @Override
    public ResponseEntity<List<LineOverride>> listOverrides(UUID boq) {
        return ResponseEntity.ok(adjustments.overrides(boq, actor()));
    }

    @Override
    public ResponseEntity<LineOverride> setOverride(UUID boq, LineOverrideInput input) {
        return ResponseEntity.ok(adjustments.write(boq, actor(), input));
    }

    @Override
    public ResponseEntity<ApplyLineEdits200Response> applyLineEdits(UUID boq, ApplyLineEditsRequest input) {
        return ResponseEntity.ok(adjustments.batch(boq, actor(), input));
    }

    @Override
    public ResponseEntity<Void> removeOverride(UUID item) {
        adjustments.removeOverride(item, actor());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<List<ManualItemRecord>> listManualItems(UUID boq) {
        return ResponseEntity.ok(adjustments.manual(boq, actor()));
    }

    @Override
    public ResponseEntity<ManualItemRecord> addManualItem(UUID boq, ManualItemInput input) {
        return ResponseEntity.status(HttpStatus.CREATED).body(adjustments.add(boq, actor(), input));
    }

    @Override
    public ResponseEntity<ManualItemRecord> updateManualItem(UUID item, ManualItemInput input) {
        return ResponseEntity.ok(adjustments.update(item, actor(), input));
    }

    @Override
    public ResponseEntity<Void> removeManualItem(UUID item) {
        adjustments.removeManual(item, actor());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<BoqPresence> putBoqPresence(UUID boq, PutBoqPresenceRequest request) {
        return ResponseEntity.ok(adjustments.presence(boq, actor(), request.getLineKey().orElse(null)));
    }

    @Override
    public ResponseEntity<Void> leaveBoqPresence(UUID boq) {
        adjustments.leave(boq, actor());
        return ResponseEntity.noContent().build();
    }

    private static UUID actor() { return Login.current().userId(); }
}
