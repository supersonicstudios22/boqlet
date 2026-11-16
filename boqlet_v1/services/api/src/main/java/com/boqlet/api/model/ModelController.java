package com.boqlet.api.model;

import com.boqlet.api.identity.Login;
import com.boqlet.contract.api.ModelsApi;
import com.boqlet.contract.model.*;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ModelController implements ModelsApi {
    private final Models models;

    ModelController(Models models) {
        this.models = models;
    }

    @Override
    public ResponseEntity<List<Model>> listModels(UUID project) {
        return ResponseEntity.ok(models.list(project, actor()));
    }

    @Override
    public ResponseEntity<Model> createModel(UUID project, ModelCreate request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(models.create(project, actor(), request));
    }

    @Override
    public ResponseEntity<Model> getModel(UUID id) {
        return ResponseEntity.ok(models.get(id, actor()));
    }

    @Override
    public ResponseEntity<Model> updateModel(UUID id, ModelUpdate request) {
        return ResponseEntity.ok(models.update(id, actor(), request));
    }

    @Override
    public ResponseEntity<Void> archiveModel(UUID id) {
        models.archive(id, actor());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<List<ModelVersion>> listModelVersions(UUID id) {
        return ResponseEntity.ok(models.versions(id, actor()));
    }

    @Override
    public ResponseEntity<CreateModelVersion201Response> createModelVersion(UUID id, CreateModelVersionRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(models.createVersion(id, actor(), request));
    }

    @Override
    public ResponseEntity<ModelVersion> getModelVersion(UUID id) {
        return ResponseEntity.ok(models.getVersion(id, actor()));
    }

    @Override
    public ResponseEntity<ModelVersion> completeModelUpload(UUID id, CompleteModelUploadRequest request) {
        return ResponseEntity.ok(models.complete(id, actor(), request));
    }

    @Override
    public ResponseEntity<ModelVersion> retryModelVersion(UUID id) {
        return ResponseEntity.ok(models.retry(id, actor()));
    }

    @Override
    public ResponseEntity<Void> deleteModelVersion(UUID id) {
        models.delete(id, actor());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> getModelGeometry(UUID id) {
        return ResponseEntity.status(HttpStatus.FOUND).cacheControl(CacheControl.noStore()).location(models.geometry(id, actor())).build();
    }

    @Override
    public ResponseEntity<SceneIndex> getModelScene(UUID id) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(models.scene(id, actor()));
    }

    @Override
    public ResponseEntity<NamesResponse> namesInModel(UUID id, NamesInModelRequest request) {
        return ResponseEntity.ok(models.names(id, actor(), request));
    }

    private static UUID actor() {
        return Login.current().userId();
    }
}
