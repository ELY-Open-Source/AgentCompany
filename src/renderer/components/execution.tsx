import { useCallback, useEffect, useState, useMemo } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  CheckCircle,
  ClockCounterClockwise,
  Download,
  FolderOpen,
  ListChecks,
  MagnifyingGlass,
  Pencil,
  Play,
  ShieldCheck,
  Trash,
  XCircle,
  Warning,
  Robot,
  CheckSquare,
  Gear,
  Key,
  Lightning,
  Target,
  Briefcase,
  Buildings,
  ArrowRight,
} from "@phosphor-icons/react";
import type {
  ActivityRecord,
  AgentRecord,
  ApprovalRecord,
  GoalRecord,
  ProfileSnapshot,
  ProjectRecord,
  RunRecord,
  SecretRecord,
  TaskRecord,
  TaskStatus,
  WorkspaceRecord,
} from "@shared/types";
import { formatMoney, formatTime } from "../lib/formatters";
import { unwrap } from "../lib/desktop";
import { ActionButton, EmptyState, Field, Input, ListFrame, ListRow, Select, StatusPill, TextArea, useFocusTrap } from "./ui";

function describeActionError(error: unknown) {
  return error instanceof Error ? error.message : "The action could not be completed.";
}

function InlineNotice({
  message,
  tone = "danger",
}: {
  message: string;
  tone?: "danger" | "success" | "warn";
}) {
  const toneClass = tone === "success"
    ? "border-[color:var(--success)] bg-[color:var(--success-soft)] text-[color:var(--success)]"
    : tone === "warn"
      ? "border-[color:var(--warn)] bg-[color:var(--warn-soft)] text-[color:var(--warn)]"
      : "border-[color:var(--danger)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]";
  return (
    <div className={`rounded-[10px] border px-4 py-3 text-[13px] ${toneClass}`} role={tone === "danger" ? "alert" : "status"}>
      {message}
    </div>
  );
}

/* ─── Confirm Dialog ─────────────────────────────────────────────────── */

export function ConfirmDialog({ open, title, message, errorMessage, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  message: string;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--text)]/45" onClick={onCancel}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-[400px] rounded-[12px] bg-[color:var(--panel)] border border-[color:var(--line)] p-6 shadow-lg"
        onClick={e => e.stopPropagation()}
      >
        <div id="confirm-dialog-title" className="text-[16px] font-semibold text-[color:var(--text)] mb-2">{title}</div>
        <div className="text-[13px] text-[color:var(--muted)] mb-6">{message}</div>
        {errorMessage ? <div className="mb-4"><InlineNotice message={errorMessage} /></div> : null}
        <div className="flex gap-3 justify-end">
          <ActionButton label="Cancel" onClick={onCancel} />
          <ActionButton label="Confirm" tone="danger" onClick={onConfirm} />
        </div>
      </div>
    </div>
  );
}

/* ─── Entity-type icon lookup ────────────────────────────────────────── */

const ENTITY_ICONS: Record<string, typeof Robot> = {
  agent: Robot,
  task: CheckSquare,
  run: Play,
  approval: ShieldCheck,
  connector: Gear,
  workspace: FolderOpen,
  secret: Key,
  goal: Target,
  project: Briefcase,
  company: Buildings,
};

const ENTITY_TYPE_OPTIONS = [
  "all", "agent", "task", "run", "approval", "connector", "workspace", "secret", "goal", "project", "company",
] as const;

/* ─── Workspace state pills ──────────────────────────────────────────── */

