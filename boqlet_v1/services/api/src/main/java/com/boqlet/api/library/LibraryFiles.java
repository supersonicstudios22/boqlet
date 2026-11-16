package com.boqlet.api.library;

import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.storage.ObjectStorage;
import com.boqlet.api.worker.WorkerClient;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.net.URI;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
class LibraryFiles {
    private static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final int UPLOAD_LIMIT = 20 << 20;
    private final Library library;
    private final PresetCatalog catalog;
    private final ObjectStorage storage;
    private final WorkerClient worker;
    private final StoredJson json;

    LibraryFiles(Library library, PresetCatalog catalog, ObjectStorage storage, WorkerClient worker, StoredJson json) {
        this.library = library;
        this.catalog = catalog;
        this.storage = storage;
        this.worker = worker;
        this.json = json;
    }

    URI template(UUID id, UUID actor, String source) {
        var head = library.visible(id, actor);
        var payload = input(head, source);
        JsonNode result = worker.rpc("template-export", payload, JsonNode.class);
        String prefix = head.org() == null ? "system/" : ObjectStorage.orgPrefix(head.org());
        String key = prefix + "templates/" + Ids.newId() + "/" + head.slug() + ".xlsx";
        storage.put(key, XLSX, Base64.getDecoder().decode(result.path("xlsx").asText()));
        return storage.download(key, "private, no-store", XLSX);
    }

    TemplateImportResult templateImport(UUID id, UUID actor, MultipartFile file) {
        var head = library.requireEditor(id, actor);
        var payload = input(head, "draft");
        payload.put("file", Base64.getEncoder().encodeToString(bytes(file)));
        JsonNode result = worker.rpc("template-import", payload, JsonNode.class);
        if (result.has("error")) throw invalid("invalid_file", result.get("error").asText());
        return json.read(result.toString(), TemplateImportResult.class);
    }

    TableReadResponse codeRead(UUID actor, MultipartFile file) {
        String filename = Optional.ofNullable(file.getOriginalFilename()).orElse("codes.csv");
        String key = "internal/code-lists/" + actor + "/" + Ids.newId();
        storage.put(key, "application/octet-stream", bytes(file));
        try {
            return worker.rpc("codelist-read", Map.of("fileKey", key, "fileName", filename), TableReadResponse.class);
        } catch (ApiException error) {
            if (error.status() == HttpStatus.BAD_REQUEST) throw invalid("invalid_file", "The spreadsheet could not be read.");
            throw error;
        } finally {
            storage.delete(key);
        }
    }

    CodeListBuildResponse codeBuild(CodeListBuildRequest request) {
        if (request.getCode() == null || request.getTitle() == null) {
            throw invalid("invalid_body", "Choose the code column and the title column.");
        }
        var mapping = new LinkedHashMap<String, Integer>(Map.of("code", request.getCode(), "title", request.getTitle()));
        if (request.getParent() != null) mapping.put("parent", request.getParent());
        if (request.getDescription() != null) mapping.put("description", request.getDescription());
        if (request.getLevel() != null) mapping.put("level", request.getLevel());
        var input = new LinkedHashMap<String, Object>(Map.of("rows", request.getRows(), "headerRow", request.getHeaderRow(),
                "hierarchy", request.getHierarchy().getValue(), "mapping", mapping));
        input.put("separator", request.getSeparator().orElse(null));
        return worker.rpc("codelist-build", input, CodeListBuildResponse.class);
    }

    private Map<String, Object> input(PresetCatalog.Head head, String source) {
        if (!Set.of("draft", "latest", "empty").contains(source)) throw invalid("invalid_param", "Choose a template source.");
        UUID id = source.equals("latest") || head.draft() == null ? head.published() : head.draft();
        if (id == null) throw new ApiException(HttpStatus.CONFLICT, "no_draft", "The preset has no draft or published version.", Map.of());
        var version = catalog.version(id);
        var data = new LinkedHashMap<String, Object>(Map.of("kind", head.kind().getValue(), "source", source, "doc", version.doc()));
        switch (head.kind()) {
            case RULE_SET -> {
                var rules = catalog.rules(version);
                var checked = library.check(head.kind(), version.doc(), version.parent());
                data.put("effective", checked.getFlattened().orElse(version.doc()));
                if (version.parent() != null) {
                    var parent = catalog.version(version.parent());
                    var parentDoc = library.check(head.kind(), parent.doc(), parent.parent()).getFlattened().orElse(parent.doc());
                    data.put("parentParams", json.object(parentDoc).path("params"));
                    data.put("checkParent", rules.doc().path("extends").asText());
                    data.put("library", rules.library());
                }
            }
            case CLASSIFICATION -> {
                var rules = catalog.system(PresetKind.RULE_SET, "as-modelled").doc();
                var items = new ArrayList<Map<String, String>>();
                for (String group : List.of("items", "derived")) for (JsonNode rule : rules.path(group)) {
                    items.add(Map.of("id", rule.path("id").asText(), "label", rule.path("label").asText(rule.path("id").asText())));
                }
                data.put("items", items);
            }
            case DICTIONARY -> data.put("terms", library.termsFor(catalog.visibleHeads(head.org(), head.project()), null, null)
                    .stream().map(TermInfo::getId).toList());
            default -> throw invalid("no_template", "This preset kind does not have a workbook template.");
        }
        return data;
    }

    private static byte[] bytes(MultipartFile file) {
        if (file.isEmpty()) throw invalid("invalid_file", "Choose a non-empty workbook.");
        if (file.getSize() > UPLOAD_LIMIT) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "too_large", "The file exceeds 20 MiB.", Map.of());
        }
        try {
            return file.getBytes();
        } catch (IOException error) {
            throw invalid("invalid_file", "The file could not be read.");
        }
    }

    private static ApiException invalid(String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, message, Map.of());
    }
}
