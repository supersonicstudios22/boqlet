/** What a model's discipline may be before the org's federation settings are loaded (the system preset's keys). */
export const DEFAULT_DISCIPLINES = ["architecture", "structure", "mep"] as const;

/**
 * The disciplines a model may have: the keys of the org's published federation settings (`doc.disciplines`),
 * the same set Java accepts (`400 invalid_discipline`, `details.allowed`; TF-128).
 */
export function federationKeys(docs: readonly unknown[]): string[] {
  const keys = new Set<string>();
  for (const doc of docs) {
    const disciplines = (doc as { disciplines?: unknown } | null)?.disciplines;
    if (disciplines && typeof disciplines === "object" && !Array.isArray(disciplines)) Object.keys(disciplines).forEach((k) => keys.add(k));
  }
  return [...keys].sort();
}

/**
 * The options a model form offers: the allowed keys (from a refusal's `details.allowed`, else the federation
 * settings, else the defaults while they load), plus the model's own discipline so an old value still shows.
 */
export function disciplineOptions({ allowed, federation, current }: { allowed?: unknown; federation?: readonly string[]; current?: string }): string[] {
  const refused = Array.isArray(allowed) && allowed.every((a) => typeof a === "string") ? (allowed as string[]) : undefined;
  const base = refused ?? (federation && federation.length > 0 ? [...federation] : [...DEFAULT_DISCIPLINES]);
  return current && current !== "detect" && !base.includes(current) ? [...base, current] : base;
}
