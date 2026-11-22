/**
 * `Idempotency-Key` for the actions that create a job or send an email (api-conventions.md, TF-073):
 * generate, export, preview, share link, save or confirm a version, edits import, model upload and
 * retry, invitations. One key per action; the same action (same scope and body) asked again within
 * 3 s (a double click, a retry after a dropped answer) reuses its key, so the API acts once and
 * answers the same. A preview (a new draft each time) takes a new key per call.
 */
/** Long enough for a double click or an immediate retry; short enough that a deliberate repeat is new. */
const WINDOW_MS = 3_000;
const recent = new Map<string, { key: string; at: number }>();

export function idempotencyHeaders(scope: string, body?: unknown): { "Idempotency-Key": string } {
  const now = Date.now();
  for (const [k, v] of recent) if (now - v.at > WINDOW_MS) recent.delete(k);
  const id = body === undefined ? scope : `${scope}|${JSON.stringify(body)}`;
  let entry = recent.get(id);
  if (!entry) {
    entry = { key: crypto.randomUUID(), at: now };
    recent.set(id, entry);
  }
  return { "Idempotency-Key": entry.key };
}
