"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Schemas } from "@ifc-boq/api";
import { useProject } from "@/api/hooks/projects";
import { can } from "@/lib/permissions";
import { InlineError } from "@/components/errors/inline-error";
import { LoadingLines } from "@/components/loading";
import { useOrgScope } from "@/features/orgs/org-context";
import { NotFoundView } from "@/components/errors/not-found-view";

export type ProjectPermission =
  | "view"
  | "edit"
  | "archive"
  | "manageMembers"
  | "editModels"
  | "editBoqs"
  | "answerQuestions"
  | "editLines"
  | "editPresets"
  | "saveVersion"
  | "approve"
  | "confirm"
  | "reopen"
  | "share"
  | "revokeShares"
  | "seeAudit";

export interface ProjectScope {
  project: Schemas["Project"];
  can: (permission: ProjectPermission) => boolean;
}

const ProjectContext = createContext<ProjectScope | null>(null);

/** Loads the project once for every page under it; 404 goes to the error boundary (not found). */
export function ProjectProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const project = useProject(projectId);
  const org = useOrgScope()?.org;
  // A 404 goes to the not-found page (the query client throws it); any other failure offers a retry (TF-019).
  if (project.isError && !project.data) return <InlineError error={project.error} onRetry={() => project.refetch()} />;
  if (!project.data) return <LoadingLines />;
  // A project of another org, opened under this org's URL: not found here, never inside the wrong org's
  // navigation (F01-AC6, TF-116).
  if (org && project.data.orgId !== org.id) return <NotFoundView />;
  const scope: ProjectScope = { project: project.data, can: (p) => can(project.data.permissions, p) };
  return <ProjectContext.Provider value={scope}>{children}</ProjectContext.Provider>;
}

/** The project of the route, or null outside a project route. */
export function useOptionalProjectScope(): ProjectScope | null {
  return useContext(ProjectContext);
}

export function useProjectScope(): ProjectScope {
  const scope = useContext(ProjectContext);
  if (!scope) throw new Error("useProjectScope outside a project route");
  return scope;
}
