import { useMemo, useState } from "react";
import { Avatar, Button, Icon, IconButton, Pill, Segmented } from "../shared/ui";
import {
  TASK_STATUS,
  type AgentRecord,
  type GoalRecord,
  type ProjectRecord,
  type TaskRecord,
  type TaskStatus,
  type WorkspaceRecord,
} from "../../../shared/domain";
import { NewTaskDialog } from "./NewTaskDialog";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";

type View = "board" | "list" | "timeline";

const COLUMNS: ReadonlyArray<{ id: TaskStatus; label: string; tone: string }> = [
  { id: TASK_STATUS.BACKLOG, label: "Backlog", tone: "var(--text-4)" },
  { id: TASK_STATUS.IN_PROGRESS, label: "In progress", tone: "var(--accent)" },
  { id: TASK_STATUS.REVIEW, label: "In review", tone: "var(--amber)" },
  { id: TASK_STATUS.DONE, label: "Done", tone: "var(--green)" },
];

const VIEW_OPTIONS: ReadonlyArray<{ id: View; label: string }> = [
  { id: "board", label: "Board" },
  { id: "list", label: "List" },
  { id: "timeline", label: "Timeline" },
];

export function WorkPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const [view, setView] = useState<View>("board");
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const tasks = useMemo(() => snapshot.tasks.filter((task) => task.orgId === orgId), [snapshot.tasks, orgId]);
  const agents = useMemo(() => snapshot.agents.filter((agent) => agent.orgId === orgId), [snapshot.agents, orgId]);
  const projects = useMemo(() => snapshot.projects.filter((project) => project.orgId === orgId), [snapshot.projects, orgId]);
  const goals = useMemo(() => snapshot.goals.filter((goal) => goal.orgId === orgId), [snapshot.goals, orgId]);
  const workspaces = useMemo(() => snapshot.workspaces.filter((workspace) => workspace.orgId === orgId), [snapshot.workspaces, orgId]);

  const advance = (task: TaskRecord) => {
    const next = nextStatus(task.status);
    if (!next) return;
    void actions.run(() => window.agentCompany.updateTaskStatus({ orgId, taskId: task.id, status: next }));
  };

  return (
    <div className="page-wide">
      <div className="row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-h1">Work</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"} · {agents.length} {agents.length === 1 ? "assignee" : "assignees"}
          </p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <Segmented value={view} onChange={setView} options={VIEW_OPTIONS} />
          <Button tone="ghost"><Icon name="filter" size={13} /></Button>
          <Button tone="primary" onClick={() => setNewTaskOpen(true)}><Icon name="plus" size={13} /> New task</Button>
        </div>
      </div>

      {view === "board" && (
        <BoardView
          tasks={tasks}
          agents={agents}
          projects={projects}
          goals={goals}
          workspaces={workspaces}
          onAdvance={advance}
          onCreate={() => setNewTaskOpen(true)}
        />
      )}
      {view === "list" && <ListView tasks={tasks} agents={agents} projects={projects} />}
      {view === "timeline" && <TimelineView tasks={tasks} goals={goals} />}

      <NewTaskDialog open={newTaskOpen} orgId={orgId} snapshot={snapshot} actions={actions} onClose={() => setNewTaskOpen(false)} />
    </div>
  );
}

