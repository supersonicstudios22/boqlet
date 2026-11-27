/**
 * The sheet's rows, built client-side from a run's lines (F06 §1–4): filtered, grouped by one
 * classification's code path with subtotals, lines without a code in that system last under
 * "Unclassified" (never hidden, BR-03). Lines carry their current edits (`edits.ts`): excluded lines
 * stay listed but leave the subtotals, and edits' order applies within each section.
 * Pure functions: no React, no formatting.
 */
import { orderSection, type SheetLine } from "./edits";

export type Source = "measured" | "derived" | "manual" | "flagged";

/**
 * The source the sheet shows (review A-05): a measured or derived line the engine marks `toConfirm`
 * (some elements without a value, or a quantity resting on an open contradiction) reads "To confirm",
 * is found by the "to confirm" filter and counts there, like a line without a quantity.
 */
export function shownSource(l: { source: Source; toConfirm?: unknown }): Source {
  return l.toConfirm && (l.source === "measured" || l.source === "derived") ? "flagged" : l.source;
}
/** The source filter also lists edited and excluded lines (F06 §4, §6). */
export type SourceFilter = Source | "edited" | "excluded";

export interface SheetFilters {
  source?: SourceFilter;
  storey?: string;
  family?: string;
  /** Engine model id (as in the trace's elements). */
  model?: string;
  q?: string;
  /** Top-level code in the Group-by system (`UNCLASSIFIED` for lines without one), F07 §9. */
  group?: string;
  /** Only these lines ("only these lines" from a selection in the model, F07 §9). */
  keys?: ReadonlySet<string>;
}

export interface GroupRow {
  kind: "group";
  id: string;
  depth: number;
  code: string;
  /** null for the "Unclassified" / "No storey" group and the built-in extra sections (the UI names them). */
  title: string | null;
  /** A storey or rule section (review C-07): it has no code of its own to show or move lines to. */
  builtIn?: boolean;
  lineCount: number;
  /** Set when every line under the group has the same unit. */
  unit: string | null;
  quantity: number | null;
  collapsed: boolean;
}
export interface LineRow {
  kind: "line";
  id: string;
  depth: number;
  line: SheetLine;
}
export type Row = GroupRow | LineRow;

export const UNCLASSIFIED = "~unclassified";

/**
 * Built-in groupings (review C-07, DEC-58): by storey and by the rule that measured the line ("measured as"), so a
 * BoQ without a classification still reads in sections. A view only (rule 6); the Excel's `groupBy` takes the same
 * values (`export_xlsx.py`). They start with "~", which no classification id the app offers does.
 */
export const GROUP_STOREY = "~storey";
export const GROUP_RULE = "~rule";
export type BuiltInGrouping = typeof GROUP_STOREY | typeof GROUP_RULE;
export const isBuiltInGrouping = (grouping: string | null | undefined): grouping is BuiltInGrouping => grouping === GROUP_STOREY || grouping === GROUP_RULE;
/** The built-in sections besides storeys and rules: a line on several storeys, a line added by hand. */
export const SEVERAL_STOREYS = "~several";
export const MANUAL_LINES = "~manual";

/** The code system a grouping shows codes and item texts of: the grouping one, or the first one under a built-in grouping. */
export function codeSystemOf(grouping: string | null, systems: readonly { id: string }[]): string | null {
  return isBuiltInGrouping(grouping) ? (systems[0]?.id ?? null) : grouping;
}

type Segment = { code: string; title: string | null };

/**
 * The sections a line goes under (the Excel's `section_path`): its code path in the grouping classification, or one
 * storey or rule section; empty for the "none" section (Unclassified, or No storey).
 */
