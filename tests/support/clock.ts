import { ROOT_URL } from "./env";
import { isLocal } from "./local-stack.mjs";

/**
 * Whether the target has the test clock. The local stack runs the product image, whose database
 * time is the real time (no `suite_clock` schema): scenarios that move time skip there.
 */
export const hasTestClock = !isLocal();

/**
 * The test-only clock (testing.md): `POST /_test/clock` on Java (registered only by the suite
 * test, never in a build). Deadline and expiry scenarios move time instead of waiting.
 */
async function post(body: Record<string, unknown>): Promise<Date> {
  const res = await fetch(`${ROOT_URL}/_test/clock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`/_test/clock answered ${res.status}`);
  return new Date(((await res.json()) as { now: string }).now);
}

export const advanceClock = (ms: number) => post({ advanceMs: ms });
export const advanceDays = (days: number) => post({ advanceDays: days });
export const resetClock = () => post({ reset: true });
export async function serverNow(): Promise<Date> {
  const res = await fetch(`${ROOT_URL}/_test/clock`);
  return new Date(((await res.json()) as { now: string }).now);
}
