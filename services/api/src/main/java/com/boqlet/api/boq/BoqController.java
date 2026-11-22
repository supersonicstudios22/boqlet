package com.boqlet.api.boq;

import com.boqlet.api.identity.Login;
import com.boqlet.api.http.Idempotency;
import com.boqlet.contract.api.BoqsApi;
import com.boqlet.contract.model.*;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class BoqController implements BoqsApi {
    private final Boqs boqs;
    private final BoqAccess access;
    private final Idempotency idempotency;

    BoqController(Boqs boqs, BoqAccess access, Idempotency idempotency) {
        this.boqs = boqs;
        this.access = access;
        this.idempotency = idempotency;
    }

    @Override
    public ResponseEntity<List<Boq>> listBoqs(UUID project) { return ResponseEntity.ok(access.list(project, actor())); }

    @Override
    public ResponseEntity<Boq> createBoq(UUID project, CreateBoqRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(boqs.create(project, actor(), request));
    }

    @Override
    public ResponseEntity<Boq> getBoq(UUID id) {
        UUID actor = actor();
        return ResponseEntity.ok(access.view(access.bill(id, actor), actor));
    }

    @Override
    public ResponseEntity<Boq> updateBoq(UUID id, UpdateBoqRequest request) {
        return ResponseEntity.ok(boqs.update(id, actor(), request));
    }

    @Override
    public ResponseEntity<Boq> archiveBoq(UUID id) { return ResponseEntity.ok(boqs.archive(id, actor())); }

    @Override
    public ResponseEntity<List<BoqRevision>> listRevisions(UUID id) { return ResponseEntity.ok(access.versions(id, actor())); }

    @Override
    public ResponseEntity<BoqRevision> getRevision(UUID id) {
        UUID actor = actor();
        return ResponseEntity.ok(access.viewRevision(access.revision(id, actor), actor));
    }

    @Override
    public ResponseEntity<BoqRevision> updateRevisionInputs(UUID id, UpdateRevisionInputsRequest request) {
        return ResponseEntity.ok(boqs.updateInputs(id, actor(), request.getInputs()));
    }

    @Override
    public ResponseEntity<BoqRevision> submitRevision(UUID id, SubmitRevisionRequest request) {
        return ResponseEntity.ok(boqs.submit(id, actor(), request));
    }

    @Override
    public ResponseEntity<BoqRevision> requestRevisionChanges(UUID id, RequestRevisionChangesRequest request) {
        return ResponseEntity.ok(boqs.review(id, actor(), request.getComment(), false));
    }

    @Override
    public ResponseEntity<BoqRevision> approveRevision(UUID id, ApproveRevisionRequest request) {
        return ResponseEntity.ok(boqs.review(id, actor(), request == null ? null : request.getComment(), true));
    }

    @Override
    public ResponseEntity<BoqRevision> reopenRevision(UUID id) { return ResponseEntity.ok(boqs.withdraw(id, actor())); }

    @Override
    public ResponseEntity<ReviewComment> addReviewComment(UUID id, AddReviewCommentRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(boqs.comment(id, actor(), request));
    }

    @Override
    public ResponseEntity<BoqRevision> issueRevision(UUID id, IssueRevisionRequest request, UUID idempotencyKey) {
        UUID actor = actor();
        return ResponseEntity.ok(idempotency.once(actor, idempotencyKey, 200, BoqRevision.class,
                () -> access.revision(id, actor), () -> boqs.issue(id, actor, request)));
    }

    @Override
    public ResponseEntity<Boq> confirmBoq(UUID id, UUID idempotencyKey, ConfirmBoqRequest request) {
        UUID actor = actor();
        return ResponseEntity.ok(idempotency.once(actor, idempotencyKey, 200, Boq.class,
                () -> access.bill(id, actor), () -> boqs.confirm(id, actor, request)));
    }

    @Override
    public ResponseEntity<Boq> reopenBoq(UUID id, ReopenBoqRequest request) {
        return ResponseEntity.ok(boqs.reopen(id, actor(), request.getReason()));
    }

    private static UUID actor() { return Login.current().userId(); }
}
