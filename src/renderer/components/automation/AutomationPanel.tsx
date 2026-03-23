import { useCallback, useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowRight, ArrowsClockwise, Lightning, Plus, Robot, Trash, X } from "@phosphor-icons/react"
import type { AutomationAction, AutomationRuleRecord, AutomationStatus, AutomationTrigger, WorkflowPipelineRecord } from "@shared/types"
import { ActionButton, Select } from "../ui"
import { useT } from "../../i18n"
import { ACCENT, LINE, triggerConfig, actionConfig, statusColors, type AutomationLogEntry } from "./automation-config"
import { timeAgo } from "../../lib/formatters"
import { RuleCard } from "./RuleCard"
import { RuleFormModal } from "./RuleEditor"
import { WorkflowCard } from "./WorkflowList"
import { WorkflowFormModal } from "./WorkflowEditor"

function DeleteConfirmDialog({ open, entityName, onConfirm, onCancel }: { open: boolean; entityName: string; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={{ duration: 0.15 }} className="w-full max-w-[380px] rounded-[8px] border bg-[color:var(--panel)] p-6 shadow-xl" style={{ borderColor: LINE }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--danger-soft)]"><Trash size={16} className="text-[color:var(--danger)]" /></div><h3 className="text-[15px] font-bold text-[color:var(--text)]">Delete</h3></div>
        <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--muted)]">Are you sure you want to delete <strong className="text-[color:var(--text)]">{entityName}</strong>? This action cannot be undone.</p>
        <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={onCancel} className="rounded-[8px] px-4 py-2 text-[12px] font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)]">Cancel</button><ActionButton label="Delete" onClick={onConfirm} icon={Trash} tone="danger" /></div>
      </motion.div>
    </motion.div>
  )
}