function WorkspaceStatePill({ state }: { state: string }) {
  const colorMap: Record<string, string> = {
    ready: "text-[color:var(--success)] bg-[color:var(--success-soft)]",
    busy: "text-[color:var(--warn)] bg-[color:var(--warn-soft)]",
    blocked: "text-[color:var(--danger)] bg-[color:var(--danger-soft)]",
    missing: "text-[color:var(--muted-strong)] bg-[color:var(--panel-soft)]",
    error: "text-[color:var(--danger)] bg-[color:var(--danger-soft)]",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${colorMap[state] ?? colorMap.missing}`}>
      {state}
    </span>
  );
}

/* ─── Priority indicator ─────────────────────────────────────────────── */

function PriorityDot({ priority }: { priority: string }) {
  const color = priority === "critical"
    ? "bg-[color:var(--danger)]"
    : priority === "high"
      ? "bg-[color:var(--warn)]"
      : priority === "low"
        ? "bg-[color:var(--muted)]"
        : "bg-[color:var(--muted-strong)]";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} aria-label={`${priority} priority`} />;
}

/* ─── Task Queue ─────────────────────────────────────────────────────── */

export function TaskQueue({
  tasks,
  runs,
  selectedTaskId,
  onSelect,
}: {
  tasks: TaskRecord[];
  runs: RunRecord[];
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
}) {
  if (tasks.length === 0) {
    return <EmptyState title="Task queue is empty" />;
  }
  return (
    <ListFrame>
      {tasks.map((task) => {
        const activeRun = runs.find((run) => run.id === task.activeRunId) ?? null;
        return (
          <button
            key={task.id}
            className={`focus-ring relative w-full border-b border-[color:var(--line)] px-5 py-4 text-left transition last:border-b-0 ${
              selectedTaskId === task.id
                ? "bg-transparent"
                : "bg-transparent hover:bg-[color:var(--panel-soft)]"
            }`}
            onClick={() => onSelect(task.id)}
          >
            {selectedTaskId === task.id ? (
              <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-[color:var(--accent)]" />
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <PriorityDot priority={task.priority} />
                <div className={`truncate text-[14px] text-[color:var(--text)] ${selectedTaskId === task.id ? "font-semibold" : "font-medium"}`}>{task.title}</div>
              </div>
              <StatusPill status={activeRun?.status ?? task.status} />
            </div>
          </button>
        );
      })}
    </ListFrame>
  );
}

/* ─── Task Inspector ─────────────────────────────────────────────────── */

export function TaskInspector({
  task,
  tasks,
  runs,
  agents,
  goals,
  projects,
  workspaces,
  companyId,
  onRun,
  onCancelRun,
  onCreateApproval,
  onDeleted,
}: {
  task: TaskRecord;
  tasks: TaskRecord[];
  runs: RunRecord[];
  agents: ProfileSnapshot["agents"];
  goals: GoalRecord[];
  projects: ProjectRecord[];
  workspaces: WorkspaceRecord[];
  companyId: string;
  onRun: (taskId: string) => Promise<void>;
  onCancelRun: (runId: string) => Promise<void>;
  onCreateApproval: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDescription, setEditDescription] = useState(task.description);
  const [editPriority, setEditPriority] = useState(task.priority);
  const [editStatus, setEditStatus] = useState<TaskStatus>(task.status);
  const [editAssignee, setEditAssignee] = useState(task.assigneeAgentId ?? "");
  const [editWorkspace, setEditWorkspace] = useState(task.workspaceId ?? "");
  const [editProject, setEditProject] = useState(task.projectId ?? "");
  const [editGoal, setEditGoal] = useState(task.goalId ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [savingChanges, setSavingChanges] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<TaskStatus | null>(null);
  const [creatingApproval, setCreatingApproval] = useState(false);

  const assignee = agents.find((agent) => agent.id === task.assigneeAgentId) ?? null;
  const project = projects.find((entry) => entry.id === task.projectId) ?? null;
  const goal = goals.find((entry) => entry.id === task.goalId) ?? null;
  const workspace = workspaces.find((entry) => entry.id === task.workspaceId) ?? null;
  const activeRun = runs.find((run) => run.id === task.activeRunId) ?? null;
  const reviewer = assignee?.reportsTo ? (agents.find((a) => a.id === assignee.reportsTo) ?? null) : null;
  const needsGovernance = task.status === "blocked" || (task.status === "in_review" && !reviewer);

  const budgetWarning = assignee && assignee.budgetMonthlyUsd > 0
    ? assignee.spentMonthlyUsd / assignee.budgetMonthlyUsd
    : 0;

  function startEdit() {
    setActionError(null);
    setActionNotice(null);
    setEditTitle(task.title);
    setEditDescription(task.description);
    setEditPriority(task.priority);
    setEditStatus(task.status);
    setEditAssignee(task.assigneeAgentId ?? "");
    setEditWorkspace(task.workspaceId ?? "");
    setEditProject(task.projectId ?? "");
    setEditGoal(task.goalId ?? "");
    setEditing(true);
  }

  async function saveChanges() {
    setActionError(null);
    setActionNotice(null);
    setSavingChanges(true);
    try {
      unwrap(await window.agentCompany.saveTask({
        id: task.id,
        companyId: task.companyId,
        title: editTitle,
        description: editDescription,
        priority: editPriority as TaskRecord["priority"],
        status: editStatus,
        assigneeAgentId: editAssignee || null,
        workspaceId: editWorkspace || null,
        projectId: editProject || null,
        goalId: editGoal || null,
      }));
      setEditing(false);
      setActionNotice("Task changes saved.");
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      setSavingChanges(false);
    }
  }

  async function quickStatus(status: TaskStatus) {
    setActionError(null);
    setActionNotice(null);
    setUpdatingStatus(status);
    try {
      unwrap(await window.agentCompany.saveTask({
        id: task.id,
        companyId: task.companyId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status,
        assigneeAgentId: task.assigneeAgentId,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        goalId: task.goalId,
      }));
      setActionNotice(`Task moved to ${status.replaceAll("_", " ")}.`);
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function handleCreateApproval() {
    setActionError(null);
    setActionNotice(null);
    setCreatingApproval(true);
    try {
      await onCreateApproval();
      setActionNotice(task.status === "blocked" ? "Approval created and routed to leadership." : "Approval created.");
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      setCreatingApproval(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    try {
      unwrap(await window.agentCompany.deleteTask({ id: task.id, companyId }));
      setConfirmDelete(false);
      await onDeleted();
    } catch (error) {
      setDeleteError(describeActionError(error));
    }
  }

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={confirmDelete}
        title="Delete task"
        message={`Permanently delete "${task.title}"? This cannot be undone.`}
        errorMessage={deleteError}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setDeleteError(null);
          setConfirmDelete(false);
        }}
      />

      {/* Budget warning */}
      {budgetWarning > 0.8 && assignee ? (
        <div className={`flex items-center gap-2 rounded-[8px] border px-4 py-3 text-[13px] font-medium ${
          budgetWarning > 1
            ? "border-[color:var(--danger)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
            : "border-[color:var(--warn)] bg-[color:var(--warn-soft)] text-[color:var(--warn)]"
        }`}>
          <Warning size={16} weight="fill" />
          {assignee.name} has used {Math.round(budgetWarning * 100)}% of their monthly budget ({formatMoney(assignee.spentMonthlyUsd)} / {formatMoney(assignee.budgetMonthlyUsd)})
        </div>
      ) : null}

      {actionError ? <InlineNotice message={actionError} /> : null}
      {!actionError && actionNotice ? <InlineNotice message={actionNotice} tone="success" /> : null}

      {/* Edit mode */}
      {editing ? (
        <div className="grid gap-3 border-y border-[color:var(--line)] py-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input label="Title" value={editTitle} onChange={setEditTitle} placeholder="Task title" />
          </div>
          <div className="md:col-span-2">
            <TextArea label="Description" value={editDescription} onChange={setEditDescription} placeholder="Description" rows={4} />
          </div>
          <Select label="Priority" value={editPriority} onChange={v => setEditPriority(v as TaskRecord["priority"])} options={["critical", "high", "medium", "low"].map(v => ({ value: v, label: v }))} />
          <Select label="Status" value={editStatus} onChange={v => setEditStatus(v as TaskStatus)} options={["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"].map(v => ({ value: v, label: v.replaceAll("_", " ") }))} />
          <Select label="Assignee" value={editAssignee} onChange={setEditAssignee} options={[{ value: "", label: "Unassigned" }, ...agents.map(a => ({ value: a.id, label: a.name }))]} />
          <Select label="Workspace" value={editWorkspace} onChange={setEditWorkspace} options={[{ value: "", label: "No workspace" }, ...workspaces.map(w => ({ value: w.id, label: w.name }))]} />
          <Select label="Project" value={editProject} onChange={setEditProject} options={[{ value: "", label: "No project" }, ...projects.map(p => ({ value: p.id, label: p.name }))]} />
          <Select label="Goal" value={editGoal} onChange={setEditGoal} options={[{ value: "", label: "No goal" }, ...goals.map(g => ({ value: g.id, label: g.title }))]} />
          <div className="md:col-span-2 flex gap-3">
            <ActionButton label="Save" tone="accent" onClick={() => void saveChanges()} icon={CheckCircle} loading={savingChanges} />
            <ActionButton label="Cancel" onClick={() => setEditing(false)} icon={XCircle} />
          </div>
        </div>
      ) : (
        <>
          {/* Compact metadata */}
          <div className="grid gap-x-6 gap-y-1 text-[13px] md:grid-cols-2">
            {assignee && <div className="text-[color:var(--muted)]">Assignee: <span className="text-[color:var(--text)]">{assignee.name}</span></div>}
            {project && <div className="text-[color:var(--muted)]">Project: <span className="text-[color:var(--text)]">{project.name}</span></div>}
            {goal && <div className="text-[color:var(--muted)]">Goal: <span className="text-[color:var(--text)]">{goal.title}</span></div>}
            {task.parentId && (() => { const parent = tasks.find((t) => t.id === task.parentId); return parent ? <div className="text-[color:var(--muted)]">Parent: <span className="text-[color:var(--text)]">{parent.title}</span></div> : null; })()}
            {workspace && <div className="text-[color:var(--muted)]">Workspace: <span className="text-[color:var(--text)]">{workspace.name}</span></div>}
            {task.costUsd > 0 && <div className="text-[color:var(--muted)]">Cost: <span className="mono text-[color:var(--text)]">{formatMoney(task.costUsd)}</span></div>}
          </div>

          {/* Description */}
          {task.description ? (
            <div className="text-[13px] leading-relaxed text-[color:var(--muted-strong)] whitespace-pre-wrap">{task.description}</div>
          ) : null}

          {task.status === "in_review" && reviewer ? (
            <div className="rounded-[10px] border border-blue-200 bg-blue-50 px-4 py-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-blue-700">
                <Robot size={16} weight="fill" />
                Being reviewed by {reviewer.name}{reviewer.title ? ` (${reviewer.title})` : ""}
              </div>
              <div className="mt-1 text-[13px] leading-relaxed text-blue-600/80">
                {assignee?.name} submitted this task for review. {reviewer.name} will approve, request revisions, or escalate.
              </div>
            </div>
          ) : needsGovernance ? (
            <div className="rounded-[10px] border border-[color:var(--warn)] bg-[color:var(--warn-soft)] px-4 py-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[color:var(--warn)]">
                <ShieldCheck size={16} weight="fill" />
                {task.status === "blocked" ? "Governance action required" : "Task is waiting on review"}
              </div>
              <div className="mt-1 text-[13px] leading-relaxed text-[color:var(--muted-strong)]">
                {task.status === "blocked"
                  ? "Create an approval so leadership can resolve the blocker, provide credentials, or authorize the next privileged action."
                  : "Create an approval entry if this task needs an explicit operator decision before it can move forward."}
              </div>
              <div className="mt-3">
                <ActionButton
                  label={task.status === "blocked" ? "Create unblock approval" : "Create review approval"}
                  onClick={() => void handleCreateApproval()}
                  icon={ShieldCheck}
                  loading={creatingApproval}
                />
              </div>
            </div>
          ) : null}

          {/* Contextual actions — only show what makes sense for current state */}
          <div className="flex items-center gap-2 pt-1">
            {activeRun ? (
              <ActionButton label="Cancel run" onClick={() => void onCancelRun(activeRun.id)} icon={XCircle} tone="danger" />
            ) : (
              <>
                {["todo", "in_progress", "blocked"].includes(task.status) && (
                  <ActionButton label="Run" onClick={() => void onRun(task.id)} icon={Play} tone="accent" />
                )}
                {task.status === "in_review" && (
                  <ActionButton label="Done" onClick={() => void quickStatus("done")} icon={CheckCircle} tone="accent" loading={updatingStatus === "done"} />
                )}
                {task.status === "blocked" && (
                  <ActionButton label="Unblock" onClick={() => void quickStatus("in_progress")} icon={Play} loading={updatingStatus === "in_progress"} />
                )}
              </>
            )}
            <ActionButton label="Edit" onClick={startEdit} icon={Pencil} />
            <ActionButton label="Delete" onClick={() => setConfirmDelete(true)} icon={Trash} tone="danger" />
          </div>
        </>
      )}

      {/* Subtask tree */}
      {(() => {
        const subtasks = tasks.filter((t) => t.parentId === task.id);
        if (subtasks.length === 0) return null;
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ListChecks size={14} className="text-[color:var(--muted)]" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Subtasks ({subtasks.length})</span>
              <span className="text-[10px] text-[color:var(--success)]">
                {subtasks.filter((t) => t.status === "done").length}/{subtasks.length} done
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
              <div
                className="h-full rounded-full bg-[color:var(--success)] transition-all duration-300"
                style={{ width: `${subtasks.length > 0 ? (subtasks.filter((t) => t.status === "done").length / subtasks.length) * 100 : 0}%` }}
              />
            </div>
            <div className="space-y-1">
              {subtasks.map((sub) => {
                const subAssignee = agents.find((a) => a.id === sub.assigneeAgentId);
                return (
                  <div key={sub.id} className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-[12px] bg-[color:var(--panel-soft)]">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      sub.status === "done" ? "bg-[color:var(--success)]" :
                      sub.status === "in_progress" ? "bg-[color:var(--accent)]" :
                      sub.status === "blocked" ? "bg-[color:var(--danger)]" :
                      sub.status === "in_review" ? "bg-[color:var(--warn)]" :
                      "bg-[color:var(--muted)]"
                    }`} />
                    <span className={`flex-1 truncate ${sub.status === "done" ? "line-through text-[color:var(--muted)]" : "text-[color:var(--text)]"}`}>
                      {sub.title}
                    </span>
                    {subAssignee ? (
                      <span className="shrink-0 text-[10px] text-[color:var(--muted)]">{subAssignee.name}</span>
                    ) : null}
                    <StatusPill status={sub.status} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Communication */}
      <TaskComments taskId={task.id} companyId={task.companyId} agents={agents} />

      {/* Run history — only if there are runs */}
      {runs.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]">Run history</div>
          <div className="space-y-2">
            {runs.slice(0, 8).map((run) => {
              const runAgent = agents.find((a) => a.id === run.agentId);
              const isActive = run.status === "running" || run.status === "queued";
              return (
                <div key={run.id} className={`rounded-[8px] border px-3 py-2.5 ${
                  isActive ? "border-[color:var(--success)] bg-[color:var(--success-soft)]" :
                  run.status === "failed" || run.status === "timed_out" ? "border-[color:var(--danger)] border-opacity-30 bg-[color:var(--danger-soft)]" :
                  "border-[color:var(--line)] bg-[color:var(--panel-soft)]"
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {isActive ? <span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--success)]" /> : null}
                        <span className="truncate text-[13px] font-medium text-[color:var(--text)]">
                          {run.summary || (isActive ? "Running..." : "Completed run")}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[color:var(--muted)]">
                        {runAgent ? <span>{runAgent.name}</span> : null}
                        <span>{run.connectorId.replace("_local", "")}</span>
                        {run.model ? <span className="mono">{run.model}</span> : null}
                        <span>{formatTime(run.startedAt)}</span>
                        {run.costUsd != null && run.costUsd > 0 ? <span className="mono">{formatMoney(run.costUsd)}</span> : null}
                      </div>
                    </div>
                    <StatusPill status={run.status} />
                  </div>
                  {run.errorMessage ? (
                    <div className="mt-1.5 rounded bg-[color:var(--danger-soft)] px-2 py-1 text-[11px] text-[color:var(--danger)]">
                      {run.errorMessage}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {runs.length > 8 && <div className="text-[11px] text-[color:var(--muted)] text-center">+{runs.length - 8} more runs</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Task Comments ──────────────────────────────────────────────────── */

function TaskComments({
  taskId,
  companyId,
  agents,
}: {
  taskId: string;
  companyId: string;
  agents: ProfileSnapshot["agents"];
}) {
  const [comments, setComments] = useState<Array<{ id: string; authorAgentId: string | null; authorName: string; body: string; createdAt: string }>>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    const result = await window.agentCompany.listComments({ taskId });
    if (result.ok) setComments(result.data);
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    void loadComments();
    const unsubscribe = window.agentCompany.subscribe((event) => {
      if (event.type === "agent-message" && event.taskId === taskId) {
        setComments((prev) => [...prev, event.comment]);
      }
    });
    return unsubscribe;
  }, [taskId, loadComments]);

  const handleSubmit = async () => {
    if (!newComment.trim()) return;
    setSubmitError(null);
    try {
      unwrap(await window.agentCompany.addComment({
        companyId,
        taskId,
        authorName: "Board",
        body: newComment.trim(),
      }));
      setNewComment("");
      await loadComments();
    } catch (error) {
      setSubmitError(describeActionError(error));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Robot size={16} className="text-[color:var(--muted)]" />
        <span className="text-[13px] font-semibold text-[color:var(--text)]">Communication</span>
        <span className="text-[11px] text-[color:var(--muted)]">({comments.length})</span>
      </div>
      {loading ? (
        <div className="text-[12px] text-[color:var(--muted)]">Loading...</div>
      ) : comments.length === 0 ? (
        <div className="text-[12px] text-[color:var(--muted)]">No messages yet. Agents will post updates here during runs.</div>
      ) : (
        <div className="max-h-[240px] space-y-2 overflow-y-auto rounded-lg border border-[color:var(--line)] p-3">
          {comments.map((comment) => {
            const isAgent = Boolean(comment.authorAgentId);
            const agent = isAgent ? agents.find((a) => a.id === comment.authorAgentId) : null;
            return (
              <div key={comment.id} className="rounded-md bg-[color:var(--panel-soft)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[12px] font-semibold ${isAgent ? "text-[color:var(--accent)]" : "text-[color:var(--text)]"}`}>
                    {comment.authorName}
                  </span>
                  {agent && <span className="text-[10px] text-[color:var(--muted)]">{agent.role}</span>}
                  <span className="text-[10px] text-[color:var(--muted)]">{formatTime(comment.createdAt)}</span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] text-[color:var(--text)]">{comment.body}</div>
              </div>
            );
          })}
        </div>
      )}
      {submitError ? <InlineNotice message={submitError} /> : null}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:outline-none"
          placeholder="Send a message to the team..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSubmit(); } }}
        />
        <ActionButton label="Send" tone="accent" onClick={() => void handleSubmit()} icon={ArrowRight} />
      </div>
    </div>
  );
}

