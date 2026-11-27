/**
 * The sheet's layout choices (review C-06, DEC-46): row density, the "Wrap text" clamp and column widths.
 * Density and wrapping are the user's (server-side preferences, like the model pane, D113); column widths
 * are per BoQ in this browser, because they follow the BoQ's own text lengths. Pure functions, no React.
 */

export type Density = "compact" | "default" | "comfortable";
export const DENSITIES: readonly Density[] = ["compact", "default", "comfortable"];

/** Row heights per density (design guidelines "Density": 28 / 32 / 36 px, the `--row-height*` tokens). */
const ROW_HEIGHT: Record<Density, number> = { compact: 28, default: 32, comfortable: 36 };

export function rowHeight(density: Density | undefined): number {
  return ROW_HEIGHT[density ?? "default"] ?? ROW_HEIGHT.default;
}

/** The selected row: its description wraps to two lines (review C-03), so it is a line of text taller. */
export function selectedRowHeight(density: Density | undefined): number {
  return rowHeight(density) + 20;
}

/** The least and most a column can be dragged to (px). */
export const COLUMN_WIDTH = { min: 48, max: 800 } as const;

export type ColumnWidths = Readonly<Record<string, number>>;

const storageKey = (boqId: string) => `boqlet.sheet.columns.${boqId}`;

export function clampWidth(width: number): number {
  return Math.round(Math.min(COLUMN_WIDTH.max, Math.max(COLUMN_WIDTH.min, width)));
}

/** The widths saved for a BoQ in this browser; anything unreadable or out of range is dropped. */
export function readColumnWidths(boqId: string, storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): ColumnWidths {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(storageKey(boqId)) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, w]) => typeof w === "number" && Number.isFinite(w)).map(([id, w]) => [id, clampWidth(w as number)]));
  } catch {
    return {};
  }
}

/** Saves a BoQ's widths; an empty set removes the entry (Columns › Reset widths). */
export function saveColumnWidths(boqId: string, widths: ColumnWidths, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = globalThis.localStorage) {
  try {
    if (Object.keys(widths).length === 0) storage?.removeItem(storageKey(boqId));
    else storage?.setItem(storageKey(boqId), JSON.stringify(widths));
  } catch {
    // Storage full or blocked: the widths last for this visit only.
  }
}

/** A column's CSS grid width: the dragged width when there is one, else its default track. */
export function columnTrack(id: string, fallback: string, widths: ColumnWidths): string {
  const w = widths[id];
  return w === undefined ? fallback : `${w}px`;
}

/**
 * Double-click on a column's edge (auto-fit): the widest of the rendered cells' content and the header,
 * plus the cell padding, within the limits.
 */
export function fitWidth(contentWidths: readonly number[], padding = 16): number {
  return clampWidth(Math.max(0, ...contentWidths) + padding);
}
