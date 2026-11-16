package com.boqlet.api.library;

import com.boqlet.api.identity.Login;
import com.boqlet.contract.api.LibraryApi;
import com.boqlet.contract.model.*;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
class LibraryController implements LibraryApi {
    private final Library library;
    private final LibraryFiles files;
    private final LibraryPreview previews;

    LibraryController(Library library, LibraryFiles files, LibraryPreview previews) {
        this.library = library;
        this.files = files;
        this.previews = previews;
    }

    @Override
    public ResponseEntity<List<Preset>> listPresets(UUID org, PresetKind kind, PresetLayer layer, UUID project, Boolean archived) {
        return ResponseEntity.ok(library.list(org, actor(), kind, layer, project, Boolean.TRUE.equals(archived)));
    }

    @Override
    public ResponseEntity<Preset> createPreset(UUID org, PresetCreate request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(library.create(org, actor(), request));
    }

    @Override
    public ResponseEntity<Preset> getPreset(UUID preset) {
        return ResponseEntity.ok(library.get(preset, actor()));
    }

    @Override
    public ResponseEntity<Preset> updatePreset(UUID preset, UpdatePresetRequest request) {
        return ResponseEntity.ok(library.update(preset, actor(), request));
    }

    @Override
    public ResponseEntity<Preset> archivePreset(UUID preset) {
        return ResponseEntity.ok(library.archive(preset, actor()));
    }

    @Override
    public ResponseEntity<List<PresetUsage>> getPresetUsage(UUID preset) {
        return ResponseEntity.ok(library.usage(preset, actor()));
    }

    @Override
    public ResponseEntity<PresetVersion> getPresetVersion(UUID version) {
        return respond(library.version(version, actor()));
    }

    @Override
    public ResponseEntity<List<PresetVersionInfo>> listPresetVersions(UUID preset) {
        return ResponseEntity.ok(library.versions(preset, actor()));
    }

    @Override
    public ResponseEntity<PresetVersion> saveDraft(UUID preset, SaveDraftRequest request, String ifMatch) {
        return respond(library.save(preset, actor(), request, ifMatch));
    }

    @Override
    public ResponseEntity<Void> discardDraft(UUID preset) {
        library.discard(preset, actor());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<PresetVersion> publishDraft(UUID preset, PublishDraftRequest request) {
        return ResponseEntity.ok(library.publish(preset, actor(), request.getChangeNote()));
    }

    @Override
    public ResponseEntity<CheckResponse> checkPreset(CheckPresetRequest request) {
        return ResponseEntity.ok(library.check(request, actor()));
    }

    @Override
    public ResponseEntity<Job> previewPreset(UUID preset, PreviewPresetRequest request) {
        return ResponseEntity.accepted().body(previews.preview(preset, actor(), request));
    }

    @Override
    public ResponseEntity<List<TermInfo>> listTerms(UUID org, UUID project, String query, String category) {
        return ResponseEntity.ok(library.terms(org, actor(), project, query, category));
    }

    @Override
    public ResponseEntity<Void> downloadPresetTemplate(UUID preset, String source) {
        return ResponseEntity.status(HttpStatus.FOUND).cacheControl(CacheControl.noStore())
                .location(files.template(preset, actor(), source)).build();
    }

    @Override
    public ResponseEntity<TemplateImportResult> importPresetTemplate(UUID preset, MultipartFile file) {
        return ResponseEntity.ok(files.templateImport(preset, actor(), file));
    }

    @Override
    public ResponseEntity<TableReadResponse> readCodeListFile(MultipartFile file) {
        return ResponseEntity.ok(files.codeRead(actor(), file));
    }

    @Override
    public ResponseEntity<CodeListBuildResponse> buildCodeList(CodeListBuildRequest request) {
        return ResponseEntity.ok(files.codeBuild(request));
    }

    private static ResponseEntity<PresetVersion> respond(PresetVersion version) {
        return version.getEtag() == null ? ResponseEntity.ok(version) : ResponseEntity.ok().eTag(version.getEtag()).body(version);
    }

    private static UUID actor() {
        return Login.current().userId();
    }
}
