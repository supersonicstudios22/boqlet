package com.boqlet.api.project;

import com.boqlet.api.http.ApiException;
import com.boqlet.api.library.PresetCatalog;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.contract.model.SearchHit;
import com.boqlet.contract.model.SearchResults;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * The command palette's search (review C-09, DEC-75): names in one org that the caller can open. Projects, BoQs and
 * models come only from {@link ProjectAccess#VISIBLE_IN_ORG}, the condition every project read uses; presets from the
 * Library's own list ({@link PresetCatalog#visibleHeads}). An org the caller isn't in answers 404 (A-37).
 */
@Service
public class OrgSearch {
    private final JdbcTemplate database;
    private final OrgAccess orgs;
    private final PresetCatalog presets;

    OrgSearch(JdbcTemplate database, OrgAccess orgs, PresetCatalog presets) {
        this.database = database;
        this.orgs = orgs;
        this.presets = presets;
    }

    public SearchResults search(UUID org, UUID actor, String query, Integer requestedLimit) {
        orgs.require(org, actor);
        String text = query == null ? "" : query.strip();
        if (text.isEmpty() || text.length() > 200) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_parameter", "Search for 1 to 200 characters.", Map.of("field", "q"));
        }
        int limit = Math.clamp(requestedLimit == null ? 8 : requestedLimit, 1, 50);
        String needle = text.toLowerCase(Locale.ROOT);
        // Names that start with the text first, then by name; strpos, so % and _ in the text are plain characters.
        String rank = " ORDER BY strpos(lower(x.name), ?) = 1 DESC, lower(x.name), x.id LIMIT ?";
        var items = new ArrayList<SearchHit>();
        database.query("SELECT x.id, x.name, x.status FROM (" + ProjectAccess.VISIBLE_IN_ORG + ") x WHERE strpos(lower(x.name), ?) > 0" + rank,
                (row, index) -> items.add(new SearchHit(SearchHit.KindEnum.PROJECT, row.getObject("id", UUID.class), row.getString("name"))
                        .archived("archived".equals(row.getString("status")))),
                actor, org, needle, needle, limit);
        database.query("SELECT x.id, x.name, v.id AS project_id, v.name AS project_name FROM boqs x JOIN (" + ProjectAccess.VISIBLE_IN_ORG
                        + ") v ON v.id = x.project_id WHERE NOT x.archived AND strpos(lower(x.name), ?) > 0" + rank,
                (row, index) -> items.add(inProject(SearchHit.KindEnum.BOQ, row)), actor, org, needle, needle, limit);
        database.query("SELECT x.id, x.name, v.id AS project_id, v.name AS project_name FROM models x JOIN (" + ProjectAccess.VISIBLE_IN_ORG
                        + ") v ON v.id = x.project_id WHERE NOT x.archived AND strpos(lower(x.name), ?) > 0" + rank,
                (row, index) -> items.add(inProject(SearchHit.KindEnum.MODEL, row)), actor, org, needle, needle, limit);
        presets.visibleHeads(org, null).stream()
                .filter(head -> !head.archived() && head.name().toLowerCase(Locale.ROOT).contains(needle))
                .sorted(Comparator.comparing((PresetCatalog.Head head) -> !head.name().toLowerCase(Locale.ROOT).startsWith(needle))
                        .thenComparing(head -> head.name().toLowerCase(Locale.ROOT)).thenComparing(PresetCatalog.Head::id))
                .limit(limit)
                .forEach(head -> items.add(new SearchHit(SearchHit.KindEnum.PRESET, head.id(), head.name()).presetKind(head.kind())));
        return new SearchResults(items);
    }

    private static SearchHit inProject(SearchHit.KindEnum kind, java.sql.ResultSet row) throws java.sql.SQLException {
        return new SearchHit(kind, row.getObject("id", UUID.class), row.getString("name"))
                .projectId(row.getObject("project_id", UUID.class)).projectName(row.getString("project_name"));
    }
}
