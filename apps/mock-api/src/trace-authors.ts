/**
 * The engine writes each line's `trace.steps` (EN-013), with an `edit` step for a line whose quantity
 * was edited. It doesn't know people: the mock adds the edit's author's name (`params.by`, F06 §5).
 */
import type { BoqResult } from "@ifc-boq/types";

/** Who made a line's quantity edit (the override's author), by line key. */
export type EditAuthors = (lineKey: string) => string | undefined;

export function addEditAuthors(result: BoqResult, authors: EditAuthors) {
  for (const line of result.lines) {
    const edits = (line.trace.steps ?? []).filter((step) => step.kind === "edit");
    if (!edits.length) continue;
    const by = authors(line.key);
    if (by) for (const step of edits) step.params.by = by;
  }
}