function AutomationActivityLog({ entries }: { entries: AutomationLogEntry[] }) {
  if (entries.length === 0) return <div className="py-6 text-center text-[13px] text-[color:var(--muted)]">No activity yet</div>
  return (
    <div className="space-y-1">{entries.map((entry, idx) => {
      const ti = triggerConfig[entry.trigger as AutomationTrigger]; const ai = actionConfig[entry.action as AutomationAction]; const TIcon = ti?.icon ?? Lightning
      return <motion.div key={`${entry.ruleId}-${entry.executedAt}-${idx}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }} className="flex items-center gap-3 rounded-[8px] border bg-[color:var(--panel)] px-4 py-2.5 text-[12px]" style={{ borderColor: LINE }}><TIcon size={14} style={{ color: ACCENT }} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium text-[color:var(--text)]">{entry.ruleName}</span></div><div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[color:var(--muted)]"><span>{ti?.label ?? entry.trigger}</span><ArrowRight size={8} /><span>{ai?.label ?? entry.action}</span></div></div><span className="shrink-0 text-[10px] text-[color:var(--muted)]">{timeAgo(entry.executedAt)}</span></motion.div>
    })}</div>
  )
}

function RulesPanel({ rules, companyId, onRefresh }: { rules: AutomationRuleRecord[]; companyId: string; onRefresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false); const [editRule, setEditRule] = useState<AutomationRuleRecord | null>(null); const [delTarget, setDelTarget] = useState<AutomationRuleRecord | null>(null)
  const [actLog, setActLog] = useState<AutomationLogEntry[]>([]); const [activeTab, setActiveTab] = useState<"rules"|"activity">("rules"); const [filterStatus, setFilterStatus] = useState<AutomationStatus|"all">("all")
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => { void window.agentCompany.getAutomationLog(companyId).then((r) => { if (r.ok) setActLog(r.data) }) }, [companyId, rules])
  const filtered = useMemo(() => filterStatus === "all" ? rules : rules.filter((r) => r.status === filterStatus), [rules, filterStatus])
  const counts = useMemo(() => ({ total: rules.length, active: rules.filter((r) => r.status === "active").length, paused: rules.filter((r) => r.status === "paused").length, error: rules.filter((r) => r.status === "error").length }), [rules])
  const handleToggle = useCallback(async (rule: AutomationRuleRecord) => { setActionError(null); try { const r = await window.agentCompany.toggleAutomationRule({ id: rule.id, companyId, status: (rule.status === "active" ? "paused" : "active") as "active"|"paused" }); if (!r.ok) { setActionError(r.error.message); return }; onRefresh() } catch (e) { setActionError(e instanceof Error ? e.message : "Failed") } }, [companyId, onRefresh])
  const handleDelete = useCallback(async () => { if (!delTarget) return; setActionError(null); try { const r = await window.agentCompany.deleteAutomationRule({ id: delTarget.id, companyId }); if (!r.ok) { setActionError(r.error.message); setDelTarget(null); return }; setDelTarget(null); onRefresh() } catch (e) { setActionError(e instanceof Error ? e.message : "Failed"); setDelTarget(null) } }, [delTarget, companyId, onRefresh])

  return (
    <div className="space-y-5">
      {actionError ? <div className="flex items-center justify-between rounded-[8px] bg-[color:var(--danger-soft)] px-3.5 py-2.5 text-[12px] font-medium text-[color:var(--danger)]"><span>{actionError}</span><button type="button" onClick={() => setActionError(null)} className="ml-2 rounded p-0.5 hover:bg-[color:var(--danger)] hover:text-[color:var(--text-on-accent)]"><X size={12} /></button></div> : null}
      <div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-[8px]" style={{ backgroundColor: `${ACCENT}15`, color: ACCENT }}><Lightning size={20} weight="fill" /></div><div><h2 className="text-[16px] font-bold text-[color:var(--text)]">Automation Rules</h2><p className="text-[12px] text-[color:var(--muted)]">{counts.active} active, {counts.paused} paused{counts.error > 0 ? `, ${counts.error} errored` : ""}</p></div></div><ActionButton label="New Rule" onClick={() => setShowCreate(true)} icon={Plus} tone="accent" /></div>
      {rules.length > 0 ? <div className="grid grid-cols-3 gap-2">{[{ l: "Total Rules", v: counts.total, c: undefined }, { l: "Total Executions", v: rules.reduce((s, r) => s + r.executionCount, 0), c: ACCENT }, { l: "Recent Activity", v: actLog.length, c: "var(--success)" }].map((s) => <div key={s.l} className="rounded-[8px] border bg-[color:var(--panel)] px-4 py-3.5" style={{ borderColor: LINE }}><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{s.l}</div><div className="text-[26px] font-bold tabular-nums" style={s.c ? { color: s.c } : undefined}>{s.v}</div></div>)}</div> : null}
      <div className="flex gap-1 rounded-[8px] bg-[color:var(--panel-soft)] p-1"><button type="button" onClick={() => setActiveTab("rules")} className={`flex-1 rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition ${activeTab === "rules" ? "bg-[color:var(--panel)] text-[color:var(--text)] shadow-sm" : "text-[color:var(--muted)] hover:text-[color:var(--text)]"}`}>Rules ({rules.length})</button><button type="button" onClick={() => setActiveTab("activity")} className={`flex-1 rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition ${activeTab === "activity" ? "bg-[color:var(--panel)] text-[color:var(--text)] shadow-sm" : "text-[color:var(--muted)] hover:text-[color:var(--text)]"}`}>Activity Log ({actLog.length})</button></div>
      {activeTab === "rules" ? <>
        {rules.length > 0 ? <div className="flex flex-wrap items-center gap-1.5">{(["all","active","paused","error"] as const).map((s) => <button key={s} type="button" onClick={() => setFilterStatus(s)} className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${filterStatus === s ? "text-[color:var(--text-on-accent)]" : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)] hover:bg-[color:var(--line)]"}`} style={filterStatus === s ? { backgroundColor: ACCENT } : undefined}>{s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}</button>)}</div> : null}
        {filtered.length === 0 && rules.length === 0 ? <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed py-16 text-center" style={{ borderColor: LINE }}><Lightning size={36} className="mb-3 text-[color:var(--muted)]" /><div className="text-[14px] font-medium text-[color:var(--muted-strong)]">No automation rules</div><div className="mx-auto mt-1 max-w-[42ch] text-[12px] leading-relaxed text-[color:var(--muted)]">Create your first rule to make the company autonomous.</div><div className="mt-4"><ActionButton label="Create First Rule" onClick={() => setShowCreate(true)} icon={Lightning} tone="accent" /></div></div>
        : filtered.length === 0 ? <div className="py-8 text-center text-[13px] text-[color:var(--muted)]">No rules match the current filter.</div>
        : <div className="space-y-2"><AnimatePresence>{filtered.map((r) => <RuleCard key={r.id} rule={r} onToggle={() => void handleToggle(r)} onDelete={() => setDelTarget(r)} onEdit={() => setEditRule(r)} />)}</AnimatePresence></div>}
      </> : <AutomationActivityLog entries={actLog} />}
      <AnimatePresence>{showCreate ? <RuleFormModal open={showCreate} editingRule={null} companyId={companyId} onClose={() => setShowCreate(false)} onSaved={onRefresh} /> : null}{editRule ? <RuleFormModal open={!!editRule} editingRule={editRule} companyId={companyId} onClose={() => setEditRule(null)} onSaved={onRefresh} /> : null}</AnimatePresence>
      <AnimatePresence>{delTarget ? <DeleteConfirmDialog open={!!delTarget} entityName={delTarget.name} onConfirm={() => void handleDelete()} onCancel={() => setDelTarget(null)} /> : null}</AnimatePresence>
    </div>
  )
}

