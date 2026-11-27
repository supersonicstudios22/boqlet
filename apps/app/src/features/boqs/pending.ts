/**
 * What the working version has that its current run doesn't (review C-08, DEC-38): the line edits and manual lines
 * saved since the run, worked out from the run's lines (which carry the edits they were generated with, in
 * `overridden`) and the BoQ's current edits. Only the engine computes, so these wait for the next run; the header
 * says so in one banner. Pure and tested.
 */
import type { LineOverride, ManualItemRecord } from "@/api/hooks/edits";
import type { RunLine } from "@/api/hooks/sheet";
import { editedFields, type EditField } from "@/features/boq-sheet/edits";

export type PendingEditKind = "changed" | "restored" | "added" | "removed";
export interface PendingEdit {
  key: string;
  description: string;
  kind: PendingEditKind;
  /** For a changed line: the fields its current edit sets. */
  fields?: EditField[];
}

const manualId = (line: Pick<RunLine, "ruleId">) => (line.ruleId.startsWith("boq.") ? line.ruleId.slice(4) : line.ruleId);

/** Whether the run already applied this edit: the same fields, and the line shows the edit's values. */
function applied(line: RunLine, o: LineOverride): boolean {
  const now = editedFields(o);
  const before = new Set(line.overridden?.fields ?? []);
  if (now.length !== before.size || now.some((f) => !before.has(f))) return false;
  if (o.quantity !== undefined && o.quantity !== line.quantity) return false;
  if (o.description !== undefined && o.description !== line.description) return false;
  if (o.unit !== undefined && o.unit !== line.unit) return false;
  if (Object.entries(o.codes ?? {}).some(([system, code]) => line.codes[system]?.code !== code)) return false;
  // A changed order can't be told from the run's line (its place is the backend's index): the same field counts as applied.
  return !!o.excluded === !!line.excluded;
}

export function notAppliedEdits(lines: readonly RunLine[], overrides: readonly LineOverride[], manual: readonly ManualItemRecord[]): PendingEdit[] {
  const out: PendingEdit[] = [];
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const current = new Map(overrides.map((o) => [o.lineKey, o]));
  for (const o of overrides) {
    const line = byKey.get(o.lineKey);
    // An edit of a line the run doesn't have is an `orphan_override` question, not a pending edit.
    if (!line || applied(line, o)) continue;
    out.push({ key: line.key, description: o.description ?? line.description, kind: "changed", fields: editedFields(o) });
  }
  for (const line of lines) if (line.overridden?.fields.length && !current.has(line.key)) out.push({ key: line.key, description: line.overridden.engineDescription ?? line.description, kind: "restored" });
  const records = new Map(manual.map((m) => [m.item.id, m]));
  const inRun = new Map(lines.filter((l) => l.ruleKind === "manual" && l.ruleId.startsWith("boq.")).map((l) => [manualId(l), l]));
  for (const m of manual) {
    const line = inRun.get(m.item.id);
    const description = typeof m.item.description === "string" ? m.item.description : m.item.id;
    if (!line) out.push({ key: m.item.id, description, kind: "added" });
    else {
      // Only what the run copies as it is: a templated text or a formula's quantity is the engine's to fill.
      const text = typeof m.item.description === "string" && !line.overridden?.fields.includes("description") ? m.item.description : undefined;
      const quantity = typeof m.item.quantity === "number" && !(m.item as { formula?: unknown }).formula && !line.overridden?.fields.includes("quantity") ? m.item.quantity : undefined;
      if ((text !== undefined && text !== line.description) || (quantity !== undefined && quantity !== line.quantity) || (!line.overridden?.fields.includes("unit") && m.item.unit !== line.unit))
        out.push({ key: line.key, description, kind: "changed" });
    }
  }
  for (const [id, line] of inRun) if (!records.has(id)) out.push({ key: line.key, description: line.description, kind: "removed" });
  return out;
}
