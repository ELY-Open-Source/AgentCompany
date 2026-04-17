import type { AgentRecord, GoalRecord, ProjectRecord } from "@shared/types";
import { ProjectForm } from "./project-form";

export function ProjectEditor({
  project,
  goals,
  agents,
  companyId,
  onSaved,
  onDeleted,
}: {
  project: ProjectRecord;
  goals: GoalRecord[];
  agents: AgentRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  return (
    <ProjectForm
      mode="edit"
      companyId={companyId}
      goals={goals}
      agents={agents}
      project={project}
      onSaved={onSaved}
      onDeleted={onDeleted}
    />
  );
}
