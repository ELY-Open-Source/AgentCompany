import { useCallback, useEffect, useState } from "react"
import { ArrowsClockwise, Gear } from "@phosphor-icons/react"
import type { AutomationTrigger, WorkflowPipelineRecord, WorkflowStatus } from "@shared/types"
import { ActionButton, Modal, Select } from "../ui"
import { triggerConfig, safeJsonStringify } from "./automation-config"

interface WorkflowFormState { name: string; description: string; triggerType: AutomationTrigger; triggerConfigJson: string; status: WorkflowStatus; stepsJson: string }
const defaultWorkflowForm: WorkflowFormState = { name: "", description: "", triggerType: "task_created", triggerConfigJson: "{}", status: "draft", stepsJson: "[]" }
function workflowToFormState(wf: WorkflowPipelineRecord): WorkflowFormState { return { name: wf.name, description: wf.description, triggerType: wf.triggerType, triggerConfigJson: safeJsonStringify(wf.triggerConfigJson), status: wf.status, stepsJson: safeJsonStringify(wf.stepsJson) } }

export function WorkflowFormModal({ open, editingWorkflow, companyId, onClose, onSaved }: { open: boolean; editingWorkflow: WorkflowPipelineRecord | null; companyId: string; onClose: () => void; onSaved: () => void }) {
  const isEditing = editingWorkflow !== null; const [form, setForm] = useState<WorkflowFormState>(defaultWorkflowForm); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setForm(editingWorkflow ? workflowToFormState(editingWorkflow) : defaultWorkflowForm); setError(null) } }, [open, editingWorkflow])
  const updateField = useCallback(<K extends keyof WorkflowFormState>(key: K, value: WorkflowFormState[K]) => { setForm((p) => ({ ...p, [key]: value })) }, [])
  const handleSave = useCallback(async () => {
    if (!form.name.trim()) { setError("Workflow name is required"); return }
    try { JSON.parse(form.triggerConfigJson) } catch { setError("Trigger config must be valid JSON"); return }
    try { JSON.parse(form.stepsJson) } catch { setError("Steps must be valid JSON array"); return }
    setSaving(true); setError(null)
    try { const result = await window.agentCompany.saveWorkflow({ id: editingWorkflow?.id ?? null, companyId, name: form.name.trim(), description: form.description.trim(), triggerType: form.triggerType, triggerConfigJson: form.triggerConfigJson, status: form.status, stepsJson: form.stepsJson }); if (!result.ok) { setError(result.error.message); return }; onSaved(); onClose() } catch (err) { setError(err instanceof Error ? err.message : "Failed to save workflow") } finally { setSaving(false) }
  }, [form, editingWorkflow, companyId, onSaved, onClose])
  const triggerOptions = Object.entries(triggerConfig).map(([key, c]) => ({ value: key, label: c.label }))
  const statusOptions = [{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "paused", label: "Paused" }]
  return (
    <Modal open={open} onClose={onClose} title={isEditing ? "Edit Workflow" : "New Workflow"} width="540px">
      <div className="space-y-5">
        {error ? <div className="rounded-lg bg-destructive-muted px-3.5 py-2.5 text-[12px] font-medium text-destructive">{error}</div> : null}
        <div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Workflow Name</label><input type="text" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="e.g., Bug Fix Pipeline" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground" /></div>
        <div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Description</label><textarea value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder="Describe this workflow pipeline" rows={2} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground" /></div>
        <div className="grid grid-cols-2 gap-3"><div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Trigger</label><Select value={form.triggerType} onChange={(v) => updateField("triggerType", v as AutomationTrigger)} options={triggerOptions} /></div><div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Status</label><Select value={form.status} onChange={(v) => updateField("status", v as WorkflowStatus)} options={statusOptions} /></div></div>
        <div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Trigger Configuration (JSON)</label><textarea value={form.triggerConfigJson} onChange={(e) => updateField("triggerConfigJson", e.target.value)} rows={2} spellCheck={false} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 font-mono text-[12px] text-foreground" placeholder="{}" /></div>
        <div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Pipeline Steps (JSON Array)</label><textarea value={form.stepsJson} onChange={(e) => updateField("stepsJson", e.target.value)} rows={6} spellCheck={false} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 font-mono text-[12px] text-foreground" placeholder='[{"id":"step-1","name":"Assign","action":"assign_task","configJson":"{}","assigneeDepartment":"engineering","assigneeAgentId":null,"requiresApproval":false,"timeoutSec":0,"status":"pending"}]' /></div>
      </div>
      <div className="mt-6 flex justify-end gap-3 border-t border-border pt-4">
        <ActionButton label="Cancel" onClick={onClose} />
        <ActionButton label={isEditing ? "Save Changes" : "Create Workflow"} onClick={() => void handleSave()} icon={isEditing ? Gear : ArrowsClockwise} tone="accent" loading={saving} disabled={!form.name.trim()} />
      </div>
    </Modal>
  )
}
