import { describe, expect, it, vi } from "vitest";
import { reasonForRevoked } from "./revoked";

/**
 * TF-115 / TF-155 (F01 §10, F19): a revoked session is signed out with the reason that is true:
 * replaced by a sign-in elsewhere, expired, or ended (signed out in another tab, or by support),
 * not always "opened on another device".
 */
describe("reasonForRevoked", () => {
  it("uses the reason the event carries", async () => {
    const probe = vi.fn();
    expect(await reasonForRevoked({ sessionId: "s", status: "replaced" }, probe)).toBe("session_replaced");
    expect(await reasonForRevoked({ sessionId: "s", status: "expired" }, probe)).toBe("session_expired");
    expect(await reasonForRevoked({ sessionId: "s", status: "ended" }, probe)).toBe("session_ended");
    expect(probe).not.toHaveBeenCalled();
  });
  it("else asks the API: its 401 code says replaced or expired; anything else is an ended session", async () => {
    expect(await reasonForRevoked({ sessionId: "s" }, async () => "session_replaced")).toBe("session_replaced");
    expect(await reasonForRevoked({ sessionId: "s" }, async () => "session_expired")).toBe("session_expired");
    expect(await reasonForRevoked({ sessionId: "s" }, async () => "unauthenticated")).toBe("session_ended");
    expect(await reasonForRevoked({ sessionId: "s" }, async () => null)).toBe("session_ended");
  });
});