function WorkflowsPanel({ workflows, companyId, onRefresh }: { workflows: WorkflowPipelineRecord[]; companyId: string; onRefresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false); const [editWf, setEditWf] = useState<WorkflowPipelineRecord | null>(null); const [delTarget, setDelTarget] = useState<WorkflowPipelineRecord | null>(null)
  const [actionError, setActionError] = useState<string | null>(null); const [runningId, setRunningId] = useState<string | null>(null)
  const handleDelete = useCallback(async () => { if (!delTarget) return; setActionError(null); try { const r = await window.agentCompany.deleteWorkflow({ id: delTarget.id, companyId }); if (!r.ok) { setActionError(r.error.message); setDelTarget(null); return }; setDelTarget(null); onRefresh() } catch (e) { setActionError(e instanceof Error ? e.message : "Failed"); setDelTarget(null) } }, [delTarget, companyId, onRefresh])
  const handleRun = useCallback(async (wf: WorkflowPipelineRecord) => { setActionError(null); setRunningId(wf.id); try { const r = await window.agentCompany.runWorkflow({ id: wf.id, companyId }); if (!r.ok) { setActionError(r.error.message); return }; onRefresh() } catch (e) { setActionError(e instanceof Error ? e.message : "Failed") } finally { setRunningId(null) } }, [companyId, onRefresh])
  const counts = useMemo(() => ({ total: workflows.length, active: workflows.filter((w) => w.status === "active").length, draft: workflows.filter((w) => w.status === "draft").length }), [workflows])
  return (
    <div className="space-y-5">
      {actionError ? <div className="flex items-center justify-between rounded-[8px] bg-[color:var(--danger-soft)] px-3.5 py-2.5 text-[12px] font-medium text-[color:var(--danger)]"><span>{actionError}</span><button type="button" onClick={() => setActionError(null)} className="ml-2 rounded p-0.5 hover:bg-[color:var(--danger)] hover:text-[color:var(--text-on-accent)]"><X size={12} /></button></div> : null}
      <div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-[8px]" style={{ backgroundColor: `${ACCENT}12`, color: ACCENT }}><ArrowsClockwise size={20} weight="fill" /></div><div><h2 className="text-[16px] font-bold text-[color:var(--text)]">Workflow Pipelines</h2><p className="text-[12px] text-[color:var(--muted)]">{counts.active} active, {counts.draft} draft{counts.total > counts.active + counts.draft ? `, ${counts.total - counts.active - counts.draft} other` : ""}</p></div></div><ActionButton label="New Workflow" onClick={() => setShowCreate(true)} icon={Plus} tone="accent" /></div>
      {workflows.length === 0 ? <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed py-16 text-center" style={{ borderColor: LINE }}><ArrowsClockwise size={36} className="mb-3 text-[color:var(--muted)]" /><div className="text-[14px] font-medium text-[color:var(--muted-strong)]">No workflow pipelines</div><div className="mx-auto mt-1 max-w-[42ch] text-[12px] leading-relaxed text-[color:var(--muted)]">Workflows chain actions into multi-step pipelines.</div><div className="mt-4"><ActionButton label="Create First Workflow" onClick={() => setShowCreate(true)} icon={ArrowsClockwise} tone="accent" /></div></div>
      : <div className="space-y-2"><AnimatePresence>{workflows.map((wf) => <WorkflowCard key={wf.id} workflow={wf} isRunning={runningId === wf.id} onDelete={() => setDelTarget(wf)} onEdit={() => setEditWf(wf)} onRun={() => void handleRun(wf)} />)}</AnimatePresence></div>}
      <AnimatePresence>{showCreate ? <WorkflowFormModal open={showCreate} editingWorkflow={null} companyId={companyId} onClose={() => setShowCreate(false)} onSaved={onRefresh} /> : null}{editWf ? <WorkflowFormModal open={!!editWf} editingWorkflow={editWf} companyId={companyId} onClose={() => setEditWf(null)} onSaved={onRefresh} /> : null}</AnimatePresence>
      <AnimatePresence>{delTarget ? <DeleteConfirmDialog open={!!delTarget} entityName={delTarget.name} onConfirm={() => void handleDelete()} onCancel={() => setDelTarget(null)} /> : null}</AnimatePresence>
    </div>
  )
}

