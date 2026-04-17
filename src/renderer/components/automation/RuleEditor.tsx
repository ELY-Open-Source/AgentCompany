import { useCallback, useEffect, useState } from "react"
import { Gear, Lightning } from "@phosphor-icons/react"
import type { AutomationAction, AutomationRuleRecord, AutomationTrigger, DepartmentId } from "@shared/types"
import { ActionButton, Modal, Select } from "../ui"
import { triggerConfig, actionConfig, departmentOptions, safeJsonStringify } from "./automation-config"

interface RuleFormState { name: string; description: string; trigger: AutomationTrigger; conditionsJson: string; action: AutomationAction; actionConfigJson: string; sourceDepartment: string; targetDepartment: string; priority: number }
const defaultRuleForm: RuleFormState = { name: "", description: "", trigger: "task_status_changed", conditionsJson: "{}", action: "assign_task", actionConfigJson: "{}", sourceDepartment: "", targetDepartment: "", priority: 50 }
function ruleToFormState(rule: AutomationRuleRecord): RuleFormState { return { name: rule.name, description: rule.description, trigger: rule.trigger, conditionsJson: safeJsonStringify(rule.conditionsJson), action: rule.action, actionConfigJson: safeJsonStringify(rule.actionConfigJson), sourceDepartment: rule.sourceDepartment ?? "", targetDepartment: rule.targetDepartment ?? "", priority: rule.priority } }

export function RuleFormModal({ open, editingRule, companyId, onClose, onSaved }: { open: boolean; editingRule: AutomationRuleRecord | null; companyId: string; onClose: () => void; onSaved: () => void }) {
  const isEditing = editingRule !== null; const [form, setForm] = useState<RuleFormState>(defaultRuleForm); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setForm(editingRule ? ruleToFormState(editingRule) : defaultRuleForm); setError(null) } }, [open, editingRule])
  const updateField = useCallback(<K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) => { setForm((prev) => ({ ...prev, [key]: value })) }, [])
  const handleSave = useCallback(async () => {
    if (!form.name.trim()) { setError("Rule name is required"); return }
    try { JSON.parse(form.conditionsJson) } catch { setError("Conditions must be valid JSON"); return }
    try { JSON.parse(form.actionConfigJson) } catch { setError("Action config must be valid JSON"); return }
    setSaving(true); setError(null)
    try { const result = await window.agentCompany.saveAutomationRule({ id: editingRule?.id ?? null, companyId, name: form.name.trim(), description: form.description.trim(), trigger: form.trigger, conditionsJson: form.conditionsJson, action: form.action, actionConfigJson: form.actionConfigJson, sourceDepartment: (form.sourceDepartment || null) as DepartmentId | null, targetDepartment: (form.targetDepartment || null) as DepartmentId | null, priority: form.priority, status: editingRule?.status ?? "active" }); if (!result.ok) { setError(result.error.message); return }; onSaved(); onClose() } catch (err) { setError(err instanceof Error ? err.message : "Failed to save rule") } finally { setSaving(false) }
  }, [form, editingRule, companyId, onSaved, onClose])
  const triggerOptions = Object.entries(triggerConfig).map(([key, c]) => ({ value: key, label: c.label })); const actionOptions = Object.entries(actionConfig).map(([key, c]) => ({ value: key, label: c.label }))
  const selectedTriggerInfo = triggerConfig[form.trigger]; const selectedActionInfo = actionConfig[form.action]
  return (
    <Modal open={open} onClose={onClose} title={isEditing ? "Edit Automation Rule" : "New Automation Rule"} width="580px">
      <div className="space-y-5">
        {error ? <div className="rounded-lg bg-destructive-muted px-3.5 py-2.5 text-[12px] font-medium text-destructive">{error}</div> : null}
        <div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Rule Name</label><input type="text" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="e.g., Auto-assign blocked tasks" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground" /></div>
        <div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Description</label><textarea value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder="What does this rule do?" rows={2} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground" /></div>
        <div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Trigger</label><Select value={form.trigger} onChange={(v) => updateField("trigger", v as AutomationTrigger)} options={triggerOptions} />{selectedTriggerInfo ? <div className="mt-1.5 text-[11px] text-muted-foreground">{selectedTriggerInfo.description}</div> : null}</div>
        <div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Conditions (JSON)</label><textarea value={form.conditionsJson} onChange={(e) => updateField("conditionsJson", e.target.value)} rows={3} spellCheck={false} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 font-mono text-[12px] text-foreground" placeholder='{"status": "blocked"}' /></div>
        <div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Action</label><Select value={form.action} onChange={(v) => updateField("action", v as AutomationAction)} options={actionOptions} />{selectedActionInfo ? <div className="mt-1.5 text-[11px] text-muted-foreground">{selectedActionInfo.description}</div> : null}</div>
        <div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Action Configuration (JSON)</label><textarea value={form.actionConfigJson} onChange={(e) => updateField("actionConfigJson", e.target.value)} rows={3} spellCheck={false} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 font-mono text-[12px] text-foreground" placeholder='{"targetAgentId": "..."}' /></div>
        <div className="grid grid-cols-2 gap-3"><div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Source Department</label><Select value={form.sourceDepartment} onChange={(v) => updateField("sourceDepartment", v)} options={departmentOptions} /></div><div><label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Target Department</label><Select value={form.targetDepartment} onChange={(v) => updateField("targetDepartment", v)} options={departmentOptions} /></div></div>
        <div><div className="mb-1.5 flex items-center justify-between"><label className="text-[12px] font-medium text-muted-foreground">Priority</label><span className="text-[12px] font-semibold text-primary">{form.priority}</span></div><input type="range" min={0} max={100} value={form.priority} onChange={(e) => updateField("priority", parseInt(e.target.value, 10))} className="w-full accent-[color:var(--primary)]" /><div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>Low priority</span><span>High priority</span></div></div>
      </div>
      <div className="mt-6 flex justify-end gap-3 border-t border-border pt-4">
        <ActionButton label="Cancel" onClick={onClose} />
        <ActionButton label={isEditing ? "Save Changes" : "Create Rule"} onClick={() => void handleSave()} icon={isEditing ? Gear : Lightning} tone="accent" loading={saving} disabled={!form.name.trim()} />
      </div>
    </Modal>
  )
}
