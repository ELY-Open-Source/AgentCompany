import { useState, type FormEvent } from "react";
import { Avatar, Button, Field, Icon, IconButton, Pill } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import {
  RISK_LEVEL,
  TASK_PRIORITY,
  TASK_STATUS,
  type AgentRecord,
  type GoalRecord,
  type ProjectRecord,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
  type WorkspaceRecord,
} from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";

const columns: Array<{ id: TaskStatus; label: string }> = [
  { id: TASK_STATUS.BACKLOG, label: "Backlog" },
  { id: TASK_STATUS.IN_PROGRESS, label: "In progress" },
  { id: TASK_STATUS.REVIEW, label: "In review" },
  { id: TASK_STATUS.DONE, label: "Done" },
];

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optionalValue(form: FormData, key: string): string | null {
  const text = value(form, key);
  return text ? text : null;
}

type ViewMode = "board" | "list";

export function WorkPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("board");
  const tasks = snapshot.tasks.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);
  const projects = snapshot.projects.filter((item) => item.orgId === orgId);
  const goals = snapshot.goals.filter((item) => item.orgId === orgId);
  const workspaces = snapshot.workspaces.filter((item) => item.orgId === orgId);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createTask({
      orgId,
      title: value(form, "title"),
      description: value(form, "description"),
      status: TASK_STATUS.BACKLOG,
      assigneeAgentId: optionalValue(form, "assigneeAgentId"),
      risk: value(form, "risk") as "low" | "medium" | "high",
      projectId: optionalValue(form, "projectId"),
      goalId: optionalValue(form, "goalId"),
      workspaceId: optionalValue(form, "workspaceId"),
      priority: value(form, "priority") as TaskPriority,
      requiresFilesystem: form.get("requiresFilesystem") === "on",
    })).then(() => setOpen(false));
  };

  return (
    <div className="page-wide">
      <div className="row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-h1">Work</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>{tasks.length} tasks · {agents.length} assignees</p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 2, padding: 2, border: "1px solid var(--border)", borderRadius: 8 }}>
            <button
              type="button"
              className="button small"
              style={{ borderColor: "transparent", background: view === "board" ? "var(--panel-3)" : "transparent" }}
              onClick={() => setView("board")}
            >
              Board
            </button>
            <button
              type="button"
              className="button small"
              style={{ borderColor: "transparent", background: view === "list" ? "var(--panel-3)" : "transparent" }}
              onClick={() => setView("list")}
            >
              List
            </button>
          </div>
          <button type="button" className="button"><Icon name="filter" size={13} /> Filter</button>
          <Button tone="primary" onClick={() => setOpen(true)}><Icon name="plus" /> New task</Button>
        </div>
      </div>
      {view === "board" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {columns.map((column) => {
            const columnTasks = tasks.filter((task) => task.status === column.id);
            return (
              <div key={column.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="row" style={{ padding: "4px 6px 8px" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: columnColor(column.id) }} />
                  <span style={{ fontSize: 12.5, fontWeight: 540 }}>{column.label}</span>
                  <span className="num" style={{ color: "var(--text-3)" }}>{columnTasks.length}</span>
                </div>
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    assignee={optionalRecordName(task.assigneeAgentId, agents, (agent) => agent.name, "Agent")}
                    project={optionalRecordName(task.projectId, projects, (project) => project.name, "Project")}
                    goal={optionalRecordName(task.goalId, goals, (goal) => goal.title, "Goal")}
                    workspace={optionalRecordName(task.workspaceId, workspaces, (workspace) => workspace.name, "Workspace")}
                    onMove={(status) => void actions.run(() => window.agentCompany.updateTaskStatus({ orgId, taskId: task.id, status }))}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-row" style={{ gridTemplateColumns: "3fr 1fr 1fr 1fr", background: "var(--panel-2)", color: "var(--text-3)", fontSize: 11 }}>
            <div>Title</div><div>Status</div><div>Priority</div><div>Assignee</div>
          </div>
          {tasks.length === 0 ? (
            <div style={{ padding: 18, color: "var(--text-3)" }}>No tasks</div>
          ) : tasks.map((task) => {
            const assigneeName = optionalRecordName(task.assigneeAgentId, agents, (a) => a.name, "Agent");
            return (
              <div key={task.id} className="table-row" style={{ gridTemplateColumns: "3fr 1fr 1fr 1fr" }}>
                <div className="row">
                  {task.risk === "high" && <span style={{ width: 3, height: 12, background: "var(--red)", borderRadius: 2, flexShrink: 0 }} />}
                  <span style={{ fontWeight: 480 }}>{task.title}</span>
                </div>
                <Pill>{task.status.replaceAll("_", " ")}</Pill>
                <Pill tone={task.priority === "high" ? "amber" : undefined}>{task.priority}</Pill>
                <div>{assigneeName ? <div className="row"><Avatar name={assigneeName} size="sm" bot /><span style={{ color: "var(--text-2)" }}>{assigneeName}</span></div> : <span style={{ color: "var(--text-4)" }}>—</span>}</div>
              </div>
            );
          })}
        </div>
      )}
      <Dialog title="New task" open={open} submitLabel="Create" onClose={() => setOpen(false)} onSubmit={submit}>
        <Field label="Title"><input className="input" name="title" required /></Field>
        <Field label="Description"><textarea className="input" name="description" required /></Field>
        <Field label="Assignee">
          <select className="input" name="assigneeAgentId">
            <option value="">Unassigned</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select className="input" name="projectId">
            <option value="">Unassigned</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </Field>
        <Field label="Goal">
          <select className="input" name="goalId">
            <option value="">Unassigned</option>
            {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
          </select>
        </Field>
        <Field label="Workspace">
          <select className="input" name="workspaceId">
            <option value="">Unassigned</option>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </Field>
        <Field label="Risk">
          <select className="input" name="risk" defaultValue={RISK_LEVEL.LOW}>
            <option value={RISK_LEVEL.LOW}>Low</option>
            <option value={RISK_LEVEL.MEDIUM}>Medium</option>
            <option value={RISK_LEVEL.HIGH}>High</option>
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" name="priority" defaultValue={TASK_PRIORITY.NORMAL}>
            <option value={TASK_PRIORITY.LOW}>Low</option>
            <option value={TASK_PRIORITY.NORMAL}>Normal</option>
            <option value={TASK_PRIORITY.HIGH}>High</option>
          </select>
        </Field>
        <Field label="Filesystem">
          <label className="checkbox-row"><input type="checkbox" name="requiresFilesystem" /> Requires workspace access</label>
        </Field>
      </Dialog>
    </div>
  );
}

function TaskCard({
  task,
  assignee,
  project,
  goal,
  workspace,
  onMove,
}: {
  task: TaskRecord;
  assignee: string | null;
  project: string | null;
  goal: string | null;
  workspace: string | null;
  onMove: (status: TaskStatus) => void;
}) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, opacity: task.status === "done" ? 0.7 : 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        {task.risk === "high" && <span style={{ width: 3, height: 14, background: "var(--red)", borderRadius: 2, marginTop: 2 }} />}
        <div style={{ fontWeight: 480, lineHeight: 1.35 }}>{task.title}</div>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Pill tone={task.risk === "high" ? "amber" : undefined}>{task.risk}</Pill>
        <Pill>{task.priority}</Pill>
        {project && <Pill>{project}</Pill>}
        {goal && <Pill>{goal}</Pill>}
        {workspace && <Pill>{workspace}</Pill>}
        {task.requiresFilesystem && <Pill>filesystem</Pill>}
        {assignee && <Avatar name={assignee} size="sm" bot />}
        <div style={{ marginLeft: "auto" }}>
          {nextStatus(task.status) && <IconButton icon="check" label="Move" onClick={() => onMove(nextStatus(task.status)!)} />}
        </div>
      </div>
    </div>
  );
}

function columnColor(status: TaskStatus): string {
  if (status === TASK_STATUS.IN_PROGRESS) return "var(--accent)";
  if (status === TASK_STATUS.REVIEW) return "var(--amber)";
  if (status === TASK_STATUS.DONE) return "var(--green)";
  return "var(--text-4)";
}

function nextStatus(status: TaskStatus): TaskStatus | null {
  if (status === TASK_STATUS.BACKLOG) return TASK_STATUS.IN_PROGRESS;
  if (status === TASK_STATUS.IN_PROGRESS) return TASK_STATUS.REVIEW;
  if (status === TASK_STATUS.REVIEW) return TASK_STATUS.DONE;
  return null;
}

function optionalRecordName<T extends AgentRecord | ProjectRecord | GoalRecord | WorkspaceRecord>(
  id: string | null,
  records: T[],
  getName: (record: T) => string,
  label: string,
): string | null {
  if (!id) return null;
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error(`${label} reference is missing.`);
  return getName(record);
}
