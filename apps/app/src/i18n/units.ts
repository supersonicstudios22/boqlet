"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { displayUnit } from "@/features/boq-sheet/model";

/** A unit for display (F15 §7): its entry in the units catalogue, else with superscripts (m2 → m²). */
export function useUnit(): (unit: string) => string {
  const t = useTranslations("units");
  return useCallback((unit: string) => (unit && t.has(unit as never) ? t(unit as never) : displayUnit(unit)), [t]);
}
