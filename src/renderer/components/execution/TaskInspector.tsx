import { useCallback, useEffect, useState, useMemo } from "react"
import { CheckCircle, ListChecks, Pencil, Play, ShieldCheck, Trash, XCircle, Warning, Robot, ArrowRight } from "@phosphor-icons/react"
import type { AgentRecord, CommentRecord, GoalRecord, ProfileSnapshot, ProjectRecord, RunRecord, TaskRecord, TaskStatus, WorkspaceRecord } from "@shared/types"
import { useT } from "../../i18n"
import { formatMoney, formatTime } from "../../lib/formatters"
import { unwrap } from "../../lib/desktop"
import { ActionButton, ConfirmDialog, InlineNotice, Input, Select, StatusPill, TextArea } from "../ui"
import { describeActionError, PriorityDot } from "./execution-utils"
import { TaskComments } from "./TaskComments"
import { useAppStore } from "../../state/store"

export function TaskInspector({ task, tasks, runs, agents, goals, projects, workspaces, companyId, onRun, onCancelRun, onCreateApproval, onOpenDiscussion, comments, onRefresh, onDeleted }: {
  task: TaskRecord; tasks: TaskRecord[]; runs: RunRecord[]; agents: ProfileSnapshot["agents"]; goals: GoalRecord[]; projects: ProjectRecord[]; workspaces: WorkspaceRecord[]; companyId: string
  onRun: (taskId: string) => Promise<void>; onCancelRun: (runId: string) => Promise<void>; onCreateApproval: () => Promise<void>; onOpenDiscussion: (taskId: string) => void
  comments: CommentRecord[]; onRefresh: () => Promise<void>; onDeleted: () => Promise<void>
}) {
  const t = useT()
  const addToast = useAppStore((s) => s.addToast)
  const [editing, setEditing] = useState(false); const [editTitle, setEditTitle] = useState(task.title); const [editDescription, setEditDescription] = useState(task.description)
  const [editPriority, setEditPriority] = useState(task.priority); const [editStatus, setEditStatus] = useState<TaskStatus>(task.status); const [editAssignee, setEditAssignee] = useState(task.assigneeAgentId ?? "")
  const [editWorkspace, setEditWorkspace] = useState(task.workspaceId ?? ""); const [editProject, setEditProject] = useState(task.projectId ?? ""); const [editGoal, setEditGoal] = useState(task.goalId ?? "")
  const [confirmDelete, setConfirmDelete] = useState(false); const [actionError, setActionError] = useState<string | null>(null); const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null); const [savingChanges, setSavingChanges] = useState(false); const [updatingStatus, setUpdatingStatus] = useState<TaskStatus | null>(null); const [creatingApproval, setCreatingApproval] = useState(false)

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const assignee = agentMap.get(task.assigneeAgentId ?? "") ?? null; const project = projects.find((e) => e.id === task.projectId) ?? null
  const goal = goals.find((e) => e.id === task.goalId) ?? null; const workspace = workspaces.find((e) => e.id === task.workspaceId) ?? null
  const activeRun = runs.find((r) => r.id === task.activeRunId) ?? null; const reviewer = assignee?.reportsTo ? (agentMap.get(assignee.reportsTo) ?? null) : null
  const needsGovernance = task.status === "blocked" || (task.status === "in_review" && !reviewer)
  const budgetWarning = assignee && assignee.budgetMonthlyUsd > 0 ? assignee.spentMonthlyUsd / assignee.budgetMonthlyUsd : 0

  function startEdit() { setActionError(null); setActionNotice(null); setEditTitle(task.title); setEditDescription(task.description); setEditPriority(task.priority); setEditStatus(task.status); setEditAssignee(task.assigneeAgentId ?? ""); setEditWorkspace(task.workspaceId ?? ""); setEditProject(task.projectId ?? ""); setEditGoal(task.goalId ?? ""); setEditing(true) }
  async function saveChanges() { setActionError(null); setActionNotice(null); setSavingChanges(true); try { unwrap(await window.agentCompany.saveTask({ id: task.id, companyId: task.companyId, title: editTitle, description: editDescription, priority: editPriority as TaskRecord["priority"], status: editStatus, assigneeAgentId: editAssignee || null, workspaceId: editWorkspace || null, projectId: editProject || null, goalId: editGoal || null })); await onRefresh(); setEditing(false); setActionNotice("Task changes saved."); addToast("Task changes saved", "success") } catch (e) { setActionError(describeActionError(e)) } finally { setSavingChanges(false) } }
  async function quickStatus(status: TaskStatus) { setActionError(null); setActionNotice(null); setUpdatingStatus(status); try { unwrap(await window.agentCompany.saveTask({ id: task.id, companyId: task.companyId, title: task.title, description: task.description, priority: task.priority, status, assigneeAgentId: task.assigneeAgentId, workspaceId: task.workspaceId, projectId: task.projectId, goalId: task.goalId })); await onRefresh(); setActionNotice(`Task moved to ${status.replaceAll("_", " ")}.`) } catch (e) { setActionError(describeActionError(e)) } finally { setUpdatingStatus(null) } }
  async function handleCreateApproval() { setActionError(null); setActionNotice(null); setCreatingApproval(true); try { await onCreateApproval(); setActionNotice(task.status === "blocked" ? "Approval created and routed to leadership." : "Approval created."); addToast("Approval created and routed to leadership", "success") } catch (e) { setActionError(describeActionError(e)) } finally { setCreatingApproval(false) } }
  async function handleDelete() { setDeleteError(null); try { unwrap(await window.agentCompany.deleteTask({ id: task.id, companyId })); setConfirmDelete(false); addToast("Task deleted", "success"); await onDeleted() } catch (e) { setDeleteError(describeActionError(e)) } }

  return (
    <div className="space-y-6">
      <ConfirmDialog open={confirmDelete} title={t("exec.deleteTask")} message={`${t("exec.deleteTaskConfirm").replace("{0}", task.title)}`} errorMessage={deleteError} onConfirm={() => void handleDelete()} onCancel={() => { setDeleteError(null); setConfirmDelete(false) }} />
      {budgetWarning > 0.8 && assignee ? <div className={`flex items-center gap-2 rounded-[8px] border px-4 py-3 text-[13px] font-medium ${budgetWarning > 1 ? "border-[color:var(--danger)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]" : "border-[color:var(--warn)] bg-[color:var(--warn-soft)] text-[color:var(--warn)]"}`}><Warning size={16} weight="fill" />{assignee.name} has used {Math.round(budgetWarning * 100)}% of their monthly budget ({formatMoney(assignee.spentMonthlyUsd)} / {formatMoney(assignee.budgetMonthlyUsd)})</div> : null}
      {actionError ? <InlineNotice message={actionError} /> : null}
      {!actionError && actionNotice ? <InlineNotice message={actionNotice} tone="success" /> : null}
      {editing ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2"><Input label={t("exec.title")} value={editTitle} onChange={setEditTitle} placeholder={t("exec.taskTitle")} /></div>
          <div className="md:col-span-2"><TextArea label={t("exec.description")} value={editDescription} onChange={setEditDescription} placeholder={t("exec.description")} rows={4} /></div>
          <Select label={t("exec.priority")} value={editPriority} onChange={v => setEditPriority(v as TaskRecord["priority"])} options={["critical","high","medium","low"].map(v => ({ value: v, label: v }))} />
          <Select label={t("exec.status")} value={editStatus} onChange={v => setEditStatus(v as TaskStatus)} options={["backlog","todo","in_progress","in_review","done","blocked","cancelled"].map(v => ({ value: v, label: v.replaceAll("_"," ") }))} />
          <Select label={t("exec.assignee")} value={editAssignee} onChange={setEditAssignee} options={[{ value: "", label: t("exec.unassigned") }, ...agents.map(a => ({ value: a.id, label: a.name }))]} />
          <Select label={t("exec.workspace")} value={editWorkspace} onChange={setEditWorkspace} options={[{ value: "", label: t("exec.noWorkspace") }, ...workspaces.map(w => ({ value: w.id, label: w.name }))]} />
          <Select label={t("exec.project")} value={editProject} onChange={setEditProject} options={[{ value: "", label: t("exec.noProject") }, ...projects.map(p => ({ value: p.id, label: p.name }))]} />
          <Select label={t("exec.goal")} value={editGoal} onChange={setEditGoal} options={[{ value: "", label: t("exec.noGoal") }, ...goals.map(g => ({ value: g.id, label: g.title }))]} />
          <div className="md:col-span-2 flex gap-3"><ActionButton label={t("exec.save")} tone="accent" onClick={() => void saveChanges()} icon={CheckCircle} loading={savingChanges} /><ActionButton label={t("exec.cancel")} onClick={() => setEditing(false)} icon={XCircle} /></div>
        </div>
      ) : (
        <>
          <div className="grid gap-x-6 gap-y-2 text-[13px] md:grid-cols-2">
            {assignee && <div className="text-[color:var(--muted)]">Assignee: <span className="text-[color:var(--text)]">{assignee.name}</span></div>}
            {project && <div className="text-[color:var(--muted)]">Project: <span className="text-[color:var(--text)]">{project.name}</span></div>}
            {goal && <div className="text-[color:var(--muted)]">Goal: <span className="text-[color:var(--text)]">{goal.title}</span></div>}
            {task.parentId && (() => { const parent = tasks.find((t) => t.id === task.parentId); return parent ? <div className="text-[color:var(--muted)]">Parent: <span className="text-[color:var(--text)]">{parent.title}</span></div> : null })()}
            {workspace && <div className="text-[color:var(--muted)]">Workspace: <span className="text-[color:var(--text)]">{workspace.name}</span></div>}
            {task.costUsd > 0 && <div className="text-[color:var(--muted)]">Cost: <span className="mono tabular-nums text-[color:var(--text)]">{formatMoney(task.costUsd)}</span></div>}
          </div>
          {task.description ? <div className="text-[13px] leading-relaxed text-[color:var(--muted-strong)] whitespace-pre-wrap">{task.description}</div> : null}
          {task.status === "in_review" && reviewer ? <div className="rounded-[8px] border border-[color:var(--accent-soft)] bg-[color:var(--accent-soft)] px-4 py-3"><div className="flex items-center gap-2 text-[13px] font-semibold text-[color:var(--accent-text)]"><Robot size={16} weight="fill" />Being reviewed by {reviewer.name}{reviewer.title ? ` (${reviewer.title})` : ""}</div><div className="mt-1 text-[13px] leading-relaxed text-[color:var(--accent-text)]">{assignee?.name} submitted this task for review. {reviewer.name} will approve, request revisions, or escalate.</div></div>
          : needsGovernance ? <div className="rounded-[8px] border border-[color:var(--warn)] bg-[color:var(--warn-soft)] px-4 py-3"><div className="flex items-center gap-2 text-[13px] font-semibold text-[color:var(--warn)]"><ShieldCheck size={16} weight="fill" />{task.status === "blocked" ? t("exec.governanceRequired") : t("exec.waitingOnReview")}</div><div className="mt-1 text-[13px] leading-relaxed text-[color:var(--muted-strong)]">{task.status === "blocked" ? t("exec.blockedGovernance") : t("exec.reviewGovernance")}</div><div className="mt-3"><ActionButton label={task.status === "blocked" ? t("exec.createUnblockApproval") : t("exec.createReviewApproval")} onClick={() => void handleCreateApproval()} icon={ShieldCheck} loading={creatingApproval} /></div></div> : null}
          <div className="flex items-center gap-3">
            {activeRun ? <ActionButton label={t("exec.cancelRun")} onClick={() => void onCancelRun(activeRun.id)} icon={XCircle} tone="danger" /> : <>
              {["todo","in_progress","blocked"].includes(task.status) && <ActionButton label={t("exec.run")} onClick={() => void onRun(task.id)} icon={Play} tone="accent" />}
              {task.status === "in_review" && <ActionButton label={t("exec.done")} onClick={() => void quickStatus("done")} icon={CheckCircle} tone="accent" loading={updatingStatus === "done"} />}
              {task.status === "blocked" && <ActionButton label={t("exec.unblock")} onClick={() => void quickStatus("in_progress")} icon={Play} loading={updatingStatus === "in_progress"} />}
            </>}
            <ActionButton label={t("exec.discussion")} onClick={() => onOpenDiscussion(task.id)} icon={ArrowRight} />
            <ActionButton label={t("exec.edit")} onClick={startEdit} icon={Pencil} />
            <ActionButton label={t("exec.delete")} onClick={() => setConfirmDelete(true)} icon={Trash} tone="danger" />
          </div>
        </>
      )}
      {(() => { const subtasks = tasks.filter((t) => t.parentId === task.id); if (subtasks.length === 0) return null; return (
        <div className="space-y-2">
          <div className="flex items-center gap-2"><ListChecks size={14} className="text-[color:var(--muted)]" /><span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("exec.subtasks")} ({subtasks.length})</span><span className="text-[10px] text-[color:var(--success)]">{subtasks.filter((t) => t.status === "done").length}/{subtasks.length} done</span></div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--panel-soft)]"><div className="h-full rounded-full bg-[color:var(--success)] transition-all duration-300" style={{ width: `${subtasks.length > 0 ? (subtasks.filter((t) => t.status === "done").length / subtasks.length) * 100 : 0}%` }} /></div>
          <div className="space-y-1">{subtasks.map((sub) => { const subAssignee = agentMap.get(sub.assigneeAgentId ?? ""); return (
            <div key={sub.id} className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-[12px] bg-[color:var(--panel-soft)]">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sub.status === "done" ? "bg-[color:var(--success)]" : sub.status === "in_progress" ? "bg-[color:var(--accent)]" : sub.status === "blocked" ? "bg-[color:var(--danger)]" : sub.status === "in_review" ? "bg-[color:var(--warn)]" : "bg-[color:var(--muted)]"}`} />
              <span className={`flex-1 truncate ${sub.status === "done" ? "line-through text-[color:var(--muted)]" : "text-[color:var(--text)]"}`}>{sub.title}</span>
              {subAssignee ? <span className="shrink-0 text-[10px] text-[color:var(--muted)]">{subAssignee.name}</span> : null}<StatusPill status={sub.status} />
            </div>) })}</div></div>) })()}
      <TaskComments taskId={task.id} companyId={task.companyId} agents={agents} comments={comments} onRefresh={onRefresh} />
      {runs.length > 0 && <div className="space-y-2"><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("exec.runHistory")}</div><div className="space-y-2">{runs.slice(0, 8).map((run) => { const runAgent = agentMap.get(run.agentId); const isActive = run.status === "running" || run.status === "queued"; return (
        <div key={run.id} className={`rounded-[8px] border px-3 py-2.5 ${isActive ? "border-[color:var(--success)] bg-[color:var(--success-soft)]" : run.status === "failed" || run.status === "timed_out" ? "border-[color:var(--danger)] border-opacity-30 bg-[color:var(--danger-soft)]" : "border-[color:var(--line)] bg-[color:var(--panel-soft)]"}`}>
          <div className="flex items-center justify-between gap-2"><div className="min-w-0 flex-1"><div className="flex items-center gap-2">{isActive ? <span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--success)]" /> : null}<span className="truncate text-[13px] font-medium text-[color:var(--text)]">{run.summary || (isActive ? "Running..." : "Completed run")}</span></div><div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[color:var(--muted)]">{runAgent ? <span>{runAgent.name}</span> : null}<span>{run.connectorId.replace("_local", "")}</span>{run.model ? <span className="mono">{run.model}</span> : null}<span>{formatTime(run.startedAt)}</span>{run.costUsd != null && run.costUsd > 0 ? <span className="mono tabular-nums">{formatMoney(run.costUsd)}</span> : null}</div></div><StatusPill status={run.status} /></div>
          {run.errorMessage ? <div className="mt-1.5 rounded bg-[color:var(--danger-soft)] px-2 py-1 text-[11px] text-[color:var(--danger)] break-words">{run.errorMessage}</div> : null}
        </div>) })}{runs.length > 8 && <div className="text-[11px] text-[color:var(--muted)] text-center">+{runs.length - 8} more runs</div>}</div></div>}
    </div>
  )
}
