import { useState } from "react"
import { ArrowSquareOut, FolderOpen, Trash } from "../ui/icons"
import type { ProjectRecord, WorkspaceRecord } from "@shared/types"
import { useT } from "../../i18n"
import { unwrap } from "../../lib/desktop"
import { ActionButton, ConfirmDialog, EmptyState, ListFrame, ListRow } from "../ui"
import { describeActionError, WorkspaceStatePill } from "./execution-utils"

export function WorkspaceList({ workspaces, projects, companyId, selectedWorkspaceId, onSelect, onOpen, onDeleted }: {
  workspaces: WorkspaceRecord[]; projects: ProjectRecord[]; companyId: string; selectedWorkspaceId: string | null
  onSelect: (workspaceId: string) => void; onOpen: (path: string) => Promise<void>; onDeleted: () => Promise<void>
}) {
  const t = useT()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null); const [deleteError, setDeleteError] = useState<string | null>(null)
  const toDelete = workspaces.find((w) => w.id === confirmDeleteId) ?? null
  async function handleDelete(id: string) { setDeleteError(null); try { unwrap(await window.agentCompany.deleteWorkspace({ id, companyId })); setConfirmDeleteId(null); await onDeleted() } catch (e) { setDeleteError(describeActionError(e)) } }

  if (workspaces.length === 0) return <EmptyState title={t("exec.noWorkspacesYet")} />
  return (
    <>
      <ConfirmDialog open={confirmDeleteId !== null} title={t("exec.deleteWorkspace")} message={t("exec.deleteWorkspaceConfirm").replace("{0}", toDelete?.name ?? "")} errorMessage={deleteError} onConfirm={() => confirmDeleteId && void handleDelete(confirmDeleteId)} onCancel={() => { setDeleteError(null); setConfirmDeleteId(null) }} />
      <ListFrame>
        {workspaces.map((workspace) => {
          const linkedProject = projects.find((p) => p.id === workspace.projectId) ?? null
          return (
            <ListRow key={workspace.id}>
              {(() => {
                const isSelected = selectedWorkspaceId === workspace.id;
                return (
                  <div className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-l-2 py-2 pl-2 pr-1 transition-colors ${isSelected ? "border-l-[color:var(--success)]" : "border-l-transparent hover:border-l-border"}`}>
                    <span aria-hidden="true" className={`select-none transition-colors ${isSelected ? "text-success" : "text-muted-foreground group-hover:text-foreground"}`}>›</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-[13px] font-medium text-foreground">{workspace.name}</div>
                        <WorkspaceStatePill state={workspace.state} />
                        {workspace.isPrimary ? <span className="text-[11px] text-muted-foreground">· Primary</span> : null}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">{workspace.localPath}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{workspace.repoUrl || "No remote URL"}{workspace.repoRef ? ` · ${workspace.repoRef}` : ""}{linkedProject ? <span> · Project: <span className="text-foreground">{linkedProject.name}</span></span> : null}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ActionButton label={t("exec.inspect")} onClick={() => onSelect(workspace.id)} icon={FolderOpen} />
                      <ActionButton label={t("exec.reveal")} onClick={() => void onOpen(workspace.localPath)} icon={ArrowSquareOut} />
                      <ActionButton label={t("exec.delete")} onClick={() => setConfirmDeleteId(workspace.id)} icon={Trash} tone="danger" />
                    </div>
                  </div>
                );
              })()}
            </ListRow>
          )
        })}
      </ListFrame>
    </>
  )
}
