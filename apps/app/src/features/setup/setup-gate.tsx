"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOrg } from "@/features/orgs/org-context";

/**
 * Where an org page leads before the org's setup is finished (F16 §1, P18, Q57/P54, TF-139): every page
 * but the wizard and the settings leads to the wizard, for the people who can finish it. Members, who
 * can't, keep the pages (the dashboard says setup isn't finished). Null: stay.
 */
export function setupRedirect({ pathname, slug, finished, canFinish }: { pathname: string; slug: string; finished: boolean; canFinish: boolean }): string | null {
  if (finished || !canFinish) return null;
  const base = `/${slug}`;
  const inside = (section: string) => pathname === `${base}/${section}` || pathname.startsWith(`${base}/${section}/`);
  if (inside("setup") || inside("settings")) return null;
  return `${base}/setup`;
}

/** Applies {@link setupRedirect} to every page under `/{org}`. */
export function SetupGate({ children }: { children: ReactNode }) {
  const { org, can } = useOrg();
  const pathname = usePathname();
  const router = useRouter();
  const target = setupRedirect({ pathname, slug: org.slug, finished: org.setup?.status === "done", canFinish: can("finishSetup") });
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);
  if (target) return <div aria-busy="true" className="min-h-40" />;
  return children;
}