function BoardView({
  tasks,
  agents,
  projects,
  goals,
  workspaces,
  onAdvance,
  onCreate,
}: {
  tasks: TaskRecord[];
  agents: AgentRecord[];
  projects: ProjectRecord[];
  goals: GoalRecord[];
  workspaces: WorkspaceRecord[];
  onAdvance: (task: TaskRecord) => void;
  onCreate: () => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, minWidth: 0 }}>
      {COLUMNS.map((column) => {
        const columnTasks = tasks.filter((task) => task.status === column.id);
        return (
          <div key={column.id} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div className="row" style={{ padding: "4px 6px 8px" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: column.tone, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, fontWeight: 540 }}>{column.label}</span>
              <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>{columnTasks.length}</span>
              <IconButton icon="plus" label="Add task" onClick={onCreate} />
            </div>
            {columnTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                assignee={agents.find((agent) => agent.id === task.assigneeAgentId) ?? null}
                project={projects.find((project) => project.id === task.projectId) ?? null}
                goal={goals.find((goal) => goal.id === task.goalId) ?? null}
                workspace={workspaces.find((workspace) => workspace.id === task.workspaceId) ?? null}
                onAdvance={() => onAdvance(task)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ListView({ tasks, agents, projects }: { tasks: TaskRecord[]; agents: AgentRecord[]; projects: ProjectRecord[] }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="table-row head"
        style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr) 60px" }}
      >
        <div>Title</div><div>Status</div><div>Priority</div><div>Assignee</div><div />
      </div>
      {tasks.map((task, index) => {
        const assignee = agents.find((agent) => agent.id === task.assigneeAgentId) ?? null;
        const project = projects.find((p) => p.id === task.projectId) ?? null;
        const last = index === tasks.length - 1;
        return (
          <div
            key={task.id}
            className="table-row"
            style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr) 60px", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
          >
            <div className="row" style={{ gap: 8, minWidth: 0 }}>
              {task.risk === "high" && <span style={{ width: 3, height: 12, background: "var(--red)", borderRadius: 2, flexShrink: 0 }} />}
              <span style={{ fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
              {project && <Pill>{project.name}</Pill>}
            </div>
            <div><Pill>{prettyStatus(task.status)}</Pill></div>
            <div><Pill tone={task.priority === "high" ? "amber" : undefined}>{task.priority}</Pill></div>
            <div>
              {assignee ? (
                <div className="row" style={{ gap: 8 }}>
                  <Avatar name={assignee.name} size="sm" bot />
                  <span style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assignee.name}</span>
                </div>
              ) : (
                <span style={{ color: "var(--text-4)" }}>—</span>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <IconButton icon="more" label="More" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineView({ tasks, goals }: { tasks: TaskRecord[]; goals: GoalRecord[] }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="section-label">By goal</div>
      {goals.map((goal) => {
        const linked = tasks.filter((task) => task.goalId === goal.id);
        const done = linked.filter((task) => task.status === TASK_STATUS.DONE).length;
        const pct = linked.length === 0 ? 0 : Math.round((done / linked.length) * 100);
        return (
          <div key={goal.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border-soft)" }}>
            <div className="row">
              <span style={{ fontWeight: 540 }}>{goal.title}</span>
              <span className="num" style={{ marginLeft: "auto", color: "var(--text-3)" }}>{done} / {linked.length}</span>
            </div>
            <div style={{ marginTop: 8, height: 3, background: "var(--panel-3)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--text-1)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  assignee,
  project,
  goal,
  workspace,
  onAdvance,
}: {
  task: TaskRecord;
  assignee: AgentRecord | null;
  project: ProjectRecord | null;
  goal: GoalRecord | null;
  workspace: WorkspaceRecord | null;
  onAdvance: () => void;
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: task.status === "done" ? 0.7 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        {task.priority === "high" && <span style={{ width: 3, height: 14, background: "var(--red)", borderRadius: 2, marginTop: 2, flexShrink: 0 }} />}
        <div
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 480,
            lineHeight: 1.35,
            letterSpacing: "-0.005em",
            textDecoration: task.status === "done" ? "line-through" : "none",
            color: task.status === "done" ? "var(--text-3)" : "var(--text-1)",
          }}
        >
          {task.title}
        </div>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {project ? <Pill>{project.name}</Pill> : <Pill>{capitalize(task.risk)}</Pill>}
        {goal && <Pill tone="violet">{truncate(goal.title, 20)}</Pill>}
        {workspace && <Pill>{workspace.name}</Pill>}
        {task.requiresFilesystem && <Pill>workspace</Pill>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {assignee && <Avatar name={assignee.name} size="sm" bot />}
          {nextStatus(task.status) && <IconButton icon="check" label="Advance" onClick={onAdvance} />}
        </div>
      </div>
    </div>
  );
}

function nextStatus(status: TaskStatus): TaskStatus | null {
  if (status === TASK_STATUS.BACKLOG) return TASK_STATUS.IN_PROGRESS;
  if (status === TASK_STATUS.IN_PROGRESS) return TASK_STATUS.REVIEW;
  if (status === TASK_STATUS.REVIEW) return TASK_STATUS.DONE;
  return null;
}

function prettyStatus(status: TaskStatus): string {
  return status.replaceAll("_", " ");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
