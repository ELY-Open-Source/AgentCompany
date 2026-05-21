import { useState, type FormEvent } from "react";
import { Avatar, Button, Field, Icon, IconButton, Pill } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import { RISK_LEVEL, TASK_STATUS, type TaskRecord, type TaskStatus } from "../../../shared/domain";
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

export function WorkPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const [open, setOpen] = useState(false);
  const tasks = snapshot.tasks.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createTask({
      orgId,
      title: value(form, "title"),
      description: value(form, "description"),
      status: TASK_STATUS.BACKLOG,
      assigneeAgentId: value(form, "assigneeAgentId") || null,
      risk: value(form, "risk") as "low" | "medium" | "high",
    })).then(() => setOpen(false));
  };

  return (
    <div className="page-wide">
      <div className="row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-h1">Work</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>{tasks.length} tasks · {agents.length} assignees</p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Button tone="primary" onClick={() => setOpen(true)}><Icon name="plus" /> New task</Button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(240px, 1fr))", gap: 12 }}>
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
                  assignee={agents.find((agent) => agent.id === task.assigneeAgentId)?.name ?? null}
                  onMove={(status) => void actions.run(() => window.agentCompany.updateTaskStatus({ orgId, taskId: task.id, status }))}
                />
              ))}
            </div>
          );
        })}
      </div>
      <Dialog title="New task" open={open} submitLabel="Create" onClose={() => setOpen(false)} onSubmit={submit}>
        <Field label="Title"><input className="input" name="title" required /></Field>
        <Field label="Description"><textarea className="input" name="description" required /></Field>
        <Field label="Assignee">
          <select className="input" name="assigneeAgentId">
            <option value="">Unassigned</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </Field>
        <Field label="Risk">
          <select className="input" name="risk" defaultValue={RISK_LEVEL.LOW}>
            <option value={RISK_LEVEL.LOW}>Low</option>
            <option value={RISK_LEVEL.MEDIUM}>Medium</option>
            <option value={RISK_LEVEL.HIGH}>High</option>
          </select>
        </Field>
      </Dialog>
    </div>
  );
}

function TaskCard({
  task,
  assignee,
  onMove,
}: {
  task: TaskRecord;
  assignee: string | null;
  onMove: (status: TaskStatus) => void;
}) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, opacity: task.status === "done" ? 0.7 : 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        {task.risk === "high" && <span style={{ width: 3, height: 14, background: "var(--red)", borderRadius: 2, marginTop: 2 }} />}
        <div style={{ fontWeight: 480, lineHeight: 1.35 }}>{task.title}</div>
      </div>
      <div className="row">
        <Pill tone={task.risk === "high" ? "amber" : undefined}>{task.risk}</Pill>
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
