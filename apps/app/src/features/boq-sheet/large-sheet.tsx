"use client";

/**
 * The sheet of a BoQ with more than `SERVER_GROUPED_ABOVE` lines (F06 edge cases, review B-19): the server groups
 * it, so it opens with the groups of the "Group by" system collapsed, each with its line count and subtotal (BR-63);
 * opening a group loads its lines a page at a time. Without a code system the lines are listed page by page. A
 * line opens its detail as in the sheet. Lines are read-only here (known limitations: edits on a server-grouped
 * sheet are a later item).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLineGroups, useLinePages, type LineGroup, type RunLine } from "@/api/hooks/sheet";
import type { Run } from "@/api/hooks/boqs";
import { InlineError } from "@/components/errors/inline-error";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBoqFormat } from "@/i18n/boq-format";
import { useUnit } from "@/i18n/units";
import { cn } from "@/lib/utils";
import { LineDetailPanel } from "./line-detail";
import { shownDescription } from "./model";
import { SourceTag } from "./source-tag";

export function LargeSheet({ run, total, showIn3d }: { run: Run; total: number; showIn3d?: (key: string) => string | undefined }) {
  const t = useTranslations("boqs.sheet");
  const systems = useMemo(() => run.classifications ?? [], [run.classifications]);
  const systemNames = useMemo(() => new Map(systems.map((s) => [s.id, s.name])), [systems]);
  const modelNames = useMemo(() => new Map((run.models ?? []).map((m) => [m.id, m.fileName])), [run.models]);
  const [system, setSystem] = useState<string | null>(systems[0]?.id ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  // Lines seen so far, for the detail's links to other lines (it never loads every line here).
  const [seen] = useState(() => new Map<string, string>());
  const remember = useCallback((lines: RunLine[]) => lines.forEach((l) => seen.set(l.key, l.description)), [seen]);

  return (
    <div className="flex min-w-0 gap-5" data-testid="large-sheet" data-total={total}>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="max-w-[72ch] text-muted-foreground" role="note" data-testid="large-sheet-note">
          {t("large.note", { count: total })}
        </p>
        <label className="flex items-center gap-2">
          <span className="label-caps text-muted-foreground">{t("groupBy")}</span>
          <NativeSelect value={system ?? ""} onChange={(e) => setSystem(e.target.value || null)} data-testid="group-by">
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="">{t("noGrouping")}</option>
          </NativeSelect>
        </label>
        {system ? (
          <Groups run={run} system={system} onSelect={setSelected} selected={selected} remember={remember} />
        ) : (
          <Lines run={run} system={null} path={null} onSelect={setSelected} selected={selected} remember={remember} />
        )}
      </div>
      {selected && (
        <LineDetailPanel
          run={run}
          lineKey={selected}
          groupBy={system}
          showIn3dHref={showIn3d?.(selected)}
          modelNames={modelNames}
          systemNames={systemNames}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
          describe={(key) => seen.get(key)}
        />
      )}
    </div>
  );
}

type RowProps = { run: Run; onSelect: (key: string) => void; selected: string | null; remember: (lines: RunLine[]) => void };

function Groups({ run, system, ...rest }: RowProps & { system: string }) {
  const t = useTranslations("boqs.sheet");
  const groups = useLineGroups(run.id, system);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  if (groups.isError) return <InlineError error={groups.error} onRetry={() => groups.refetch()} />;
  if (!groups.data) return <p className="text-muted-foreground" aria-busy="true">{t("loading")}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border border-y border-border" aria-label={t("tableLabel")}>
      {groups.data.map((g) => {
        const isOpen = open.has(g.path);
        return (
          <li key={g.path} className="flex flex-col" data-testid="sheet-group" data-path={g.path} data-open={isOpen ? "true" : "false"}>
            <button
              type="button"
              className="flex items-center gap-2 py-2 text-left hover:bg-muted"
              aria-expanded={isOpen}
              onClick={() => setOpen((o) => (o.has(g.path) ? new Set([...o].filter((p) => p !== g.path)) : new Set([...o, g.path])))}
              data-testid="sheet-group-toggle"
            >
              {isOpen ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
              <GroupHeading group={g} />
            </button>
            {isOpen && <Lines run={run} system={system} path={g.path} {...rest} />}
          </li>
        );
      })}
    </ul>
  );
}

function GroupHeading({ group }: { group: LineGroup }) {
  const t = useTranslations("boqs.sheet");
  const unitLabel = useUnit();
  const boqFormat = useBoqFormat();
  const quantity = group.quantity ?? null;
  return (
    <span className="flex flex-1 flex-wrap items-baseline gap-x-3 font-medium">
      <span className="font-mono">{group.path ? group.code : ""}</span>
      <span className="flex-1">{group.path ? group.title : t("unclassified")}</span>
      <span className="font-normal text-muted-foreground">{t("groupLines", { count: group.lineCount })}</span>
      {group.unit && quantity !== null && (
        <span className="tabular-nums" data-testid="sheet-group-subtotal">
          {boqFormat.quantity(quantity)} {unitLabel(group.unit)}
        </span>
      )}
    </span>
  );
}

function Lines({ run, system, path, onSelect, selected, remember }: RowProps & { system: string | null; path: string | null }) {
  const t = useTranslations("boqs.sheet");
  const unitLabel = useUnit();
  const boqFormat = useBoqFormat();
  const pages = useLinePages(run.id, system, path);
  const lines = useMemo(() => (pages.data?.pages ?? []).flatMap((p) => p.items), [pages.data]);
  useEffect(() => remember(lines), [lines, remember]);
  if (pages.isError && !pages.data) return <InlineError error={pages.error} onRetry={() => pages.refetch()} />;
  if (!pages.data) return <p className="py-2 text-muted-foreground" aria-busy="true">{t("loading")}</p>;
  return (
    <div className="flex flex-col gap-2 pb-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("col.item")}</TableHead>
            <TableHead>{t("col.description")}</TableHead>
            <TableHead>{t("col.unit")}</TableHead>
            <TableHead className="text-right">{t("col.quantity")}</TableHead>
            <TableHead>{t("col.source")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow
              key={l.key}
              className={cn("cursor-pointer", selected === l.key && "bg-muted")}
              onClick={() => onSelect(l.key)}
              data-testid="sheet-line"
              data-key={l.key}
            >
              <TableCell className="font-mono">{system ? (l.codes[system]?.code ?? "") : ""}</TableCell>
              <TableCell>
                <button type="button" className="text-left hover:underline" onClick={() => onSelect(l.key)}>
                  {shownDescription(l, system)}
                </button>
              </TableCell>
              <TableCell>{unitLabel(l.unit)}</TableCell>
              <TableCell className="text-right tabular-nums">{l.quantity === null ? "—" : boqFormat.quantity(l.quantity)}</TableCell>
              <TableCell>
                <SourceTag source={l.source} toConfirm={l.toConfirm} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pages.hasNextPage && (
        <Button variant="outline" className="self-start" disabled={pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()} data-testid="sheet-more-lines">
          {t("large.more")}
        </Button>
      )}
    </div>
  );
}
