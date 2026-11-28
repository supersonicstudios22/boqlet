"use client";

import { useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import type { RunLine } from "@/api/hooks/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusMark } from "@/features/boq-sheet/status-mark";
import { useUnit } from "@/i18n/units";
import { useBoqFormat } from "@/i18n/boq-format";
import { cn } from "@/lib/utils";

/** Above this many rows the share's sheet draws only the rows near the window (review C-26). */
export const SHARE_VIRTUAL_ABOVE = 500;
const ROW = 41;
const COLUMNS = 5;

export type ShareGroup = { code: string; title: string; lines: RunLine[] };
type Row = { kind: "group"; group: ShareGroup } | { kind: "line"; line: RunLine };

/**
 * The share page's sheet (F18 §2, review C-26): No. (the line's position number, as the app and the share's Excel
 * number it), the status gutter of the app's sheet (C-02) with a one-line legend, Description, Unit and Quantity.
 * The quantity cell wraps, so an edited line's note never pushes the quantity off a phone screen; above
 * {@link SHARE_VIRTUAL_ABOVE} rows only those near the window are drawn.
 */
export function ShareTable({
  groups,
  grouped,
  textOf,
  lineDetail,
  selected,
  onOpen,
  lineButtons,
}: {
  groups: readonly ShareGroup[];
  /** Group rows are shown (the share has a classification to group by). */
  grouped: boolean;
  textOf: (line: RunLine) => string;
  lineDetail: boolean;
  selected: string | null;
  onOpen: (key: string, fromKeyboard: boolean) => void;
  lineButtons: MutableRefObject<Map<string, HTMLButtonElement>>;
}) {
  const t = useTranslations("shares.public");
  const unitLabel = useUnit();
  const format = useBoqFormat();
  const rows = useMemo<Row[]>(
    () => groups.flatMap((g) => [...(grouped ? [{ kind: "group" as const, group: g }] : []), ...g.lines.map((line) => ({ kind: "line" as const, line }))]),
    [groups, grouped],
  );
  const virtual = rows.length > SHARE_VIRTUAL_ABOVE;
  const body = useRef<HTMLTableSectionElement>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    if (virtual && body.current) setMargin(body.current.getBoundingClientRect().top + window.scrollY);
  }, [virtual]);
  const virtualizer = useWindowVirtualizer({ count: virtual ? rows.length : 0, estimateSize: () => ROW, overscan: 20, scrollMargin: margin });
  const items = virtual ? virtualizer.getVirtualItems() : null;
  const shown = items ? items.map((item) => ({ row: rows[item.index]!, index: item.index })) : rows.map((row, index) => ({ row, index }));
  const before = items?.length ? items[0]!.start - margin : 0;
  const after = items?.length ? virtualizer.getTotalSize() - (items[items.length - 1]!.end - margin) : 0;
  const hasMarks = useMemo(() => rows.some((r) => r.kind === "line" && (r.line.source !== "measured" || r.line.toConfirm)), [rows]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {hasMarks && <Legend />}
      <Table data-testid="share-sheet" data-virtual={virtual ? "true" : "false"} aria-rowcount={virtual ? rows.length + 1 : undefined}>
        <TableHeader>
          <TableRow>
            <TableHead className="label-caps w-px">{t("no")}</TableHead>
            <TableHead className="w-px px-0">
              <span className="sr-only">{t("mark")}</span>
            </TableHead>
            <TableHead className="label-caps">{t("description")}</TableHead>
            <TableHead className="label-caps">{t("unit")}</TableHead>
            <TableHead className="label-caps text-right">{t("quantity")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody ref={body}>
          {before > 0 && <tr aria-hidden style={{ height: before }} />}
          {shown.map(({ row, index }) =>
            row.kind === "group" ? (
              <TableRow key={`g:${row.group.code}`} data-index={index} ref={virtual ? virtualizer.measureElement : undefined} className="bg-muted/50 hover:bg-muted/50" aria-rowindex={virtual ? index + 2 : undefined}>
                <TableCell colSpan={COLUMNS} className="label-caps whitespace-normal">
                  {row.group.code ? `${row.group.code} ${row.group.title}` : "—"}
                </TableCell>
              </TableRow>
            ) : (
              <LineRow
                key={row.line.key}
                line={row.line}
                index={index}
                measure={virtual ? virtualizer.measureElement : undefined}
                rowIndex={virtual ? index + 2 : undefined}
                text={textOf(row.line)}
                lineDetail={lineDetail}
                selected={selected === row.line.key}
                onOpen={onOpen}
                lineButtons={lineButtons}
                unit={unitLabel(row.line.unit)}
                quantity={(v) => format.quantity(v)}
              />
            ),
          )}
          {after > 0 && <tr aria-hidden style={{ height: after }} />}
        </TableBody>
      </Table>
    </div>
  );
}

