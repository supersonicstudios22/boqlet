import { client } from "./env";
import { user, type TestUser } from "./users";

/**
 * Puts an org on a plan (F14), for scenarios that need a plan's features. In the pilot, plans are
 * set by the platform admin (D7, contract change C06: checkout answers `409 checkout_unavailable`),
 * so Pat sets it with `PUT /admin/orgs/{orgId}/subscription`.
 */
export async function setPlan(_owner: TestUser, orgId: string, planId: string) {
  const pat = await user("pat");
  const { response } = await client(pat.token).PUT("/admin/orgs/{orgId}/subscription", { params: { path: { orgId } }, body: { planId, reason: "Shared scenario suite" } });
  if (!response.ok) throw new Error(`setting the plan answered ${response.status}`);
}