/* ─── Task Creator ───────────────────────────────────────────────────── */

export function TaskCreator({
  companyId,
  goals,
  projects,
  agents,
  workspaces,
  onSaved,
}: {
  companyId: string;
  goals: GoalRecord[];
  projects: ProjectRecord[];
  agents: ProfileSnapshot["agents"];
  workspaces: WorkspaceRecord[];
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goalId, setGoalId] = useState(goals[0]?.id ?? "");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [assigneeAgentId, setAssigneeAgentId] = useState(agents[0]?.id ?? "");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [priority, setPriority] = useState("medium");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreateTask() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      unwrap(await window.agentCompany.saveTask({
        companyId,
        projectId: projectId || null,
        goalId: goalId || null,
        title,
        description,
        assigneeAgentId: assigneeAgentId || null,
        workspaceId: workspaceId || null,
        priority: priority as TaskRecord["priority"],
        status: "todo",
      }));
      setTitle("");
      setDescription("");
      await onSaved();
    } catch (error) {
      setSubmitError(describeActionError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Input label="Title" value={title} onChange={setTitle} placeholder="Task title" />
      <Select label="Priority" value={priority} onChange={setPriority} options={["critical", "high", "medium", "low"].map((value) => ({ value, label: value }))} />
      <div className="md:col-span-2"><TextArea label="Description" value={description} onChange={setDescription} placeholder="What should the agent do, and what result should come back into the run summary?" rows={5} /></div>
      <Select label="Goal" value={goalId} onChange={setGoalId} options={[{ value: "", label: "No goal" }, ...goals.map((goal) => ({ value: goal.id, label: goal.title }))]} />
      <Select label="Project" value={projectId} onChange={setProjectId} options={[{ value: "", label: "No project" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} />
      <Select label="Assignee" value={assigneeAgentId} onChange={setAssigneeAgentId} options={[{ value: "", label: "Unassigned" }, ...agents.map((agent) => ({ value: agent.id, label: agent.name }))]} />
      <Select label="Workspace" value={workspaceId} onChange={setWorkspaceId} options={[{ value: "", label: "No workspace" }, ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))]} />
      {submitError ? <div className="md:col-span-2"><InlineNotice message={submitError} /></div> : null}
      <div className="md:col-span-2">
        <ActionButton
          label="Create task"
          tone="accent"
          onClick={() => void handleCreateTask()}
          icon={ListChecks}
          loading={submitting}
        />
      </div>
    </div>
  );
}

