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
