"use client";

import { useFormatter, useTranslations } from "next-intl";
import { displayUnit } from "@/features/boq-sheet/model";

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
const DERIVED: Record<string, (p: Record<string, unknown>, format: Format) => Record<string, string | number>> = {
  "question.contradiction": (p, format) => {
    const lo = Number(p.minDifference ?? 0);
    const hi = Number(p.maxDifference ?? lo);
    const pct = (v: number) => format.number(v, { style: "percent", maximumFractionDigits: 0, signDisplay: "always" });
    return { minPercent: pct(lo), maxPercent: pct(hi), same: Math.abs(hi - lo) < 0.005 ? "true" : "false" };
  },
  "question.double_claim": (p) => ({ ruleCount: Array.isArray(p.rules) ? p.rules.length : 0 }),
  // An edit moving a line to a code not in the list is not applied (BR-09, TF-052).
  unknown_code: (p) => ({ kind: p.edit === true ? "edit" : p.mapRuleId ? "rule" : "line" }),
  item_text_blank: (p) => ({ blankRef: `{${String(p.blank ?? "")}}` }),
};

/** Params as ICU values: lists in the user's language, booleans for `select`, units with superscripts, empty for null. */
function values(code: string, params: Record<string, unknown>, format: Format): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [name, v] of Object.entries(params)) {
    if (v === null || v === undefined) out[name] = "";
    else if (typeof v === "number") out[name] = v;
    else if (typeof v === "boolean") out[name] = v ? "true" : "false";
    else if (Array.isArray(v)) out[name] = format.list(v.map(String), { type: "conjunction" });
    else if (typeof v === "string") out[name] = name === "unit" ? displayUnit(v) : v;
    else out[name] = JSON.stringify(v);
  }
  return { ...out, ...(DERIVED[code]?.(params, format) ?? {}) };
}

/**
 * An engine message in the user's language (F15 §4): `engine.{code}` with its params when the
 * catalogue has the key, else the engine's English `message`. Messages from runs before EN-004 have
 * no code and always use the fallback.
 */
export function renderEngineMessage(t: Translate, format: Format, m: EngineMessage): RenderedMessage {
  const code = m.code;
  if (!code || !t.has(code)) return { text: m.message, source: "fallback" };
  try {
    const text = t(code, values(code, m.params ?? {}, format));
    // A param the text needs is missing (an older engine): next-intl reports it and returns the key.
    if (text === code || text === `engine.${code}`) return { text: m.message, source: "fallback" };
    return { text, source: "key" };
  } catch {
    return { text: m.message, source: "fallback" };
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
  return (m) => renderEngineMessage(t, format, m);
}
