import { useCallback, useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Gear, Lightning, X } from "@phosphor-icons/react"
import type { AutomationAction, AutomationRuleRecord, AutomationTrigger, DepartmentId } from "@shared/types"
import { ActionButton, Select } from "../ui"
import { ACCENT, LINE, triggerConfig, actionConfig, departmentOptions, safeJsonStringify } from "./automation-config"

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
  if (!open) return null
  const triggerOptions = Object.entries(triggerConfig).map(([key, c]) => ({ value: key, label: c.label })); const actionOptions = Object.entries(actionConfig).map(([key, c]) => ({ value: key, label: c.label }))
  const selectedTriggerInfo = triggerConfig[form.trigger]; const selectedActionInfo = actionConfig[form.action]
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} className="flex w-full max-w-[580px] flex-col rounded-[8px] border bg-[color:var(--panel)] shadow-xl" style={{ borderColor: LINE, maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b px-6 py-4" style={{ borderColor: LINE }}>
          <div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-[8px]" style={{ backgroundColor: `${ACCENT}15`, color: ACCENT }}><Lightning size={18} weight="fill" /></div><h2 className="text-[16px] font-bold text-[color:var(--text)]">{isEditing ? "Edit Automation Rule" : "New Automation Rule"}</h2></div>
          <button type="button" onClick={onClose} className="rounded-[6px] p-1.5 text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5"><div className="space-y-5">
          {error ? <div className="rounded-[8px] bg-[color:var(--danger-soft)] px-3.5 py-2.5 text-[12px] font-medium text-[color:var(--danger)]">{error}</div> : null}
          <div><label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">Rule Name</label><input type="text" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="e.g., Auto-assign blocked tasks" className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]" style={{ borderColor: LINE }} /></div>
          <div><label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">Description</label><textarea value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder="What does this rule do?" rows={2} className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]" style={{ borderColor: LINE }} /></div>
          <div><label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">Trigger</label><Select value={form.trigger} onChange={(v) => updateField("trigger", v as AutomationTrigger)} options={triggerOptions} />{selectedTriggerInfo ? <div className="mt-1.5 text-[11px] text-[color:var(--muted)]">{selectedTriggerInfo.description}</div> : null}</div>
          <div><label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">Conditions (JSON)</label><textarea value={form.conditionsJson} onChange={(e) => updateField("conditionsJson", e.target.value)} rows={3} spellCheck={false} className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 font-mono text-[12px] text-[color:var(--text)]" style={{ borderColor: LINE }} placeholder='{"status": "blocked"}' /></div>
          <div><label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">Action</label><Select value={form.action} onChange={(v) => updateField("action", v as AutomationAction)} options={actionOptions} />{selectedActionInfo ? <div className="mt-1.5 text-[11px] text-[color:var(--muted)]">{selectedActionInfo.description}</div> : null}</div>
          <div><label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">Action Configuration (JSON)</label><textarea value={form.actionConfigJson} onChange={(e) => updateField("actionConfigJson", e.target.value)} rows={3} spellCheck={false} className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 font-mono text-[12px] text-[color:var(--text)]" style={{ borderColor: LINE }} placeholder='{"targetAgentId": "..."}' /></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">Source Department</label><Select value={form.sourceDepartment} onChange={(v) => updateField("sourceDepartment", v)} options={departmentOptions} /></div><div><label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">Target Department</label><Select value={form.targetDepartment} onChange={(v) => updateField("targetDepartment", v)} options={departmentOptions} /></div></div>
          <div><div className="mb-1.5 flex items-center justify-between"><label className="text-[12px] font-medium text-[color:var(--muted-strong)]">Priority</label><span className="text-[12px] font-semibold" style={{ color: ACCENT }}>{form.priority}</span></div><input type="range" min={0} max={100} value={form.priority} onChange={(e) => updateField("priority", parseInt(e.target.value, 10))} className="w-full accent-[#d97745]" /><div className="mt-1 flex justify-between text-[10px] text-[color:var(--muted)]"><span>Low priority</span><span>High priority</span></div></div>
        </div></div>
        <div className="flex shrink-0 justify-end gap-3 border-t px-6 py-4" style={{ borderColor: LINE }}>
          <button type="button" onClick={onClose} className="rounded-[8px] px-4 py-2 text-[12px] font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]">Cancel</button>
          <ActionButton label={isEditing ? "Save Changes" : "Create Rule"} onClick={() => void handleSave()} icon={isEditing ? Gear : Lightning} tone="accent" loading={saving} disabled={!form.name.trim()} />
        </div>
      </motion.div>
    </motion.div>
  )
}
