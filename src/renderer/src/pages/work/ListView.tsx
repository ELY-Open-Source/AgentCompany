import { Avatar, IconButton, Pill } from "../../shared/ui";
import type { AgentRecord, ProjectRecord, ProviderRecord, TaskRecord } from "../../../../shared/domain";
import { canRun, prettyStatus, providerFor } from "./task-helpers";

const GRID = "minmax(0, 3fr) 110px 96px minmax(0, 1.2fr) 88px";

export function ListView({
  tasks,
  agents,
  projects,
  providers,
  onRun,
  onOpen,
}: {
  tasks: TaskRecord[];
  agents: AgentRecord[];
  projects: ProjectRecord[];
  providers: ProviderRecord[];
  onRun: (task: TaskRecord) => void;
  onOpen: (task: TaskRecord) => void;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="table-row head" style={{ gridTemplateColumns: GRID }}>
        <div>Title</div><div>Status</div><div>Priority</div><div>Assignee</div><div />
      </div>
      {tasks.map((task, index) => {
        const assignee = agents.find((agent) => agent.id === task.assigneeAgentId) ?? null;
        const provider = providerFor(assignee, providers);
        const project = projects.find((p) => p.id === task.projectId) ?? null;
        const last = index === tasks.length - 1;
        return (
          <div
            key={task.id}
            role="button"
            tabIndex={0}
            className="table-row clickable"
            onClick={() => onOpen(task)}
            onKeyDown={(event) => { if (event.key === "Enter") onOpen(task); }}
            style={{ gridTemplateColumns: GRID, borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
          >
            <div className="row" style={{ gap: 8, minWidth: 0, overflow: "hidden" }}>
              {task.risk === "high" && <span style={{ width: 3, height: 12, background: "var(--red)", borderRadius: 2, flexShrink: 0 }} />}
              <span style={{ fontWeight: 480, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {task.title}
              </span>
              {project && <span style={{ flexShrink: 0 }}><Pill>{truncate(project.name, 24)}</Pill></span>}
            </div>
            <div><Pill>{prettyStatus(task.status)}</Pill></div>
            <div><Pill tone={task.priority === "high" ? "amber" : undefined}>{task.priority}</Pill></div>
            <div style={{ minWidth: 0 }}>
              {assignee ? (
                <div className="row" style={{ gap: 8, minWidth: 0 }}>
                  <Avatar name={assignee.name} size="sm" bot />
                  <span style={{ color: "var(--text-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {assignee.name}
                  </span>
                </div>
              ) : (
                <span style={{ color: "var(--text-4)" }}>—</span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }} onClick={(event) => event.stopPropagation()}>
              {assignee && <IconButton icon="send" label={`Run ${task.title}`} onClick={() => onRun(task)} disabled={!canRun(provider)} />}
              <IconButton icon="more" label={`Open ${task.title}`} onClick={() => onOpen(task)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
