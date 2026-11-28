package com.boqlet.api.library;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.api.worker.WorkerClient;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.text.Normalizer;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import static com.boqlet.contract.model.OrgRole.*;

@Service
public class Library {
    private static final Map<PresetKind, String> CHECKS = Map.of(PresetKind.RULE_SET, "rules",
            PresetKind.DICTIONARY, "dictionaries", PresetKind.CLASSIFICATION, "classifications",
            PresetKind.RESOLUTION, "resolution");
    private final JdbcTemplate database;
    private final StoredJson json;
    private final PresetCatalog catalog;
    private final OrgAccess orgs;
    private final ProjectAccess projects;
    private final EntitlementService limits;
    private final WorkerClient worker;
    private final AuditWriter audit;

    Library(JdbcTemplate database, StoredJson json, PresetCatalog catalog, OrgAccess orgs, ProjectAccess projects,
            EntitlementService limits, WorkerClient worker, AuditWriter audit) {
        this.database = database;
        this.json = json;
        this.catalog = catalog;
        this.orgs = orgs;
        this.projects = projects;
        this.limits = limits;
        this.worker = worker;
        this.audit = audit;
    }

    List<Preset> list(UUID org, UUID actor, PresetKind kind, PresetLayer layer, UUID project, boolean includeArchived) {
        var role = orgs.require(org, actor).role();
        var projectDetails = project == null ? null : projects.require(project, actor);
        if (projectDetails != null && !org.equals(projectDetails.getOrgId())) throw PresetCatalog.missing();
        return catalog.visibleHeads(org, project).stream().filter(head ->
                (kind == null || head.kind() == kind) && (layer == null || head.layer() == layer)
                        && (includeArchived || !head.archived())).map(head -> view(head, switch (head.layer()) {
                            case SYSTEM -> false;
                            case ORG -> canEdit(role);
                            case PROJECT -> Boolean.TRUE.equals(projectDetails.getPermissions().get("editPresets"));
                        }, actor)).toList();
    }

    Preset get(UUID id, UUID actor) {
        var access = access(id, actor);
        return view(access.head(), access.edit(), actor);
    }

    PresetCatalog.Head visible(UUID id, UUID actor) {
        return access(id, actor).head();
    }

    List<PresetUsage> usage(UUID preset, UUID actor) {
        visible(preset, actor);
        return database.query("""
                SELECT pr.id AS project_id, pr.name AS project_name, b.id AS boq_id, b.name AS boq_name,
                    r.id AS revision_id, r.label, r.status, v.number
                FROM boq_revisions r JOIN boqs b ON b.id = r.boq_id JOIN projects pr ON pr.id = b.project_id
                JOIN orgs o ON o.id = pr.org_id AND o.status <> 'deleting'
                JOIN memberships m ON m.org_id = pr.org_id AND m.user_id = ?
                LEFT JOIN project_members pm ON pm.project_id = pr.id AND pm.user_id = m.user_id
                JOIN preset_versions v ON v.preset_id = ? AND v.number IS NOT NULL AND (
                    v.id::text IN (r.inputs->>'ruleSetVersionId', r.inputs->>'federationVersionId', r.inputs->>'resolutionVersionId')
                    OR r.inputs->'classificationVersionIds' @> jsonb_build_array(v.id::text)
                    OR r.inputs->'dictionaryVersionIds' @> jsonb_build_array(v.id::text))
                WHERE m.role IN ('owner','admin') OR pm.role IS NOT NULL
                ORDER BY lower(pr.name), lower(b.name), r.number
                """, (row, index) -> new PresetUsage(row.getObject("project_id", UUID.class), row.getString("project_name"),
                    row.getObject("boq_id", UUID.class), row.getString("boq_name"), row.getObject("revision_id", UUID.class),
                    row.getString("label"), RevisionStatus.fromValue(row.getString("status")), row.getInt("number")), actor, preset);
    }

    PresetCatalog.Head requireEditor(UUID id, UUID actor) {
        var access = access(id, actor);
        if (!access.edit()) throw new ApiException(HttpStatus.FORBIDDEN, "forbidden", "You cannot edit this preset.",
                Map.of("required", access.head().layer() == PresetLayer.PROJECT ? "estimator" : "library_editor"));
        return access.head();
    }

