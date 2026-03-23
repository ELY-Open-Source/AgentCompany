import { ArrowSquareOut } from "@phosphor-icons/react"
import type { AgentRecord, DocumentRecord, ProjectRecord, RunRecord, TaskRecord, WorkspaceRecord } from "@shared/types"
import { useT } from "../../i18n"
import { formatTime } from "../../lib/formatters"
import { ActionButton, EmptyState, StatusPill } from "../ui"
import { PriorityDot, WorkspaceStatePill } from "./execution-utils"

export function WorkspaceInspector({ workspace, agents, tasks, runs, documents, project, onOpen }: {
  workspace: WorkspaceRecord | null; agents: AgentRecord[]; tasks: TaskRecord[]; runs: RunRecord[]; documents: DocumentRecord[]; project: ProjectRecord | null; onOpen: (path: string) => Promise<void>
}) {
  const t = useT()
  if (!workspace) return <EmptyState title={t("exec.selectWorkspace")} detail={t("exec.selectWorkspaceDetail")} />
  const wAgents = agents.filter((a) => a.workspaceId === workspace.id); const wTasks = tasks.filter((tk) => tk.workspaceId === workspace.id)
  const wRuns = runs.filter((r) => r.workspaceId === workspace.id); const wDocs = documents.filter((d) => d.projectId && project && d.projectId === project.id)

  return (
    <div className="space-y-5">
      <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><div className="text-[15px] font-semibold text-[color:var(--text)]">{workspace.name}</div><WorkspaceStatePill state={workspace.state} /></div><div className="mono mt-1 text-[11px] text-[color:var(--muted)]">{workspace.localPath}</div><div className="mt-2 text-[12px] text-[color:var(--muted)]">{project ? <>Project: <span className="text-[color:var(--text)]">{project.name}</span></> : "No linked project"}{workspace.repoUrl ? <span> · Repo: <span className="text-[color:var(--text)]">{workspace.repoUrl}</span></span> : null}{workspace.repoRef ? <span> · Ref: <span className="text-[color:var(--text)]">{workspace.repoRef}</span></span> : null}</div></div><ActionButton label={t("exec.openFolder")} onClick={() => void onOpen(workspace.localPath)} icon={ArrowSquareOut} /></div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {[{ label: t("exec.agents"), val: wAgents.length }, { label: t("exec.tasks"), val: wTasks.length }, { label: t("exec.runs"), val: wRuns.length }, { label: t("exec.docs"), val: wDocs.length }].map((s) => (
          <div key={s.label} className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4"><div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted)]">{s.label}</div><div className="mt-2 text-[24px] font-semibold text-[color:var(--text)]">{s.val}</div></div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4"><div className="mb-3 text-[12px] font-semibold text-[color:var(--text)]">{t("exec.assignedAgents")}</div>{wAgents.length === 0 ? <div className="text-[12px] text-[color:var(--muted)]">{t("exec.noAgentsBound")}</div> : <div className="space-y-2">{wAgents.map((a) => <div key={a.id} className="flex items-center justify-between rounded-[8px] bg-[color:var(--panel-soft)] px-3 py-2"><div><div className="text-[12px] font-medium text-[color:var(--text)]">{a.name}</div><div className="text-[11px] text-[color:var(--muted)]">{a.role}</div></div><StatusPill status={a.status} /></div>)}</div>}</div>
        <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4"><div className="mb-3 text-[12px] font-semibold text-[color:var(--text)]">{t("exec.openTasks")}</div>{wTasks.length === 0 ? <div className="text-[12px] text-[color:var(--muted)]">{t("exec.noTasksTarget")}</div> : <div className="space-y-2">{wTasks.slice(0, 6).map((tk) => <div key={tk.id} className="rounded-[8px] bg-[color:var(--panel-soft)] px-3 py-2"><div className="flex items-center gap-2"><PriorityDot priority={tk.priority} /><span className="text-[12px] font-medium text-[color:var(--text)]">{tk.title}</span></div><div className="mt-1 text-[11px] text-[color:var(--muted)]">{tk.status.replaceAll("_"," ")}</div></div>)}</div>}</div>
        <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4"><div className="mb-3 text-[12px] font-semibold text-[color:var(--text)]">{t("exec.recentRuns")}</div>{wRuns.length === 0 ? <div className="text-[12px] text-[color:var(--muted)]">{t("exec.noRunsExecuted")}</div> : <div className="space-y-2">{wRuns.slice(0, 6).map((r) => <div key={r.id} className="rounded-[8px] bg-[color:var(--panel-soft)] px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium text-[color:var(--text)]">{r.summary || `Run ${r.id.slice(0, 8)}`}</span><StatusPill status={r.status} /></div><div className="mt-1 text-[11px] text-[color:var(--muted)]">{formatTime(r.startedAt)} → {formatTime(r.finishedAt)}</div></div>)}</div>}</div>
      </div>
    </div>
  )
}
