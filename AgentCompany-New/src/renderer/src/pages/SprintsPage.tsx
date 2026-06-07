import { useMemo, useState, type FormEvent } from "react";
import { Button, Field, Icon, IconButton, Pill } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import { Dialog } from "../shared/Dialog";
import type { SprintRecord, TaskRecord } from "../../../shared/domain";
import { TASK_STATUS } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function SprintsPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const sprints = useMemo(() => snapshot.sprints.filter((s) => s.orgId === orgId), [snapshot.sprints, orgId]);
  const tasks = useMemo(() => snapshot.tasks.filter((t) => t.orgId === orgId), [snapshot.tasks, orgId]);
  const [createOpen, setCreateOpen] = useState(false);

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createSprint({
      orgId,
      name: text(form, "name"),
      goal: text(form, "goal"),
      startDate: text(form, "startDate"),
      endDate: text(form, "endDate"),
    })).then((r) => { if (r) setCreateOpen(false); });
  };

  const remove = (sprintId: string) => {
    void actions.run(() => window.agentCompany.deleteSprint({ orgId, sprintId }));
  };

  return (
    <div className="page">
      <TopbarActions>
        <Button tone="primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> New sprint</Button>
      </TopbarActions>
      <h1 className="page-h1">Sprints</h1>
      <p className="page-sub">{sprints.length} {sprints.length === 1 ? "sprint" : "sprints"}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
        {sprints.map((sprint) => (
          <SprintCard key={sprint.id} sprint={sprint} tasks={tasks} onDelete={() => remove(sprint.id)} />
        ))}
      </div>

      <Dialog title="New sprint" open={createOpen} submitLabel="Create" onClose={() => setCreateOpen(false)} onSubmit={create}>
        <Field label="Name"><input className="input" name="name" required /></Field>
        <Field label="Goal"><textarea className="input" name="goal" rows={2} required /></Field>
        <Field label="Start date"><input className="input" name="startDate" type="date" required /></Field>
        <Field label="End date"><input className="input" name="endDate" type="date" required /></Field>
      </Dialog>
    </div>
  );
}

function SprintCard({ sprint, tasks, onDelete }: { sprint: SprintRecord; tasks: TaskRecord[]; onDelete: () => void }) {
  const start = new Date(sprint.startDate);
  const end = new Date(sprint.endDate);
  const now = new Date();
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  const elapsed = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / 86400000));
  const progressPct = Math.min(100, Math.round((elapsed / totalDays) * 100));
  const done = tasks.filter((t) => t.status === TASK_STATUS.DONE).length;
  const total = tasks.length;
  const taskPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <article className="card" style={{ padding: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span style={{ fontWeight: 560, flex: 1 }}>{sprint.name}</span>
        <IconButton icon="x" label="Delete" onClick={onDelete} />
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <Pill tone={sprintStatusTone(sprint.status)}>{sprint.status}</Pill>
        <Pill>{sprint.startDate} to {sprint.endDate}</Pill>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5, marginBottom: 12 }}>{sprint.goal}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ProgressBar label="Time" pct={progressPct} />
        <ProgressBar label="Tasks" pct={taskPct} />
      </div>
    </article>
  );
}

function ProgressBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="row" style={{ gap: 8, fontSize: 12 }}>
      <span style={{ width: 40, color: "var(--text-3)" }}>{label}</span>
      <div style={{ flex: 1, height: 3, background: "var(--panel-3)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--text-1)" }} />
      </div>
      <span className="num" style={{ color: "var(--text-3)", width: 30, textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

function sprintStatusTone(status: string): "amber" | "green" | "violet" | undefined {
  if (status === "planned") return undefined;
  if (status === "active") return "amber";
  if (status === "completed") return "green";
  return "violet";
}
