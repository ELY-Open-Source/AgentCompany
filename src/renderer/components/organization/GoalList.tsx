import { CheckCircle } from "@phosphor-icons/react";
import type { AgentRecord, GoalRecord } from "@shared/types";
import { EmptyState, ListFrame, ListRow, StatusPill } from "../ui";
import { useT } from "../../i18n";

export function GoalList({
  goals,
  agents,
  selectedGoalId,
  onSelect,
}: {
  goals: GoalRecord[];
  agents: AgentRecord[];
  selectedGoalId: string | null;
  onSelect: (goalId: string) => void;
}) {
  const t = useT();
  if (goals.length === 0) {
    return <EmptyState title={t("org.noGoalsYet")} detail={t("org.noGoalsDetail")} />;
  }
  return (
    <ListFrame>
      {goals.map((goal) => {
        const isSelected = goal.id === selectedGoalId;
        const parentGoal = goal.parentId ? goals.find((g) => g.id === goal.parentId) : null;
        const ownerAgent = goal.ownerAgentId
          ? agents.find((a) => a.id === goal.ownerAgentId)
          : null;
        return (
          <ListRow
            key={goal.id}
            onClick={() => onSelect(goal.id)}
            className={`cursor-pointer transition-colors duration-100 ${isSelected ? "bg-[color:var(--accent-soft)]" : "hover:bg-[color:var(--panel-soft)]"}`}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {isSelected && (
                  <CheckCircle size={16} weight="fill" className="shrink-0 text-[color:var(--accent)]" />
                )}
                <div className="truncate text-[14px] font-semibold text-[color:var(--text)]">{goal.title}</div>
              </div>
              <StatusPill status={goal.status} />
            </div>
            <div className="line-clamp-2 text-[13px] text-[color:var(--muted)]">{goal.description}</div>
            <div className="mt-1 flex gap-4 text-[11px] text-[color:var(--muted)]">
              {parentGoal && <span>Parent: {parentGoal.title}</span>}
              {ownerAgent && <span>Owner: {ownerAgent.name}</span>}
            </div>
          </ListRow>
        );
      })}
    </ListFrame>
  );
}
