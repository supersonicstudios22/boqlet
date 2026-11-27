import type { ReactNode } from "react";
import { ProjectHeader } from "@/features/projects/project-header";
import { ProjectProvider } from "@/features/projects/project-context";

export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string; projectId: string }> }) {
  const { org, projectId } = await params;
  return (
    <ProjectProvider projectId={projectId}>
      {/* Under a workspace that fills the screen (C-01): takes the rest of main's height, tighter gaps. */}
      <div className="flex flex-col gap-6 has-[[data-workspace-fill]]:min-h-0 has-[[data-workspace-fill]]:flex-1 has-[[data-workspace-fill]]:gap-2">
        <ProjectHeader org={org} />
        {children}
      </div>
    </ProjectProvider>
  );
}
