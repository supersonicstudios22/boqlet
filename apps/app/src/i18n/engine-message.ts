"use client";

import { useFormatter, useTranslations } from "next-intl";
import { displayUnit } from "@/features/boq-sheet/model";
import { useUnit } from "@/i18n/units";

/** A question, warning or log entry as the engine writes it (EN-004): a stable code, its params, and an English fallback. */
export type EngineMessage = { code?: string | null; params?: Record<string, unknown> | null; message: string };

/** The rendered text, and whether it came from the catalogue (`key`) or the engine's English (`fallback`). */
export type RenderedMessage = { text: string; source: "key" | "fallback" };

type Translate = { (key: string, values?: Record<string, string | number>): string; has(key: string): boolean };
type Format = { number(value: number, options?: Intl.NumberFormatOptions): string; list(value: Iterable<string>, options?: Intl.ListFormatOptions): string };

/**
 * Values a message needs that the engine's params carry only in raw form. Each one is computed here
 * so that the catalogue text stays plain ICU.
 */
const DERIVED: Record<string, (p: Record<string, unknown>, format: Format, t: Translate) => Record<string, string | number>> = {
  "question.contradiction": (p, format) => {
    const lo = Number(p.minDifference ?? 0);
    const hi = Number(p.maxDifference ?? lo);
    const pct = (v: number) => format.number(v, { style: "percent", maximumFractionDigits: 0, signDisplay: "always" });
    const reported = Number(p.reported);
    const geometry = Number(p.geometry);
    // the example's own difference (review C-15): the geometry against the file
    const example = reported ? geometry / reported - 1 : lo;
    // runs before WP-A1 have neither: the stated value was always used
    const used = p.used === "geometry" ? "geometry" : "reported";
    return {
      minPercent: pct(lo), maxPercent: pct(hi), examplePercent: pct(Number.isFinite(example) ? example : lo),
      same: Math.abs(hi - lo) < 0.005 || Number(p.count ?? 1) <= 1 ? "true" : "false",
      used, unitError: p.unitError === true ? "true" : "false",
      joins: used === "reported" && p.quantity === "volume" && p.unitError !== true ? "true" : "false",
      scale: typeof p.scale === "string" ? p.scale : "",
    };
  },
  "question.double_claim": (p) => ({ ruleCount: Array.isArray(p.rules) ? p.rules.length : 0 }),
  double_count: (p) => ({ ruleCount: Array.isArray(p.rules) ? p.rules.length : 0 }),
  // Copies of one GlobalId in several models that disagree (review A-18): what differs, and each copy's values.
  "question.duplicate_conflict": (p, format, t) => {
    const fields = Array.isArray(p.fields) ? p.fields.map(String) : [];
    const label = (f: string) => (t.has(`field.${f}`) ? t(`field.${f}`) : f);
    const key: Record<string, [string, string?]> = {
      class: ["ifcClass"], type: ["typeName"], material: ["material"],
      thickness: ["thickness", "m"], volume: ["volume", "m3"], area: ["area", "m2"], length: ["length", "m"],
    };
    const value = (c: Record<string, unknown>, f: string) => {
      const [name, unit] = key[f] ?? [f];
      const v = c[name];
      if (typeof v === "number") return `${format.number(v, { maximumFractionDigits: 3 })}${unit ? ` ${displayUnit(unit)}` : ""}`;
      return typeof v === "string" && v ? (f === "class" ? v : `“${v}”`) : "–";
    };
    const copies = Array.isArray(p.copies) ? (p.copies as Record<string, unknown>[]) : [];
    return {
      fieldList: format.list(fields.map(label), { type: "conjunction" }),
      copyList: copies.map((c) => `${String(c.model ?? "")} ${fields.map((f) => value(c, f)).join(", ")}`).join("; "),
    };
  },
  // An edit moving a line to a code not in the list is not applied (BR-09, TF-052).
  unknown_code: (p) => ({ kind: p.edit === true ? "edit" : p.mapRuleId ? "rule" : "line" }),
  item_text_blank: (p) => ({ blankRef: `{${String(p.blank ?? "")}}` }),
  // Plausibility warnings (review A-07, A-08): an absent width or wall reads "none" for the catalogue's select.
  implausible: (p, format) => ({ width: typeof p.width === "number" ? format.number(p.width) : "none" }),
  unhosted_opening: (p) => ({ wall: typeof p.wall === "string" && p.wall ? p.wall : "none" }),
};

/** Params as ICU values: lists in the user's language, booleans for `select`, units with superscripts, empty for null. */
function values(code: string, params: Record<string, unknown>, format: Format, t: Translate): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [name, v] of Object.entries(params)) {
    if (v === null || v === undefined) out[name] = "";
    else if (typeof v === "number") out[name] = v;
    else if (typeof v === "boolean") out[name] = v ? "true" : "false";
    else if (Array.isArray(v)) out[name] = format.list(v.map(String), { type: "conjunction" });
    else if (typeof v === "string") out[name] = name === "unit" ? displayUnit(v) : v;
    else out[name] = JSON.stringify(v);
  }
  return { ...out, ...(DERIVED[code]?.(params, format, t) ?? {}) };
}

/**
 * Unit symbols inside an engine text ("4.9364 m3", "-> 11 m2", "kg/m3") written as the sheet writes them
 * (m³, m², kg/m³; review C-11): a symbol standing alone, not part of a name or a GlobalId.
 */
const UNIT_TOKEN = /(?<![\w.$])(?:mm|cm|km|m|ft|yd|in)[23](?![\w$])/g;

export function labelUnits(text: string, unitLabel: (unit: string) => string = displayUnit): string {
  return text.replace(UNIT_TOKEN, (unit) => unitLabel(unit));
}

/**
 * An engine message in the user's language (F15 §4): `engine.{code}` with its params when the
 * catalogue has the key, else the engine's English `message`. Messages from runs before EN-004 have
 * no code and always use the fallback.
 */
export function renderEngineMessage(t: Translate, format: Format, m: EngineMessage, unitLabel?: (unit: string) => string): RenderedMessage {
  const code = m.code;
  const fallback = (): RenderedMessage => ({ text: labelUnits(m.message, unitLabel), source: "fallback" });
  if (!code || !t.has(code)) return fallback();
  try {
    const text = t(code, values(code, m.params ?? {}, format, t));
    // A param the text needs is missing (an older engine): next-intl reports it and returns the key.
    if (text === code || text === `engine.${code}`) return fallback();
    return { text: labelUnits(text, unitLabel), source: "key" };
  } catch {
    return fallback();
  }
}

/** The message with `params.system` (a classification id) as its name, when known (TF-110). */
export function withSystemName<M extends EngineMessage>(m: M, names: ReadonlyMap<string, string>): M {
  const id = m.params?.system;
  const name = typeof id === "string" ? names.get(id) : undefined;
  return name ? { ...m, params: { ...m.params, system: name } } : m;
}

/** `renderEngineMessage` with the current language. */
export function useEngineMessage(): (m: EngineMessage) => RenderedMessage {
  const t = useTranslations("engine") as unknown as Translate;
  const format = useFormatter() as unknown as Format;
  const unitLabel = useUnit();
  return (m) => renderEngineMessage(t, format, m, unitLabel);
}