/* ─── Pending Review List ────────────────────────────────────────────── */

export function PendingReviewList({ tasks, agents }: { tasks: TaskRecord[]; agents: AgentRecord[] }) {
  const reviewTasks = tasks.filter((t) => t.status === "in_review");
  if (reviewTasks.length === 0) {
    return <EmptyState title="No agent reviews in progress" />;
  }
  return (
    <ListFrame>
      {reviewTasks.map((task) => {
        const assignee = agents.find((a) => a.id === task.assigneeAgentId) ?? null;
        const reviewer = assignee?.reportsTo ? (agents.find((a) => a.id === assignee.reportsTo) ?? null) : null;
        return (
          <div key={task.id} className="flex items-start gap-3 border-b border-[color:var(--line)] px-5 py-4 last:border-b-0">
            <Robot size={16} weight="fill" className="mt-0.5 shrink-0 text-blue-500" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-[color:var(--text)] truncate">{task.title}</div>
              <div className="mt-0.5 text-[12px] text-[color:var(--muted)]">
                {assignee ? assignee.name : "Unassigned"}
                {reviewer ? <> &rarr; reviewed by <span className="text-[color:var(--muted-strong)]">{reviewer.name}{reviewer.title ? ` (${reviewer.title})` : ""}</span></> : " · awaiting review"}
              </div>
            </div>
          </div>
        );
      })}
    </ListFrame>
  );
}

/* ─── Approval List ──────────────────────────────────────────────────── */

