import { motion } from "framer-motion"
import { ArrowRight, CaretRight, Gear, Lightning, Pause, Play, Trash } from "@phosphor-icons/react"
import type { AutomationRuleRecord } from "@shared/types"
import { timeAgo } from "../../lib/formatters"
import { ACCENT, LINE, triggerConfig, actionConfig, statusColors } from "./automation-config"

export function RuleCard({ rule, onToggle, onDelete, onEdit }: { rule: AutomationRuleRecord; onToggle: () => void; onDelete: () => void; onEdit: () => void }) {
  const triggerInfo = triggerConfig[rule.trigger]; const actionInfo = actionConfig[rule.action]
  const TriggerIcon = triggerInfo?.icon ?? Lightning; const colors = statusColors[rule.status]

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} className="group rounded-[8px] border bg-[color:var(--panel)] transition duration-150 hover:shadow-md hover:-translate-y-px" style={{ borderColor: LINE }}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]" style={{ backgroundColor: `${ACCENT}12`, color: ACCENT }}><TriggerIcon size={20} weight="fill" /></div>
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-bold text-[color:var(--text)]">{rule.name}</span>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]" style={{ backgroundColor: colors.bg, color: colors.text }}><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors.dot }} aria-hidden="true" />{rule.status}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[color:var(--muted)]">
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[color:var(--panel-soft)] px-1.5 py-0.5 font-medium text-[color:var(--muted-strong)]"><Lightning size={10} weight="fill" />{triggerInfo?.label ?? rule.trigger}</span>
            <ArrowRight size={10} className="text-[color:var(--muted)]" />
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[color:var(--panel-soft)] px-1.5 py-0.5 font-medium text-[color:var(--muted-strong)]"><Gear size={10} />{actionInfo?.label ?? rule.action}</span>
            {rule.sourceDepartment || rule.targetDepartment ? <><span className="text-[color:var(--line-strong)]">|</span><span className="inline-flex items-center gap-1"><span className="font-medium text-[color:var(--muted-strong)]">{rule.sourceDepartment ?? "Any"}</span><CaretRight size={8} /><span className="font-medium text-[color:var(--muted-strong)]">{rule.targetDepartment ?? "Same"}</span></span></> : null}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-[color:var(--muted)]"><span className="tabular-nums">{rule.executionCount} execution{rule.executionCount !== 1 ? "s" : ""}</span><span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" /><span>Last run {timeAgo(rule.lastExecutedAt)}</span><span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" /><span className="tabular-nums">Priority {rule.priority}</span></div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onToggle} aria-label={rule.status === "active" ? "Pause rule" : "Activate rule"} title={rule.status === "active" ? "Pause rule" : "Activate rule"} className="rounded-[6px] p-2 text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]">{rule.status === "active" ? <Pause size={15} /> : <Play size={15} />}</button>
          <button type="button" onClick={onDelete} aria-label="Delete rule" title="Delete rule" className="rounded-[6px] p-2 text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--danger-soft)] hover:text-[color:var(--danger)] group-hover:opacity-100"><Trash size={15} /></button>
        </div>
      </div>
    </motion.div>
  )
}
