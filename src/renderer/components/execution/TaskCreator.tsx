import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
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

  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <Input label={t("exec.title")} value={title} onChange={setTitle} placeholder={t("exec.taskTitle")} />
      <Select label={t("exec.priority")} value={priority} onChange={setPriority} options={["critical","high","medium","low"].map((v) => ({ value: v, label: v }))} />
      <div className="md:col-span-2"><TextArea label="Description" value={description} onChange={setDescription} placeholder="Describe the task" rows={5} /></div>
      <div className="md:col-span-2">
        <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground">
          <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}><path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
          {t("exec.goal")}, {t("exec.project")}, {t("exec.assignee")}, {t("exec.workspace")}
        </button>
      </div>
      <AnimatePresence>
      {showAdvanced ? (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }} className="grid gap-4 overflow-hidden md:col-span-2 md:grid-cols-2">
          <Select label={t("exec.goal")} value={goalId} onChange={setGoalId} options={[{ value: "", label: t("exec.noGoal") }, ...goals.map((g) => ({ value: g.id, label: g.title }))]} />
          <Select label={t("exec.project")} value={projectId} onChange={setProjectId} options={[{ value: "", label: t("exec.noProject") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          <Select label={t("exec.assignee")} value={assigneeAgentId} onChange={setAssigneeAgentId} options={[{ value: "", label: t("exec.unassigned") }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
          <Select label={t("exec.workspace")} value={workspaceId} onChange={setWorkspaceId} options={[{ value: "", label: t("exec.noWorkspace") }, ...workspaces.map((w) => ({ value: w.id, label: w.name }))]} />
        </motion.div>
      ) : null}
      </AnimatePresence>
      {submitError ? <div className="md:col-span-2"><InlineNotice message={submitError} /></div> : null}
      <div className="md:col-span-2"><ActionButton label={t("exec.createTask")} tone="accent" onClick={() => void handleCreateTask()} icon={ListChecks} loading={submitting} /></div>
    </div>
  )
}