export function ApprovalList({ approvals, selectedApprovalId, onSelect }: { approvals: ApprovalRecord[]; selectedApprovalId: string | null; onSelect: (id: string) => void }) {
  if (approvals.length === 0) {
    return <EmptyState title="No approvals" />;
  }
  return (
    <ListFrame>
      {approvals.map((approval) => (
        <button
          key={approval.id}
          className={`focus-ring relative w-full border-b border-[color:var(--line)] px-5 py-4 text-left transition last:border-b-0 ${
            selectedApprovalId === approval.id
              ? "bg-transparent"
              : "bg-transparent hover:bg-[color:var(--panel-soft)]"
          }`}
          onClick={() => onSelect(approval.id)}
        >
          {selectedApprovalId === approval.id ? (
            <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-[color:var(--warn)]" />
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <div className={`text-[15px] text-[color:var(--text)] ${selectedApprovalId === approval.id ? "font-semibold" : "font-medium"}`}>{approval.payloadSummary}</div>
            <StatusPill status={approval.state} />
          </div>
        </button>
      ))}
    </ListFrame>
  );
}

/* ─── Approval Inspector ─────────────────────────────────────────────── */

export function ApprovalInspector({
  approval,
  agents,
  tasks,
  companyId,
  onDecide,
  onDeleted,
}: {
  approval: ApprovalRecord;
  agents: AgentRecord[];
  tasks: TaskRecord[];
  companyId: string;
  onDecide: (state: "approved" | "rejected" | "revision_requested", note?: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [decisionNote, setDecisionNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState<"approved" | "rejected" | "revision_requested" | "delete" | null>(null);

  const requestingAgent = agents.find((a) => a.id === approval.requestedByAgentId) ?? null;
  const relatedTask = tasks.find((t) => t.id === approval.relatedTaskId) ?? null;
  const isDecided = approval.state !== "pending";

  async function handleDelete() {
    setActionError(null);
    setActing("delete");
    try {
      unwrap(await window.agentCompany.deleteApproval({ id: approval.id, companyId }));
      setConfirmDelete(false);
      await onDeleted();
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      setActing(null);
    }
  }

  async function handleDecision(state: "approved" | "rejected" | "revision_requested") {
    setActionError(null);
    setActing(state);
    try {
      await onDecide(state, decisionNote || undefined);
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={confirmDelete}
        title="Delete approval"
        message={`Permanently delete this approval? This cannot be undone.`}
        errorMessage={actionError}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setActionError(null);
          setConfirmDelete(false);
        }}
      />

      {actionError && !confirmDelete ? <InlineNotice message={actionError} /> : null}

      {/* Approval context */}
      <div className="border-y border-[color:var(--line)] py-4 space-y-4">
        {/* Type badge + state */}
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${
            approval.type === "hire_agent" ? "bg-[color:var(--accent-soft)] text-[color:var(--accent)]" :
            approval.type === "approve_ceo_strategy" ? "bg-[color:var(--warn-soft)] text-[color:var(--warn)]" :
            approval.type === "secret_access" ? "bg-[color:var(--danger-soft)] text-[color:var(--danger)]" :
            "bg-[color:var(--panel-soft)] text-[color:var(--muted)]"
          }`}>
            {approval.type.replaceAll("_", " ")}
          </span>
          <StatusPill status={approval.state} />
        </div>

        {/* Summary */}
        <div className="text-[14px] font-medium text-[color:var(--text)]">{approval.payloadSummary}</div>
        {approval.impactSummary ? (
          <div className="text-[13px] text-[color:var(--muted)]">{approval.impactSummary}</div>
        ) : null}

        {/* Metadata grid */}
        <div className="grid gap-2 text-[13px] md:grid-cols-2">
          <div className="flex items-center gap-2 text-[color:var(--muted)]">
            <Robot size={14} />
            Requested by: <span className="font-medium text-[color:var(--text)]">{requestingAgent?.name ?? "Unknown"}</span>
            {requestingAgent?.role ? <span className="text-[10px] text-[color:var(--muted)]">({requestingAgent.role})</span> : null}
          </div>
          {relatedTask ? (
            <div className="flex items-center gap-2 text-[color:var(--muted)]">
              <Briefcase size={14} />
              Task: <span className="font-medium text-[color:var(--text)]">{relatedTask.title}</span>
            </div>
          ) : null}
          <div className="text-[color:var(--muted)]">
            Created: <span className="mono text-[color:var(--text)]">{formatTime(approval.createdAt)}</span>
          </div>
          {approval.updatedAt !== approval.createdAt ? (
            <div className="text-[color:var(--muted)]">
              Updated: <span className="mono text-[color:var(--text)]">{formatTime(approval.updatedAt)}</span>
            </div>
          ) : null}
        </div>

        {/* Hire agent payload details */}
        {approval.type === "hire_agent" ? (() => {
          // Find the agent that was proposed for hiring (look for pending_approval agents)
          const proposedAgent = agents.find(
            (a) => a.status === "pending_approval" && a.reportsTo === approval.requestedByAgentId
          ) ?? agents.find(
            (a) => a.name.toLowerCase().includes("pending") || a.status === "pending_approval"
          );
          if (!proposedAgent) return null;
          return (
            <div className="rounded-[8px] border border-[color:var(--accent)] border-opacity-30 bg-[color:var(--accent-soft)] px-4 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--accent)]">Proposed Hire</div>
              <div className="grid gap-1.5 text-[12px]">
                <div><span className="text-[color:var(--muted)]">Name:</span> <span className="font-medium text-[color:var(--text)]">{proposedAgent.name}</span></div>
                <div><span className="text-[color:var(--muted)]">Role:</span> <span className="text-[color:var(--text)]">{proposedAgent.role}</span></div>
                {proposedAgent.title ? <div><span className="text-[color:var(--muted)]">Title:</span> <span className="text-[color:var(--text)]">{proposedAgent.title}</span></div> : null}
                {proposedAgent.capabilities ? <div><span className="text-[color:var(--muted)]">Capabilities:</span> <span className="text-[color:var(--text)]">{proposedAgent.capabilities}</span></div> : null}
                <div><span className="text-[color:var(--muted)]">Connector:</span> <span className="mono text-[color:var(--text)]">{proposedAgent.connectorId}</span></div>
                <div><span className="text-[color:var(--muted)]">Budget:</span> <span className="mono text-[color:var(--text)]">{formatMoney(proposedAgent.budgetMonthlyUsd)}/mo</span></div>
                {proposedAgent.reportsTo ? (() => {
                  const manager = agents.find((a) => a.id === proposedAgent.reportsTo);
                  return manager ? <div><span className="text-[color:var(--muted)]">Reports to:</span> <span className="text-[color:var(--text)]">{manager.name}</span></div> : null;
                })() : null}
              </div>
            </div>
          );
        })() : null}

        {/* CEO strategy payload details */}
        {approval.type === "approve_ceo_strategy" ? (
          <div className="rounded-[8px] border border-[color:var(--warn)] border-opacity-30 bg-[color:var(--warn-soft)] px-4 py-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--warn)]">Organization Strategy</div>
            <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--text)]">
              {approval.payloadSummary}
            </div>
          </div>
        ) : null}
      </div>

      {/* Decision note input */}
      {!isDecided ? (
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-[color:var(--muted)]">Decision note</label>
          <TextArea value={decisionNote} onChange={setDecisionNote} placeholder="Optional note to accompany your decision..." rows={3} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {!isDecided ? (
          <>
            <ActionButton label="Approve" tone="accent" onClick={() => void handleDecision("approved")} icon={CheckCircle} loading={acting === "approved"} />
            <ActionButton label="Request revision" onClick={() => void handleDecision("revision_requested")} icon={ClockCounterClockwise} loading={acting === "revision_requested"} />
            <ActionButton label="Reject" tone="danger" onClick={() => void handleDecision("rejected")} icon={XCircle} loading={acting === "rejected"} />
          </>
        ) : null}
        {isDecided ? (
          <ActionButton label="Delete" onClick={() => setConfirmDelete(true)} icon={Trash} tone="danger" loading={acting === "delete"} />
        ) : null}
      </div>

      {approval.decisionNote ? (
        <div className="border-t border-[color:var(--line)] pt-4 text-[13px] text-[color:var(--muted-strong)]">
          Last note: {approval.decisionNote}
        </div>
      ) : null}
    </div>
  );
}

/* ─── Cost List ──────────────────────────────────────────────────────── */

export function CostList({ costs, agents, runs }: { costs: ProfileSnapshot["costs"]; agents: ProfileSnapshot["agents"]; runs: ProfileSnapshot["runs"] }) {
  const [connectorFilter, setConnectorFilter] = useState("all");

  const connectorIds = useMemo(() => {
    const ids = new Set(costs.map((c) => c.connectorId));
    return Array.from(ids).sort();
  }, [costs]);

  const filtered = useMemo(() => {
    if (connectorFilter === "all") return costs;
    return costs.filter((c) => c.connectorId === connectorFilter);
  }, [costs, connectorFilter]);

  const total = useMemo(() => filtered.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0), [filtered]);

  if (costs.length === 0) {
    return <EmptyState title="No cost data yet" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Select
          value={connectorFilter}
          onChange={setConnectorFilter}
          options={[{ value: "all", label: "All connectors" }, ...connectorIds.map((id) => ({ value: id, label: id }))]}
        />
      </div>
      <ListFrame>
        {filtered.map((entry) => (
          <ListRow key={entry.id} className="flex items-center justify-between">
            <div>
              <div className="text-[14px] text-[color:var(--text)]">{runs.find((run) => run.id === entry.runId)?.summary || "Run cost"}</div>
              <div className="text-[12px] text-[color:var(--muted)]">{agents.find((agent) => agent.id === entry.agentId)?.name ?? "Unknown agent"} · {entry.connectorId}</div>
            </div>
            <div className="text-right">
              <div className="mono text-[13px] text-[color:var(--text)]">{formatMoney(entry.amountUsd)}</div>
              {entry.unattributed ? <div className="text-[11px] text-[color:var(--warn)]">unattributed</div> : null}
            </div>
          </ListRow>
        ))}
        {/* Total row */}
        <ListRow className="flex items-center justify-between">
          <div className="text-[14px] font-semibold text-[color:var(--text)]">Total ({filtered.length} entries)</div>
          <div className="mono text-[14px] font-semibold text-[color:var(--text)]">{formatMoney(total)}</div>
        </ListRow>
      </ListFrame>
    </div>
  );
}

/* ─── Budget Summary ─────────────────────────────────────────────────── */

export function BudgetSummary({ agents, costs }: { agents: ProfileSnapshot["agents"]; costs: ProfileSnapshot["costs"] }) {
  const knownSpend = costs.reduce((sum, entry) => sum + (entry.amountUsd ?? 0), 0);
  const unattributedCount = costs.filter((entry) => entry.unattributed).length;
  return (
    <div className="space-y-4">
      <div className="border-y border-[color:var(--line)]">
        <div className="flex items-end justify-between gap-4 py-3">
          <div className="text-[12px] text-[color:var(--muted)]">Known spend</div>
          <div className="mono text-[22px] tracking-[-0.03em] text-[color:var(--text)]">{formatMoney(knownSpend)}</div>
        </div>
        <div className="flex items-end justify-between gap-4 border-t border-[color:var(--line)] py-3">
          <div className="text-[12px] text-[color:var(--muted)]">Unattributed entries</div>
          <div className="mono text-[18px] text-[color:var(--text)]">{String(unattributedCount)}</div>
        </div>
      </div>
      <ListFrame>
        {agents.map((agent) => {
          const pct = agent.budgetMonthlyUsd > 0
            ? (agent.spentMonthlyUsd / agent.budgetMonthlyUsd) * 100
            : 0;
          const isWarning = pct > 80 && pct <= 100;
          const isDanger = pct > 100;

          const barColor = isDanger
            ? "bg-[color:var(--danger)]"
            : isWarning
              ? "bg-[color:var(--warn)]"
              : "bg-[color:var(--success)]";

          const nameColor = isDanger
            ? "text-[color:var(--danger)]"
            : isWarning
              ? "text-[color:var(--warn)]"
              : "text-[color:var(--text)]";

          return (
            <ListRow key={agent.id}>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`text-[14px] font-medium ${nameColor}`}>{agent.name}</div>
                  {isDanger ? <Warning size={14} weight="fill" className="text-[color:var(--danger)]" /> : null}
                  {isWarning ? <Warning size={14} weight="fill" className="text-[color:var(--warn)]" /> : null}
                </div>
                <div className="flex items-center gap-2">
                  <div className="mono text-[12px] text-[color:var(--text)]">{formatMoney(agent.spentMonthlyUsd)} / {formatMoney(agent.budgetMonthlyUsd)}</div>
                  <span className={`mono text-[11px] font-semibold ${isDanger ? "text-[color:var(--danger)]" : isWarning ? "text-[color:var(--warn)]" : "text-[color:var(--muted)]"}`}>
                    {Math.round(pct)}%
                  </span>
                </div>
              </div>
              <div className="h-2 rounded-full bg-[color:var(--line)]">
                <div
                  className={`h-2 rounded-full ${barColor}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </ListRow>
          );
        })}
      </ListFrame>
    </div>
  );
}

