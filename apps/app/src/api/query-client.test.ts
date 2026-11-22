import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors";
import { registerGlobalErrorHandler } from "./global-errors";
import { makeQueryClient } from "./query-client";

/**
 * TF-117 (screens.md, C06): the "someone else changed this" toast is for a 409 from a state someone
 * else changed (revision_locked, invalid_transition, …), not for a refusal with its own reason
 * (last_owner, checkout_unavailable, …), which the screen or the generic error toast explains.
 */
const off: (() => void)[] = [];
afterEach(() => off.splice(0).forEach((f) => f()));

async function run409(code: string, ownOnError: boolean) {
  const conflict = vi.fn();
  const failed = vi.fn();
  off.push(registerGlobalErrorHandler("conflict", conflict), registerGlobalErrorHandler("failed", failed));
  const client = makeQueryClient();
  const mutation = client.getMutationCache().build(client, {
    mutationFn: async () => {
      throw new ApiError(409, code, "");
    },
    ...(ownOnError ? { onError: () => {} } : {}),
  });
  await mutation.execute(undefined).catch(() => {});
  return { conflict, failed };
}

describe("409 handling", () => {
  it("a refusal with its own reason gets no concurrency toast", async () => {
    for (const code of ["last_owner", "checkout_unavailable", "label_taken", "unit_needs_quantity"]) {
      expect((await run409(code, true)).conflict, code).not.toHaveBeenCalled();
    }
    // Without a screen of its own, the generic error toast says the reason.
    const { conflict, failed } = await run409("last_owner", false);
    expect(conflict).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalled();
  });
  it("a state someone else changed gets it", async () => {
    for (const code of ["revision_locked", "invalid_transition", "boq_confirmed"]) {
      expect((await run409(code, false)).conflict, code).toHaveBeenCalled();
    }
  });
});
