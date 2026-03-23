import { useState } from "react"
import { ListChecks } from "@phosphor-icons/react"
import type { GoalRecord, ProfileSnapshot, ProjectRecord, WorkspaceRecord, TaskRecord } from "@shared/types"
import { useT } from "../../i18n"
import { unwrap } from "../../lib/desktop"
import { ActionButton, InlineNotice, Input, Select, TextArea } from "../ui"
import { describeActionError } from "./execution-utils"

export function TaskCreator({ companyId, goals, projects, agents, workspaces, onSaved }: {
  companyId: string; goals: GoalRecord[]; projects: ProjectRecord[]; agents: ProfileSnapshot["agents"]; workspaces: WorkspaceRecord[]; onSaved: () => Promise<void>
}) {
  const t = useT()
  const [title, setTitle] = useState(""); const [description, setDescription] = useState("")
  const [goalId, setGoalId] = useState(goals[0]?.id ?? ""); const [projectId, setProjectId] = useState(projects[0]?.id ?? "")
  const [assigneeAgentId, setAssigneeAgentId] = useState(agents[0]?.id ?? ""); const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "")
  const [priority, setPriority] = useState("medium"); const [submitError, setSubmitError] = useState<string | null>(null); const [submitting, setSubmitting] = useState(false)

  async function handleCreateTask() {
    setSubmitError(null); setSubmitting(true)
    try { unwrap(await window.agentCompany.saveTask({ companyId, projectId: projectId || null, goalId: goalId || null, title, description, assigneeAgentId: assigneeAgentId || null, workspaceId: workspaceId || null, priority: priority as TaskRecord["priority"], status: "todo" })); setTitle(""); setDescription(""); await onSaved() } catch (e) { setSubmitError(describeActionError(e)) } finally { setSubmitting(false) }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Input label={t("exec.title")} value={title} onChange={setTitle} placeholder={t("exec.taskTitle")} />
      <Select label={t("exec.priority")} value={priority} onChange={setPriority} options={["critical","high","medium","low"].map((v) => ({ value: v, label: v }))} />
      <div className="md:col-span-2"><TextArea label="Description" value={description} onChange={setDescription} placeholder="Describe the task" rows={5} /></div>
      <Select label={t("exec.goal")} value={goalId} onChange={setGoalId} options={[{ value: "", label: t("exec.noGoal") }, ...goals.map((g) => ({ value: g.id, label: g.title }))]} />
      <Select label={t("exec.project")} value={projectId} onChange={setProjectId} options={[{ value: "", label: t("exec.noProject") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
      <Select label={t("exec.assignee")} value={assigneeAgentId} onChange={setAssigneeAgentId} options={[{ value: "", label: t("exec.unassigned") }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
      <Select label={t("exec.workspace")} value={workspaceId} onChange={setWorkspaceId} options={[{ value: "", label: t("exec.noWorkspace") }, ...workspaces.map((w) => ({ value: w.id, label: w.name }))]} />
      {submitError ? <div className="md:col-span-2"><InlineNotice message={submitError} /></div> : null}
      <div className="md:col-span-2"><ActionButton label={t("exec.createTask")} tone="accent" onClick={() => void handleCreateTask()} icon={ListChecks} loading={submitting} /></div>
    </div>
  )
}
