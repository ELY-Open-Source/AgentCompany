import { useState, type FormEvent } from "react";
import { Avatar, Button, Field, Icon, IconButton, Pill, Segmented } from "../../shared/ui";
import type {
  AgentRecord,
  ApprovalRecord,
  AuditEventRecord,
  GoalRecord,
  ProjectRecord,
  ProviderRecord,
  TaskRecord,
  TaskRunRecord,
  WorkspaceRecord,
} from "../../../../shared/domain";
import { TASK_STATUS } from "../../../../shared/domain";
import { auditEventLabel, formatRelative } from "../types";
import { canRun, nextStatus, prettyRunState, prettyStatus, providerFor, runsForTask, runTone } from "./task-helpers";
import type { SnapshotActions } from "../../app/useSnapshot";
import { t } from "../../i18n/i18n";

type Tab = "overview" | "subtasks" | "activity";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: t("Overview") },
  { id: "subtasks", label: t("Subtasks") },
  { id: "activity", label: t("Activity") },
];

export function TaskDetailDialog({
  task,
  agents,
  projects,
  goals,
  workspaces,
  providers,
  taskRuns,
  allTasks,
  approvals,
  auditEvents,
  orgId,
  actions,
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
  allTasks: TaskRecord[];
  approvals: ApprovalRecord[];
  auditEvents: AuditEventRecord[];
  orgId: string;
  actions: SnapshotActions;
  onClose: () => void;
  onAdvance: (task: TaskRecord) => void;
  onRun: (task: TaskRecord) => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);

  if (!task) return null;
  const assignee = agents.find((a) => a.id === task.assigneeAgentId) ?? null;
  const project = projects.find((p) => p.id === task.projectId) ?? null;
  const goal = goals.find((g) => g.id === task.goalId) ?? null;
  const workspace = workspaces.find((w) => w.id === task.workspaceId) ?? null;
  const provider = providerFor(assignee, providers);
  const runs = runsForTask(task.id, taskRuns);
  const advanceTo = nextStatus(task.status);
  const subtasks = allTasks.filter((t) => t.parentTaskId === task.id);
  const taskApprovals = approvals.filter((a) => a.sourceEntityType === "task" && a.sourceEntityId === task.id);
  const taskAudit = auditEvents.filter((e) => e.entityType === "task" && e.entityId === task.id);

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const val = (key: string) => String(form.get(key) ?? "").trim();
    void actions.run(() => window.agentCompany.updateTask({
      orgId,
      taskId: task.id,
      title: val("title"),
      description: val("description"),
      assigneeAgentId: val("assigneeAgentId") || null,
      risk: (val("risk") || "low") as "low" | "medium" | "high",
      priority: (val("priority") || "normal") as "low" | "normal" | "high",
      parentTaskId: val("parentTaskId") || null,
    })).then((r) => { if (r) setEditing(false); });
  };

  const deleteTask = () => {
    void actions.run(() => window.agentCompany.deleteTask({ orgId, taskId: task.id }));
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} role="dialog" aria-label={task.title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
          {task.priority === "high" && <span style={{ width: 3, height: 18, background: "var(--red)", borderRadius: 2, marginTop: 2, flexShrink: 0 }} />}
          <h2 className="modal-title" style={{ margin: 0, flex: 1 }}>{task.title}</h2>
          <IconButton icon="edit" label={t("Edit")} onClick={() => setEditing(true)} />
          <IconButton icon="x" label={t("Close")} onClick={onClose} />
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          <Pill>{prettyStatus(task.status)}</Pill>
          <Pill tone={task.priority === "high" ? "amber" : undefined}>{task.priority === "high" ? t("high") : task.priority === "low" ? t("low") : t("normal")}</Pill>
          {task.risk === "high" && <Pill tone="red">{t("high risk")}</Pill>}
          {task.requiresFilesystem && <Pill>{t("workspace")}</Pill>}
        </div>

        <div style={{ marginBottom: 12 }}><Segmented value={tab} onChange={setTab} options={TABS} /></div>

        {tab === "overview" && (
          <OverviewTab task={task} assignee={assignee} project={project} goal={goal} workspace={workspace} provider={provider} runs={runs} />
        )}
        {tab === "subtasks" && (
          <SubtasksTab subtasks={subtasks} agents={agents} />
        )}
        {tab === "activity" && (
          <ActivityTab audit={taskAudit} approvals={taskApprovals} />
        )}

        <div className="modal-actions">
          <Button tone="ghost" onClick={deleteTask}><Icon name="x" size={16} /> {t("Delete")}</Button>
          {assignee && <Button onClick={() => onRun(task)} disabled={!canRun(provider)}><Icon name="send" size={16} /> {t("Run")}</Button>}
          {advanceTo && <Button tone="primary" onClick={() => onAdvance(task)}><Icon name="check" size={16} /> {prettyStatus(advanceTo)}</Button>}
        </div>

        {editing && <EditOverlay task={task} agents={agents} allTasks={allTasks} onSubmit={submitEdit} onCancel={() => setEditing(false)} />}
      </div>
    </div>
  );
}

