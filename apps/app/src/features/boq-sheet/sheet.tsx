"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { getCoreRowModel, useReactTable, type ColumnDef, type VisibilityState } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Box, ChevronDown, ChevronRight, Columns3, Download, GripVertical, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import type { Boq, Run } from "@/api/hooks/boqs";
import { useQueryClient } from "@tanstack/react-query";
import { useEditLines, useManualItems, useOverrides, useRemoveManualItem, useSaveManualItem, type EditBatch, type LineOverride, type LineOverrideInput, type ManualItemRecord } from "@/api/hooks/edits";
import { isApiError, isUnavailable } from "@/api/errors";
import { keys as queryKeys } from "@/api/keys";
import { useBoqPresence } from "@/features/boqs/presence";
import { onApiResumed, onLineEdited } from "@/realtime/boq-events";
import { generateAndExport, useExportRun } from "@/api/hooks/exports";
import { useMe, useUpdatePreferences } from "@/api/hooks/me";
import { SERVER_GROUPED_ABOVE, useLines, useLineTotal } from "@/api/hooks/sheet";
import { useErrorMessage } from "@/components/errors/use-error-message";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useOrg } from "@/features/orgs/org-context";
import { SearchPicker } from "@/features/questions/search-picker";
import { ModelViewer } from "@/features/viewer/model-viewer";
import { showIn3dHref, viewerModels } from "@/features/viewer/viewer-tab";
import { cn } from "@/lib/utils";
import { ManualLineDialog, ReasonDialog } from "./edit-dialogs";
import { exportChoice } from "./export-choice";
import { ExportStaleDialog } from "./export-dialog";
import { batchFor, effectiveLines, restoreField, takeLinesFromUndo, withChange, type CodeLists, type EditField, type SheetLine, type UndoBatch } from "./edits";
import { LargeSheet } from "./large-sheet";
import { LineDetailPanel } from "./line-detail";
import { LineEdits, type LineActions } from "./line-edits";
import { SystemRulesHint } from "@/features/setup/system-rules-hint";
import { buildRows, facets, filterLines, linesInGroup, topGroups, UNCLASSIFIED, type GroupRow, type Row, type SheetFilters, type SourceFilter, shownDescription } from "./model";
import { SourceTag } from "./source-tag";
import { useCodeLists, useCodeListSeparators } from "./use-code-lists";
import { positionNumbers } from "./positions";
import { NotInModelsNotice } from "./not-in-models";
import { WarningsBar } from "./warnings-bar";
import { extensions } from "@/extensions";
import { useUnit } from "@/i18n/units";
import { useBoqFormat } from "@/i18n/boq-format";
import { LIMITS } from "@/lib/limits";
import { InlineError } from "@/components/errors/inline-error";
import { keepEdit, takeKeptEdits } from "./kept-edits";
import { useRefocusWhenLost } from "@/lib/focus";

/** Fixed row height (architecture.md performance budget: virtualised rows, fixed height). */
const ROW = 32;
const SOURCES: SourceFilter[] = ["measured", "derived", "manual", "flagged", "edited", "excluded"];
/** F06 §6: the last 20 edits can be undone. */
const UNDO_DEPTH = 20;
const DRAG_TYPE = "application/x-boqlet-line";
/** How long a click on an editable cell of a line not selected yet waits for a second click (TF-104). */
const DOUBLE_CLICK_MS = 250;

type EditableColumn = "item" | "description" | "unit" | "quantity";
const FIELD_OF: Record<EditableColumn, EditField> = { item: "codes", description: "description", unit: "unit", quantity: "quantity" };

interface ColumnMeta {
  id: string;
  width: string;
  align?: "right";
  /** Columns that can be switched off. */
  optional?: boolean;
  /** A cell the sheet edits in place (F06 §6). */
  editable?: EditableColumn;
  cell: (line: SheetLine) => React.ReactNode;
  /** The engine's value, shown on hover over an edited cell. */
  engine?: (line: SheetLine) => string | undefined;
}

interface GroupLabels {
  unclassified: string;
  lines: (count: number) => string;
  addLine: (name: string) => string;
}

/** What a row can ask the sheet to do. One stable object, so memoised rows don't re-render. */
interface RowApi {
  click: (key: string) => void;
  check: (key: string, range: boolean) => void;
  startEdit: (key: string, column: EditableColumn) => void;
  commitEdit: (key: string, column: EditableColumn, value: string) => void;
  cancelEdit: () => void;
  drop: (from: string, target: { line?: string; group?: GroupRow }) => void;
  addToGroup: (group: GroupRow) => void;
  toggleGroup: (id: string) => void;
  /** Selects a group row: the model highlights the elements of its lines (F07 §9). */
  selectGroup: (id: string) => void;
}

type UndoEntry = ({ kind: "batch" } & UndoBatch) | { kind: "manualAdded"; recordId: string };
type Prompt = { title: string; summary: string; initial?: string; apply: (reason: string) => void };

/**
 * The BoQ sheet (F06 §1–4, §6–7, §10, §11): every line of the run, grouped by any attached
 * classification with subtotals, filters that never change the data, toggleable columns, the line
 * detail beside it. On the working version, leads and estimators edit it like a spreadsheet:
 * double-click a description, unit, quantity or Item cell, or by keyboard pick the line (arrows up and
 * down), its cell (arrows left and right) and press F2 or Enter; drag a line onto another to
 * reorder it, or onto a group to move it there; tick lines for bulk moves and exclusions; Ctrl+Z
 * undoes the last 20 edits; "Add line" adds a manual line. Edits show at once (the BoQ's current
 * edits laid over the run's lines, `edits.ts`) and apply on the next run.
 *
 * Performance (F06-AC11, 20,000 lines): rows are virtualised at a fixed height in `SheetGrid`, so a
 * scroll re-renders neither the toolbar nor the rows already on screen (`LineRowView` is memoised
 * and gets only stable props).
 */
type SheetProps = { run: Run; boq: Boq; readOnly?: boolean; frozen?: { overrides?: LineOverride[]; manualItems?: ManualItemRecord[] } };

/**
 * The BoQ sheet: every line in the browser up to `SERVER_GROUPED_ABOVE` lines (F06 §1); above that, grouped on the
 * server and loaded a group at a time (`LargeSheet`, review B-19), so a very large BoQ never downloads at once.
 */
export function Sheet(props: SheetProps) {
  const t = useTranslations("boqs.sheet");
  const { org } = useOrg();
  const total = useLineTotal(props.run.id);
  if (total.data === undefined) return <p className="text-muted-foreground" aria-busy="true">{t("loading")}</p>;
  if (total.data > SERVER_GROUPED_ABOVE) {
    const base = `/${org.slug}/projects/${props.boq.projectId}/boqs/${props.boq.id}`;
    const hasModels = (props.run.snapshotVersions?.models?.length ?? 0) > 0;
    return <LargeSheet run={props.run} total={total.data} showIn3d={hasModels ? (key) => showIn3dHref(base, { line: key }) : undefined} />;
  }
  return <FullSheet {...props} />;
}

