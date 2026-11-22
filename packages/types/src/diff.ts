import type { BoqLine } from "./engine";

export type Change = "added" | "removed" | "changed";
export type ChangeCause = "elements_added" | "elements_removed" | "elements_changed"
  | "rules_changed" | "decision_changed" | "override_changed";

type LineSnapshot = Pick<BoqLine, "quantity" | "unit" | "description" | "codes"> & {
  /** Only on a line whose quantity is edited: the engine's value under the edit (BR-09). A change of it lists the line. */
  engineQuantity?: number | null;
};

export interface LineChange {
  lineKey: string;
  change: Change;
  before?: LineSnapshot;
  after?: LineSnapshot;
  delta: number | null;
  deltaPct: number | null;
  causes: ChangeCause[];
}

export interface ElementChange {
  guid: string;
  model: string;
  change: Change;
  fields: string[];
  lineKeys: string[];
}

export interface DiffSummary {
  linesAdded: number;
  linesRemoved: number;
  linesChanged: number;
  linesUnchanged: number;
  elementsAdded: number;
  elementsRemoved: number;
  elementsChanged: number;
  questionsNew: number;
  questionsResolved: number;
  guidChurnWarning: boolean;
  inputsChanged: string[];
  byModel: { model: string; added: number; removed: number; changed: number }[];
}

/** Full worker artifact. The API stores relation IDs and pages these arrays. */
export interface RunDiff {
  summary: DiffSummary;
  questions: { new: string[]; resolved: string[] };
  lines: LineChange[];
  elements: ElementChange[];
}
