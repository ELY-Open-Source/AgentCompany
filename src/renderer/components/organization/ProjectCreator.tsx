import type { AgentRecord, GoalRecord } from "@shared/types";
import { ProjectForm } from "./project-form";

export function ProjectCreator({
  companyId,
  goals,
  agents,
  onSaved,
}: {
  companyId: string;
  goals: GoalRecord[];
  agents: AgentRecord[];
  onSaved: () => Promise<void>;
}) {
  return <ProjectForm mode="create" companyId={companyId} goals={goals} agents={agents} onSaved={onSaved} />;
}
