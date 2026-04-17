import type { AgentRecord, GoalRecord } from "@shared/types";
import { GoalForm } from "./goal-form";

export function GoalCreator({
  companyId,
  agents,
  goals,
  onSaved,
}: {
  companyId: string;
  agents: AgentRecord[];
  goals: GoalRecord[];
  onSaved: () => Promise<void>;
}) {
  return <GoalForm mode="create" companyId={companyId} agents={agents} goals={goals} onSaved={onSaved} />;
}
