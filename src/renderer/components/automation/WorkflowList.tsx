import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowsClockwise, CaretRight, Gear, Lightning, Play, Trash, X } from "@phosphor-icons/react"
import type { WorkflowPipelineRecord, WorkflowStep } from "@shared/types"
import { timeAgo } from "../../lib/formatters"
import { ActionButton } from "../ui"
import { ACCENT, LINE, triggerConfig, actionConfig, workflowStatusColors, stepStatusConfig, safeJsonParse } from "./automation-config"

function StepTimeline({ steps }: { steps: WorkflowStep[] }) {
  if (steps.length === 0) return <div className="py-4 text-center text-[11px] text-[color:var(--muted)]">No steps defined</div>
  return (
    <div className="relative pl-5">
      <div className="absolute left-[9px] top-2 w-px" style={{ height: `calc(100% - 16px)`, backgroundColor: "var(--line)" }} />
      <div className="space-y-3">
        {steps.map((step, idx) => {
          const colors = stepStatusConfig[step.status]; const info = actionConfig[step.action]
          return (
            <div key={step.id} className="relative flex items-start gap-3">
              <div className="absolute -left-5 top-1.5 z-10 h-[10px] w-[10px] rounded-full border-2" style={{ backgroundColor: colors.bg, borderColor: colors.border }} />
              <div className="flex-1 rounded-[8px] border px-3 py-2.5" style={{ borderColor: step.status === "running" ? ACCENT : LINE }}>
                <div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-[11px] font-bold" style={{ color: colors.text }}>{idx + 1}</span><span className="text-[12px] font-medium text-[color:var(--text)]">{step.name}</span></div><span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]" style={{ backgroundColor: colors.bg, color: colors.text }}>{step.status}</span></div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-[color:var(--muted)]"><span>{info?.label ?? step.action}</span>{step.assigneeDepartment ? <><span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" /><span>{step.assigneeDepartment}</span></> : null}{step.requiresApproval ? <><span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" /><span className="text-[color:var(--warn)]">Requires approval</span></> : null}{step.timeoutSec > 0 ? <><span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" /><span>{step.timeoutSec}s timeout</span></> : null}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WorkflowCard({ workflow, isRunning, onDelete, onEdit, onRun }: { workflow: WorkflowPipelineRecord; isRunning: boolean; onDelete: () => void; onEdit: () => void; onRun: () => void }) {
  const [expanded, setExpanded] = useState(false); const colors = workflowStatusColors[workflow.status]
  const triggerInfo = triggerConfig[workflow.triggerType]; const TriggerIcon = triggerInfo?.icon ?? Lightning
  const steps: WorkflowStep[] = useMemo(() => { const parsed = safeJsonParse(workflow.stepsJson); return Array.isArray(parsed) ? (parsed as WorkflowStep[]) : [] }, [workflow.stepsJson])

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} className="group rounded-[8px] border bg-[color:var(--panel)] transition hover:shadow-sm" style={{ borderColor: LINE }}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]" style={{ backgroundColor: `${ACCENT}12`, color: ACCENT }}><TriggerIcon size={20} weight="fill" /></div>
        <button type="button" onClick={() => setExpanded((p) => !p)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2"><span className="truncate text-[13px] font-semibold text-[color:var(--text)]">{workflow.name}</span><span className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]" style={{ backgroundColor: colors.bg, color: colors.text }}><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors.dot }} />{workflow.status}</span></div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-[color:var(--muted)]"><span className="inline-flex items-center gap-1 rounded-[4px] bg-[color:var(--panel-soft)] px-1.5 py-0.5 font-medium text-[color:var(--muted-strong)]"><Lightning size={10} weight="fill" />{triggerInfo?.label ?? workflow.triggerType}</span><span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" /><span>{steps.length} step{steps.length !== 1 ? "s" : ""}</span><span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" /><span>{workflow.runCount} run{workflow.runCount !== 1 ? "s" : ""}</span>{workflow.lastRunAt ? <><span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" /><span>Last run {timeAgo(workflow.lastRunAt)}</span></> : null}</div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <motion.div animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.15 }}><button type="button" onClick={() => setExpanded((p) => !p)} aria-label={expanded ? "Collapse" : "Expand"} className="rounded-[6px] p-2 text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"><CaretRight size={14} /></button></motion.div>
          <button type="button" onClick={onRun} aria-label="Run workflow" disabled={isRunning} className="rounded-[6px] p-2 text-[color:var(--muted)] transition hover:bg-[color:var(--success-soft)] hover:text-[color:var(--success)] disabled:pointer-events-none disabled:opacity-50">{isRunning ? <ArrowsClockwise size={15} className="animate-spin" /> : <Play size={15} />}</button>
          <button type="button" onClick={onEdit} aria-label="Edit workflow" className="rounded-[6px] p-2 text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"><Gear size={15} /></button>
          <button type="button" onClick={onDelete} aria-label="Delete workflow" className="rounded-[6px] p-2 text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--danger-soft)] hover:text-[color:var(--danger)] group-hover:opacity-100"><Trash size={15} /></button>
        </div>
      </div>
      <AnimatePresence>
        {expanded ? <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden"><div className="border-t px-4 py-4" style={{ borderColor: LINE }}>{workflow.description ? <p className="mb-3 text-[12px] leading-relaxed text-[color:var(--muted)]">{workflow.description}</p> : null}<StepTimeline steps={steps} /></div></motion.div> : null}
      </AnimatePresence>
    </motion.div>
  )
}

export { WorkflowCard, StepTimeline }
