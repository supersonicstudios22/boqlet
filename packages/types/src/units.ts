/**
 * The unit registry (review A-28): every unit a BoQ line, a quantity or a manual item may be stated in, with what
 * it measures and its factor from SI. One table for the engine (`npm run codegen` writes
 * engine/ifc_boq/data/units.json) and the app's labels (`apps/app/messages/<locale>/units.json`, keyed by the
 * same ids). Ids are language-neutral keys; the app shows each in the user's language.
 *
 * The engine measures in SI (m, m2, m3, kg, nr); a line's value in a unit = the SI value x `perSi`.
 * `presets.check` refuses a unit that is not here, and one of the wrong dimension for its quantity
 * (cm on an area, l on a length); a run of an older preset with such a unit warns (`rule_set`).
 */

export type Dimension =
  | "count"     // pieces: nr
  | "lump"      // an item or sum priced as one: item, sum
  | "time"      // daywork: h
  | "length"
  | "area"
  | "volume"
  | "mass";

export interface UnitInfo {
  dimension: Dimension;
  /** The value in this unit of 1 SI unit of its dimension (m, m2, m3, kg; 1 for count, lump and time). */
  perSi: number;
}

export const UNITS = {
  nr: { dimension: "count", perSi: 1 },
  item: { dimension: "lump", perSi: 1 },
  sum: { dimension: "lump", perSi: 1 },
  h: { dimension: "time", perSi: 1 },
  mm: { dimension: "length", perSi: 1000 },
  cm: { dimension: "length", perSi: 100 },
  m: { dimension: "length", perSi: 1 },
  km: { dimension: "length", perSi: 0.001 },
  in: { dimension: "length", perSi: 39.37007874 },
  ft: { dimension: "length", perSi: 3.280839895 },
  yd: { dimension: "length", perSi: 1.093613298 },
  mm2: { dimension: "area", perSi: 1_000_000 },
  cm2: { dimension: "area", perSi: 10_000 },
  m2: { dimension: "area", perSi: 1 },
  ft2: { dimension: "area", perSi: 10.7639104 },
  yd2: { dimension: "area", perSi: 1.19599005 },
  l: { dimension: "volume", perSi: 1000 },
  m3: { dimension: "volume", perSi: 1 },
  ft3: { dimension: "volume", perSi: 35.3146667 },
  yd3: { dimension: "volume", perSi: 1.30795062 },
  g: { dimension: "mass", perSi: 1000 },
  kg: { dimension: "mass", perSi: 1 },
  t: { dimension: "mass", perSi: 0.001 },
  lb: { dimension: "mass", perSi: 2.20462262 },
} as const satisfies Record<string, UnitInfo>;

export type RegisteredUnit = keyof typeof UNITS;

/** What each quantity kind measures; `formula`, derived and manual quantities may use any registered unit. */
export const KIND_DIMENSION = {
  count: "count",
  length: "length",
  perimeter: "length",
  area: "area",
  volume: "volume",
  mass: "mass",
} as const satisfies Record<string, Dimension>;
