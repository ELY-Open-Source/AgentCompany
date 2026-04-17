import { useState } from "react"
import { ArrowSquareOut, FolderOpen, Trash } from "../ui/icons"
import type { ProjectRecord, WorkspaceRecord } from "@shared/types"
import { useT } from "../../i18n"
import { unwrap } from "../../lib/desktop"
import { ActionButton, ConfirmDialog, EmptyState, ListFrame, ListRow, StatusPill } from "../ui"
import { describeActionError, WorkspaceStatePill } from "./execution-utils"

export function WorkspaceList({ workspaces, projects, companyId, selectedWorkspaceId, onSelect, onOpen, onDeleted }: {
  workspaces: WorkspaceRecord[]; projects: ProjectRecord[]; companyId: string; selectedWorkspaceId: string | null
  onSelect: (workspaceId: string) => void; onOpen: (path: string) => Promise<void>; onDeleted: () => Promise<void>
}) {
  const t = useT()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null); const [deleteError, setDeleteError] = useState<string | null>(null)
  const toDelete = workspaces.find((w) => w.id === confirmDeleteId) ?? null
  async function handleDelete(id: string) { setDeleteError(null); try { unwrap(await window.agentCompany.deleteWorkspace({ id, companyId })); setConfirmDeleteId(null); await onDeleted() } catch (e) { setDeleteError(describeActionError(e)) } }

  if (workspaces.length === 0) return <EmptyState title={t("exec.noWorkspacesYet")} detail={t("exec.noWorkspacesDetail")} />
  return (
    <>
      <ConfirmDialog open={confirmDeleteId !== null} title={t("exec.deleteWorkspace")} message={t("exec.deleteWorkspaceConfirm").replace("{0}", toDelete?.name ?? "")} errorMessage={deleteError} onConfirm={() => confirmDeleteId && void handleDelete(confirmDeleteId)} onCancel={() => { setDeleteError(null); setConfirmDeleteId(null) }} />
      <ListFrame>
        {workspaces.map((workspace) => {
          const linkedProject = projects.find((p) => p.id === workspace.projectId) ?? null
          return (
            <ListRow key={workspace.id}>
              <div className={`mb-2 rounded-lg p-1 ${selectedWorkspaceId === workspace.id ? "bg-accent" : ""}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2"><div className="truncate text-[13px] text-foreground">{workspace.name}</div><WorkspaceStatePill state={workspace.state} /></div>
                    <div className="font-mono truncate text-[11px] text-muted-foreground">{workspace.localPath}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {workspace.isPrimary ? <StatusPill status="ready" /> : null}
                    <ActionButton label={t("exec.inspect")} onClick={() => onSelect(workspace.id)} icon={FolderOpen} />
                    <ActionButton label={t("exec.reveal")} onClick={() => void onOpen(workspace.localPath)} icon={ArrowSquareOut} />
                    <ActionButton label={t("exec.delete")} onClick={() => setConfirmDeleteId(workspace.id)} icon={Trash} tone="danger" />
                  </div>
                </div>
                <div className="truncate text-[11px] text-muted-foreground">{workspace.repoUrl || "No remote URL"} {workspace.repoRef ? `· ${workspace.repoRef}` : ""}{linkedProject ? <span> · Project: <span className="text-foreground">{linkedProject.name}</span></span> : null}</div>
              </div>
            </ListRow>
          )
        })}
      </ListFrame>
    </>
  )
}