function FullSheet({ run, boq, readOnly = false, frozen }: SheetProps) {
  const unitLabel = useUnit();
  const t = useTranslations("boqs.sheet");
  const te = useTranslations("boqs.edits");
  const tn = useTranslations("boqs.notInModels");
  const message = useErrorMessage();
  const lines = useLines(run.id);
  const me = useMe();
  const savePreferences = useUpdatePreferences();
  const searchParams = useSearchParams();
  const exporting = useExportRun(run.id);
  // F12: the run's Excel, grouped as the sheet is; a toast while the job runs, then the download.
  const exportLastRun = () => {
    setStaleExport(null);
    const id = toast.loading(t("exporting"));
    exporting.mutate(
      { groupBy },
      {
        onSuccess: (e) => toast.success(t("exported", { file: e.fileName }), { id }),
        onError: (err) => toast.error(message(err), { id }),
      },
    );
  };
  // A-41 (DEC-38): with edits or answers waiting for the next run, ask first; the default generates, then exports.
  const [staleExport, setStaleExport] = useState<{ pending: string[]; canGenerate: boolean } | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const exportExcel = () => {
    const choice = exportChoice(boq, run, !!frozen || readOnly);
    if (choice.ask) setStaleExport({ pending: choice.pending, canGenerate: choice.canGenerate });
    else exportLastRun();
  };
  const exportAfterGenerating = () => {
    setStaleExport(null);
    setRegenerating(true);
    const id = toast.loading(t("exportStale.generating"));
    const revisionId = boq.currentRevision.id;
    void generateAndExport(revisionId, groupBy ?? null, () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.boq(boq.id) }), queryClient.invalidateQueries({ queryKey: queryKeys.runs(revisionId) })]),
    )
      .then((e) => toast.success(t("exported", { file: e.fileName }), { id }))
      .catch((err: unknown) =>
        toast.error((err as { generateFailed?: boolean }).generateFailed ? t("exportStale.generateFailed", { message: (err as Error).message }) : message(err), { id }),
      )
      .finally(() => setRegenerating(false));
  };
  const { org } = useOrg();
  const base = `/${org.slug}/projects/${boq.projectId}/boqs/${boq.id}`;
  const overrides = useOverrides(boq.id);
  const manual = useManualItems(boq.id);
  const lists = useCodeLists(run);
  const editLines = useEditLines(boq.id);
  const saveManual = useSaveManualItem(boq.id);
  const removeManual = useRemoveManualItem(boq.id);
  // Edits are for the working version's current run, by leads and estimators (F06 §6, §11).
  // A saved version opened read-only (F09 §3) shares its run with the next working version: `readOnly` wins.
  const editable = !readOnly && boq.currentRevision.permissions.editLines === true && boq.currentRevision.currentRun?.id === run.id;

  const systems = useMemo(() => run.classifications ?? [], [run.classifications]);
  const systemNames = useMemo(() => new Map(systems.map((s) => [s.id, s.name])), [systems]);
  const modelNames = useMemo(() => new Map((run.models ?? []).map((m) => [m.id, m.fileName])), [run.models]);
  const [groupBy, setGroupBy] = useState<string | null>(systems[0]?.id ?? null);
  const [filters, setFilters] = useState<SheetFilters>({});
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // "Open in the sheet" from the viewer (F07 §4) arrives as `?line=`.
  const [selected, setSelected] = useState<string | null>(() => searchParams.get("line"));
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const badges = useModuleLineBadges(boq.id, run.id);
  const [editing, setEditing] = useState<{ key: string; column: EditableColumn } | null>(null);
  // The selected line's active cell (TF-159): ArrowLeft/Right move it, F2 or Enter edit it.
  const [activeColumn, setActiveColumn] = useState<EditableColumn>("description");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  // An in-cell edit or its reason dialog closes: focus goes back to the grid, so the arrows go on working (TF-160).
  const gridRef = useRef<HTMLDivElement>(null);
  useRefocusWhenLost(gridRef, [editing, prompt]);
  const [manualDialog, setManualDialog] = useState<{ record?: ManualItemRecord; defaults?: { codes?: Record<string, string>; sortHint?: string } } | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  // Edits the API never answered (a restart or deploy, TF-183): kept here and sent again, never dropped.
  // An edit refused because the session ended is kept in the tab and offered again here after signing in (TF-146).
  const [unsaved, setUnsaved] = useState<{ apply: EditBatch; undo: EditBatch | null }[]>(() => (typeof window === "undefined" || readOnly ? [] : takeKeptEdits(boq.id)));
  const [unsavedSignedOut, setUnsavedSignedOut] = useState(() => unsaved.length > 0);
  const undoRef = useRef(undoStack);
  useLayoutEffect(() => {
    undoRef.current = undoStack;
  }, [undoStack]);
  // F07 §9: on screens 1280 px and wider the sheet and the model open side by side (resizable, collapsible).
  const hasModels = (run.snapshotVersions?.models?.length ?? 0) > 0;
  const [split, setSplit] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches);
  const [sheetWidth, setSheetWidth] = useState(55);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [modelSelection, setModelSelection] = useState<{ elements: string[]; lines: string[] }>({ elements: [], lines: [] });
  const splitBox = useRef<HTMLDivElement>(null);
  const [visibility, setVisibility] = useState<VisibilityState>({ family: false, tags: false, notes: false });
  const search = useRef<HTMLInputElement>(null);
  const anchor = useRef<string | null>(null);

  const current = useMemo(() => new Map((overrides.data ?? []).map((o) => [o.lineKey, o])), [overrides.data]);
  // A saved version shows the edits it was saved with (BR-25), never the working version's.
  const shownOverrides = frozen ? frozen.overrides : overrides.data;
  const shownManual = frozen ? frozen.manualItems : manual.data;
  const all = useMemo(() => effectiveLines(lines.data ?? [], shownOverrides ?? [], shownManual ?? [], lists), [lines.data, shownOverrides, shownManual, lists]);
  const byKey = useMemo(() => new Map(all.map((l) => [l.key, l])), [all]);
  const byKeyRef = useRef(byKey);
  useLayoutEffect(() => {
    byKeyRef.current = byKey;
  }, [byKey]);
  // F06 §13: numbers follow what the sheet shows, so they renumber at once as lines are edited.
  const separators = useCodeListSeparators(run);
  const positions = useMemo(() => positionNumbers(all, groupBy, groupBy ? separators.get(groupBy) : undefined), [all, groupBy, separators]);
  const options = useMemo(() => facets(all), [all]);
  const filtered = useMemo(() => filterLines(all, filters, groupBy), [all, filters, groupBy]);
  const groups = useMemo(() => topGroups(all, groupBy), [all, groupBy]);
  const models3d = useMemo(() => viewerModels(run), [run]);
  // The viewer colours "edited" from the sheet's current edits (F07 §5).
  const linkLines = useMemo(() => all.map((l) => ({ ...l, edited: !!l.edit })), [all]);
  const startResize = (e: React.PointerEvent) => {
    const box = splitBox.current;
    if (!box) return;
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const r = box.getBoundingClientRect();
      setSheetWidth(Math.min(75, Math.max(30, ((ev.clientX - r.left) / r.width) * 100)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const rows = useMemo(() => buildRows(filtered, groupBy, collapsed), [filtered, groupBy, collapsed]);
  const filtering = filtered.length !== all.length;
  // One formatter for every cell (the rule set's rounding is already applied by the engine), in the
  // firm's number format and the project's locale (F15 §6, §11, TF-021).
  const boqFormat = useBoqFormat();
  const num = useMemo(() => (v: number) => boqFormat.quantity(v), [boqFormat]);
  // Lists in a cell (storeys, tags) in the person's language, not a literal ", " (TF-023).
  const format = useFormatter();
  const list = useCallback((items: string[]) => format.list(items, { type: "unit" }), [format]);
  const toConfirm = t("toConfirm");

  const columns = useMemo<ColumnDef<SheetLine>[]>(() => {
    const col = (id: string, header: string, meta: Omit<ColumnMeta, "id">): ColumnDef<SheetLine> => ({ id, header, meta: { id, ...meta }, enableHiding: !!meta.optional });
    const engine = (l: SheetLine, field: EditField, text: string) => (l.edit?.fields.includes(field) ? te("engineHover", { value: text }) : undefined);
    return [
      col("positionNo", t("col.positionNo"), { width: "5.5rem", cell: (l) => <span className="tabular-nums" data-testid="position-no">{positions.get(l.key) ?? ""}</span> }),
      // The Item (code) column only while grouping by a classification: empty otherwise, it took room
      // from Quantity on narrow screens (TF-171).
      ...(groupBy
        ? [
            col("item", t("col.item"), {
              width: "8rem",
              editable: "item",
              cell: (l) => l.codes[groupBy]?.code,
              engine: (l) => (l.edit?.override.codes?.[groupBy] ? engine(l, "codes", l.edit.engine.codes[groupBy] ?? te("noCode")) : undefined),
            }),
          ]
        : []),
      // The item text of the Group-by system when its code has one (P14, F06 §2); an edited description wins.
      // Beside the model the description gives way first, so Quantity stays in view (TF-107).
      col("description", t("col.description"), { width: split && hasModels ? "minmax(10rem, 1fr)" : "minmax(16rem, 1fr)", editable: "description", cell: (l) => (badges[l.key] ? <>{shownDescription(l, groupBy)} {badges[l.key]}</> : shownDescription(l, groupBy)), engine: (l) => engine(l, "description", l.edit?.engine.description ?? "") }),
      col("unit", t("col.unit"), { width: "4.5rem", editable: "unit", cell: (l) => unitLabel(l.unit), engine: (l) => engine(l, "unit", unitLabel(l.edit?.engine.unit ?? "")) }),
      col("quantity", t("col.quantity"), {
        width: "8rem",
        align: "right",
        editable: "quantity",
        cell: (l) => (l.quantity === null ? <span title={l.notes[0] ?? toConfirm}>—</span> : num(l.quantity)),
        engine: (l) => engine(l, "quantity", l.edit?.engine.quantity === null || l.edit?.engine.quantity === undefined ? toConfirm : num(l.edit.engine.quantity)),
      }),
      col("source", t("col.source"), { width: "7.5rem", optional: true, cell: (l) => <SourceTag source={l.source} toConfirm={l.toConfirm} /> }),
      col("storey", t("col.storey"), { width: "8rem", optional: true, cell: (l) => l.location?.storey ?? (l.location?.storeys ? list(l.location.storeys) : undefined) }),
      col("family", t("col.family"), { width: "7rem", optional: true, cell: (l) => (l.family && t.has(`families.${l.family}`) ? t(`families.${l.family}`) : l.family) }),
      col("tags", t("col.tags"), { width: "8rem", optional: true, cell: (l) => list(l.tags) }),
      col("notes", t("col.notes"), { width: "12rem", optional: true, cell: (l) => l.notes.join(" ") }),
      // One column per extra classification (F06 §2), off by default.
      ...systems.filter((s) => s.id !== groupBy).map((s) => col(`code:${s.id}`, s.name, { width: "8rem", optional: true, cell: (l) => l.codes[s.id]?.code })),
    ];
  }, [groupBy, systems, num, t, te, toConfirm, badges, positions, unitLabel, list, split, hasModels]);

  // TanStack Table owns the columns and their visibility; the rows are the sheet's own (groups + lines).
  // It returns functions the React Compiler can't memoise, so this component is left uncompiled.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: [] as SheetLine[],
    columns,
    // Beside the model, Source is off unless the person switched it on (TF-107): Quantity stays in view.
    state: { columnVisibility: { ...Object.fromEntries(systems.map((s) => [`code:${s.id}`, false])), ...(split && hasModels && !("source" in visibility) ? { source: false } : {}), ...visibility } },
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
  });
  const visibleIds = table
    .getVisibleLeafColumns()
    .map((c) => c.id)
    .join("|");
  // Stable while the visible columns don't change, so the memoised rows don't re-render.
  const visibleMetas = useMemo(
    () => visibleIds.split("|").map((id) => columns.find((c) => c.id === id)!.meta as ColumnMeta),
    [visibleIds, columns],
  );
  const headers = useMemo(() => new Map(columns.map((c) => [c.id!, String(c.header)])), [columns]);

  const groupLabels = useMemo<GroupLabels>(
    () => ({
      unclassified: t("unclassified"),
      lines: (count) => t("groupLines", { count }),
      addLine: (name) => te("addToGroup", { name }),
    }),
    [t, te],
  );

  // ───────── live co-editing (F06 §14, BR-29) ─────────

  const tp = useTranslations("boqs.presence");
  const presence = useBoqPresence();
  const setPresenceLine = presence?.setLineKey;
  // The line I'm editing goes to the others; theirs get a marker here.
  useEffect(() => setPresenceLine?.(editing?.key ?? null), [editing?.key, setPresenceLine]);
  const markers = useMemo(() => new Map((presence?.others ?? []).flatMap((u) => (u.lineKey ? [[u.lineKey, tp("marker", { name: u.name })] as const] : []))), [presence?.others, tp]);
  const queryClient = useQueryClient();
  const myId = me.data?.user.id;
  const keepMineRef = useRef<(key: string, mine: LineOverrideInput | null) => void>(() => {});
  // Someone else saved a line I had edited: the later edit wins; I'm told, with their value, and may put mine back.
  useEffect(
    () =>
      onLineEdited(async (e) => {
        if (e.boqId !== boq.id || e.by.id === myId || readOnly) return;
        const { stack, mine } = takeLinesFromUndo(undoRef.current, new Set(e.lineKeys));
        if (!mine.size) return;
        setUndoStack(stack as UndoEntry[]);
        await queryClient.refetchQueries({ queryKey: queryKeys.overrides(boq.id) });
        const now = new Map((queryClient.getQueryData<LineOverride[]>(queryKeys.overrides(boq.id)) ?? []).map((o) => [o.lineKey, o]));
        for (const [key, my] of mine) {
          const theirs = now.get(key);
          const value =
            theirs === undefined
              ? te("theirRestored")
              : theirs.excluded
                ? te("theirExcluded")
                : theirs.quantity !== undefined && theirs.quantity !== null
                  ? te("theirValue", { value: `${num(theirs.quantity)} ${unitLabel(theirs.unit ?? byKeyRef.current.get(key)?.unit ?? "")}`.trim() })
                  : theirs.description
                    ? te("theirValue", { value: theirs.description })
                    : te("theirValue", { value: list(Object.values(theirs.codes ?? {})) });
          toast(te("changedBy", { name: e.by.name }), {
            id: `coedit-${key}`,
            description: value,
            duration: 15_000,
            action: { label: te("keepMine"), onClick: () => keepMineRef.current(key, my) },
          });
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boq.id, myId, readOnly, queryClient],
  );

  // ───────── edits ─────────

  const pushUndo = (entry: UndoEntry) => setUndoStack((s) => [...s.slice(-(UNDO_DEPTH - 1)), entry]);

  /**
   * Sends one edit batch; once saved, its inverse (if any) goes on the undo stack. A batch the API
   * never answered, after the hook's retries, is kept as not saved (TF-183). mutateAsync, so every
   * batch gets its outcome, not only the latest.
   */
  const send = (apply: EditBatch, undo: EditBatch | null) =>
    editLines.mutateAsync(apply).then(
      () => {
        if (undo) pushUndo({ kind: "batch", apply, undo });
      },
      (error: unknown) => {
        if (isUnavailable(error)) setUnsaved((u) => [...u, { apply, undo }]);
        // Signed out (expired or taken over): the app goes to sign-in; the edit waits in this tab.
        else if (isApiError(error) && error.status === 401) keepEdit(boq.id, { apply, undo });
      },
    );
  const sendUnsaved = async () => {
    const batches = unsaved;
    setUnsaved([]);
    setUnsavedSignedOut(false);
    // In order: a later edit of the same line must win.
    for (const b of batches) await send(b.apply, b.undo);
  };
  const sendUnsavedRef = useRef(sendUnsaved);
  useLayoutEffect(() => {
    sendUnsavedRef.current = sendUnsaved;
  });
  const hasUnsaved = unsaved.length > 0;
  useEffect(() => {
    if (!hasUnsaved) return;
    // Sent again as soon as the API answers (the event stream is back) or the browser is online again.
    const again = () => void sendUnsavedRef.current();
    const off = onApiResumed(again);
    window.addEventListener("online", again);
    // Leaving the page would lose them.
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      off();
      window.removeEventListener("online", again);
      window.removeEventListener("beforeunload", warn);
    };
  }, [hasUnsaved]);

  /** One edit (any number of lines) as one request; its inverse goes on the undo stack. */
  const commit = (changes: Map<string, LineOverrideInput | null>) => {
    if (!changes.size) return;
    const { apply, undo } = batchFor(changes, current);
    void send(apply, undo);
  };
  useLayoutEffect(() => {
    keepMineRef.current = (key, mine) => commit(new Map([[key, mine]]));
  });
  const change = (key: string, patch: Partial<LineOverrideInput>) => commit(new Map([[key, withChange(current.get(key), key, patch)]]));
  const changeMany = (keys: Iterable<string>, patch: (key: string) => Partial<LineOverrideInput>) => commit(new Map([...keys].map((k) => [k, withChange(current.get(k), k, patch(k))])));

  const undoLast = () => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setUndoStack((s) => s.slice(0, -1));
    if (entry.kind === "batch") void send(entry.undo, null);
    else removeManual.mutate(entry.recordId);
  };

  const askReason = (title: string, summary: string, initial: string | undefined, apply: (reason: string) => void) => setPrompt({ title, summary, initial, apply });

  const commitCell = (key: string, column: EditableColumn, value: string) => {
    setEditing(null);
    const line = byKey.get(key);
    if (!line) return;
    const o = current.get(key);
    if (column === "description") {
      const text = value.trim();
      if (!text || text === line.description) return;
      change(key, { description: text === line.edit?.engine.description ? undefined : text });
    } else if (column === "item" && groupBy) {
      if (!value || value === line.codes[groupBy]?.code) return;
      change(key, { codes: { ...(o?.codes ?? {}), [groupBy]: value } });
    } else if (column === "unit") {
      const unit = value.trim();
      if (!unit || unit === line.unit) return;
      // Sent as it is: without a quantity edit the API refuses it with the reason (409 unit_needs_quantity).
      const next = { ...(withChange(o, key, {}) ?? { lineKey: key }), unit };
      const { apply, undo } = batchFor(new Map([[key, next]]), current);
      void send(apply, undo);
    } else if (column === "quantity") {
      const text = value.trim();
      const quantity = text === "" ? null : Number(text.replace(/\s/g, "").replace(",", "."));
      if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) return;
      if (quantity === line.quantity) return;
      askReason(te("quantityTitle"), te("quantitySummary", { line: line.description, value: quantity === null ? toConfirm : `${num(quantity)} ${unitLabel(line.unit)}` }), o?.reason, (reason) => change(key, { quantity, reason }));
    }
  };

  const exclude = (keys: string[]) =>
    askReason(te("excludeTitle", { count: keys.length }), keys.length === 1 ? (byKey.get(keys[0]!)?.description ?? "") : te("excludeSummary", { count: keys.length }), undefined, (reason) => changeMany(keys, () => ({ excluded: true, reason })));

  const lastLineOf = (group: GroupRow) => {
    const at = rows.indexOf(group);
    let last: string | undefined;
    for (let i = at + 1; i < rows.length && !(rows[i]!.kind === "group" && rows[i]!.depth <= group.depth); i++) if (rows[i]!.kind === "line") last = rows[i]!.id;
    return last;
  };

  const actions: LineActions = {
    restore: (line, field) => {
      const o = current.get(line.key);
      if (!o) return;
      commit(new Map([[line.key, field === "all" ? null : restoreField(o, field)]]));
    },
    exclude: (line) => exclude([line.key]),
    include: (line) => {
      const o = current.get(line.key);
      if (o) commit(new Map([[line.key, restoreField(o, "excluded")]]));
    },
    markToConfirm: (line) => askReason(te("quantityTitle"), te("quantitySummary", { line: line.description, value: toConfirm }), current.get(line.key)?.reason, (reason) => change(line.key, { quantity: null, reason })),
    addBelow: (line) => setManualDialog({ defaults: { codes: Object.fromEntries(Object.entries(line.codes).map(([s, c]) => [s, c.code])), sortHint: line.key } }),
    editManual: (line) => line.manual && setManualDialog({ record: line.manual }),
    removeManual: (line) => {
      if (!line.manual) return;
      removeManual.mutate(line.manual.id);
      setSelected(null);
    },
  };

  // The rows call the latest handlers through one stable object.
  const live = useRef<RowApi | null>(null);
  useLayoutEffect(() => {
    live.current = {
      // Clicking selects (Escape or the close button closes the detail): a click on the selected line
      // must not close it, or the first click of a double-click (editing a cell) would move the cells.
      click: (key) => setSelected(key),
      check: (key, range) => {
        setChecked((prev) => {
          const next = new Set(prev);
          const keys = rows.filter((r) => r.kind === "line").map((r) => r.id);
          if (range && anchor.current && keys.includes(anchor.current)) {
            const [a, b] = [keys.indexOf(anchor.current), keys.indexOf(key)].sort((x, y) => x - y);
            for (const k of keys.slice(a!, b! + 1)) next.add(k);
          } else if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
        anchor.current = key;
      },
      startEdit: (key, column) => editable && !byKey.get(key)?.pending && setEditing({ key, column }),
      commitEdit: commitCell,
      cancelEdit: () => setEditing(null),
      drop: (from, target) => {
        const line = byKey.get(from);
        if (!editable || !line || line.pending) return;
        const o = current.get(from);
        if (target.line && target.line !== from) {
          const onto = byKey.get(target.line);
          const code = groupBy ? onto?.codes[groupBy]?.code : undefined;
          const moves = groupBy && code && code !== line.codes[groupBy]?.code;
          change(from, { sortAfter: target.line, ...(moves ? { codes: { ...(o?.codes ?? {}), [groupBy!]: code } } : {}) });
        } else if (target.group && groupBy && target.group.title !== null && target.group.code !== line.codes[groupBy]?.code) {
          change(from, { codes: { ...(o?.codes ?? {}), [groupBy]: target.group.code } });
        }
      },
      addToGroup: (group) => setManualDialog({ defaults: { ...(groupBy && group.title !== null ? { codes: { [groupBy]: group.code } } : {}), ...(lastLineOf(group) ? { sortHint: lastLineOf(group) } : {}) } }),
      toggleGroup: (id) =>
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      selectGroup: (id) => {
        setSelectedGroup((g) => (g === id ? null : id));
        setSelected(null);
      },
    };
  });
  const rowApi = useMemo<RowApi>(
    () => ({
      click: (k) => live.current?.click(k),
      check: (k, r) => live.current?.check(k, r),
      startEdit: (k, c) => live.current?.startEdit(k, c),
      commitEdit: (k, c, v) => live.current?.commitEdit(k, c, v),
      cancelEdit: () => live.current?.cancelEdit(),
      drop: (f, target) => live.current?.drop(f, target),
      addToGroup: (g) => live.current?.addToGroup(g),
      toggleGroup: (id) => live.current?.toggleGroup(id),
      selectGroup: (id) => live.current?.selectGroup(id),
    }),
    [],
  );

  // The editable columns on screen, left to right (Item only while grouping by a classification).
  const editableColumns = visibleMetas.flatMap((c) => (c.editable ? [c.editable] : []));
  const shownActive = editableColumns.includes(activeColumn) ? activeColumn : "description";
  const editActive = () => selected && rowApi.startEdit(selected, shownActive);
  // "/" focuses the search (F06 §10); Ctrl+Z undoes the last edit (F06 §6); F2 edits the selected line's active cell.
  const keys = useRef({ undo: undoLast, edit: editActive });
  useLayoutEffect(() => {
    keys.current = { undo: undoLast, edit: editActive };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        keys.current.undo();
      } else if (e.key === "F2") {
        e.preventDefault();
        keys.current.edit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setFilter = <K extends keyof SheetFilters>(key: K, value: SheetFilters[K] | "") => setFilters((f) => ({ ...f, [key]: value || undefined }));
  const checkedKeys = [...checked].filter((k) => byKey.has(k) && !byKey.get(k)!.pending);
  const shownKeys = rows.filter((r) => r.kind === "line" && !(r as { line: SheetLine }).line.pending).map((r) => r.id);
  // An edit the API didn't answer is shown as not saved (below), not as an error.
  const editError = (editLines.error && !isUnavailable(editLines.error) ? editLines.error : null) ?? saveManual.error ?? removeManual.error;
  const retrying = editLines.isPending && editLines.failureCount > 0;

  if (lines.isError) return <InlineError error={lines.error} onRetry={() => lines.refetch()} />;
  if (!lines.data) return <p className="text-muted-foreground" aria-busy="true">{t("loading")}</p>;

  const selectedLine = selected ? byKey.get(selected) : undefined;
  const renderDetail = (detailClass: string | undefined) =>
    selectedLine &&
          (selectedLine.pending ? (
            <aside className={cn("flex w-full flex-col gap-4 border-l border-border pl-5 lg:w-[440px] lg:shrink-0", detailClass)} aria-label={selectedLine.description} data-testid="line-detail">
              <h3 className="text-title">{selectedLine.description}</h3>
              <LineEdits line={selectedLine} editable={editable} systemNames={systemNames} actions={actions} />
            </aside>
          ) : (
            <LineDetailPanel run={run} lineKey={selectedLine.key} groupBy={groupBy} showIn3dHref={(run.snapshotVersions?.models?.length ?? 0) > 0 ? showIn3dHref(base, { line: selectedLine.key }) : undefined} modelNames={modelNames} systemNames={systemNames} onSelect={setSelected} onClose={() => setSelected(null)} className={detailClass}>
              {(editable || selectedLine.edit || selectedLine.excluded) && <LineEdits line={selectedLine} editable={editable} systemNames={systemNames} actions={actions} />}
            </LineDetailPanel>
          ));
  return (
    <div className="flex flex-col gap-3" data-testid="sheet" data-editable={editable ? "true" : "false"}>
      <WarningsBar runId={run.id} systemNames={systemNames} />
      <SystemRulesHint run={run} userId={me.data?.user.id} />
      <NotInModelsNotice
        lines={all}
        collapsed={me.data?.preferences?.notInModelsCollapsed ?? false}
        onCollapsedChange={(notInModelsCollapsed) => savePreferences.mutate({ notInModelsCollapsed })}
        onAddLine={editable ? () => setManualDialog({}) : undefined}
      />
      <div className="flex flex-wrap items-end gap-3" data-testid="sheet-toolbar">
        <label className="flex flex-col gap-1">
          <span className="label-caps text-muted-foreground">{t("groupBy")}</span>
          <NativeSelect value={groupBy ?? ""} onChange={(e) => setGroupBy(e.target.value || null)} data-testid="group-by">
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="">{t("noGrouping")}</option>
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label-caps text-muted-foreground">{t("source")}</span>
          <NativeSelect value={filters.source ?? ""} onChange={(e) => setFilter("source", e.target.value as SourceFilter)} data-testid="filter-source">
            <option value="">{t("all")}</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`sources.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </label>
        {options.storeys.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="label-caps text-muted-foreground">{t("storey")}</span>
            <NativeSelect value={filters.storey ?? ""} onChange={(e) => setFilter("storey", e.target.value)} data-testid="filter-storey">
              <option value="">{t("all")}</option>
              {options.storeys.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        {groupBy && groups.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className="label-caps text-muted-foreground">{t("codeGroup")}</span>
            <NativeSelect value={filters.group ?? ""} onChange={(e) => setFilter("group", e.target.value)} data-testid="filter-group">
              <option value="">{t("all")}</option>
              {groups.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.code === UNCLASSIFIED ? t("unclassified") : g.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        {options.families.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className="label-caps text-muted-foreground">{t("family")}</span>
            <NativeSelect value={filters.family ?? ""} onChange={(e) => setFilter("family", e.target.value)} data-testid="filter-family">
              <option value="">{t("all")}</option>
              {options.families.map((s) => (
                <option key={s} value={s}>
                  {t.has(`families.${s}`) ? t(`families.${s}`) : s}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        {options.models.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className="label-caps text-muted-foreground">{t("model")}</span>
            <NativeSelect value={filters.model ?? ""} onChange={(e) => setFilter("model", e.target.value)} data-testid="filter-model">
              <option value="">{t("all")}</option>
              {options.models.map((m) => (
                <option key={m} value={m}>
                  {modelNames.get(m) ?? m.slice(0, 8)}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        <label className="flex min-w-56 flex-1 flex-col gap-1">
          <span className="label-caps text-muted-foreground">{t("search")}</span>
          <Input ref={search} type="search" value={filters.q ?? ""} placeholder={t("searchHint")} onChange={(e) => setFilter("q", e.target.value)} data-testid="sheet-search" />
        </label>
        {editable && (
          <>
            <Button variant="outline" onClick={undoLast} disabled={undoStack.length === 0 || editLines.isPending} title={te("undoHint")} data-testid="undo-edit">
              <Undo2 aria-hidden />
              {te("undo")}
            </Button>
            <Button variant="outline" onClick={() => setManualDialog({})} data-testid="add-line">
              <Plus aria-hidden />
              {te("addLine")}
            </Button>
          </>
        )}
        <Button variant="outline" onClick={exportExcel} disabled={exporting.isPending || regenerating} data-testid="export-xlsx">
          <Download aria-hidden />
          {t("exportExcel")}
        </Button>
        {hasModels && (
          <Button variant="outline" aria-pressed={split} onClick={() => setSplit((s) => !s)} title={t("modelToggleHint")} data-testid="toggle-model">
            <Box aria-hidden />
            {t("model3d")}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" data-testid="columns-menu" />}>
            <Columns3 aria-hidden />
            {t("columns")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllLeafColumns()
              .filter((c) => c.getCanHide())
              .map((c) => (
                <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} data-testid={`column-${c.id}`}>
                  {String(c.columnDef.header)}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {filtering && (
        <p className="flex items-center gap-3" role="status" data-testid="filtered-count">
          {t("filtered", { shown: filtered.length, total: all.length })}
          <button className="text-link hover:underline" onClick={() => setFilters({})}>
            {t("clearFilters")}
          </button>
        </p>
      )}
      {split && hasModels && modelSelection.elements.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-l-2 border-[var(--link)] pl-3" role="status" data-testid="model-selection">
          <span>{t("fromModel", { lines: modelSelection.lines.length, elements: modelSelection.elements.length })}</span>
          {editable && modelSelection.lines.length > 0 && (
            <button className="text-link hover:underline" onClick={() => setChecked(new Set(modelSelection.lines.filter((k) => byKey.has(k))))} data-testid="model-selection-check">
              {t("selectTheseLines")}
            </button>
          )}
          {modelSelection.lines.length > 0 && (
            <button className="text-link hover:underline" onClick={() => setFilters((f) => ({ ...f, keys: new Set(modelSelection.lines) }))} data-testid="model-selection-only">
              {t("onlyTheseLines")}
            </button>
          )}
        </div>
      )}
      {editable && checkedKeys.length > 0 && (
        <BulkBar
          count={checkedKeys.length}
          lists={lists}
          system={groupBy}
          systemName={groupBy ? (systemNames.get(groupBy) ?? groupBy) : ""}
          onMove={(code) => changeMany(checkedKeys, (k) => ({ codes: { ...(current.get(k)?.codes ?? {}), [groupBy!]: code } }))}
          onExclude={() => exclude(checkedKeys)}
          onRestore={() => commit(new Map(checkedKeys.filter((k) => current.has(k)).map((k) => [k, null])))}
          onClear={() => setChecked(new Set())}
          actions={extensions("sheet.selectionActions").map((a) => (
            <a.Action key={a.id} boqId={boq.id} runId={run.id} lineKeys={checkedKeys} />
          ))}
        />
      )}
      {editError ? (
        <p role="alert" className="text-error" data-testid="edit-error">
          {message(editError)}
        </p>
      ) : null}
      {retrying && (
        <p role="status" className="text-muted-foreground" data-testid="edit-retrying">
          {te("retrying")}
        </p>
      )}
      {hasUnsaved && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-l-2 border-[var(--status-error)] pl-3" data-testid="edit-unsaved" data-count={unsaved.length}>
          <span>{unsavedSignedOut ? te("notSavedSignedOut", { count: unsaved.length }) : te("notSaved", { count: unsaved.length })}</span>
          <Button variant="outline" onClick={() => void sendUnsaved()} disabled={editLines.isPending} data-testid="edit-unsaved-retry">
            {te("retry")}
          </Button>
          <Button variant="ghost" onClick={() => {
              setUnsaved([]);
              setUnsavedSignedOut(false);
            }} data-testid="edit-unsaved-discard">
            {te("discard")}
          </Button>
        </div>
      )}

      {split && hasModels ? (
        <div ref={splitBox} className="flex items-start" data-testid="sheet-split">
          <div className="min-w-0 shrink-0" style={{ width: `${sheetWidth}%` }}>
            <SheetGrid
              rows={rows}
              columns={visibleMetas}
              headers={headers}
              selected={selected}
              onSelect={setSelected}
              checked={checked}
              editing={editing}
              editable={editable}
              allChecked={shownKeys.length > 0 && shownKeys.every((k) => checked.has(k))}
              onCheckAll={(on) => setChecked(on ? new Set(shownKeys) : new Set())}
              api={rowApi}
              groupBy={groupBy}
              selectedGroup={selectedGroup}
              lists={lists}
              num={num}
              labels={groupLabels}
              emptyText={filtering ? t("noMatches") : tn("text")}
              label={t("tableLabel")}
              checkAllLabel={te("selectAll")}
              pendingLabel={te("pending")}
              editingBy={markers}
              activeColumn={editable ? shownActive : null}
              editableColumns={editable ? editableColumns : []}
              onActiveColumn={setActiveColumn}
              onEditActive={editActive}
              gridRef={gridRef}
            />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("resize")}
            aria-valuenow={Math.round(sheetWidth)}
            aria-valuemin={30}
            aria-valuemax={75}
            tabIndex={0}
            className="mx-2 w-1.5 shrink-0 cursor-col-resize self-stretch bg-border hover:bg-[var(--link)] focus-visible:bg-[var(--link)] focus-visible:outline-none"
            onPointerDown={startResize}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                setSheetWidth((w) => Math.min(75, Math.max(30, w + (e.key === "ArrowLeft" ? -5 : 5))));
              }
            }}
            data-testid="split-handle"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            {/* The line's detail first, in view; the model under it (TF-107). */}
            {renderDetail("border-l-0 pl-0 lg:w-full")}
            <ModelViewer
              key={run.id}
              stacked
              models={models3d}
              runId={run.id}
              lines={linkLines}
              systems={systems}
              focusLine={selected}
              focusKeys={selectedGroup ? linesInGroup(filtered, groupBy, selectedGroup) : null}
              scope={filtering ? filtered.map((l) => l.key) : null}
              onOpenLine={setSelected}
              onSelectionChange={setModelSelection}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row">
          <div className="min-w-0 flex-1">
            <SheetGrid
              rows={rows}
              columns={visibleMetas}
              headers={headers}
              selected={selected}
              onSelect={setSelected}
              checked={checked}
              editing={editing}
              editable={editable}
              allChecked={shownKeys.length > 0 && shownKeys.every((k) => checked.has(k))}
              onCheckAll={(on) => setChecked(on ? new Set(shownKeys) : new Set())}
              api={rowApi}
              groupBy={groupBy}
              selectedGroup={selectedGroup}
              lists={lists}
              num={num}
              labels={groupLabels}
              emptyText={filtering ? t("noMatches") : tn("text")}
              label={t("tableLabel")}
              checkAllLabel={te("selectAll")}
              pendingLabel={te("pending")}
              editingBy={markers}
              activeColumn={editable ? shownActive : null}
              editableColumns={editable ? editableColumns : []}
              onActiveColumn={setActiveColumn}
              onEditActive={editActive}
              gridRef={gridRef}
            />
          </div>
          {renderDetail(undefined)}
        </div>
      )}

      <ExportStaleDialog
        pending={staleExport?.pending ?? null}
        canGenerate={staleExport?.canGenerate ?? false}
        onGenerate={exportAfterGenerating}
        onLastRun={exportLastRun}
        onClose={() => setStaleExport(null)}
      />
      {prompt && (
        <ReasonDialog
          title={prompt.title}
          summary={prompt.summary}
          initial={prompt.initial}
          onClose={() => setPrompt(null)}
          onConfirm={(reason) => {
            prompt.apply(reason);
            setPrompt(null);
          }}
        />
      )}
      {manualDialog && (
        <ManualLineDialog
          run={run}
          systems={systems}
          lists={lists}
          record={manualDialog.record}
          defaults={manualDialog.defaults}
          saving={saveManual.isPending}
          error={saveManual.error}
          onClose={() => {
            saveManual.reset();
            setManualDialog(null);
          }}
          onSave={(input) =>
            saveManual.mutate(
              { id: manualDialog.record?.id, input },
              {
                onSuccess: (rec) => {
                  if (!manualDialog.record) pushUndo({ kind: "manualAdded", recordId: rec.id });
                  setManualDialog(null);
                  setSelected(rec.item.id);
                },
              },
            )
          }
        />
      )}
    </div>
  );
}

/** Bulk actions on the ticked lines (F06 §6): move to a section, exclude, restore. */
function BulkBar({ count, lists, system, systemName, onMove, onExclude, onRestore, onClear, actions }: { count: number; lists: CodeLists; system: string | null; systemName: string; onMove: (code: string) => void; onExclude: () => void; onRestore: () => void; onClear: () => void; actions?: ReactNode }) {
  const t = useTranslations("boqs.edits");
  const list = system ? lists.get(system) : undefined;
  const items = useMemo(() => (list ? [...list.values()].map((c) => ({ value: c.code, label: c.code, hint: c.title })) : []), [list]);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-muted px-3 py-2" role="region" aria-label={t("bulkLabel")} data-testid="sheet-bulk-bar">
      <span className="tabular-nums">{t("selected", { count })}</span>
      {list && <SearchPicker items={items} value={undefined} onPick={onMove} label={t("moveTo", { system: systemName })} placeholder={t("moveTo", { system: systemName })} empty={t("noCode")} className="min-w-64" data-testid="bulk-move" />}
      <Button variant="outline" onClick={onExclude} data-testid="bulk-exclude">
        {t("exclude")}
      </Button>
      <Button variant="outline" onClick={onRestore} data-testid="bulk-restore">
        {t("restoreEdits")}
      </Button>
      {/* Module actions on the ticked lines (`sheet.selectionActions`, P36). */}
      {actions}
      <Button variant="ghost" onClick={onClear}>
        {t("clearSelection")}
      </Button>
    </div>
  );
}

const NO_BADGES: Readonly<Record<string, ReactNode>> = {};

/**
 * Badges modules put on lines (`sheet.lineBadges`, P36): each module's hook, in registration order
 * (fixed after startup, so the hooks are called in the same order on every render).
 */
function useModuleLineBadges(boqId: string, runId: string): Readonly<Record<string, ReactNode>> {
  const all = extensions("sheet.lineBadges").map((b) => b.useBadges({ boqId, runId }));
  if (all.length === 0) return NO_BADGES;
  if (all.length === 1) return all[0]!;
  const merged: Record<string, ReactNode> = {};
  for (const map of all) for (const [key, badge] of Object.entries(map)) merged[key] = merged[key] ? <>{merged[key]} {badge}</> : badge;
  return merged;
}

/** The virtualised body: header, rows, keyboard (arrows move the selection, Escape clears it). */
function SheetGrid({
  rows,
  columns,
  headers,
  selected,
  onSelect,
  checked,
  editing,
  editable,
  allChecked,
  onCheckAll,
  api,
  groupBy,
  selectedGroup,
  lists,
  num,
  labels,
  emptyText,
  label,
  checkAllLabel,
  pendingLabel,
  editingBy,
  activeColumn,
  editableColumns,
  onActiveColumn,
  onEditActive,
  gridRef,
}: {
  rows: Row[];
  columns: ColumnMeta[];
  headers: Map<string, string>;
  selected: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
  checked: ReadonlySet<string>;
  editing: { key: string; column: EditableColumn } | null;
  editable: boolean;
  allChecked: boolean;
  onCheckAll: (on: boolean) => void;
  api: RowApi;
  groupBy: string | null;
  selectedGroup: string | null;
  lists: CodeLists;
  num: (v: number) => string;
  labels: GroupLabels;
  emptyText: string;
  label: string;
  checkAllLabel: string;
  pendingLabel: string;
  /** Lines others are editing (F06 §14), line key → the marker's text. */
  editingBy: ReadonlyMap<string, string>;
  /** The selected line's active cell (TF-159), null when the sheet can't be edited. */
  activeColumn: EditableColumn | null;
  editableColumns: EditableColumn[];
  onActiveColumn: (column: EditableColumn) => void;
  onEditActive: () => void;
  /** The grid element, for the sheet to give focus back to it (TF-160). */
  gridRef?: RefObject<HTMLDivElement | null>;
}) {
  const ownScroller = useRef<HTMLDivElement>(null);
  const scroller = gridRef ?? ownScroller;
  // Like TanStack Table, the virtualizer returns functions the React Compiler can't memoise.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 12 });
  const lineIndexes = useMemo(() => rows.flatMap((r, i) => (r.kind === "line" ? [i] : [])), [rows]);
  const lead = editable ? "2rem " : "";
  const template = useMemo(() => lead + columns.map((c) => c.width).join(" "), [columns, lead]);
  const unitIndex = columns.findIndex((c) => c.id === "unit");
  const quantityIndex = columns.findIndex((c) => c.id === "quantity");
  const codeItems = useMemo(() => {
    const list = groupBy ? lists.get(groupBy) : undefined;
    return list ? [...list.values()].map((c) => ({ value: c.code, label: c.code, hint: c.title })) : [];
  }, [groupBy, lists]);

  // Keep the selected line in view (also when it was chosen elsewhere: the viewer, `?line=`).
  const selectedIndex = selected ? rows.findIndex((r) => r.id === selected) : -1;
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  // The arrows walk every row, group headings included (treegrid): the grid is one Tab stop (TF-161),
  // so a heading is reached, opened and closed by keyboard here rather than by Tab.
  const groupRow = selectedGroup && !selected ? rows.find((r) => r.kind === "group" && r.id === selectedGroup) : undefined;
  const move = (by: number) => {
    if (!rows.length) return;
    const at = selected ? rows.findIndex((r) => r.kind === "line" && r.id === selected) : groupRow ? rows.indexOf(groupRow) : -1;
    const next = Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + by));
    const row = rows[next]!;
    if (row.kind === "line") {
      if (selectedGroup) api.selectGroup(selectedGroup); // deselects the heading
      onSelect(row.id);
    } else if (selectedGroup !== row.id) api.selectGroup(row.id);
    virtualizer.scrollToIndex(next, { align: "auto" });
  };

  return (
    <div
      ref={scroller}
      role="treegrid"
      aria-label={label}
      aria-rowcount={rows.length + 1}
      tabIndex={0}
      className="relative h-[max(24rem,calc(100dvh-24rem))] overflow-auto border-y border-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input")) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          move(e.key === "ArrowDown" ? 1 : -1);
        } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Enter") && groupRow?.kind === "group") {
          // On a heading: Right opens it, Left closes it, Enter toggles.
          e.preventDefault();
          const open = !groupRow.collapsed;
          if (e.key === "Enter" || (e.key === "ArrowRight" ? !open : open)) api.toggleGroup(groupRow.id);
        } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && selected && activeColumn && editableColumns.length) {
          // Between the editable cells of the selected line (TF-159).
          e.preventDefault();
          const at = Math.max(0, editableColumns.indexOf(activeColumn));
          onActiveColumn(editableColumns[Math.max(0, Math.min(editableColumns.length - 1, at + (e.key === "ArrowRight" ? 1 : -1)))]!);
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && editable) {
          // Ctrl+A ticks every shown line, or none when all are ticked (the header box isn't a Tab stop either).
          e.preventDefault();
          onCheckAll(!allChecked);
        } else if (e.key === " " && selected && editable) {
          // Space ticks the selected line (its box is not a Tab stop, TF-161).
          e.preventDefault();
          api.check(selected, e.shiftKey);
        } else if (e.key === "Escape") onSelect(null);
        else if (e.key === "Enter" && !selected) move(0);
        else if (e.key === "Enter" && activeColumn) {
          e.preventDefault();
          onEditActive();
        }
      }}
      data-testid="sheet-grid"
      data-rows={rows.length}
      data-lines={lineIndexes.length}
    >
      <div role="row" className="sticky top-0 z-10 grid min-w-fit border-b border-border bg-background" style={{ gridTemplateColumns: template, height: ROW }}>
        {editable && (
          <div role="columnheader" className="flex items-center justify-center">
            <input type="checkbox" tabIndex={-1} aria-label={checkAllLabel} aria-keyshortcuts="Control+A" checked={allChecked} onChange={(e) => onCheckAll(e.target.checked)} className="accent-[var(--link)]" data-testid="check-all" />
          </div>
        )}
        {columns.map((c) => (
          <div key={c.id} role="columnheader" className={cn("label-caps flex items-center truncate px-2 text-muted-foreground", c.align === "right" && "justify-end")}>
            {headers.get(c.id)}
          </div>
        ))}
      </div>
      {rows.length === 0 && <p className="p-4 text-muted-foreground">{emptyText}</p>}
      <div className="relative min-w-fit" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index]!;
          return row.kind === "group" ? (
            <GroupRowView key={`g:${row.id}`} row={row} selected={selectedGroup === row.id} top={v.start} index={v.index} template={template} lead={editable} unitIndex={unitIndex} quantityIndex={quantityIndex} columnCount={columns.length} api={api} editable={editable} num={num} labels={labels} />
          ) : (
            <LineRowView
              key={`l:${row.id}`}
              line={row.line}
              depth={row.depth}
              top={v.start}
              index={v.index}
              template={template}
              columns={columns}
              selected={row.id === selected}
              checked={checked.has(row.id)}
              editingColumn={editing?.key === row.id ? editing.column : null}
              activeColumn={row.id === selected ? activeColumn : null}
              editable={editable}
              codeItems={codeItems}
              api={api}
              pendingLabel={pendingLabel}
              editingBy={editingBy.get(row.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

const GroupRowView = memo(function GroupRowView({
  row,
  selected,
  top,
  index,
  template,
  lead,
  unitIndex,
  quantityIndex,
  columnCount,
  api,
  editable,
  num,
  labels,
}: {
  row: GroupRow;
  /** Selected: the model highlights the elements of the group's lines (F07 §9). */
  selected: boolean;
  top: number;
  index: number;
  template: string;
  lead: boolean;
  unitIndex: number;
  quantityIndex: number;
  columnCount: number;
  api: RowApi;
  editable: boolean;
  num: (v: number) => string;
  labels: GroupLabels;
}) {
  const unitLabel = useUnit();
  const [over, setOver] = useState(false);
  const name = row.title === null ? labels.unclassified : `${row.code} ${row.title}`;
  // The group spans the columns before Unit; the subtotal sits under Unit and Quantity when the unit is shared.
  const span = Math.max(1, unitIndex >= 0 ? unitIndex : columnCount);
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-level={row.depth + 1}
      aria-expanded={!row.collapsed}
      aria-selected={selected}
      className={cn("group/row absolute top-0 left-0 grid w-full min-w-fit cursor-default border-b border-border bg-muted/50 font-semibold", selected && "bg-selection", over && "outline-2 -outline-offset-2 outline-[var(--link)]")}
      onClick={(e) => {
        // The name toggles the group; the rest of the row selects it.
        if (!(e.target as HTMLElement).closest("button")) api.selectGroup(row.id);
      }}
      style={{ gridTemplateColumns: template, height: ROW, transform: `translateY(${top}px)` }}
      onDragOver={(e) => {
        if (!editable || !e.dataTransfer.types.includes(DRAG_TYPE) || row.title === null) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const from = e.dataTransfer.getData(DRAG_TYPE);
        if (from) api.drop(from, { group: row });
      }}
      data-testid="sheet-group"
      data-group={row.id}
    >
      {lead && <div role="gridcell" />}
      <div role="gridcell" className="flex min-w-0 items-center" style={{ gridColumn: `span ${span}` }}>
        <button
          className="flex min-w-0 items-center gap-1 truncate text-left"
          style={{ paddingLeft: `${0.5 + row.depth}rem` }}
          onClick={() => api.toggleGroup(row.id)}
          aria-expanded={!row.collapsed}
          tabIndex={-1}
        >
          {row.collapsed ? <ChevronRight aria-hidden className="size-3.5 shrink-0" /> : <ChevronDown aria-hidden className="size-3.5 shrink-0" />}
          <span className="truncate">{name}</span>
          <span className="ml-2 font-normal text-muted-foreground">{labels.lines(row.lineCount)}</span>
        </button>
        {editable && (
          <button
            className="ml-2 flex size-6 shrink-0 items-center justify-center rounded-[var(--radius)] font-normal text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
            aria-label={labels.addLine(name)}
            title={labels.addLine(name)}
            onClick={() => api.addToGroup(row)}
            tabIndex={-1}
            data-testid="group-add-line"
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
        )}
      </div>
      {unitIndex >= 0 && <div role="gridcell" className="flex items-center px-2 font-normal">{row.unit ? unitLabel(row.unit) : null}</div>}
      {quantityIndex >= 0 && (
        <div role="gridcell" className="flex items-center justify-end px-2 tabular-nums" data-testid="group-subtotal">
          {row.quantity !== null ? num(row.quantity) : null}
        </div>
      )}
    </div>
  );
});

const LineRowView = memo(function LineRowView({
  line,
  depth,
  top,
  index,
  template,
  columns,
  selected,
  checked,
  editingColumn,
  editable,
  codeItems,
  api,
  pendingLabel,
  editingBy,
  activeColumn,
}: {
  line: SheetLine;
  depth: number;
  top: number;
  index: number;
  template: string;
  columns: ColumnMeta[];
  selected: boolean;
  checked: boolean;
  editingColumn: EditableColumn | null;
  editable: boolean;
  codeItems: { value: string; label: string; hint?: string }[];
  api: RowApi;
  pendingLabel: string;
  editingBy?: string;
  /** This (selected) line's active cell, edited by F2 or Enter. */
  activeColumn: EditableColumn | null;
}) {
  const [over, setOver] = useState(false);
  const canEdit = editable && !line.pending;
  const te = useTranslations("boqs.edits");
  const codeEditorLabel = te("codeCell");
  const firstCell = useRef<EditableColumn | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
  }, []);
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-level={depth + 1}
      aria-selected={selected}
      className={cn(
        "absolute top-0 left-0 grid w-full min-w-fit cursor-pointer border-b border-border hover:bg-muted/40",
        selected && "bg-[var(--selection)] shadow-[inset_3px_0_0_var(--link)]",
        line.excluded && "text-muted-foreground line-through",
        line.pending && "italic",
        over && "shadow-[inset_0_-2px_0_var(--link)]",
        // Someone else is editing this line (F06 §14): an ink marker, with the name on hover (orange is for "to confirm", P43).
        editingBy && "shadow-[inset_3px_0_0_var(--foreground)]",
      )}
      title={editingBy}
      data-editing-by={editingBy}
      style={{ gridTemplateColumns: template, height: ROW, transform: `translateY(${top}px)` }}
      // A click selects the line, which opens its detail and narrows the grid. On a line not selected yet
      // that waits out the double-click time, so the second click of a double-click lands on the same cell
      // and edits it (TF-104); the cell is the one the first click was on.
      onMouseDown={(e) => {
        if (e.detail <= 1) firstCell.current = ((e.target as HTMLElement).closest<HTMLElement>("[data-editable-column]")?.dataset.editableColumn as EditableColumn | undefined) ?? null;
      }}
      onClick={(e) => {
        if (e.detail > 1) return;
        if (selected || !canEdit || !firstCell.current) return api.click(line.key);
        if (clickTimer.current) clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(() => api.click(line.key), DOUBLE_CLICK_MS);
      }}
      onDoubleClick={() => {
        if (clickTimer.current) clearTimeout(clickTimer.current);
        clickTimer.current = null;
        const column = firstCell.current;
        api.click(line.key);
        if (canEdit && column) api.startEdit(line.key, column);
      }}
      draggable={canEdit && !editingColumn}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, line.key);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!editable || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const from = e.dataTransfer.getData(DRAG_TYPE);
        if (from) api.drop(from, { line: line.key });
      }}
      data-testid="sheet-line"
      data-key={line.key}
      data-source={line.source}
      data-edited={line.edit ? line.edit.fields.join(" ") : undefined}
      data-excluded={line.excluded ? "true" : undefined}
      data-pending={line.pending ? "true" : undefined}
    >
      {editable && (
        <div role="gridcell" className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {canEdit && <GripVertical aria-hidden className="size-3 shrink-0 cursor-grab text-muted-foreground" />}
          <input
            type="checkbox"
            // One Tab stop for the grid (TF-161): Space ticks the selected line; each box is named by its line.
            tabIndex={-1}
            aria-label={te("selectLine", { line: line.description })}
            checked={checked}
            disabled={line.pending}
            onChange={() => {}}
            onClick={(e) => api.check(line.key, e.shiftKey)}
            className="accent-[var(--link)]"
            data-testid="line-check"
          />
        </div>
      )}
      {columns.map((c) => {
        const field = c.editable ? FIELD_OF[c.editable] : undefined;
        const edited = !!field && !!line.edit?.fields.includes(field) && (field !== "codes" || !!c.engine?.(line));
        const active = canEdit && !!c.editable && c.editable === activeColumn;
        if (editingColumn && c.editable === editingColumn) {
          return (
            <div key={c.id} role="gridcell" className="flex items-center px-0.5" onClick={(e) => e.stopPropagation()}>
              {c.editable === "item" ? (
                <SearchPicker items={codeItems} value={undefined} onPick={(v) => api.commitEdit(line.key, "item", v)} onDismiss={api.cancelEdit} autoFocus portal label={codeEditorLabel} empty="—" className="min-w-0 flex-1" data-testid="cell-editor" />
              ) : (
                <CellInput initial={c.editable === "quantity" ? (line.quantity === null ? "" : String(line.quantity)) : c.editable === "unit" ? line.unit : line.description} align={c.align} maxLength={c.editable === "description" ? LIMITS.lineText : undefined} onCommit={(v) => api.commitEdit(line.key, c.editable!, v)} onCancel={api.cancelEdit} />
              )}
            </div>
          );
        }
        return (
          <div
            key={c.id}
            role="gridcell"
            className={cn("relative flex items-center truncate px-2", c.align === "right" && "justify-end tabular-nums", active && "outline-2 -outline-offset-2 outline-[var(--link)]", edited && "after:absolute after:top-1 after:right-1 after:size-1.5 after:rounded-full after:bg-change")}
            style={c.id === "description" ? { paddingLeft: `${0.5 + depth}rem` } : undefined}
            title={edited ? c.engine?.(line) : undefined}
            data-editable-column={canEdit ? c.editable : undefined}
            data-edited={edited ? "true" : undefined}
            data-active={active ? "true" : undefined}
            aria-selected={c.editable ? active : undefined}
            data-column={c.id}
          >
            <span className="truncate" title={c.id === "description" ? String(c.cell(line) ?? "") : undefined}>{c.cell(line)}</span>
            {c.id === "description" && line.pending && <span className="label-caps ml-2 shrink-0 not-italic text-muted-foreground">{pendingLabel}</span>}
          </div>
        );
      })}
    </div>
  );
});

/** An in-place cell editor: Enter or leaving the cell saves, Escape cancels. */
function CellInput({ initial, align, maxLength, onCommit, onCancel }: { initial: string; align?: "right"; maxLength?: number; onCommit: (value: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(value);
    else onCancel();
  };
  return (
    <input
      autoFocus
      maxLength={maxLength}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        // preventDefault: the same Enter must not submit the reason dialog that opens (it has the old reason).
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") finish(false);
        e.stopPropagation();
      }}
      className={cn("h-7 w-full min-w-0 rounded-[var(--radius)] border border-[var(--link)] bg-background px-1.5 outline-none", align === "right" && "text-right tabular-nums")}
      data-testid="cell-editor"
    />
  );
}