    List<TermInfo> terms(UUID org, UUID actor, UUID project, String query, String category) {
        orgs.require(org, actor);
        if (project != null && !org.equals(projects.require(project, actor).getOrgId())) throw PresetCatalog.missing();
        return termsFor(catalog.visibleHeads(org, project), query, category);
    }

    /** Each visible term's label by id, for text written outside the app (the decisions CSV, review C-18). */
    public Map<String, String> termLabels(UUID org, UUID project) {
        var out = new HashMap<String, String>();
        termsFor(catalog.visibleHeads(org, project), null, null).forEach(term -> out.put(term.getId(), term.getLabel()));
        return out;
    }

    List<TermInfo> termsFor(List<PresetCatalog.Head> heads, String query, String category) {
        var terms = new TreeMap<String, TermInfo>();
        heads.stream().filter(head -> head.kind() == PresetKind.DICTIONARY && !head.archived() && head.published() != null)
                .sorted(Comparator.comparingInt(head -> switch (head.layer()) { case SYSTEM -> 0; case ORG -> 1; case PROJECT -> 2; }))
                .forEach(head -> {
                    for (JsonNode term : catalog.version(head.published()).doc().path("terms")) {
                        String id = term.path("id").asText();
                        var info = new TermInfo(id, term.path("label").asText(), term.path("category").asText())
                                .layer(head.layer()).parent(term.path("broader").asText(null));
                        // translations and aliases for the term search (review C-16)
                        term.path("labels").properties().forEach(label -> {
                            if (label.getValue().isTextual()) info.putLabelsItem(label.getKey(), label.getValue().asText());
                        });
                        for (JsonNode alias : term.path("aliases")) if (alias.isTextual()) info.addAliasesItem(alias.asText());
                        terms.put(id, info);
                    }
                });
        String text = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
        return terms.values().stream().filter(term -> (category == null || category.equals(term.getCategory()))
                && searchText(term).contains(text)).toList();
    }

    /** What `q` matches: the id, the label, its translations and the aliases (review C-16). */
    private static String searchText(TermInfo term) {
        var text = new StringBuilder(term.getId()).append(' ').append(term.getLabel());
        if (term.getLabels() != null) term.getLabels().values().forEach(label -> text.append(' ').append(label));
        if (term.getAliases() != null) term.getAliases().forEach(alias -> text.append(' ').append(alias));
        return text.toString().toLowerCase(Locale.ROOT);
    }

    List<PresetVersionInfo> versions(UUID id, UUID actor) {
        access(id, actor);
        return catalog.versions(id).stream().map(PresetCatalog.Version::info).toList();
    }

    PresetVersion version(UUID id, UUID actor) {
        var version = catalog.version(id);
        var head = access(version.preset(), actor).head();
        Object flattened = head.kind() == PresetKind.RULE_SET
                ? check(head.kind(), version.doc(), version.parent()).getFlattened().orElse(null) : null;
        return version.response(flattened);
    }

