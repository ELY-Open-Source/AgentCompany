import { useState } from "react"
import { CheckCircle, XCircle } from "../ui/icons"
import type { GoalRecord, ProfileSnapshot, ProjectRecord, TaskRecord, TaskStatus, WorkspaceRecord } from "@shared/types"
import { useT } from "../../i18n"
import { unwrap } from "../../lib/desktop"
import { ActionButton, Input, Select, TextArea } from "../ui"
import { describeActionError } from "./execution-utils"

export function TaskInspectorEditForm({
  task, agents, goals, projects, workspaces, onDone, onRefresh, onError, onNotice, addToast,
}: {
  task: TaskRecord
  agents: ProfileSnapshot["agents"]
  goals: GoalRecord[]
  projects: ProjectRecord[]
  workspaces: WorkspaceRecord[]
  onDone: () => void
  onRefresh: () => Promise<void>
  onError: (message: string | null) => void
  onNotice: (message: string | null) => void
  addToast: (message: string, tone?: "success" | "warn" | "danger") => void
}) {
  const t = useT()
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [priority, setPriority] = useState(task.priority)
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [assignee, setAssignee] = useState(task.assigneeAgentId ?? "")
  const [workspace, setWorkspace] = useState(task.workspaceId ?? "")
  const [requiresFilesystem, setRequiresFilesystem] = useState(task.requiresFilesystem)
  const [project, setProject] = useState(task.projectId ?? "")
  const [goal, setGoal] = useState(task.goalId ?? "")
  const [saving, setSaving] = useState(false)

  const save = async () => {
    onError(null); onNotice(null); setSaving(true)
    try {
      unwrap(await window.agentCompany.saveTask({
        id: task.id,
        companyId: task.companyId,
        title,
        description,
        priority: priority as TaskRecord["priority"],
        status,
        assigneeAgentId: assignee || null,
        workspaceId: workspace || null,
        requiresFilesystem,
        projectId: project || null,
        goalId: goal || null,
      }))
      await onRefresh()
      onDone()
      onNotice("Task changes saved.")
      addToast("Task changes saved", "success")
    } catch (e) {
      onError(describeActionError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      <div className="md:col-span-2"><Input label={t("exec.title")} value={title} onChange={setTitle} placeholder={t("exec.taskTitle")} /></div>
      <div className="md:col-span-2"><TextArea label={t("exec.description")} value={description} onChange={setDescription} placeholder={t("exec.description")} rows={4} /></div>
      <Select label={t("exec.priority")} value={priority} onChange={(v) => setPriority(v as TaskRecord["priority"])} options={["critical", "high", "medium", "low"].map((v) => ({ value: v, label: v }))} />
      <Select label={t("exec.status")} value={status} onChange={(v) => setStatus(v as TaskStatus)} options={["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"].map((v) => ({ value: v, label: v.replaceAll("_", " ") }))} />
      <Select label={t("exec.assignee")} value={assignee} onChange={setAssignee} options={[{ value: "", label: t("exec.unassigned") }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
      <Select label={t("exec.workspace")} value={workspace} onChange={setWorkspace} options={[{ value: "", label: t("exec.noWorkspace") }, ...workspaces.map((w) => ({ value: w.id, label: w.name }))]} />
      <label className="flex items-center gap-2.5 md:col-span-2">
        <input
          type="checkbox"
          checked={requiresFilesystem}
          onChange={(event) => setRequiresFilesystem(event.target.checked)}
          className="h-4 w-4 rounded border-border accent-[color:var(--primary)]"
        />
        <span className="text-[13px] text-foreground">{t("exec.requiresFilesystem")}</span>
      </label>
      <Select label={t("exec.project")} value={project} onChange={setProject} options={[{ value: "", label: t("exec.noProject") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
      <Select label={t("exec.goal")} value={goal} onChange={setGoal} options={[{ value: "", label: t("exec.noGoal") }, ...goals.map((g) => ({ value: g.id, label: g.title }))]} />
      <div className="md:col-span-2 flex gap-3">
        <ActionButton label={t("exec.save")} tone="accent" onClick={() => void save()} icon={CheckCircle} loading={saving} />
        <ActionButton label={t("exec.cancel")} onClick={onDone} icon={XCircle} />
      </div>
    </div>
  )
}