export function AutomationPanel({ rules, workflows, companyId, onRefresh }: { rules: AutomationRuleRecord[]; workflows: WorkflowPipelineRecord[]; companyId: string; onRefresh: () => void }) {
  const t = useT(); const [activeSection, setActiveSection] = useState<"rules"|"workflows">("rules")
  return (
    <div className="space-y-6">
      <div className="rounded-[8px] border px-5 py-4" style={{ borderColor: `${ACCENT}30`, background: `linear-gradient(135deg, ${ACCENT}08 0%, ${ACCENT}04 100%)` }}><div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]" style={{ backgroundColor: `${ACCENT}18`, color: ACCENT }}><Robot size={20} weight="fill" /></div><div><div className="text-[13px] font-semibold text-[color:var(--text)]">{t("auto.automationEngine")}</div><div className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--muted)]">Rules trigger actions based on company events. Workflows chain multiple steps into pipelines. Together, they let your AI company run fully autonomously.</div></div></div></div>
      <div className="flex gap-1 rounded-[8px] bg-[color:var(--panel-soft)] p-1">
        <button type="button" onClick={() => setActiveSection("rules")} className={`flex flex-1 items-center justify-center gap-2 rounded-[8px] px-4 py-2 text-[13px] font-medium transition ${activeSection === "rules" ? "bg-[color:var(--panel)] text-[color:var(--text)] shadow-sm" : "text-[color:var(--muted)] hover:text-[color:var(--text)]"}`}><Lightning size={15} weight={activeSection === "rules" ? "fill" : "regular"} style={activeSection === "rules" ? { color: ACCENT } : undefined} />Automation Rules ({rules.length})</button>
        <button type="button" onClick={() => setActiveSection("workflows")} className={`flex flex-1 items-center justify-center gap-2 rounded-[8px] px-4 py-2 text-[13px] font-medium transition ${activeSection === "workflows" ? "bg-[color:var(--panel)] text-[color:var(--text)] shadow-sm" : "text-[color:var(--muted)] hover:text-[color:var(--text)]"}`}><ArrowsClockwise size={15} weight={activeSection === "workflows" ? "fill" : "regular"} style={activeSection === "workflows" ? { color: ACCENT } : undefined} />Workflows ({workflows.length})</button>
      </div>
      <AnimatePresence mode="wait"><motion.div key={activeSection} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}>{activeSection === "rules" ? <RulesPanel rules={rules} companyId={companyId} onRefresh={onRefresh} /> : <WorkflowsPanel workflows={workflows} companyId={companyId} onRefresh={onRefresh} />}</motion.div></AnimatePresence>
    </div>
  )
}
