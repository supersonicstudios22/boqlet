import { APP } from "./helpers";

/**
 * Before the smoke tests: every route they visit is compiled once. The dev server compiles a route
 * on its first visit, which can take many seconds, and F01-AC1 times sign-up to the dashboard.
 */
const ROUTES = [
  "/sign-in", "/sign-up", "/session-conflict", "/onboarding", "/account", "/invite/warm-up",
  "/s/warm-up", "/warm-up", "/warm-up/setup", "/warm-up/settings/general", "/warm-up/settings/members",
  "/warm-up/projects/new", "/warm-up/projects/p", "/warm-up/projects/p/models", "/warm-up/projects/p/boqs",
  "/warm-up/projects/p/boqs/b", "/warm-up/projects/p/models/m/versions/v",
];

export default async function globalSetup() {
  for (const route of ROUTES) {
    const res = await fetch(`${APP}${route}`, { redirect: "manual" });
    await res.arrayBuffer();
  }
}
