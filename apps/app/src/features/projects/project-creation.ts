"use client";

import { useProjects } from "@/api/hooks/projects";
import { useOrg } from "@/features/orgs/org-context";

/**
 * Whether the caller may create projects (review C-32): the org role allows it, and under the org
 * setting `projectCreation: leads_and_admins` only owners, admins and people who lead a project of
 * the org do. The API enforces it (`403 forbidden`); this only hides the buttons.
 */
export function useCanCreateProjects(): boolean {
  const { org, can } = useOrg();
  const restricted = org.settings.projectCreation === "leads_and_admins";
  const projects = useProjects(org.id, { status: "active" });
  if (!can("createProjects")) return false;
  if (!restricted || can("createProjectsWhenRestricted")) return true;
  return !!projects.data?.some((p) => p.myRole === "lead");
}
