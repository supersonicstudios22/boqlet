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

/**
 * Free has one seat (P57): a scenario that invites colleagues into a Free org gives it more seats
 * with an entitlement override, so every other Free limit still applies. Pat sets it, as for plans.
 */
export async function allowSeats(orgId: string, seats = 25) {
  const pat = await user("pat");
  const { response } = await client(pat.token).PUT("/admin/orgs/{orgId}/entitlement-overrides", {
    params: { path: { orgId } },
    body: { overrides: { seats }, reason: "Shared scenario suite: colleagues on a Free org" },
  });
  if (!response.ok) throw new Error(`allowing seats answered ${response.status}`);
}

/**
 * More active projects for one Free org (an override): a scenario that needs a second project
 * keeps it in the same org, since Free allows one owned org per person (P57).
 */
export async function allowProjects(orgId: string, activeProjects = 25) {
  const pat = await user("pat");
  const current = (await client(pat.token).GET("/admin/orgs/{orgId}", { params: { path: { orgId } } })).data!.overrides ?? {};
  const { response } = await client(pat.token).PUT("/admin/orgs/{orgId}/entitlement-overrides", {
    params: { path: { orgId } },
    body: { overrides: { ...(current as Record<string, number | boolean>), activeProjects }, reason: "Shared scenario suite: a second project on a Free org" },
  });
  if (!response.ok) throw new Error(`allowing projects answered ${response.status}`);
}
