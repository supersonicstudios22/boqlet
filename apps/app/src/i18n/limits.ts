"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

/** Plan limits that are a feature on or off, not a count (F14). */
export const FEATURE_LIMITS = new Set(["approvalWorkflow", "shareLinks", "exportWatermark"]);

/**
 * On/off limits that switch a plan's behaviour on rather than include a feature: `exportWatermark` true
 * means exports carry the watermark (Free), so its switch reads "On", never "Included" (review A-42).
 */
export const SETTING_LIMITS = new Set(["exportWatermark"]);

/** The admin plan editor's word beside an on/off limit's checkbox (`admin.plans.<key>`). */
export const switchLabel = (key: string): "switchOn" | "included" => (SETTING_LIMITS.has(key) ? "switchOn" : "included");

/**
 * A plan limit's name in words (`errors.limit.name`, one select for every limit; TF-098, TF-129),
 * shared by the limit dialog and the limit notifications.
 */
export function useLimitName(): (limit: string) => string {
  const t = useTranslations("errors.limit");
  return useCallback((limit: string) => t("name", { limit }), [t]);
}