/* ─── Activity List ──────────────────────────────────────────────────── */

export function ActivityList({ activity }: { activity: ActivityRecord[] }) {
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(100);

  const filtered = useMemo(() => {
    let result = activity;
    if (entityFilter !== "all") {
      result = result.filter((entry) => entry.entityType === entityFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((entry) =>
        entry.action.toLowerCase().includes(q) ||
        entry.actor.toLowerCase().includes(q) ||
        entry.detail.toLowerCase().includes(q) ||
        entry.entityType.toLowerCase().includes(q)
      );
    }
    return result;
  }, [activity, entityFilter, search]);

  const visible = filtered.slice(0, visibleCount);

  if (activity.length === 0) {
    return <EmptyState title="No activity yet" />;
  }
  return (
    <div className="space-y-3">
      {/* Search and filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]" />
          <input
            type="text"
            className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] py-2.5 pl-8 pr-3.5 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity..."
          />
        </div>
        <Select
          value={entityFilter}
          onChange={setEntityFilter}
          options={ENTITY_TYPE_OPTIONS.map((v) => ({ value: v, label: v === "all" ? "All types" : v }))}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No matching activity" />
      ) : (
        <>
          <ListFrame>
            {visible.map((entry) => {
              const EntityIcon = ENTITY_ICONS[entry.entityType] ?? Lightning;
              return (
                <ListRow key={entry.id}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <EntityIcon size={14} weight="duotone" className="text-[color:var(--muted)]" />
                      <div className="text-[14px] text-[color:var(--text)]">{entry.action}</div>
                    </div>
                    <div className="mono text-[11px] text-[color:var(--muted)]">{formatTime(entry.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 text-[13px] text-[color:var(--muted)]">
                    <span className="font-medium text-[color:var(--muted-strong)]">{entry.actor}</span>
                    <span>·</span>
                    <span>{entry.detail || `${entry.entityType}:${entry.entityId}`}</span>
                  </div>
                </ListRow>
              );
            })}
          </ListFrame>
          {visibleCount < filtered.length ? (
            <div className="flex justify-center pt-2">
              <ActionButton label={`Load more (${filtered.length - visibleCount} remaining)`} onClick={() => setVisibleCount((c) => c + 100)} icon={ArrowRight} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ─── Workspace List ─────────────────────────────────────────────────── */

export function WorkspaceList({
  workspaces,
  projects,
  companyId,
  onOpen,
  onDeleted,
}: {
  workspaces: WorkspaceRecord[];
  projects: ProjectRecord[];
  companyId: string;
  onOpen: (path: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const toDelete = workspaces.find((w) => w.id === confirmDeleteId) ?? null;

  async function handleDelete(id: string) {
    setDeleteError(null);
    try {
      unwrap(await window.agentCompany.deleteWorkspace({ id, companyId }));
      setConfirmDeleteId(null);
      await onDeleted();
    } catch (error) {
      setDeleteError(describeActionError(error));
    }
  }

  if (workspaces.length === 0) {
    return <EmptyState title="No workspaces yet" />;
  }
  return (
    <>
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete workspace"
        message={`Delete workspace "${toDelete?.name ?? ""}"? This only removes it from the company registry; files on disk are not affected.`}
        errorMessage={deleteError}
        onConfirm={() => confirmDeleteId && void handleDelete(confirmDeleteId)}
        onCancel={() => {
          setDeleteError(null);
          setConfirmDeleteId(null);
        }}
      />
      <ListFrame>
        {workspaces.map((workspace) => {
          const linkedProject = projects.find((p) => p.id === workspace.projectId) ?? null;
          return (
            <ListRow key={workspace.id}>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-[14px] text-[color:var(--text)]">{workspace.name}</div>
                    <WorkspaceStatePill state={workspace.state} />
                  </div>
                  <div className="mono text-[11px] text-[color:var(--muted)]">{workspace.localPath}</div>
                </div>
                <div className="flex items-center gap-2">
                  {workspace.isPrimary ? <StatusPill status="ready" /> : null}
                  <ActionButton label="Reveal" onClick={() => void onOpen(workspace.localPath)} icon={ArrowSquareOut} />
                  <ActionButton label="Delete" onClick={() => setConfirmDeleteId(workspace.id)} icon={Trash} tone="danger" />
                </div>
              </div>
              <div className="text-[12px] text-[color:var(--muted)]">
                {workspace.repoUrl || "No remote URL"} {workspace.repoRef ? `· ${workspace.repoRef}` : ""}
                {linkedProject ? <span> · Project: <span className="text-[color:var(--text)]">{linkedProject.name}</span></span> : null}
              </div>
            </ListRow>
          );
        })}
      </ListFrame>
    </>
  );
}

/* ─── Workspace Creator ──────────────────────────────────────────────── */

export function WorkspaceCreator({ companyId, projects, onSaved }: { companyId: string; projects: ProjectRecord[]; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoRef, setRepoRef] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleChooseDirectory() {
    setSubmitError(null);
    const result = await window.agentCompany.pickDirectory();
    if (!result.ok) {
      setSubmitError(result.error.message);
      return;
    }
    if (result.data) {
      setLocalPath(result.data);
    }
  }

  async function handleSaveWorkspace() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      unwrap(await window.agentCompany.saveWorkspace({ companyId, name, localPath, repoUrl, repoRef, projectId: projectId || null, isPrimary: false }));
      setName("");
      setLocalPath("");
      setRepoUrl("");
      setRepoRef("");
      await onSaved();
    } catch (error) {
      setSubmitError(describeActionError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Input label="Workspace name" value={name} onChange={setName} placeholder="Workspace name" />
      <Field label="Local path">
        <div className="flex gap-3">
          <Input value={localPath} onChange={setLocalPath} placeholder="/Users/you/project" />
          <ActionButton
            label="Choose"
            onClick={() => void handleChooseDirectory()}
            icon={FolderOpen}
          />
        </div>
      </Field>
      <Input label="Repository URL" value={repoUrl} onChange={setRepoUrl} placeholder="https://github.com/org/repo" />
      <Input label="Branch / ref" value={repoRef} onChange={setRepoRef} placeholder="main" />
      <Select label="Project" value={projectId} onChange={setProjectId} options={[{ value: "", label: "No project binding" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} />
      {submitError ? <InlineNotice message={submitError} /> : null}
      <ActionButton
        label="Add workspace"
        tone="accent"
        onClick={() => void handleSaveWorkspace()}
        icon={FolderOpen}
        loading={submitting}
      />
    </div>
  );
}

/* ─── Settings Pane ──────────────────────────────────────────────────── */

export function SettingsPane({
  snapshot,
  secrets,
  companyId,
  onSaved,
}: {
  snapshot: ProfileSnapshot;
  secrets: SecretRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
}) {
  const [theme, setTheme] = useState(snapshot.theme);
  const [updatesEnabled, setUpdatesEnabled] = useState(snapshot.updatesEnabled);
  const [confirmDeleteSecretId, setConfirmDeleteSecretId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [deleteSecretError, setDeleteSecretError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<"save" | "check" | "backup" | "restore" | null>(null);
  const secretToDelete = secrets.find((s) => s.id === confirmDeleteSecretId) ?? null;

  useEffect(() => {
    setTheme(snapshot.theme);
    setUpdatesEnabled(snapshot.updatesEnabled);
  }, [snapshot.theme, snapshot.updatesEnabled]);

  async function handleDeleteSecret(id: string) {
    setDeleteSecretError(null);
    setActionError(null);
    setActionNotice(null);
    try {
      unwrap(await window.agentCompany.deleteSecret({ id, companyId }));
      setConfirmDeleteSecretId(null);
      setActionNotice("Secret deleted.");
      await onSaved();
    } catch (error) {
      setDeleteSecretError(describeActionError(error));
    }
  }

  async function handleSaveSettings() {
    setActionError(null);
    setActionNotice(null);
    setLoadingAction("save");
    try {
      unwrap(await window.agentCompany.updateSettings({ theme, updatesEnabled }));
      await onSaved();
      setActionNotice("Settings saved.");
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleCheckForUpdates() {
    setActionError(null);
    setActionNotice(null);
    setLoadingAction("check");
    try {
      unwrap(await window.agentCompany.checkForUpdates());
      setActionNotice("Update check started.");
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleBackupProfile() {
    setActionError(null);
    setActionNotice(null);
    setLoadingAction("backup");
    try {
      const backupPath = unwrap(await window.agentCompany.backupProfile());
      if (backupPath) {
        setActionNotice(`Profile backup created at ${backupPath}.`);
      }
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleRestoreProfile() {
    setActionError(null);
    setActionNotice(null);
    setLoadingAction("restore");
    try {
      const restored = unwrap(await window.agentCompany.restoreProfile());
      if (!restored) {
        return;
      }
      await onSaved();
      setActionNotice("Profile restored.");
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={confirmDeleteSecretId !== null}
        title="Delete secret"
        message={`Permanently delete secret "${secretToDelete?.name ?? ""}"? Any connectors referencing it will lose access.`}
        errorMessage={deleteSecretError}
        onConfirm={() => confirmDeleteSecretId && void handleDeleteSecret(confirmDeleteSecretId)}
        onCancel={() => {
          setDeleteSecretError(null);
          setConfirmDeleteSecretId(null);
        }}
      />

      {actionError ? <InlineNotice message={actionError} /> : null}
      {!actionError && actionNotice ? <InlineNotice message={actionNotice} tone="success" /> : null}

      {/* Profile info */}
      <div>
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Profile</div>
        <div className="border-y border-[color:var(--line)] py-4">
          <div className="mb-2 text-[12px] text-[color:var(--muted)]">Profile path</div>
          <div className="mono text-[12px] text-[color:var(--muted-strong)]">{snapshot.profilePath}</div>
        </div>
      </div>

      {/* Theme & updates */}
      <div>
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Preferences</div>
        <Select value={theme} onChange={(value) => setTheme(value as ProfileSnapshot["theme"])} options={[{ value: "system", label: "System" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
        <div className="border-y border-[color:var(--line)] py-4 mt-3">
          <label className="flex items-center justify-between text-[13px] text-[color:var(--muted-strong)]">
            <span>Enable updater checks</span>
            <input type="checkbox" checked={updatesEnabled} onChange={(event) => setUpdatesEnabled(event.target.checked)} />
          </label>
        </div>
      </div>

      {/* Company autonomy */}
      {(() => {
        const company = snapshot.companies.find((c) => c.id === companyId);
        if (!company) return null;
        return (
          <div>
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Company autonomy</div>
            <div className="rounded-[8px] border border-[color:var(--line)] px-4 py-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={company.autoApproveHires}
                  onChange={async (e) => {
                    try {
                      unwrap(await window.agentCompany.saveCompany({
                        id: company.id,
                        name: company.name,
                        description: company.description,
                        status: company.status,
                        autoApproveHires: e.target.checked,
                      }));
                      await onSaved();
                    } catch { /* ignore */ }
                  }}
                  className="h-4 w-4 rounded accent-[color:var(--accent)]"
                />
                <div>
                  <div className="text-[13px] font-medium text-[color:var(--text)]">Full Autonomy Mode</div>
                  <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                    Auto-approve agent hires and CEO strategies. Agents will build the team and start operations without Board approval.
                  </div>
                </div>
              </label>
            </div>
          </div>
        );
      })()}

      {/* Actions */}
      <div>
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Actions</div>
        <div className="grid gap-3 md:grid-cols-2">
          <ActionButton label="Save settings" tone="accent" onClick={() => void handleSaveSettings()} icon={CheckCircle} loading={loadingAction === "save"} />
          <ActionButton label="Check for updates" onClick={() => void handleCheckForUpdates()} icon={Download} loading={loadingAction === "check"} />
          <ActionButton label="Backup profile" onClick={() => void handleBackupProfile()} icon={ClockCounterClockwise} loading={loadingAction === "backup"} />
          <ActionButton label="Restore profile" onClick={() => void handleRestoreProfile()} icon={ArrowClockwise} loading={loadingAction === "restore"} />
        </div>
      </div>

      {/* Secret backend info */}
      <div>
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Secret backend</div>
        <div className="border-y border-[color:var(--line)] py-3 text-[13px] text-[color:var(--muted-strong)]">
          {snapshot.backend.secretBackend}
        </div>
      </div>

      {/* Secrets table */}
      <div>
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Secrets ({secrets.length})</div>
        {secrets.length === 0 ? (
          <EmptyState title="No secrets stored" />
        ) : (
          <div className="border-y border-[color:var(--line)] overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[color:var(--line)]">
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Name</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Description</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Backend</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Updated</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]" />
                </tr>
              </thead>
              <tbody>
                {secrets.map((secret) => (
                  <tr key={secret.id} className="border-b border-[color:var(--line)] last:border-b-0">
                    <td className="px-4 py-3 font-medium text-[color:var(--text)]">{secret.name}</td>
                    <td className="px-4 py-3 text-[color:var(--muted)]">{secret.description || "No description"}</td>
                    <td className="px-4 py-3 mono text-[color:var(--muted-strong)]">{secret.backend}</td>
                    <td className="px-4 py-3 mono text-[color:var(--muted)]">{formatTime(secret.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <ActionButton label="Delete" onClick={() => setConfirmDeleteSecretId(secret.id)} icon={Trash} tone="danger" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Secret Creator ─────────────────────────────────────────────────── */

export function SecretCreator({ companyId, onSaved }: { companyId: string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [errors, setErrors] = useState<{ name?: string; value?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Secret name is required.";
    else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name.trim())) next.name = "Name must be alphanumeric with underscores, starting with a letter or underscore.";
    if (!value.trim()) next.value = "Secret value cannot be empty.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  return (
    <div className="grid gap-4">
      <div>
        <Input label="Secret name" value={name} onChange={(v) => { setName(v); if (errors.name) setErrors((e) => ({ ...e, name: undefined })); }} placeholder="e.g. ANTHROPIC_API_KEY" />
        {errors.name ? <div className="mt-1 text-[12px] text-[color:var(--danger)]" role="alert">{errors.name}</div> : null}
      </div>
      <Input label="Description" value={description} onChange={setDescription} placeholder="What this secret is used for" />
      <div>
        <TextArea label="Secret value" value={value} onChange={(v) => { setValue(v); if (errors.value) setErrors((e) => ({ ...e, value: undefined })); }} rows={5} placeholder="Paste the secret value. It will be encrypted before persistence." />
        {errors.value ? <div className="mt-1 text-[12px] text-[color:var(--danger)]" role="alert">{errors.value}</div> : null}
      </div>
      {submitError ? <InlineNotice message={submitError} /> : null}
      <ActionButton
        label="Store secret"
        tone="accent"
        onClick={() => void (async () => {
          if (!validate()) return;
          setSubmitError(null);
          setSubmitting(true);
          try {
            unwrap(await window.agentCompany.saveSecret({ companyId, name: name.trim(), description, value }));
            setName("");
            setDescription("");
            setValue("");
            setErrors({});
            await onSaved();
          } catch (error) {
            setSubmitError(describeActionError(error));
          } finally {
            setSubmitting(false);
          }
        })()}
        icon={ShieldCheck}
        loading={submitting}
      />
      <div className="border-t border-[color:var(--line)] pt-4 text-[12px] leading-relaxed text-[color:var(--muted)]">
        Connector secret bindings use `ENV_NAME=secret-name` lines. Values stay outside renderer state after submission.
      </div>
    </div>
  );
}
