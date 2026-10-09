import { TaskHoldNotice } from "./TaskHoldNotice";
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
import { TASK_STATUS, type TaskDeleteImpact, type TaskStatus, type WritingMode } from "../../../../shared/domain";
import { auditEventLabel, formatRelative } from "../types";
import { WRITING_OPTIONS, descendantIds, nextStatus, prettyRunState, prettyStatus, providerFor, runBlocker, runsForTask, runTone } from "./task-helpers";
import type { SnapshotActions } from "../../app/useSnapshot";
import type { Focus, PageProps } from "../types";
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
  onOpenTask,
  onMove,
  onBlock,
  onScope,
  navigate,
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
  onOpenTask: (taskId: string) => void;
  /** Moves the task to any status, backwards included: send back, reopen, back to backlog. */
  onMove: (task: TaskRecord, status: TaskStatus) => Promise<void>;
  /** Blocks the task with a reason, or unblocks it with null. */
  onBlock: (task: TaskRecord, reason: string | null) => Promise<void>;
  onScope: (scope: Focus) => void;
  navigate: PageProps["navigate"];
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [blocking, setBlocking] = useState(false);
  // The impact is kept with the task it was counted for, and the delete removes exactly that task.
  const [deleteImpact, setDeleteImpact] = useState<{ taskId: string; impact: TaskDeleteImpact } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const act = (operation: () => Promise<void>, after?: () => void) => {
    setActionError(null);
    operation().then(after, (error: unknown) => setActionError(error instanceof Error ? error.message : String(error)));
  };
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
    setEditError(null);
    void actions.run(() => window.agentCompany.updateTask({
      orgId,
      taskId: task.id,
      title: val("title"),
      description: val("description"),
      assigneeAgentId: val("assigneeAgentId") || null,
      risk: (val("risk") || "low") as "low" | "medium" | "high",
      priority: (val("priority") || "normal") as "low" | "normal" | "high",
      parentTaskId: val("parentTaskId") || null,
      projectId: val("projectId") || null,
      goalId: val("goalId") || null,
      workspaceId: val("workspaceId") || null,
      requiresFilesystem: form.get("requiresFilesystem") === "on",
      writingMode: val("writingMode") as WritingMode,
    })).then((r) => { if (r) setEditing(false); }, (error: unknown) => setEditError(error instanceof Error ? error.message : String(error)));
  };

  const askDelete = () => {
    const taskId = task.id;
    setActionError(null);
    window.agentCompany.taskDeleteImpact({ orgId, taskId }).then((result) => {
      if (!result.ok) throw new Error(result.error.message);
      setDeleteImpact({ taskId, impact: result.data });
    }).catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)));
  };
  const confirmDelete = (taskId: string) => act(async () => {
    await actions.run(() => window.agentCompany.deleteTask({ orgId, taskId }));
  }, onClose);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} role="dialog" aria-label={task.title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
          {task.priority === "high" && <span style={{ width: 3, height: 18, background: "var(--red)", borderRadius: 2, marginTop: 2, flexShrink: 0 }} />}
          <h2 className="modal-title" style={{ margin: 0, flex: 1 }}>{task.title}</h2>
          <IconButton icon="edit" label={t("Edit")} onClick={() => { setEditError(null); setEditing(true); }} />
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
          <OverviewTab
            task={task}
            assignee={assignee}
            project={project}
            goal={goal}
            workspace={workspace}
            provider={provider}
            runs={runs}
            parent={allTasks.find((item) => item.id === task.parentTaskId) ?? null}
            onOpenTask={onOpenTask}
            onScope={onScope}
            navigate={navigate}
          />
        )}
        {tab === "subtasks" && (
          <SubtasksTab subtasks={subtasks} agents={agents} onOpenTask={onOpenTask} />
        )}
        {tab === "activity" && (
          <ActivityTab audit={taskAudit} approvals={taskApprovals} onOpenApproval={(approvalId) => navigate("approvals", { kind: "approval", id: approvalId })} />
        )}

        {blocking && (
          <form
            className="row"
            style={{ gap: 8, marginTop: 12 }}
            onSubmit={(event) => {
              event.preventDefault();
              const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
              act(() => onBlock(task, reason), () => setBlocking(false));
            }}
          >
            <input className="input" name="reason" aria-label={t("Why is it blocked?")} placeholder={t("Why is it blocked?")} required autoFocus style={{ flex: 1 }} />
            <Button tone="primary" size="small" type="submit">{t("Block task")}</Button>
            <Button tone="ghost" size="small" onClick={() => setBlocking(false)}>{t("Cancel")}</Button>
          </form>
        )}
        {deleteImpact && deleteImpact.taskId === task.id && (
          <DeleteConfirm impact={deleteImpact.impact} onConfirm={() => confirmDelete(deleteImpact.taskId)} onCancel={() => setDeleteImpact(null)} />
        )}
        {actionError && <div className="form-error" role="alert" style={{ marginTop: 8 }}>{actionError}</div>}
        <div className="modal-actions">
          <Button tone="ghost" onClick={askDelete} disabled={deleteImpact !== null}><Icon name="x" size={16} /> {t("Delete")}</Button>
          {task.blockedReason
            ? <Button onClick={() => act(() => onBlock(task, null))}>{t("Unblock")}</Button>
            : task.status !== TASK_STATUS.DONE && !blocking && <Button onClick={() => setBlocking(true)}>{t("Block")}</Button>}
          {task.status === TASK_STATUS.REVIEW && <Button onClick={() => act(() => onMove(task, TASK_STATUS.IN_PROGRESS))}>{t("Send back")}</Button>}
          {task.status === TASK_STATUS.DONE && <Button onClick={() => act(() => onMove(task, TASK_STATUS.IN_PROGRESS))}>{t("Reopen")}</Button>}
          {task.status === TASK_STATUS.IN_PROGRESS && <Button onClick={() => act(() => onMove(task, TASK_STATUS.BACKLOG))}>{t("Back to backlog")}</Button>}
          {assignee && <Button onClick={() => onRun(task)} disabled={runBlocker(task, provider, taskRuns) !== null}><Icon name="send" size={16} /> {t("Run")}</Button>}
          {advanceTo && <Button tone="primary" onClick={() => onAdvance(task)}><Icon name="check" size={16} /> {prettyStatus(advanceTo)}</Button>}
        </div>

        {editing && (
          <EditOverlay
            task={task}
            agents={agents}
            allTasks={allTasks}
            projects={projects}
            goals={goals}
            workspaces={workspaces}
            error={editError}
            onSubmit={submitEdit}
            onCancel={() => { setEditing(false); setEditError(null); }}
          />
        )}
      </div>
    </div>
  );
}

