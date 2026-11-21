import { client, TARGET } from "./env";
import { user, type TestUser } from "./users";

/**
 * Puts an org on a plan (F14), for scenarios that need a plan's features. Mock: the `manual`
 * adapter's checkout page switches the plan at once. Java: in the pilot, plans are set by the
 * platform admin (D7, contract change C06: checkout answers `409 checkout_unavailable`), so Pat
 * sets it with `PUT /admin/orgs/{orgId}/subscription`.
 */
export async function setPlan(owner: TestUser, orgId: string, planId: string) {
  if (TARGET === "mock") {
    const { data } = await client(owner.token).POST("/orgs/{orgId}/billing/checkout", { params: { path: { orgId } }, body: { planId, returnUrl: "http://localhost:3000/back" } });
    await fetch(data!.url, { redirect: "manual" });
    return;
  }
  const pat = await user("pat");
  const { response } = await client(pat.token).PUT("/admin/orgs/{orgId}/subscription", { params: { path: { orgId } }, body: { planId, reason: "Shared scenario suite" } });
  if (!response.ok) throw new Error(`setting the plan answered ${response.status}`);
}
