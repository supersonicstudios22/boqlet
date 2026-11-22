/**
 * Why a `session.revoked` event signed this tab out (TF-115, TF-155): the session's new status when the
 * event carries it (`replaced`, `expired`, `ended`), else the code the API now answers for the session
 * (`session_replaced`, `session_expired`; anything else means it was ended: a sign-out in another tab
 * or by support). Never "opened on another device" unless it was.
 */
const BY_STATUS: Record<string, string> = { replaced: "session_replaced", expired: "session_expired", ended: "session_ended" };

export async function reasonForRevoked(data: Record<string, unknown>, probe: () => Promise<string | null>): Promise<string> {
  const status = typeof data.status === "string" ? data.status : typeof data.reason === "string" ? data.reason : null;
  if (status && BY_STATUS[status]) return BY_STATUS[status]!;
  const code = await probe().catch(() => null);
  return code === "session_replaced" || code === "session_expired" ? code : "session_ended";
}
