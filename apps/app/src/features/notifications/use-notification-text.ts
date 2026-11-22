"use client";

import { useTranslations } from "next-intl";
import { extensions } from "@/extensions";
import { useLimitName } from "@/i18n/limits";

/** A notification's text from its kind and params (F13: the backend never stores rendered text). */
export function useNotificationText() {
  const t = useTranslations("notifications");
  // A module's kinds (`notifications.kinds`, P36) read from the module's own namespace.
  const root = useTranslations();
  const limitName = useLimitName();
  return (n: { kind: string; params?: Record<string, unknown> }) => {
    const params = Object.fromEntries(Object.entries(n.params ?? {}).map(([k, v]) => [k, typeof v === "number" ? v : String(v ?? "")]));
    // A plan limit by name, as the limit dialog names it (TF-098).
    if (typeof params.limit === "string" && n.kind.startsWith("limit.")) params.limit = limitName(params.limit);
    const ext = extensions("notifications.kinds").find((k) => k.kind === n.kind);
    if (ext) return root.has(ext.messageKey) ? root(ext.messageKey, params) : n.kind;
    const key = `kinds.${n.kind.replaceAll(".", "_")}`;
    return t.has(key) ? t(key, params) : n.kind;
  };
}
