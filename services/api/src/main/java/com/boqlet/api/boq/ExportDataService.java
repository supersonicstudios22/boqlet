package com.boqlet.api.boq;

import com.boqlet.contract.model.PublicShareSystemsInner;
import com.boqlet.contract.model.RunLine;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class ExportDataService {
    private final BoqReadService read;
    private final Runs runs;
    private final BoqAccess boqs;
    private final BoqExports workbooks;

    ExportDataService(BoqReadService read, Runs runs, BoqAccess boqs, BoqExports workbooks) {
        this.read = read;
        this.runs = runs;
        this.boqs = boqs;
        this.workbooks = workbooks;
    }

    public record Data(String project, String boq, String revision, List<PublicShareSystemsInner> classifications,
                       Map<String, String> positionNumbers, List<RunLine> rows) {}

    public Data forRun(UUID runId, UUID actor, String grouping) {
        var run = runs.visible(runId, actor);
        var scope = boqs.revision(run.run().getRevisionId(), actor);
        var systems = run.run().getClassifications() == null ? List.<PublicShareSystemsInner>of() : run.run().getClassifications();
        String group = grouping == null && !systems.isEmpty() ? systems.getFirst().getId() : grouping;
        var rows = new ArrayList<RunLine>();
        String cursor = null;
        do {
            var page = read.lines(runId, actor, cursor, 5000, group);
            page.getItems().stream().filter(line -> !Boolean.TRUE.equals(line.getExcluded())).forEach(rows::add);
            cursor = page.getNextCursor().orElse(null);
        } while (cursor != null);
        return new Data(scope.project().getName(), scope.bill().name(), scope.revision().label(), systems,
                workbooks.positions(runId, group), List.copyOf(rows));
    }
}