export function groupPath(l: Pick<SheetLine, "codes" | "location" | "ruleId" | "ruleKind">, grouping: string | null, ruleLabels?: ReadonlyMap<string, string>): Segment[] {
  if (!grouping) return [];
  if (grouping === GROUP_STOREY) {
    const storeys = l.location?.storeys ?? [];
    const storey = l.location?.storey ?? (storeys.length === 1 ? storeys[0] : undefined);
    if (storey) return [{ code: storey, title: storey }];
    return storeys.length ? [{ code: SEVERAL_STOREYS, title: null }] : [];
  }
  if (grouping === GROUP_RULE) {
    if (l.ruleKind === "manual") return [{ code: MANUAL_LINES, title: null }];
    return [{ code: l.ruleId, title: ruleLabels?.get(l.ruleId) ?? l.ruleId }];
  }
  return (l.codes[grouping]?.path ?? []).map((p) => ({ code: p.code, title: p.title }));
}

/**
 * What the Description column shows (F06 §2, P14): the line's item text in the Group-by system when its
 * code has one, else the rule set's line text; a description edited on the line wins over both.
 */
export function shownDescription(l: Pick<SheetLine, "description" | "codes" | "edit">, system: string | null): string {
  if (l.edit?.fields.includes("description")) return l.description;
  return (system && l.codes[system]?.text) || l.description;
}

export function filterLines(lines: SheetLine[], f: SheetFilters, system: string | null = null): SheetLine[] {
  const q = f.q?.trim().toLowerCase();
  const group = system ? f.group : undefined;
  if (!f.source && !f.storey && !f.family && !f.model && !q && !group && !f.keys) return lines;
  return lines.filter((l) => {
    if (f.keys && !f.keys.has(l.key)) return false;
    if (group && (l.codes[system!]?.path[0]?.code ?? UNCLASSIFIED) !== group) return false;
    if (f.source === "edited" ? !l.edit : f.source === "excluded" ? !l.excluded : f.source && shownSource(l) !== f.source) return false;
    if (f.storey && l.location?.storey !== f.storey && !l.location?.storeys?.includes(f.storey)) return false;
    if (f.family && l.family !== f.family) return false;
    if (f.model && !l.trace.elements.some((e) => e.model === f.model)) return false;
    if (q && !l.description.toLowerCase().includes(q) && !Object.values(l.codes).some((c) => c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q) || !!c.text?.toLowerCase().includes(q))) return false;
    return true;
  });
}

/** The lines under a group row (its id is the code path joined by "/"), F07 §9 "Groups". */
export function linesInGroup(lines: readonly SheetLine[], system: string | null, groupId: string): string[] {
  if (!system) return [];
  return lines
    .filter((l) => {
      const path = groupPath(l, system).map((p) => p.code);
      if (groupId === UNCLASSIFIED) return path.length === 0;
      // A storey or rule section is one level, and its name may hold a "/".
      if (isBuiltInGrouping(system)) return path[0] === groupId;
      const id = groupId.split("/");
      return id.every((code, i) => path[i] === code);
    })
    .map((l) => l.key);
}

/** Top-level groups of a system, for the code-group filter. */
export function topGroups(lines: readonly SheetLine[], system: string | null) {
  if (!system) return [];
  const out = new Map<string, string>();
  for (const l of lines) {
    const top = l.codes[system]?.path[0];
    out.set(top?.code ?? UNCLASSIFIED, top ? `${top.code} ${top.title}` : "");
  }
  return [...out].sort(([a], [b]) => (a === UNCLASSIFIED ? 1 : b === UNCLASSIFIED ? -1 : a.localeCompare(b, undefined, { numeric: true }))).map(([code, label]) => ({ code, label }));
}

/** Distinct values for the filter menus. */
export function facets(lines: SheetLine[]) {
  const storeys = new Set<string>();
  const families = new Set<string>();
  const models = new Set<string>();
  for (const l of lines) {
    if (l.location?.storey) storeys.add(l.location.storey);
    for (const s of l.location?.storeys ?? []) storeys.add(s);
    if (l.family) families.add(l.family);
    for (const e of l.trace.elements) if (e.model) models.add(e.model);
  }
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { storeys: sorted(storeys), families: sorted(families), models: sorted(models) };
}