function OverviewTab({ task, assignee, project, goal, workspace, provider, runs, parent, onOpenTask, onScope, navigate }: {
  task: TaskRecord; assignee: AgentRecord | null; project: ProjectRecord | null;
  goal: GoalRecord | null; workspace: WorkspaceRecord | null; provider: ProviderRecord | null;
  runs: TaskRunRecord[]; parent: TaskRecord | null;
  onOpenTask: (taskId: string) => void; onScope: (scope: Focus) => void; navigate: PageProps["navigate"];
}) {
  return (
    <>
      {task.hold && <TaskHoldNotice hold={task.hold} />}
      {task.description && (
        <p style={{ margin: "0 0 14px", color: "var(--text-2)", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{task.description}</p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "8px 14px", fontSize: 12 }}>
        <MetaLabel>{t("Assignee")}</MetaLabel>
        <div className="row" style={{ gap: 8 }}>
          {assignee ? (<><Avatar name={assignee.name} size="sm" bot /><span>{assignee.name}</span>{provider && <span style={{ color: "var(--text-3)" }}>({provider.label})</span>}</>) : <span style={{ color: "var(--text-4)" }}>{t("Unassigned")}</span>}
        </div>
        {parent && (<><MetaLabel>{t("Parent task")}</MetaLabel><LinkButton label={t("Open task {title}", { title: parent.title })} onClick={() => onOpenTask(parent.id)}>{parent.title}</LinkButton></>)}
        {project && (<><MetaLabel>{t("Project")}</MetaLabel><LinkButton label={t("Open project {name}", { name: project.name })} onClick={() => onScope({ kind: "project", id: project.id })}>{project.name}</LinkButton></>)}
        {goal && (<><MetaLabel>{t("Goal")}</MetaLabel><LinkButton label={t("Open goal {title}", { title: goal.title })} onClick={() => onScope({ kind: "goal", id: goal.id })}>{goal.title}</LinkButton></>)}
        {workspace && (<><MetaLabel>{t("Workspace")}</MetaLabel><LinkButton label={t("Open workspace {name}", { name: workspace.name })} onClick={() => navigate("settings", { kind: "workspace", id: workspace.id })}>{workspace.name}</LinkButton></>)}
      </div>
      {runs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="section-label">{t("Runs")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {runs.map((run) => (
              <div key={run.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="link-button" aria-label={t("Open run {id}", { id: run.id })} onClick={() => navigate("runs", { kind: "run", id: run.id })}>
                    <Pill tone={runTone(run.state)}>{prettyRunState(run.state)}</Pill>
                  </button>
                  <span style={{ color: "var(--text-3)", fontSize: 12 }}>{run.trigger}</span>
                  <span className="num" style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 12 }}>{formatRelative(run.createdAt)}</span>
                </div>
                {run.state === "failed" && run.errorMessage && (
                  <span style={{ color: "var(--red)", fontSize: 12, paddingLeft: 4 }}>{run.errorMessage}</span>
                )}
                {run.capabilityWarnings && (
                  <span style={{ color: "var(--amber)", fontSize: 12, paddingLeft: 4, whiteSpace: "pre-wrap" }}>{t("Missing this run")}: {run.capabilityWarnings}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function SubtasksTab({ subtasks, agents, onOpenTask }: { subtasks: TaskRecord[]; agents: AgentRecord[]; onOpenTask: (taskId: string) => void }) {
  return (
    <div style={{ minHeight: 60 }}>
      {subtasks.length === 0 && <div style={{ fontSize: 14, color: "var(--text-3)" }}>{t("No subtasks")}</div>}
      {subtasks.map((st) => {
        const owner = agents.find((a) => a.id === st.assigneeAgentId);
        return (
          <div key={st.id} className="row" style={{ gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
            <Icon name={st.status === TASK_STATUS.DONE ? "check" : "work"} size={16} color={st.status === TASK_STATUS.DONE ? "var(--green)" : "var(--text-3)"} />
            <button type="button" className="link-button" aria-label={t("Open task {title}", { title: st.title })} onClick={() => onOpenTask(st.id)} style={{ flex: 1, fontSize: 14, fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{st.title}</button>
            <Pill>{prettyStatus(st.status)}</Pill>
            {owner && <Avatar name={owner.name} size="sm" bot />}
          </div>
        );
      })}
    </div>
  );
}

function ActivityTab({ audit, approvals, onOpenApproval }: { audit: AuditEventRecord[]; approvals: ApprovalRecord[]; onOpenApproval: (approvalId: string) => void }) {
  return (
    <div style={{ minHeight: 60 }}>
      {approvals.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="section-label">{t("Approvals")}</div>
          {approvals.map((a) => (
            <div key={a.id} className="row" style={{ gap: 8, padding: "6px 0" }}>
              <Pill tone={a.state === "approved" ? "green" : a.state === "pending" ? "amber" : "red"}>{a.state}</Pill>
              <button type="button" className="link-button" style={{ fontSize: 12 }} aria-label={t("Open approval {title}", { title: a.title })} onClick={() => onOpenApproval(a.id)}>{a.title}</button>
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

function EditOverlay({ task, agents, allTasks, projects, goals, workspaces, error, onSubmit, onCancel }: {
  task: TaskRecord; agents: AgentRecord[]; allTasks: TaskRecord[];
  projects: ProjectRecord[]; goals: GoalRecord[]; workspaces: WorkspaceRecord[]; error: string | null;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  const beneath = descendantIds(task.id, allTasks);
  const otherTasks = allTasks.filter((t) => t.id !== task.id && t.orgId === task.orgId && !beneath.has(t.id));
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
        <Field label={t("Project")}>
          <select className="input" name="projectId" defaultValue={task.projectId ?? ""}>
            <option value="">{t("None")}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </Field>
        <Field label={t("Goal")}>
          <select className="input" name="goalId" defaultValue={task.goalId ?? ""}>
            <option value="">{t("None")}</option>
            {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
          </select>
        </Field>
        <Field label={t("Workspace")}>
          <select className="input" name="workspaceId" defaultValue={task.workspaceId ?? ""}>
            <option value="">{t("None")}</option>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </Field>
        <Field label={t("Writing")}>
          <select className="input" name="writingMode" defaultValue={task.writingMode}>
            {WRITING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <label className="checkbox-row">
          <input type="checkbox" name="requiresFilesystem" defaultChecked={task.requiresFilesystem} /> {t("Requires workspace access")}
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
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

function LinkButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return <button type="button" className="link-button" aria-label={label} onClick={onClick} style={{ textAlign: "left" }}>{children}</button>;
}

/** What a delete will do, said before it happens; a running session stops it. */
function DeleteConfirm({ impact, onConfirm, onCancel }: { impact: TaskDeleteImpact; onConfirm: () => void; onCancel: () => void }) {
  const lines = [
    impact.runs > 0 && t("{n} sessions and their action records are deleted.", { n: impact.runs }),
    impact.subtasks > 0 && t("{n} subtasks stay and move to the top level.", { n: impact.subtasks }),
    impact.documents > 0 && t("{n} documents stay, no longer linked to this task.", { n: impact.documents }),
    impact.openReviews > 0 && t("{n} open reviews of it are closed.", { n: impact.openReviews }),
    impact.pendingApprovals > 0 && t("{n} pending approvals for it stay pending.", { n: impact.pendingApprovals }),
  ].filter((line): line is string => typeof line === "string");
  return (
    <div role="alertdialog" aria-label={t("Delete this task?")} style={{ marginTop: 12, padding: 12, border: "1px solid var(--red)", borderRadius: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("Delete this task?")}</div>
      {lines.length === 0 && <div style={{ fontSize: 13, color: "var(--text-2)" }}>{t("Nothing else is affected.")}</div>}
      {lines.map((line) => <div key={line} style={{ fontSize: 13, color: "var(--text-2)" }}>{line}</div>)}
      {impact.running > 0 && <div className="form-error" role="alert">{t("A session is running; stop it or wait for it before deleting.")}</div>}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <Button tone="primary" size="small" onClick={onConfirm} disabled={impact.running > 0}>{t("Delete task")}</Button>
        <Button tone="ghost" size="small" onClick={onCancel}>{t("Cancel")}</Button>
      </div>
    </div>
  );
}
