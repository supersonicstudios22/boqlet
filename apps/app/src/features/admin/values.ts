/** What admins type into the org detail's dialogs (F19 §4). */

/** A number, `true`/`false`, or empty (remove the override). Anything else is not a value. */
export function parseOverrideValue(raw: string): number | boolean | null | undefined {
  const v = raw.trim();
  if (v === "") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  return Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(v) ? n : undefined;
}

/** Tags typed as "a, b, c": trimmed, no empties, no duplicates. */
export function parseTags(raw: string): string[] {
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

/**
 * A trial ends on a day, not at an instant (TF-153): the picked `yyyy-mm-dd` is stored as the end of
 * that day in UTC, and shown in UTC, so every admin reads the day they picked whatever their time zone.
 */
export const trialEnd = (day: string) => new Date(`${day}T23:59:59.000Z`).toISOString();

/** The trial's last day, for display: formatted in UTC by the given formatter (next-intl's `dateTime`). */
export function trialDay(iso: string, dateTime: (d: Date, options: { dateStyle: "medium"; timeZone: "UTC" }) => string): string {
  return dateTime(new Date(iso), { dateStyle: "medium", timeZone: "UTC" });
}

/** A plan's entitlements as the editor holds them (P57): a number as typed, with "no limit" as its own switch. */
export type EntitlementDraft = Record<string, { unlimited: boolean; value: string } | boolean>;

/** The editor's starting state: every catalogue key, a missing number unlimited and a missing feature off. */
export function draftEntitlements(keys: { key: string; type: "number" | "boolean" }[], current: Record<string, unknown>): EntitlementDraft {
  const draft: EntitlementDraft = {};
  for (const { key, type } of keys) {
    const value = current[key];
    draft[key] = type === "boolean" ? value === true : typeof value === "number" ? { unlimited: false, value: String(value) } : { unlimited: true, value: "" };
  }
  return draft;
}

/** The entitlements to save, or undefined while a number isn't a non-negative whole number. */
export function savedEntitlements(draft: EntitlementDraft): Record<string, number | boolean> | undefined {
  const out: Record<string, number | boolean> = {};
  for (const [key, entry] of Object.entries(draft)) {
    if (typeof entry === "boolean") {
      out[key] = entry;
      continue;
    }
    if (entry.unlimited) continue;
    if (!/^\d{1,15}$/.test(entry.value.trim())) return undefined;
    out[key] = Number(entry.value.trim());
  }
  return out;
}

/** A price as typed: empty is no price; otherwise at most two decimals. Undefined: not a price. */
export function parsePrice(raw: string): number | null | undefined {
  const v = raw.trim().replace(",", ".");
  if (v === "") return null;
  return /^\d{1,10}(\.\d{1,2})?$/.test(v) ? Number(v) : undefined;
}
