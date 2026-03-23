import { CheckCircle } from "@phosphor-icons/react";
import type { AgentRecord, GoalRecord, ProjectRecord, WorkspaceRecord } from "@shared/types";
import { EmptyState, ListFrame, ListRow, StatusPill } from "../ui";
import { useT } from "../../i18n";

export function ProjectList({
  projects,
  goals,
  agents,
  workspaces,
  selectedProjectId,
  onSelect,
}: {
  projects: ProjectRecord[];
  goals: GoalRecord[];
  agents: AgentRecord[];
  workspaces: WorkspaceRecord[];
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
}) {
  const t = useT();
  if (projects.length === 0) {
    return <EmptyState title={t("org.noProjectsYet")} detail={t("org.noProjectsDetail")} />;
  }
  return (
    <ListFrame>
      {projects.map((project) => {
        const isSelected = project.id === selectedProjectId;
        const wsCount = workspaces.filter((w) => w.projectId === project.id).length;
        return (
          <ListRow
            key={project.id}
            onClick={() => onSelect(project.id)}
            className={`cursor-pointer transition-colors duration-100 ${isSelected ? "bg-[color:var(--accent-soft)]" : "hover:bg-[color:var(--panel-soft)]"}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isSelected && (
                  <CheckCircle size={16} weight="fill" className="text-[color:var(--accent)]" />
                )}
                <div className="truncate text-[14px] font-semibold text-[color:var(--text)]">{project.name}</div>
              </div>
              <StatusPill status={project.status} />
            </div>
            <div className="mb-2 text-[13px] text-[color:var(--muted)]">{project.description}</div>
            <div className="flex flex-wrap gap-4 text-[11px] text-[color:var(--muted)]">
              <span>
                Goal: {goals.find((g) => g.id === project.goalId)?.title ?? "None"}
              </span>
              <span>
                Lead: {agents.find((a) => a.id === project.leadAgentId)?.name ?? "Unassigned"}
              </span>
              {project.targetDate && <span>Target: {project.targetDate}</span>}
              {wsCount > 0 && (
                <span>
                  {wsCount} workspace{wsCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </ListRow>
        );
      })}
    </ListFrame>
  );
}