interface Node {
  /** Creation order: rule sections keep the rule set's order (the order their lines come in). */
  seq: number;
  id: string;
  code: string;
  title: string | null;
  children: Map<string, Node>;
  lines: SheetLine[];
  /** The lines in the group's totals: its own and its subgroups', without excluded lines. */
  members: SheetLine[];
}

const node = (id: string, code: string, title: string | null, seq = 0): Node => ({ seq, id, code, title, children: new Map(), lines: [], members: [] });

/**
 * A group's subtotal (BR-63, the same definition as the grouped `/lines` view and the Excel): the count of
 * the lines in the totals, their unit when they share one, and the sum of their quantities when they share
 * a unit and at least one is measured. Excluded lines are out of all three; a group with nothing measured
 * has no sum, because "0" would read as a quantity. Vectors: `fixtures/subtotals.json`.
 */
export function subtotal(lines: readonly { unit: string; quantity: number | null; excluded?: boolean }[]) {
  const included = lines.filter((l) => !l.excluded);
  const units = new Set(included.map((l) => l.unit));
  const unit = units.size === 1 ? [...units][0]! : null;
  const measured = included.filter((l) => l.quantity !== null);
  const quantity = unit !== null && measured.length > 0 ? measured.reduce((sum, l) => sum + l.quantity!, 0) : null;
  return { count: included.length, unit, quantity };
}
const byCode = (a: Node, b: Node) => (a.id === UNCLASSIFIED ? 1 : b.id === UNCLASSIFIED ? -1 : a.code.localeCompare(b.code, undefined, { numeric: true }));
/** Built-in sections: storeys in natural order, rules in the order they come; the extra sections next to last. */
const byBuiltIn = (grouping: BuiltInGrouping) => (a: Node, b: Node) => {
  const rank = (n: Node) => (n.id === UNCLASSIFIED ? 2 : n.code.startsWith("~") ? 1 : 0);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  return grouping === GROUP_RULE ? a.seq - b.seq : a.code.localeCompare(b.code, undefined, { numeric: true });
};

/** The columns a header click sorts by (review C-06, DEC-46). */
export type SortColumn = "item" | "description" | "unit" | "quantity" | "storey" | "family";
export interface SheetSort {
  column: SortColumn;
  dir: "asc" | "desc";
}

/** A header click: ascending, then descending, then the sheet's own order again. */
export function nextSort(current: SheetSort | null, column: SortColumn): SheetSort | null {
  if (current?.column !== column) return { column, dir: "asc" };
  return current.dir === "asc" ? { column, dir: "desc" } : null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortValue(l: SheetLine, column: SortColumn, system: string | null): string | number | undefined {
  switch (column) {
    case "item":
      return system ? l.codes[system]?.code : undefined;
    case "description":
      return shownDescription(l, system);
    case "unit":
      return l.unit;
    case "quantity":
      return l.quantity ?? undefined;
    case "storey":
      return l.location?.storey ?? l.location?.storeys?.[0];
    case "family":
      return l.family;
  }
}

/**
 * The order a sorted column gives (review C-06): numbers by value, text in natural order ("2.10" after "2.9"),
 * ignoring case; lines without a value last in both directions, so "biggest quantities first" never starts
 * with the lines still to confirm. Equal values keep the sheet's order (the sort is stable).
 */
export function compareLines(sort: SheetSort, system: string | null) {
  const sign = sort.dir === "asc" ? 1 : -1;
  return (a: SheetLine, b: SheetLine) => {
    const x = sortValue(a, sort.column, system);
    const y = sortValue(b, sort.column, system);
    if (x === undefined || x === "") return y === undefined || y === "" ? 0 : 1;
    if (y === undefined || y === "") return -1;
    return sign * (typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y)));
  };
}

/** A section's lines in the sheet's order (edits' moves applied), then by the sorted column when there is one. */
function sectionOrder(lines: SheetLine[], sort: SheetSort | null, system: string | null): SheetLine[] {
  const out = orderSection(lines);
  return sort ? out.sort(compareLines(sort, system)) : out;
}

