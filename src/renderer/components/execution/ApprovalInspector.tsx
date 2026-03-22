import { useState } from "react"
import { Briefcase, CheckCircle, ClockCounterClockwise, Robot, Trash, XCircle } from "@phosphor-icons/react"
import type { AgentRecord, ApprovalRecord, TaskRecord } from "@shared/types"
import { useT } from "../../i18n"
import { formatMoney, formatTime } from "../../lib/formatters"
import { unwrap } from "../../lib/desktop"
import { ActionButton, ConfirmDialog, InlineNotice, StatusPill, TextArea } from "../ui"
import { describeActionError, parseApprovalPayloadJson } from "./execution-utils"

export function ApprovalInspector({ approval, agents, tasks, companyId, onDecide, onDeleted }: {
  approval: ApprovalRecord; agents: AgentRecord[]; tasks: TaskRecord[]; companyId: string
  onDecide: (state: "approved" | "rejected" | "revision_requested", note?: string) => Promise<void>; onDeleted: () => Promise<void>
}) {
  const t = useT()
  const [decisionNote, setDecisionNote] = useState(""); const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null); const [acting, setActing] = useState<"approved"|"rejected"|"revision_requested"|"delete"|null>(null)
  const requestingAgent = agents.find((a) => a.id === approval.requestedByAgentId) ?? null
  const relatedTask = tasks.find((t) => t.id === approval.relatedTaskId) ?? null
  const isDecided = approval.state !== "pending"

  async function handleDelete() { setActionError(null); setActing("delete"); try { unwrap(await window.agentCompany.deleteApproval({ id: approval.id, companyId })); setConfirmDelete(false); await onDeleted() } catch (e) { setActionError(describeActionError(e)) } finally { setActing(null) } }
  async function handleDecision(state: "approved"|"rejected"|"revision_requested") { setActionError(null); setActing(state); try { await onDecide(state, decisionNote || undefined) } catch (e) { setActionError(describeActionError(e)) } finally { setActing(null) } }

  return (
    <div className="space-y-5">
      <ConfirmDialog open={confirmDelete} title={t("exec.deleteApproval")} message={t("exec.deleteApprovalConfirm")} errorMessage={actionError} onConfirm={() => void handleDelete()} onCancel={() => { setActionError(null); setConfirmDelete(false) }} />
      {actionError && !confirmDelete ? <InlineNotice message={actionError} /> : null}
      <div className="border-y border-[color:var(--line)] py-4 space-y-4">
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${approval.type === "hire_agent" ? "bg-[color:var(--accent-soft)] text-[color:var(--accent)]" : approval.type === "approve_ceo_strategy" ? "bg-[color:var(--warn-soft)] text-[color:var(--warn)]" : approval.type === "secret_access" ? "bg-[color:var(--danger-soft)] text-[color:var(--danger)]" : "bg-[color:var(--panel-soft)] text-[color:var(--muted)]"}`}>{approval.type.replaceAll("_", " ")}</span>
          <StatusPill status={approval.state} />
        </div>
        <div className="text-[14px] font-medium text-[color:var(--text)]">{approval.payloadSummary}</div>
        {approval.impactSummary ? <div className="text-[13px] text-[color:var(--muted)]">{approval.impactSummary}</div> : null}
        <div className="grid gap-2 text-[13px] md:grid-cols-2">
          <div className="flex items-center gap-2 text-[color:var(--muted)]"><Robot size={14} />Requested by: <span className="font-medium text-[color:var(--text)]">{requestingAgent?.name ?? "Unknown"}</span>{requestingAgent?.role ? <span className="text-[10px] text-[color:var(--muted)]">({requestingAgent.role})</span> : null}</div>
          {relatedTask ? <div className="flex items-center gap-2 text-[color:var(--muted)]"><Briefcase size={14} />Task: <span className="font-medium text-[color:var(--text)]">{relatedTask.title}</span></div> : null}
          <div className="text-[color:var(--muted)]">Created: <span className="mono text-[color:var(--text)]">{formatTime(approval.createdAt)}</span></div>
          {approval.updatedAt !== approval.createdAt ? <div className="text-[color:var(--muted)]">Updated: <span className="mono text-[color:var(--text)]">{formatTime(approval.updatedAt)}</span></div> : null}
        </div>
        {approval.type === "hire_agent" ? (() => { const payload = parseApprovalPayloadJson(approval); const payloadAgentId = typeof payload?.agentId === "string" ? payload.agentId : null; const reqSnap = payload?.requestedConfigurationSnapshot && typeof payload.requestedConfigurationSnapshot === "object" && !Array.isArray(payload.requestedConfigurationSnapshot) ? payload.requestedConfigurationSnapshot as Record<string, unknown> : null; const proposedAgent = (approval.relatedAgentId ? (agents.find((a) => a.id === approval.relatedAgentId) ?? null) : null) ?? (payloadAgentId ? (agents.find((a) => a.id === payloadAgentId) ?? null) : null); const mgrId = proposedAgent?.reportsTo ?? (typeof reqSnap?.reportsTo === "string" ? reqSnap.reportsTo : null); const mgr = mgrId ? (agents.find((a) => a.id === mgrId) ?? null) : null; if (!proposedAgent && !reqSnap) return null; return (
          <div className="rounded-[8px] border border-[color:var(--accent)] border-opacity-30 bg-[color:var(--accent-soft)] px-4 py-3"><div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--accent)]">Proposed Hire</div><div className="grid gap-1.5 text-[12px]">
            <div><span className="text-[color:var(--muted)]">Name:</span> <span className="font-medium text-[color:var(--text)]">{proposedAgent?.name ?? approval.payloadSummary.replace(/^Hire\s+/i, "").split(/\s+as\s+/i)[0] ?? "Pending hire"}</span></div>
            <div><span className="text-[color:var(--muted)]">Role:</span> <span className="text-[color:var(--text)]">{proposedAgent?.role ?? (typeof reqSnap?.role === "string" ? reqSnap.role : "Unspecified")}</span></div>
            {(proposedAgent?.title || typeof reqSnap?.title === "string") ? <div><span className="text-[color:var(--muted)]">Title:</span> <span className="text-[color:var(--text)]">{proposedAgent?.title || reqSnap?.title as string}</span></div> : null}
            {(proposedAgent?.capabilities || typeof reqSnap?.capabilities === "string") ? <div><span className="text-[color:var(--muted)]">Capabilities:</span> <span className="text-[color:var(--text)]">{proposedAgent?.capabilities || reqSnap?.capabilities as string}</span></div> : null}
            <div><span className="text-[color:var(--muted)]">Connector:</span> <span className="mono text-[color:var(--text)]">{proposedAgent?.connectorId ?? (typeof reqSnap?.connectorId === "string" ? reqSnap.connectorId : "Unknown")}</span></div>
            <div><span className="text-[color:var(--muted)]">Budget:</span> <span className="mono text-[color:var(--text)]">{formatMoney(proposedAgent?.budgetMonthlyUsd ?? (typeof reqSnap?.budgetMonthlyUsd === "number" ? reqSnap.budgetMonthlyUsd : 0))}/mo</span></div>
            {mgr ? <div><span className="text-[color:var(--muted)]">Reports to:</span> <span className="text-[color:var(--text)]">{mgr.name}</span></div> : null}
          </div></div>) })() : null}
        {approval.type === "approve_ceo_strategy" ? <div className="rounded-[8px] border border-[color:var(--warn)] border-opacity-30 bg-[color:var(--warn-soft)] px-4 py-3"><div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--warn)]">Organization Strategy</div><div className="whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--text)]">{approval.payloadSummary}</div></div> : null}
      </div>
      {!isDecided ? <div><label className="mb-1 block text-[11px] font-semibold text-[color:var(--muted)]">Decision note</label><TextArea value={decisionNote} onChange={setDecisionNote} placeholder="Optional note to accompany your decision..." rows={3} /></div> : null}
      <div className="flex flex-wrap gap-3">
        {!isDecided ? <><ActionButton label={t("exec.approve")} tone="accent" onClick={() => void handleDecision("approved")} icon={CheckCircle} loading={acting === "approved"} /><ActionButton label={t("exec.requestRevision")} onClick={() => void handleDecision("revision_requested")} icon={ClockCounterClockwise} loading={acting === "revision_requested"} /><ActionButton label={t("exec.reject")} tone="danger" onClick={() => void handleDecision("rejected")} icon={XCircle} loading={acting === "rejected"} /></> : null}
        {isDecided ? <ActionButton label="Delete" onClick={() => setConfirmDelete(true)} icon={Trash} tone="danger" loading={acting === "delete"} /> : null}
      </div>
      {approval.decisionNote ? <div className="border-t border-[color:var(--line)] pt-4 text-[13px] text-[color:var(--muted-strong)]">Last note: {approval.decisionNote}</div> : null}
    </div>
  )
}
