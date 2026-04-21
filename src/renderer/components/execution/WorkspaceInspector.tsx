import { ArrowSquareOut } from "../ui/icons"
import type { AgentRecord, DocumentRecord, ProjectRecord, RunRecord, TaskRecord, WorkspaceRecord } from "@shared/types"
import { useT } from "../../i18n"
import { formatTime } from "../../lib/formatters"
import { ActionButton, EmptyState, StatusPill } from "../ui"
import { PriorityDot } from "./execution-utils"

export function WorkspaceInspector({ workspace, agents, tasks, runs, documents: _documents, project, onOpen }: {
  workspace: WorkspaceRecord | null; agents: AgentRecord[]; tasks: TaskRecord[]; runs: RunRecord[]; documents: DocumentRecord[]; project: ProjectRecord | null; onOpen: (path: string) => Promise<void>
}) {
  const t = useT()
  if (!workspace) return <EmptyState title={t("exec.selectWorkspace")} />
  const wAgents = agents.filter((a) => a.workspaceId === workspace.id); const wTasks = tasks.filter((tk) => tk.workspaceId === workspace.id)
  const wRuns = runs.filter((r) => r.workspaceId === workspace.id)
  const hasMeta = Boolean(project || workspace.repoUrl || workspace.repoRef)

  return (
    <div className="space-y-5">
      {hasMeta ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-[12px] text-muted-foreground">
            {project ? <>Project: <span className="text-foreground">{project.name}</span></> : null}
            {workspace.repoUrl ? <span>{project ? " · " : ""}Repo: <span className="text-foreground">{workspace.repoUrl}</span></span> : null}
            {workspace.repoRef ? <span> · Ref: <span className="text-foreground">{workspace.repoRef}</span></span> : null}
          </div>
          <ActionButton label={t("exec.openFolder")} onClick={() => void onOpen(workspace.localPath)} icon={ArrowSquareOut} />
        </div>
      ) : (
        <div className="flex items-start justify-end">
          <ActionButton label={t("exec.openFolder")} onClick={() => void onOpen(workspace.localPath)} icon={ArrowSquareOut} />
        </div>
      )}
      <div className="grid gap-10 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        <section>
          <div className="mb-2 flex items-baseline gap-2 border-b border-border pb-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <span>{t("exec.assignedAgents")}</span>
            <span className="text-primary tracking-normal">{wAgents.length}</span>
          </div>
          {wAgents.length === 0 ? (
            <div className="py-2 pl-2 text-[12px] text-muted-foreground">{t("exec.noAgentsBound")}</div>
          ) : (
            <div className="divide-y divide-border/60">
              {wAgents.map((a) => (
                <div key={a.id} className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-l-2 border-transparent py-2 pl-2 pr-1 transition-colors hover:border-l-[color:var(--primary)]">
                  <span aria-hidden="true" className="select-none text-muted-foreground transition-colors group-hover:text-primary">›</span>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-foreground">{a.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{a.role}</div>
                  </div>
                  <StatusPill status={a.status} />
                </div>
              ))}
            </div>
          )}
        </section>
        <section>
          <div className="mb-2 flex items-baseline gap-2 border-b border-border pb-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <span>{t("exec.openTasks")}</span>
            <span className="text-primary tracking-normal">{wTasks.length}</span>
          </div>
          {wTasks.length === 0 ? (
            <div className="py-2 pl-2 text-[12px] text-muted-foreground">{t("exec.noTasksTarget")}</div>
          ) : (
            <div className="divide-y divide-border/60">
              {wTasks.slice(0, 6).map((tk) => (
                <div key={tk.id} className="group grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-l-2 border-transparent py-2 pl-2 pr-1 transition-colors hover:border-l-[color:var(--primary)]">
                  <span aria-hidden="true" className="select-none pt-[1px] text-muted-foreground transition-colors group-hover:text-primary">›</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <PriorityDot priority={tk.priority} />
                      <span className="text-[12px] font-medium text-foreground">{tk.title}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{tk.status.replaceAll("_", " ")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section>
          <div className="mb-2 flex items-baseline gap-2 border-b border-border pb-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <span>{t("exec.recentRuns")}</span>
            <span className="text-primary tracking-normal">{wRuns.length}</span>
          </div>
          {wRuns.length === 0 ? (
            <div className="py-2 pl-2 text-[12px] text-muted-foreground">{t("exec.noRunsExecuted")}</div>
          ) : (
            <div className="divide-y divide-border/60">
              {wRuns.slice(0, 6).map((r) => (
                <div key={r.id} className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-l-2 border-transparent py-2 pl-2 pr-1 transition-colors hover:border-l-[color:var(--primary)]">
                  <span aria-hidden="true" className="select-none pt-[1px] text-muted-foreground transition-colors group-hover:text-primary">›</span>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-foreground">{r.summary || `Run ${r.id.slice(0, 8)}`}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{formatTime(r.startedAt)} → {formatTime(r.finishedAt)}</div>
                  </div>
                  <StatusPill status={r.status} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
