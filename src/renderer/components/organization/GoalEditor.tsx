import type { AgentRecord, GoalRecord } from "@shared/types";
import { GoalForm } from "./goal-form";

export function GoalEditor({
  goal,
  goals,
  agents,
  companyId,
  onSaved,
  onDeleted,
}: {
  goal: GoalRecord;
  goals: GoalRecord[];
  agents: AgentRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  return (
    <GoalForm
      mode="edit"
      companyId={companyId}
      agents={agents}
      goals={goals}
      goal={goal}
      onSaved={onSaved}
      onDeleted={onDeleted}
    />
  );
}