function OverviewTab({ task, assignee, project, goal, workspace, provider, runs }: {
  task: TaskRecord; assignee: AgentRecord | null; project: ProjectRecord | null;
  goal: GoalRecord | null; workspace: WorkspaceRecord | null; provider: ProviderRecord | null;
  runs: TaskRunRecord[];
}) {
  return (
    <>
      {task.description && (
        <p style={{ margin: "0 0 14px", color: "var(--text-2)", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{task.description}</p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "8px 14px", fontSize: 12 }}>
        <MetaLabel>{t("Assignee")}</MetaLabel>
        <div className="row" style={{ gap: 8 }}>
          {assignee ? (<><Avatar name={assignee.name} size="sm" bot /><span>{assignee.name}</span>{provider && <span style={{ color: "var(--text-3)" }}>({provider.label})</span>}</>) : <span style={{ color: "var(--text-4)" }}>{t("Unassigned")}</span>}
        </div>
        {project && (<><MetaLabel>{t("Project")}</MetaLabel><div>{project.name}</div></>)}
        {goal && (<><MetaLabel>{t("Goal")}</MetaLabel><div>{goal.title}</div></>)}
        {workspace && (<><MetaLabel>{t("Workspace")}</MetaLabel><div>{workspace.name}</div></>)}
      </div>
      {runs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="section-label">{t("Runs")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {runs.map((run) => (
              <div key={run.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Pill tone={runTone(run.state)}>{prettyRunState(run.state)}</Pill>
                  <span style={{ color: "var(--text-3)", fontSize: 12 }}>{run.trigger}</span>
                  <span className="num" style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 12 }}>{formatRelative(run.createdAt)}</span>
                </div>
                {run.state === "failed" && run.errorMessage && (
                  <span style={{ color: "var(--red)", fontSize: 12, paddingLeft: 4 }}>{run.errorMessage}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function SubtasksTab({ subtasks, agents }: { subtasks: TaskRecord[]; agents: AgentRecord[] }) {
  return (
    <div style={{ minHeight: 60 }}>
      {subtasks.length === 0 && <div style={{ fontSize: 14, color: "var(--text-3)" }}>{t("No subtasks")}</div>}
      {subtasks.map((st) => {
        const owner = agents.find((a) => a.id === st.assigneeAgentId);
        return (
          <div key={st.id} className="row" style={{ gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
            <Icon name={st.status === TASK_STATUS.DONE ? "check" : "work"} size={16} color={st.status === TASK_STATUS.DONE ? "var(--green)" : "var(--text-3)"} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st.title}</span>
            <Pill>{prettyStatus(st.status)}</Pill>
            {owner && <Avatar name={owner.name} size="sm" bot />}
          </div>
        );
      })}
    </div>
  );
}

function ActivityTab({ audit, approvals }: { audit: AuditEventRecord[]; approvals: ApprovalRecord[] }) {
  return (
    <div style={{ minHeight: 60 }}>
      {approvals.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="section-label">{t("Approvals")}</div>
          {approvals.map((a) => (
            <div key={a.id} className="row" style={{ gap: 8, padding: "6px 0" }}>
              <Pill tone={a.state === "approved" ? "green" : a.state === "pending" ? "amber" : "red"}>{a.state}</Pill>
              <span style={{ fontSize: 12 }}>{a.title}</span>
              <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-3)" }}>{formatRelative(a.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="section-label">{t("Events")}</div>
      {audit.length === 0 && <div style={{ fontSize: 14, color: "var(--text-3)" }}>{t("No events")}</div>}
      {audit.map((e) => (
        <div key={e.id} className="row" style={{ gap: 8, padding: "5px 0" }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--text-3)", flexShrink: 0 }}>{formatRelative(e.createdAt)}</span>
          <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{auditEventLabel(e.entityType, e.action)}</span>
        </div>
      ))}
    </div>
  );
}

function EditOverlay({ task, agents, allTasks, onSubmit, onCancel }: {
  task: TaskRecord; agents: AgentRecord[]; allTasks: TaskRecord[];
  onSubmit: (e: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  const otherTasks = allTasks.filter((t) => t.id !== task.id && t.orgId === task.orgId);
  return (
    <div style={{ position: "absolute", inset: 0, background: "var(--bg)", borderRadius: 14, padding: 24, overflow: "auto", zIndex: 2 }}>
      <form onSubmit={onSubmit}>
        <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 600 }}>{t("Edit task")}</h3>
        <Field label={t("Title")}><input className="input" name="title" defaultValue={task.title} required /></Field>
        <Field label={t("Description")}><textarea className="input" name="description" rows={4} defaultValue={task.description} /></Field>
        <Field label={t("Assignee")}>
          <select className="input" name="assigneeAgentId" defaultValue={task.assigneeAgentId ?? ""}>
            <option value="">{t("Unassigned")}</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label={t("Risk")}>
            <select className="input" name="risk" defaultValue={task.risk}>
              <option value="low">{t("Low")}</option><option value="medium">{t("Medium")}</option><option value="high">{t("High")}</option>
            </select>
          </Field>
          <Field label={t("Priority")}>
            <select className="input" name="priority" defaultValue={task.priority}>
              <option value="low">{t("Low")}</option><option value="normal">{t("Normal")}</option><option value="high">{t("High")}</option>
            </select>
          </Field>
        </div>
        <Field label={t("Parent task")}>
          <select className="input" name="parentTaskId" defaultValue={task.parentTaskId ?? ""}>
            <option value="">{t("None")}</option>
            {otherTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </Field>
        <div className="modal-actions">
          <Button onClick={onCancel}>{t("Cancel")}</Button>
          <Button tone="primary" type="submit">{t("Save")}</Button>
        </div>
      </form>
    </div>
  );
}

function MetaLabel({ children }: { children: string }) {
  return <div style={{ color: "var(--text-3)" }}>{children}</div>;
}