/**
 * Rows in display order. Without a system the lines are listed flat. Groups nest by the code path
 * (one level per path segment), each with its line count and, when the unit is shared, the sum.
 * A sort orders the lines inside each group; the groups keep their code order (review C-06).
 */
export function buildRows(
  lines: SheetLine[],
  grouping: string | null,
  collapsed: ReadonlySet<string> = new Set(),
  sort: SheetSort | null = null,
  /** `system`: whose codes and texts the sort reads (default: the grouping one); `ruleLabels` name the rule sections. */
  options: { system?: string | null; ruleLabels?: ReadonlyMap<string, string> } = {},
): Row[] {
  const system = options.system !== undefined ? options.system : isBuiltInGrouping(grouping) ? null : grouping;
  if (!grouping) return sectionOrder(lines, sort, system).map((line) => ({ kind: "line", id: line.key, depth: 0, line }));
  const builtIn = isBuiltInGrouping(grouping);
  const ordered = [...lines].sort((a, b) => a.sortIndex - b.sortIndex);
  const root = node("", "", null);
  for (const line of ordered) {
    const path = groupPath(line, grouping, options.ruleLabels);
    const chain: Node[] = [root];
    let at = root;
    if (path.length === 0) {
      let un = at.children.get(UNCLASSIFIED);
      if (!un) at.children.set(UNCLASSIFIED, (un = node(UNCLASSIFIED, "", null)));
      at = un;
      chain.push(at);
    } else {
      let id = "";
      for (const seg of path) {
        id = id ? `${id}/${seg.code}` : seg.code;
        let next = at.children.get(seg.code);
        if (!next) at.children.set(seg.code, (next = node(id, seg.code, seg.title, at.children.size)));
        at = next;
        chain.push(at);
      }
    }
    at.lines.push(line);
    // An excluded line stays listed but is out of the subtotal's count, unit and sum (F06 §6, BR-63).
    if (!line.excluded) for (const n of chain) n.members.push(line);
  }
  const rows: Row[] = [];
  const walk = (n: Node, depth: number) => {
    for (const child of [...n.children.values()].sort(builtIn ? byBuiltIn(grouping) : byCode)) {
      const total = subtotal(child.members);
      const isCollapsed = collapsed.has(child.id);
      rows.push({ kind: "group", id: child.id, depth, code: child.code, title: child.title, lineCount: total.count, unit: total.unit, quantity: total.quantity, collapsed: isCollapsed, ...(builtIn ? { builtIn: true } : {}) });
      if (isCollapsed) continue;
      for (const line of sectionOrder(child.lines, sort, system)) rows.push({ kind: "line", id: line.key, depth: depth + 1, line });
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** m2 → m², ft3 → ft³ (design guidelines: units with superscripts). */
export function displayUnit(unit: string): string {
  return unit.replace(/([a-z])2$/, "$1²").replace(/([a-z])3$/, "$1³");
}

/** Lines in the BoQ by source, for "120 measured · 8 derived · 3 manual · 2 to confirm" (F06 §12). Excluded lines are out of the BoQ. */
export function countsBySource(lines: readonly { source: Source; toConfirm?: unknown; excluded?: boolean }[]) {
  const counts = { measured: 0, derived: 0, manual: 0, flagged: 0 };
  for (const l of lines) if (!l.excluded) counts[shownSource(l)] += 1;
  return counts;
}

type TraceElement = { guid: string; decisions?: { questionId: string; answer: unknown; by?: string; at?: string }[] };

/** The decisions a step's elements rest on (review A-06), once each, with how many of the elements they decided. */
export function stepDecisions(elements: readonly TraceElement[]) {
  const out = new Map<string, NonNullable<TraceElement["decisions"]>[number] & { count: number }>();
  for (const e of elements)
    for (const d of e.decisions ?? []) {
      const seen = out.get(d.questionId);
      out.set(d.questionId, seen ? { ...seen, count: seen.count + 1 } : { ...d, count: 1 });
    }
  return [...out.values()];
}
