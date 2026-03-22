import { useState } from "react"
import { FolderOpen } from "@phosphor-icons/react"
import type { ProjectRecord } from "@shared/types"
import { useT } from "../../i18n"
import { unwrap } from "../../lib/desktop"
import { ActionButton, Field, InlineNotice, Input, Select } from "../ui"
import { describeActionError } from "./execution-utils"

export function WorkspaceCreator({ companyId, projects, onSaved }: { companyId: string; projects: ProjectRecord[]; onSaved: () => Promise<void> }) {
  const t = useT()
  const [name, setName] = useState(""); const [localPath, setLocalPath] = useState(""); const [repoUrl, setRepoUrl] = useState(""); const [repoRef, setRepoRef] = useState("")
  const [projectId, setProjectId] = useState(projects[0]?.id ?? ""); const [submitError, setSubmitError] = useState<string | null>(null); const [submitting, setSubmitting] = useState(false)

  async function handleChooseDirectory() { setSubmitError(null); const result = await window.agentCompany.pickDirectory(); if (!result.ok) { setSubmitError(result.error.message); return }; if (result.data) setLocalPath(result.data) }
  async function handleSaveWorkspace() { setSubmitError(null); setSubmitting(true); try { unwrap(await window.agentCompany.saveWorkspace({ companyId, name, localPath, repoUrl, repoRef, projectId: projectId || null, isPrimary: false })); setName(""); setLocalPath(""); setRepoUrl(""); setRepoRef(""); await onSaved() } catch (e) { setSubmitError(describeActionError(e)) } finally { setSubmitting(false) } }

  return (
    <div className="grid gap-4">
      <Input label={t("exec.workspaceName")} value={name} onChange={setName} placeholder={t("exec.workspaceName")} />
      <Field label={t("exec.localPath")}><div className="flex gap-3"><Input value={localPath} onChange={setLocalPath} placeholder="/Users/you/project" /><ActionButton label={t("exec.choose")} onClick={() => void handleChooseDirectory()} icon={FolderOpen} /></div></Field>
      <Input label={t("exec.repoUrl")} value={repoUrl} onChange={setRepoUrl} placeholder="https://github.com/org/repo" />
      <Input label={t("exec.branchRef")} value={repoRef} onChange={setRepoRef} placeholder="main" />
      <Select label={t("exec.project")} value={projectId} onChange={setProjectId} options={[{ value: "", label: t("exec.noProjectBinding") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
      {submitError ? <InlineNotice message={submitError} /> : null}
      <ActionButton label={t("exec.addWorkspace")} tone="accent" onClick={() => void handleSaveWorkspace()} icon={FolderOpen} loading={submitting} />
    </div>
  )
}
