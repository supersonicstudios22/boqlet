/**
 * Item texts (F10 §13, P14, BR-11): a code's `description` is the written description of the BoQ
 * item that is priced, a template with blanks (`{thickness}`, `{thickness*1000}`, `{expr: …}`, the
 * same syntax as a rule's line text). The engine fills them (BR-01), in a run and for the editor's
 * "Reads as" and samples too (`useItemTextSample`, review B-13): nothing here splits or fills a template.
 */
import type { ClassificationMap } from "@ifc-boq/types";
import type { PreviewResult } from "@/api/hooks/library";
import { LINE_SPLITS } from "../shared/vocab";
import { outcomeFor, sourceCode, type LineKind } from "./model";

/**
 * A preview line. `codes`: each classification's code and item text as the engine filled it (TF-136;
 * optional until every engine sends it).
 */
export type PreviewLine = PreviewResult["lines"][number] & { codes?: Record<string, { code?: string; text?: string | null } | undefined> };

/** The names an item text's insert buttons offer: the values a line can carry, its unit and quantity. */
export const ITEM_TEXT_NAMES: readonly string[] = [...LINE_SPLITS, "unit", "quantity"];

/** The item text the engine filled for `code` in a line of the preview, when the line got that code (TF-136). */
export function engineText(line: PreviewLine, systemId: string, code: string): string | undefined {
  const c = line.codes?.[systemId];
  return c && c.code === code && typeof c.text === "string" ? c.text : undefined;
}

/**
 * Put `{name}` in place of the selection (or at the cursor), with a space before it when it would
 * stick to a word. Returns the new text and where the cursor goes.
 */
export function insertBlank(text: string, name: string, start = text.length, end = start): { text: string; caret: number } {
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  const before = text.slice(0, a);
  const piece = `${before && !/[\s(]$/.test(before) ? " " : ""}{${name}}`;
  return { text: before + piece + text.slice(b), caret: a + piece.length };
}

/**
 * The code lines of one BoQ item get for sure (the rule every line of it falls to), following
 * "same as its source" one step for calculated items. Conditions are never evaluated, so a code
 * only some of its lines get (a split row) is not counted.
 */
export function codeForItem(map: ClassificationMap, kind: LineKind, kinds: LineKind[]): string | undefined {
  const base = outcomeFor(map, kind).base;
  if (!base) return undefined;
  if (typeof base.code === "string") return base.code || undefined;
  if ("fromSource" in base.code) return sourceCode(map, kind, kinds);
  return undefined;
}

/**
 * For each code, the first preview line that gets it (by its BoQ item: a map rule `{ruleId}` →
 * the code, or any other rule aimed at that item for sure). A line's item is looked up in `kinds`
 * (for its tags); an item the chosen rule set doesn't have is matched by its id alone.
 */
export function sampleLines(map: ClassificationMap, lines: PreviewLine[], kinds: LineKind[] = []): Map<string, PreviewLine> {
  const byId = new Map(kinds.map((k) => [k.id, k]));
  const codeOf = new Map<string, string | undefined>();
  const out = new Map<string, PreviewLine>();
  for (const line of lines) {
    if (!codeOf.has(line.ruleId)) {
      const kind = byId.get(line.ruleId) ?? { id: line.ruleId, label: line.ruleId, group: "item", tags: [] };
      codeOf.set(line.ruleId, codeForItem(map, kind, kinds));
    }
    const code = codeOf.get(line.ruleId);
    if (code && !out.has(code)) out.set(code, line);
  }
  return out;
}

/** The first preview line of each BoQ item. */
export function firstLineByItem(lines: PreviewLine[]): Map<string, PreviewLine> {
  const out = new Map<string, PreviewLine>();
  for (const line of lines) if (!out.has(line.ruleId)) out.set(line.ruleId, line);
  return out;
}
