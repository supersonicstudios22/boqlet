package com.boqlet.api.library;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Review A-43: a dictionary draft opened before a newer version merges that version's changes, entry by entry. */
class DraftMergeTest {
    private final ObjectMapper json = new ObjectMapper();

    private ObjectNode doc(String text) throws Exception {
        return (ObjectNode) json.readTree(text.replace('\'', '"'));
    }

    private static String ids(ObjectNode doc, String field) {
        var out = new StringBuilder();
        doc.path(field).forEach(entry -> out.append(out.isEmpty() ? "" : ",").append(entry.path("id").asText()));
        return out.toString();
    }

    @Test
    void aPromotedEntryIsKeptNextToTheDraftsOwn() throws Exception {
        var base = doc("{'id':'d','version':'1','entries':[]}");
        var mine = doc("{'id':'d','version':'1','entries':[{'id':'lib-entry-1','term':'space.kitchen'}]}");
        var theirs = doc("{'id':'d','version':'2','entries':[{'id':'promoted','term':'space.bedroom'}]}");
        var merge = DraftMerge.merge(base, mine, theirs, Map.of());
        assertThat(merge.conflicts()).isEmpty();
        assertThat(ids(merge.doc(), "entries")).isEqualTo("promoted,lib-entry-1");
        assertThat(merge.taken()).containsExactly("entries:promoted", "field:version");
        assertThat(merge.doc().path("version").asText()).isEqualTo("2");
    }

    @Test
    void anEntryBothChangedDifferentlyIsAConflictUntilAChoiceIsMade() throws Exception {
        var base = doc("{'entries':[{'id':'a','term':'x'},{'id':'b','term':'y'}]}");
        var mine = doc("{'entries':[{'id':'a','term':'mine'},{'id':'b','term':'y'}]}");
        var theirs = doc("{'entries':[{'id':'a','term':'theirs'}]}");
        var merge = DraftMerge.merge(base, mine, theirs, Map.of());
        assertThat(merge.conflicts()).containsExactly("entries:a");
        assertThat(ids(merge.doc(), "entries")).isEqualTo("a");
        var keep = DraftMerge.merge(base, mine, theirs, Map.of("entries:a", DraftMerge.Side.MINE));
        assertThat(keep.conflicts()).isEmpty();
        assertThat(keep.doc().path("entries").get(0).path("term").asText()).isEqualTo("mine");
        var take = DraftMerge.merge(base, mine, theirs, Map.of("entries:a", DraftMerge.Side.THEIRS));
        assertThat(take.doc().path("entries").get(0).path("term").asText()).isEqualTo("theirs");
    }

    @Test
    void removalsFollowTheSideThatMadeThem() throws Exception {
        var base = doc("{'entries':[{'id':'a'},{'id':'b'},{'id':'c'}]}");
        var mine = doc("{'entries':[{'id':'a'},{'id':'c','x':1}]}");
        var theirs = doc("{'entries':[{'id':'b'},{'id':'c'}]}");
        var merge = DraftMerge.merge(base, mine, theirs, Map.of());
        // a: theirs removed it, mine kept it unchanged -> removed; b: mine removed it -> removed; c: only mine changed.
        assertThat(merge.conflicts()).isEmpty();
        assertThat(ids(merge.doc(), "entries")).isEqualTo("c");
        assertThat(merge.doc().path("entries").get(0).path("x").asInt()).isEqualTo(1);
        // A removal against an edit is a conflict.
        var edited = doc("{'entries':[{'id':'a','x':2},{'id':'b'},{'id':'c'}]}");
        assertThat(DraftMerge.merge(base, edited, theirs, Map.of()).conflicts()).containsExactly("entries:a");
    }

    @Test
    void scalarFieldsAndTheSameChangeOnBothSides() throws Exception {
        var base = doc("{'name':'A','terms':[{'id':'t','label':'L'}]}");
        var mine = doc("{'name':'B','terms':[{'id':'t','label':'M'}]}");
        var theirs = doc("{'name':'C','terms':[{'id':'t','label':'M'}]}");
        var merge = DraftMerge.merge(base, mine, theirs, Map.of());
        assertThat(merge.conflicts()).containsExactly("field:name");
        assertThat(DraftMerge.merge(base, mine, theirs, Map.of("field:name", DraftMerge.Side.MINE)).doc().path("name").asText()).isEqualTo("B");
        assertThat(merge.doc().path("terms").get(0).path("label").asText()).isEqualTo("M");
    }

    @Test
    void nothingChangedOnTheirSideKeepsTheDraftAsItIs() throws Exception {
        var base = doc("{'entries':[{'id':'a'}],'extractors':[]}");
        var mine = doc("{'entries':[{'id':'b'},{'id':'a','k':1}],'extractors':[{'id':'e'}]}");
        var merge = DraftMerge.merge(base, mine, base.deepCopy(), Map.of());
        assertThat(merge.conflicts()).isEmpty();
        assertThat(merge.taken()).isEmpty();
        assertThat(merge.doc()).isEqualTo(mine);
    }
}
