import { Avatar, Button, Icon, IconButton, Pill } from "../../shared/ui";
import {
  type AgentRecord,
  type GoalRecord,
  type ProjectRecord,
  type ProviderRecord,
  type TaskRecord,
  type TaskRunRecord,
  type WorkspaceRecord,
} from "../../../../shared/domain";
import { formatRelative } from "../types";
import { canRun, nextStatus, prettyRunState, prettyStatus, providerFor, runsForTask, runTone } from "./task-helpers";

export function TaskDetailDialog({
  task,
  agents,
  projects,
  goals,
  workspaces,
  providers,
  taskRuns,
  onClose,
  onAdvance,
  onRun,
}: {
  task: TaskRecord | null;
  agents: AgentRecord[];
  projects: ProjectRecord[];
  goals: GoalRecord[];
  workspaces: WorkspaceRecord[];
  providers: ProviderRecord[];
  taskRuns: TaskRunRecord[];
  onClose: () => void;
  onAdvance: (task: TaskRecord) => void;
  onRun: (task: TaskRecord) => void;
}) {
  if (!task) return null;
  const assignee = agents.find((agent) => agent.id === task.assigneeAgentId) ?? null;
  const project = projects.find((item) => item.id === task.projectId) ?? null;
  const goal = goals.find((item) => item.id === task.goalId) ?? null;
  const workspace = workspaces.find((item) => item.id === task.workspaceId) ?? null;
  const provider = providerFor(assignee, providers);
  const runs = runsForTask(task.id, taskRuns);
  const advanceTo = nextStatus(task.status);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={task.title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="row" style={{ alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          {task.priority === "high" && <span style={{ width: 3, height: 18, background: "var(--red)", borderRadius: 2, marginTop: 2, flexShrink: 0 }} />}
          <h2 className="modal-title" style={{ margin: 0, flex: 1 }}>{task.title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>

        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          <Pill>{prettyStatus(task.status)}</Pill>
          <Pill tone={task.priority === "high" ? "amber" : undefined}>{task.priority}</Pill>
          {task.risk === "high" && <Pill tone="red">high risk</Pill>}
          {task.requiresFilesystem && <Pill>workspace</Pill>}
        </div>

        {task.description && (
          <p style={{ margin: "0 0 16px", color: "var(--text-2)", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            {task.description}
          </p>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "10px 14px", fontSize: 12.5 }}>
          <MetaLabel>Assignee</MetaLabel>
          <div className="row" style={{ gap: 8 }}>
            {assignee ? (
              <>
                <Avatar name={assignee.name} size="sm" bot />
                <span>{assignee.name}</span>
                {provider && <span style={{ color: "var(--text-3)" }}>· {provider.label}</span>}
              </>
            ) : (
              <span style={{ color: "var(--text-4)" }}>Unassigned</span>
            )}
          </div>
          {project && (<><MetaLabel>Project</MetaLabel><div>{project.name}</div></>)}
          {goal && (<><MetaLabel>Goal</MetaLabel><div>{goal.title}</div></>)}
          {workspace && (<><MetaLabel>Workspace</MetaLabel><div>{workspace.name}</div></>)}
        </div>

        {runs.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div className="section-label">Runs</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {runs.map((run) => (
                <div key={run.id} className="row" style={{ gap: 8 }}>
                  <Pill tone={runTone(run.state)}>{prettyRunState(run.state)}</Pill>
                  <span style={{ color: "var(--text-3)", fontSize: 12 }}>{run.trigger}</span>
                  <span className="num" style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 12 }}>{formatRelative(run.createdAt)}</span>
                  {run.state === "failed" && run.errorMessage && (
                    <span style={{ color: "var(--red)", fontSize: 12, flexBasis: "100%" }}>{run.errorMessage}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          {assignee && (
            <Button onClick={() => onRun(task)} disabled={!canRun(provider)}>
              <Icon name="send" size={13} /> Run
            </Button>
          )}
          {advanceTo && (
            <Button tone="primary" onClick={() => onAdvance(task)}>
              <Icon name="check" size={13} /> Advance to {prettyStatus(advanceTo)}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaLabel({ children }: { children: string }) {
  return <div style={{ color: "var(--text-3)" }}>{children}</div>;
}
