"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import type { Schemas } from "@ifc-boq/api";
import { useOrgScope } from "@/features/orgs/org-context";
import { useOptionalProjectScope } from "@/features/projects/project-context";

/**
 * BoQ values (quantities, deltas, their dates) in the firm's format (F15 §6, §11, P35, TF-021): the
 * org's decimal and thousands separators and date pattern, the project's locale. UI chrome (counts,
 * relative times) keeps the person's locale through next-intl's `useFormatter`.
 */
export interface BoqFormatSettings {
  numberFormat?: Schemas["OrgSettings"]["numberFormat"];
  dateFormat?: string;
  /** The project's locale (BCP 47); the UI's when absent or unusable. */
  locale?: string;
}

export interface BoqFormatter {
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  dateTime: (value: Date, options?: Intl.DateTimeFormatOptions) => string;
}

/** The default for new orgs (F15 §11, design-guidelines.md): a narrow no-break space. */
const DEFAULT_THOUSANDS = " ";

const usable = (locale: string | undefined, fallback: string) => {
  if (!locale) return fallback;
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length ? locale : fallback;
  } catch {
    return fallback;
  }
};

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** A date in a pattern such as `dd.MM.yyyy`, `yyyy-MM-dd` or `d/M/yy` (yyyy, yy, MM, M, dd, d). */
function datePattern(pattern: string, d: Date): string {
  return pattern.replace(/yyyy|yy|MM|M|dd|d/g, (token) => {
    switch (token) {
      case "yyyy":
        return pad(d.getFullYear(), 4);
      case "yy":
        return pad(d.getFullYear() % 100, 2);
      case "MM":
        return pad(d.getMonth() + 1, 2);
      case "M":
        return String(d.getMonth() + 1);
      case "dd":
        return pad(d.getDate(), 2);
      default:
        return String(d.getDate());
    }
  });
}

export function boqFormatter(uiLocale: string, settings: BoqFormatSettings): BoqFormatter {
  const locale = usable(settings.locale, uiLocale);
  const thousands = settings.numberFormat?.thousands ?? DEFAULT_THOUSANDS;
  const decimal = settings.numberFormat?.decimal;
  const numbers = new Map<string, Intl.NumberFormat>();
  const number = (value: number, options: Intl.NumberFormatOptions = {}) => {
    const key = JSON.stringify(options);
    let f = numbers.get(key);
    if (!f) numbers.set(key, (f = new Intl.NumberFormat(locale, options)));
    return f
      .formatToParts(value)
      .map((p) => (p.type === "group" ? thousands : p.type === "decimal" && decimal ? decimal : p.value))
      .join("");
  };
  const dateTime = (value: Date, options: Intl.DateTimeFormatOptions = {}) => {
    const pattern = settings.dateFormat?.trim();
    const wantsDate = !!(options.dateStyle || options.year || options.month || options.day);
    if (!pattern || !wantsDate) return new Intl.DateTimeFormat(locale, options).format(value);
    const wantsTime = !!(options.timeStyle || options.hour);
    const time = wantsTime ? new Intl.DateTimeFormat(locale, options.timeStyle ? { timeStyle: options.timeStyle } : { hour: options.hour, minute: options.minute }).format(value) : "";
    return time ? `${datePattern(pattern, value)} ${time}` : datePattern(pattern, value);
  };
  return { number, dateTime };
}

/**
 * The formatter for BoQ values on this screen: the org's settings and the project's locale where
 * there are such (an org or project route), else the defaults. `override` gives them where there is
 * no org context (a share page).
 */
export function useBoqFormat(override?: BoqFormatSettings): BoqFormatter {
  const uiLocale = useLocale();
  const org = useOrgScope()?.org.settings;
  const project = useOptionalProjectScope()?.project;
  const numberFormat = override?.numberFormat ?? org?.numberFormat;
  const dateFormat = override?.dateFormat ?? org?.dateFormat;
  const locale = override?.locale ?? project?.locale;
  const key = JSON.stringify([numberFormat, dateFormat, locale]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the settings by value
  return useMemo(() => boqFormatter(uiLocale, { numberFormat, dateFormat, locale }), [uiLocale, key]);
}