    @Transactional
    public Preset create(UUID org, UUID actor, PresetCreate request) {
        UUID project = request.getProjectId();
        if (project != null) {
            if (!org.equals(projects.lock(project, actor, "editPresets").getOrgId())) throw PresetCatalog.missing();
        } else {
            orgs.lock(org, actor, OWNER, ADMIN, LIBRARY_EDITOR);
            long count = database.queryForObject("""
                    SELECT count(*) FROM presets WHERE org_id = ? AND kind = ? AND layer = 'org' AND NOT archived
                    """, Long.class, org, request.getKind().getValue());
            limits.checkCapacity(org, actor, "libraryOrgPresets", count);
        }
        String name = label(request.getName());
        String candidate = request.getSlug() == null || request.getSlug().isBlank() ? name : request.getSlug();
        String slug = uniqueSlug(org, request.getKind(), candidate);
        PresetKind kind = request.getKind();
        var mode = request.getStart().getMode();
        PresetCatalog.Version source = null;
        PresetCatalog.Head sourceHead = null;
        if (mode != PresetCreateStart.ModeEnum.EMPTY) {
            if (request.getStart().getFromVersionId() == null) throw invalid("A source version is required.");
            source = catalog.version(request.getStart().getFromVersionId());
            sourceHead = visible(source.preset(), actor);
            if (sourceHead.kind() != kind || sourceHead.unavailable() != null) throw invalid("Choose a source of the same preset kind.");
        }
        UUID parent = null;
        ObjectNode doc;
        if (mode == PresetCreateStart.ModeEnum.PATCH) {
            if (kind != PresetKind.RULE_SET || source.draft() || !canUseParent(sourceHead, org, project)) {
                throw invalid("Choose a published rule set within reach of the new preset.");
            }
            parent = source.id();
            doc = json.object(Map.of("schemaVersion", "1.0", "id", slug, "name", name, "version", "0.1.0",
                    "extends", source.doc().path("id").asText(), "meta", Map.of(), "params", Map.of()));
        } else if (source != null) {
            doc = source.doc().deepCopy();
            parent = source.parent();
            if (parent != null && !canUseParent(catalog.head(catalog.version(parent).preset()), org, project)) {
                var flat = check(kind, doc, parent).getFlattened().orElse(null);
                if (flat == null) throw invalid("The source rule set must be valid to copy it across scopes.");
                doc = json.object(flat);
                parent = null;
            }
            rename(kind, doc, slug, name);
        } else {
            doc = blank(kind, slug, name, project == null ? "company" : "project");
        }
        UUID id = Ids.newId();
        UUID draft = Ids.newId();
        var checked = check(kind, doc, parent);
        database.update("""
                INSERT INTO presets (id, org_id, project_id, layer, kind, slug, name, description, based_on, draft_version_id, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, org, project, project == null ? "org" : "project", kind.getValue(), slug, name,
                request.getDescription(), request.getBasedOn(), draft, actor);
        insertDraft(draft, id, doc, parent, null, checked.getProblems(), actor);
        event(catalog.head(id), actor, "preset.created");
        return view(catalog.head(id), true, actor);
    }

    CheckResponse check(PresetKind kind, ObjectNode doc, UUID parent) {
        var folder = CHECKS.get(kind);
        if (folder == null) return new CheckResponse(true, List.of());
        var resolved = kind == PresetKind.RULE_SET ? catalog.rules(doc, parent) : new PresetCatalog.Rules(doc, List.of());
        return worker.rpc("check", Map.of("kind", folder, "doc", resolved.doc(), "library", resolved.library()), CheckResponse.class);
    }

    CheckResponse check(CheckPresetRequest request, UUID actor) {
        UUID parent = request.getParentVersionIds() == null || request.getParentVersionIds().isEmpty()
                ? null : request.getParentVersionIds().getFirst();
        if (parent != null) {
            var parentHead = visible(catalog.version(parent).preset(), actor);
            if (parentHead.kind() != PresetKind.RULE_SET || request.getKind() != PresetKind.RULE_SET) {
                throw invalid("Only rule sets have a parent version.");
            }
        }
        return check(request.getKind(), document(request.getDoc().orElse(null)), parent);
    }

    /** "Reads as" and samples for item texts, filled by the engine (review B-13); nothing is read or saved. */
    ItemTextSamples sampleItemTexts(SampleItemTextsRequest request) {
        return worker.rpc("item-text-sample", Map.of("items", request.getItems()), ItemTextSamples.class);
    }

    /** A rule set's slot renamed by the engine, which parses the expressions (review B-13); nothing is saved. */
    ParamRename renameParam(RenamePresetParamRequest request) {
        return worker.rpc("rename-param", Map.of("doc", document(request.getDoc().orElse(null)),
                "from", request.getFrom(), "to", request.getTo()), ParamRename.class);
    }

    @Transactional
    public PresetVersion save(UUID id, UUID actor, SaveDraftRequest request, String ifMatch) {
        var head = editable(id, actor);
        var prior = head.draft() == null ? null : catalog.version(head.draft());
        if (ifMatch != null && (prior == null || !prior.tag().equals(ifMatch))) {
            throw new ApiException(HttpStatus.CONFLICT, "draft_conflict", "The draft changed after it was opened.",
                    prior == null ? Map.of() : Map.of("etag", prior.tag(), "updatedAt", prior.updated()));
        }
        var doc = document(request.getDoc().orElse(null));
        UUID parent = prior == null ? (head.published() == null ? null : catalog.version(head.published()).parent()) : prior.parent();
        if (parent != null) {
            var newest = catalog.head(catalog.version(parent).preset()).published();
            if (newest != null) parent = newest;
        }
        List<String> problems = check(head.kind(), doc, parent).getProblems();
        UUID draft = prior == null ? Ids.newId() : prior.id();
        if (prior == null) {
            insertDraft(draft, head.id(), doc, parent, head.published(), problems, actor);
        } else {
            database.update("""
                    UPDATE preset_versions SET doc = CAST(? AS jsonb), extends_version_id = ?, problems = CAST(? AS jsonb),
                        etag = etag + 1, updated_by = ?, updated_at = now() WHERE id = ?
                    """, doc.toString(), parent, encodeProblems(problems), actor, draft);
        }
        database.update("UPDATE presets SET draft_version_id = ?, updated_by = ?, updated_at = now() WHERE id = ?", draft, actor, id);
        return catalog.version(draft).response(null);
    }

    @Transactional
    public PresetVersion publish(UUID id, UUID actor, String changeNote) {
        var head = editable(id, actor);
        if (changeNote == null || changeNote.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "change_note_required", "Say what changed in this version.", Map.of());
        }
        var draft = draft(head);
        var doc = draft.doc();
        List<String> merged = List.of();
        if (stale(head, draft)) {
            // A-43: a version was published after this draft started (a promoted name answer, a colleague's
            // publish). A dictionary takes that version's changes where the draft left them alone; anything
            // else, or a conflict, is refused until the draft is rebased: never silently overwritten.
            var latest = catalog.version(head.published());
            if (head.kind() != PresetKind.DICTIONARY) throw stale(draft, latest, List.of());
            var result = DraftMerge.merge(catalog.version(draft.base()).doc(), draft.doc(), latest.doc(), Map.of());
            if (!result.conflicts().isEmpty()) throw stale(draft, latest, List.copyOf(result.conflicts()));
            doc = result.doc();
            merged = List.copyOf(result.taken());
            database.update("UPDATE preset_versions SET doc = CAST(? AS jsonb), base_version_id = ? WHERE id = ?",
                    doc.toString(), latest.id(), draft.id());
        }
        var checked = check(head.kind(), doc, draft.parent());
        if (!checked.getOk()) throw new ApiException(HttpStatus.CONFLICT, "draft_has_problems",
                "Fix the draft before publishing.", Map.of("problems", checked.getProblems()));
        int number = database.queryForObject("SELECT coalesce(max(number), 0) + 1 FROM preset_versions WHERE preset_id = ?",
                Integer.class, id);
        database.update("""
                UPDATE preset_versions SET status = 'published', number = ?, change_note = ?, problems = '[]',
                    published_by = ?, published_at = now(), updated_by = ?, updated_at = now() WHERE id = ?
                """, number, changeNote.strip(), actor, actor, draft.id());
        database.update("""
                UPDATE presets SET draft_version_id = NULL, latest_published_version_id = ?, updated_by = ?, updated_at = now()
                WHERE id = ?
                """, draft.id(), actor, id);
        event(head, actor, "preset.published");
        followers(id, draft.id(), actor);
        var published = catalog.version(draft.id()).response(checked.getFlattened().orElse(null));
        if (!merged.isEmpty()) published.setMerged(merged);
        return published;
    }

    /**
     * A-43 "rebase on latest": the draft starts again from the latest version. A dictionary merges it entry by
     * entry, each conflict settled by `choices` (`entries:<id>`, `field:<name>`) or else by `keep`; another kind
     * keeps its document (`mine`) or takes the latest version's (`theirs`).
     */
    @Transactional
    public PresetVersion rebase(UUID id, UUID actor, RebaseDraftRequest request) {
        var head = editable(id, actor);
        var draft = draft(head);
        if (!stale(head, draft)) return draft.response(null);
        var latest = catalog.version(head.published());
        var keep = request.getKeep() == DraftSide.THEIRS ? DraftMerge.Side.THEIRS : DraftMerge.Side.MINE;
        var choices = new HashMap<String, DraftMerge.Side>();
        if (request.getChoices() != null) request.getChoices().forEach((key, side) ->
                choices.put(key, side == DraftSide.THEIRS ? DraftMerge.Side.THEIRS : DraftMerge.Side.MINE));
        ObjectNode doc = draft.doc();
        UUID parent = draft.parent();
        if (head.kind() == PresetKind.DICTIONARY) {
            var base = catalog.version(draft.base()).doc();
            var first = DraftMerge.merge(base, draft.doc(), latest.doc(), choices);
            first.conflicts().forEach(conflict -> choices.put(conflict, keep));
            doc = DraftMerge.merge(base, draft.doc(), latest.doc(), choices).doc();
        } else if (keep == DraftMerge.Side.THEIRS) {
            doc = latest.doc().deepCopy();
            parent = latest.parent();
        }
        database.update("""
                UPDATE preset_versions SET doc = CAST(? AS jsonb), extends_version_id = ?, base_version_id = ?,
                    problems = CAST(? AS jsonb), etag = etag + 1, updated_by = ?, updated_at = now() WHERE id = ?
                """, doc.toString(), parent, latest.id(), encodeProblems(check(head.kind(), doc, parent).getProblems()),
                actor, draft.id());
        database.update("UPDATE presets SET updated_by = ?, updated_at = now() WHERE id = ?", actor, id);
        event(head, actor, "preset.draft_rebased");
        return catalog.version(draft.id()).response(null);
    }

    /** The draft started from a version older than the latest one (A-43). */
    private static boolean stale(PresetCatalog.Head head, PresetCatalog.Version draft) {
        return head.published() != null && draft.base() != null && !draft.base().equals(head.published());
    }

    private static ApiException stale(PresetCatalog.Version draft, PresetCatalog.Version latest, List<String> conflicts) {
        return new ApiException(HttpStatus.CONFLICT, "draft_stale",
                "Version " + latest.number() + " was published after this draft started from version " + draft.baseNumber() + ".",
                Map.of("baseNumber", draft.baseNumber(), "latestNumber", latest.number(), "latestVersionId", latest.id(),
                        "conflicts", conflicts));
    }

    /**
     * P54 Q58 (TF-140): the "Based on it" clones of a preset follow it at once. Each clone whose draft or latest
     * version extends an earlier version of it gets a draft that extends the version just published (its own
     * draft rebased, or a new one from its latest version), checked again, for its editors to publish.
     */
    private void followers(UUID preset, UUID published, UUID actor) {
        var clones = database.queryForList("""
                SELECT DISTINCT p.id FROM presets p
                JOIN preset_versions v ON v.id = coalesce(p.draft_version_id, p.latest_published_version_id)
                JOIN preset_versions parent ON parent.id = v.extends_version_id
                WHERE parent.preset_id = ? AND p.id <> ? AND NOT p.archived AND v.extends_version_id <> ?
                """, UUID.class, preset, preset, published);
        for (UUID clone : clones) {
            var head = catalog.head(clone);
            if (head.draft() != null) {
                var prior = catalog.version(head.draft());
                database.update("""
                        UPDATE preset_versions SET extends_version_id = ?, problems = CAST(? AS jsonb), etag = etag + 1,
                            updated_at = now() WHERE id = ?
                        """, published, encodeProblems(check(head.kind(), prior.doc(), published).getProblems()), prior.id());
            } else {
                var latest = catalog.version(head.published());
                UUID draft = Ids.newId();
                insertDraft(draft, clone, latest.doc().deepCopy(), published, latest.id(),
                        check(head.kind(), latest.doc(), published).getProblems(), actor);
                database.update("UPDATE presets SET draft_version_id = ?, updated_at = now() WHERE id = ?", draft, clone);
            }
            event(head, actor, "preset.rebased");
        }
    }

    @Transactional
    public PresetVersion publishDictionaryEntries(UUID preset, UUID actor, List<ObjectNode> entries, String note) {
        var head = editable(preset, actor);
        if (head.kind() != PresetKind.DICTIONARY || head.published() == null) {
            throw invalid("Choose a published dictionary.");
        }
        var current = catalog.version(head.published());
        var doc = current.doc().deepCopy();
        var replacement = new LinkedHashMap<String, JsonNode>();
        for (JsonNode entry : doc.path("entries")) replacement.put(entry.path("id").asText(), entry);
        entries.forEach(entry -> replacement.put(entry.path("id").asText(), entry));
        var values = doc.putArray("entries");
        replacement.values().forEach(values::add);
        int number = current.number() + 1;
        doc.put("version", Integer.toString(number));
        var checked = check(head.kind(), doc, null);
        if (!checked.getOk()) throw new ApiException(HttpStatus.CONFLICT, "draft_has_problems",
                "The decision would make the dictionary invalid.", Map.of("problems", checked.getProblems()));
        UUID version = Ids.newId();
        database.update("""
                INSERT INTO preset_versions (id, preset_id, number, status, doc, change_note, published_by, published_at, updated_by)
                VALUES (?, ?, ?, 'published', CAST(? AS jsonb), ?, ?, now(), ?)
                """, version, preset, number, doc.toString(), note, actor, actor);
        database.update("UPDATE presets SET latest_published_version_id = ?, updated_at = now(), updated_by = ? WHERE id = ?",
                version, actor, preset);
        if (head.draft() != null) {
            // A-43: an open draft gets the entries too, so its editor sees them (a save with the old ETag answers
            // draft_conflict); publishing it would merge them in any case.
            var open = catalog.version(head.draft());
            var draftDoc = open.doc().deepCopy();
            var draftEntries = new LinkedHashMap<String, JsonNode>();
            for (JsonNode entry : draftDoc.path("entries")) draftEntries.put(entry.path("id").asText(), entry);
            entries.forEach(entry -> draftEntries.put(entry.path("id").asText(), entry));
            var list = draftDoc.putArray("entries");
            draftEntries.values().forEach(list::add);
            database.update("""
                    UPDATE preset_versions SET doc = CAST(? AS jsonb), problems = CAST(? AS jsonb), etag = etag + 1,
                        updated_at = now() WHERE id = ?
                    """, draftDoc.toString(), encodeProblems(check(head.kind(), draftDoc, null).getProblems()), open.id());
        }
        event(head, actor, "preset.published");
        return catalog.version(version).response(null);
    }

    @Transactional
    public void discard(UUID id, UUID actor) {
        var head = editable(id, actor);
        if (head.draft() == null) return;
        database.update("UPDATE presets SET draft_version_id = NULL, updated_by = ?, updated_at = now() WHERE id = ?", actor, id);
        database.update("DELETE FROM preset_versions WHERE id = ?", head.draft());
        event(head, actor, "preset.draft_discarded");
    }

    @Transactional
    public Preset update(UUID id, UUID actor, UpdatePresetRequest request) {
        var head = editable(id, actor);
        if (request.getDefaultForNewProjects() != null && request.getDefaultForNewProjects() != head.orgDefault()) {
            defaultFor(head, actor, request.getDefaultForNewProjects());
        }
        database.update("""
                UPDATE presets SET name = coalesce(?, name), description = coalesce(?, description),
                    starred = coalesce(?, starred), updated_by = ?, updated_at = now() WHERE id = ?
                """, request.getName() == null ? null : label(request.getName()), request.getDescription(),
                request.getStarred(), actor, id);
        event(head, actor, "preset.updated");
        return view(catalog.head(id), true, actor);
    }

    @Transactional
    public Preset archive(UUID id, UUID actor) {
        var head = lock(id, actor);
        if (!head.archived()) {
            database.update("""
                    UPDATE presets SET archived = true, starred = false, org_default = false, updated_by = ?, updated_at = now()
                    WHERE id = ?
                    """, actor, id);
            event(head, actor, "preset.archived");
        }
        return view(catalog.head(id), false, actor);
    }

    /**
     * Review A-45 (DEC-45): "Default for new projects" is set deliberately by a library editor and audited
     * (`preset.default_set` / `preset.default_cleared`); one rule set per org (choosing one clears the other),
     * classifications and dictionaries may be several. Only published org presets of those kinds.
     */
    private void defaultFor(PresetCatalog.Head head, UUID actor, boolean on) {
        if (on) {
            if (head.layer() != PresetLayer.ORG
                    || !Set.of(PresetKind.RULE_SET, PresetKind.CLASSIFICATION, PresetKind.DICTIONARY).contains(head.kind())) {
                throw invalid("Only company rule sets, classifications and dictionaries can be defaults for new projects.");
            }
            if (head.published() == null) throw invalid("Publish the preset before making it a default for new projects.");
            if (head.kind() == PresetKind.RULE_SET) {
                for (UUID other : database.queryForList("""
                        SELECT id FROM presets WHERE org_id = ? AND layer = 'org' AND kind = 'rule_set' AND org_default AND id <> ?
                        FOR UPDATE
                        """, UUID.class, head.org(), head.id())) {
                    database.update("UPDATE presets SET org_default = false WHERE id = ?", other);
                    event(catalog.head(other), actor, "preset.default_cleared");
                }
            }
        }
        database.update("UPDATE presets SET org_default = ? WHERE id = ?", on, head.id());
        event(head, actor, on ? "preset.default_set" : "preset.default_cleared");
    }

    private PresetCatalog.Head editable(UUID id, UUID actor) {
        var head = lock(id, actor);
        if (head.archived()) throw new ApiException(HttpStatus.CONFLICT, "preset_archived", "The preset is archived.", Map.of());
        return head;
    }

    private PresetCatalog.Head lock(UUID id, UUID actor) {
        var head = visible(id, actor);
        switch (head.layer()) {
            case SYSTEM -> throw new ApiException(HttpStatus.FORBIDDEN, "forbidden", "System presets are read-only.", Map.of());
            case ORG -> orgs.lock(head.org(), actor, OWNER, ADMIN, LIBRARY_EDITOR);
            case PROJECT -> projects.lock(head.project(), actor, "editPresets");
        }
        database.queryForObject("SELECT id FROM presets WHERE id = ? FOR UPDATE", UUID.class, id);
        return catalog.head(id);
    }

    /**
     * The version is the current draft of a preset of this kind that the actor may edit, in the org
     * (or project) being previewed: a preview may use it as another input (the setup wizard previews
     * its step's draft with the rule-set draft of step 1, TF-133).
     */
    public boolean ownDraft(PresetCatalog.Version version, PresetKind kind, UUID org, UUID project, UUID actor) {
        if (!version.draft()) return false;
        var head = catalog.head(version.preset());
        if (head.kind() != kind || !version.id().equals(head.draft()) || head.unavailable() != null
                || head.layer() == PresetLayer.SYSTEM || !org.equals(head.org())
                || (head.project() != null && !head.project().equals(project))) {
            return false;
        }
        try {
            return access(head.id(), actor).edit();
        } catch (ApiException notVisible) {
            return false;
        }
    }

    private Access access(UUID id, UUID actor) {
        var head = catalog.head(id);
        boolean edit = switch (head.layer()) {
            case SYSTEM -> false;
            case ORG -> canEdit(orgs.require(head.org(), actor).role());
            case PROJECT -> Boolean.TRUE.equals(projects.require(head.project(), actor).getPermissions().get("editPresets"));
        };
        return new Access(head, edit && !head.archived());
    }

    private Preset view(PresetCatalog.Head head, boolean edit, UUID actor) {
        var view = new Preset(head.id(), head.kind(), head.layer(), head.slug(), head.name(), head.archived())
                .orgId(head.org()).projectId(head.project()).description(head.description()).basedOn(head.basedOn())
                .starred(Boolean.TRUE.equals(head.starred()) ? Boolean.TRUE : null)
                .defaultForNewProjects(head.layer() == PresetLayer.ORG ? head.orgDefault() : null).updatedBy(head.editor()).updatedAt(head.updated()).usedByCount(usage(head.id(), actor).size())
                .permissions(Map.of("edit", edit, "archive", edit, "publish", edit, "preview", head.unavailable() == null));
        if (head.published() != null) view.setLatestPublishedVersion(catalog.version(head.published()).info());
        if (head.draft() != null) view.setDraft(catalog.version(head.draft()).info());
        if (head.unavailable() != null) view.available(false).unavailableReason(head.unavailable());
        else if (head.kind() == PresetKind.CLASSIFICATION) view.setAvailable(true);
        return view;
    }

    PresetCatalog.Version draft(PresetCatalog.Head head) {
        if (head.draft() == null) throw new ApiException(HttpStatus.CONFLICT, "no_draft", "The preset has no draft.", Map.of());
        return catalog.version(head.draft());
    }

    /** A new draft; `base` is the published version it starts from (A-43), null for a preset never published. */
    private void insertDraft(UUID version, UUID preset, ObjectNode doc, UUID parent, UUID base, List<String> problems, UUID actor) {
        database.update("""
                INSERT INTO preset_versions (id, preset_id, status, doc, extends_version_id, base_version_id, problems, etag, updated_by)
                VALUES (?, ?, 'draft', CAST(? AS jsonb), ?, ?, CAST(? AS jsonb), 0, ?)
                """, version, preset, doc.toString(), parent, base, encodeProblems(problems), actor);
    }

    private void event(PresetCatalog.Head head, UUID actor, String action) {
        audit.record(new RequestContext(actor, null, head.org(), null), AuditWriter.ActorKind.USER, head.project(),
                action, "preset", head.id(), json.object(Map.of("kind", head.kind().getValue())));
    }

    private ObjectNode document(Object raw) {
        if (!(raw instanceof Map<?, ?> || raw instanceof ObjectNode)) throw invalid("The preset document must be an object.");
        return json.object(raw);
    }

    private String encodeProblems(List<String> values) {
        var problems = json.object(Map.of("problems", values));
        return problems.get("problems").toString();
    }

    private String uniqueSlug(UUID org, PresetKind kind, String candidate) {
        String base = Normalizer.normalize(candidate, Normalizer.Form.NFD).replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        if (base.isEmpty()) base = "preset";
        if (base.length() > 65) base = base.substring(0, 65).replaceFirst("-$", "");
        var existing = new HashSet<>(database.queryForList("""
                SELECT slug FROM presets WHERE kind = ? AND (org_id = ? OR layer = 'system')
                """, String.class, kind.getValue(), org));
        String slug = base;
        for (int suffix = 2; existing.contains(slug); suffix++) slug = base + "-" + suffix;
        return slug;
    }

    private ObjectNode blank(PresetKind kind, String slug, String name, String layer) {
        ObjectNode doc = switch (kind) {
            case RULE_SET -> json.object(Map.of("schemaVersion", "1.0", "version", "0.1.0",
                    "meta", Map.of("unitSystem", "metric", "locale", "en"), "params", Map.of(),
                    "defaults", Map.of("rounding", Map.of("step", 0.01, "mode", "nearest", "at", "line"),
                            "onMissing", "flag", "breakdown", "element"), "items", List.of(), "derived", List.of(), "manual", List.of()));
            case DICTIONARY -> json.object(Map.of("schemaVersion", "1.0", "version", "0.1.0", "layer", layer,
                    "terms", List.of(), "entries", List.of(), "extractors", List.of()));
            case CLASSIFICATION -> json.object(Map.of(
                    "codeList", Map.of("schemaVersion", "1.0", "version", "0.1.0", "kind", "company",
                            "separator", ".", "levels", List.of("Section", "Item"), "codes", List.of()),
                    "map", Map.of("schemaVersion", "1.0", "version", "0.1.0", "sources", List.of("decision", "map"),
                            "rules", List.of(), "onUnmapped", "flag", "onConflict", "first")));
            case FEDERATION -> catalog.system(kind, "federation-default").doc().deepCopy();
            case RESOLUTION -> catalog.system(kind, "resolution-default").doc().deepCopy();
        };
        rename(kind, doc, slug, name);
        return doc;
    }

    private static void rename(PresetKind kind, ObjectNode doc, String slug, String name) {
        if (kind == PresetKind.CLASSIFICATION) {
            ((ObjectNode) doc.get("codeList")).put("id", slug).put("name", name);
            ((ObjectNode) doc.get("map")).put("id", slug + "-map").put("name", name + ": map").put("codeList", slug);
        } else {
            doc.put("id", slug).put("name", name);
        }
    }

    private static boolean canEdit(OrgRole role) {
        return role == OWNER || role == ADMIN || role == LIBRARY_EDITOR;
    }

    private static boolean canUseParent(PresetCatalog.Head head, UUID org, UUID project) {
        return head.layer() == PresetLayer.SYSTEM
                || (org.equals(head.org()) && (head.project() == null || head.project().equals(project)));
    }

    private static String label(String input) {
        if (input.isBlank()) throw invalid("A preset name is required.");
        return input.strip();
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "invalid_body", message, Map.of());
    }

    private record Access(PresetCatalog.Head head, boolean edit) {}
}