function LineRow({
  line: l,
  index,
  measure,
  rowIndex,
  text,
  lineDetail,
  selected,
  onOpen,
  lineButtons,
  unit,
  quantity,
}: {
  line: RunLine;
  index: number;
  measure?: (el: Element | null) => void;
  rowIndex?: number;
  text: string;
  lineDetail: boolean;
  selected: boolean;
  onOpen: (key: string, fromKeyboard: boolean) => void;
  lineButtons: MutableRefObject<Map<string, HTMLButtonElement>>;
  unit: string;
  quantity: (v: number) => string;
}) {
  const t = useTranslations("shares.public");
  const edited = l.overridden?.fields?.includes("quantity");
  const toConfirm = l.source === "flagged" || !!l.toConfirm;
  return (
    <TableRow
      ref={measure}
      data-index={index}
      aria-rowindex={rowIndex}
      className={cn(lineDetail && "cursor-pointer", selected && "bg-selection")}
      onClick={() => lineDetail && onOpen(l.key, false)}
      data-testid="share-line"
      data-key={l.key}
      data-source={l.source}
    >
      <TableCell className="align-top tabular-nums text-muted-foreground" data-testid="share-position">
        {l.positionNo ?? ""}
      </TableCell>
      <TableCell className="w-px px-0 align-top">
        <StatusMark source={l.source} toConfirm={l.toConfirm} className="mt-0.5" />
      </TableCell>
      {/* Wraps, so Unit and Quantity stay on narrow screens (TF-172). */}
      <TableCell className="max-w-[520px] min-w-32 align-top whitespace-normal break-words sm:min-w-40">
        {lineDetail ? (
          <button
            type="button"
            ref={(el) => {
              if (el) lineButtons.current.set(l.key, el);
              else lineButtons.current.delete(l.key);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(l.key, true);
            }}
            aria-expanded={selected}
            aria-controls={selected ? "share-detail" : undefined}
            className="w-full rounded-[var(--radius)] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {text}
          </button>
        ) : (
          text
        )}
      </TableCell>
      <TableCell className="align-top">{unit}</TableCell>
      {/* Review C-26: wraps (the table's cells don't), so an edited line keeps its quantity on a phone. */}
      <TableCell className="align-top text-right whitespace-normal tabular-nums" data-testid="share-quantity">
        <span className="whitespace-nowrap">{l.quantity === null ? "—" : quantity(l.quantity)}</span>
        {l.quantity === null && toConfirm && (
          <span className="block text-xs text-muted-foreground" data-testid="share-to-confirm">
            {t("toConfirm")}
          </span>
        )}
        {/* P54 Q52 (TF-086): an edited quantity says so, with the engine's value. */}
        {edited && (
          <span className="block text-xs text-muted-foreground" data-testid="share-edited">
            {t("edited", { engine: l.overridden!.engineQuantity == null ? "—" : quantity(l.overridden!.engineQuantity) })}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

/** What the gutter's marks mean, in one line (review C-26); measured lines carry none. */
function Legend() {
  const t = useTranslations("shares.public.legend");
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground" data-testid="share-legend">
      {(["derived", "manual", "flagged"] as const).map((source) => (
        <span key={source} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-flex">
            <StatusMark source={source} />
          </span>
          {t(source)}
        </span>
      ))}
      <span>{t("measured")}</span>
    </p>
  );
}
