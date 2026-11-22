"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

/** Plan limits that are a feature on or off, not a count (F14). */
export const FEATURE_LIMITS = new Set(["approvalWorkflow", "shareLinks", "exportWatermark"]);

/**
 * A plan limit's name in words (`errors.limit.name`, one select for every limit; TF-098, TF-129),
 * shared by the limit dialog and the limit notifications.
 */
export function useLimitName(): (limit: string) => string {
  const t = useTranslations("errors.limit");
  return useCallback((limit: string) => t("name", { limit }), [t]);
}
