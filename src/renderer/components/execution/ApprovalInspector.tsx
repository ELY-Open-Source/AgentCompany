import { useState } from "react"
import { Briefcase, CheckCircle, Clock, ClockCounterClockwise, Robot, Trash, XCircle } from "@phosphor-icons/react"
import { CaretDown, CaretUp } from "@phosphor-icons/react"
import type { AgentRecord, ApprovalRecord, DocumentRecord, TaskRecord } from "@shared/types"
import { useT } from "../../i18n"
import { formatMoney, formatTime } from "../../lib/formatters"
import { unwrap } from "../../lib/desktop"
import { ActionButton, ConfirmDialog, InlineNotice, StatusPill, TextArea } from "../ui"
import { describeActionError, parseApprovalPayloadJson } from "./execution-utils"
import { SocialDraftPreview } from "./SocialDraftPreview"
import { useAppStore } from "../../state/store"

function getTypeBadgeClass(type: string): string {
  if (type === "hire_agent") return "bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
  if (type === "approve_ceo_strategy") return "bg-[color:var(--warn-soft)] text-[color:var(--warn)]"
  if (type === "secret_access") return "bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
  if (type === "social_post") return "bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
  if (type === "deliverable_review") return "bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
  return "bg-[color:var(--panel-soft)] text-[color:var(--muted)]"
}

export function ApprovalInspector({ approval, agents, tasks, documents, companyId, onDecide, onDeleted }: {
  approval: ApprovalRecord; agents: AgentRecord[]; tasks: TaskRecord[]; documents?: DocumentRecord[]; companyId: string
  onDecide: (state: "approved" | "rejected" | "revision_requested", note?: string) => Promise<void>; onDeleted: () => Promise<void>
}) {
  const t = useT()
  const addToast = useAppStore((s) => s.addToast)
  const [decisionNote, setDecisionNote] = useState(""); const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null); const [acting, setActing] = useState<"approved"|"rejected"|"revision_requested"|"delete"|null>(null)
  const [scheduleMode, setScheduleMode] = useState<"immediate" | "scheduled">("immediate")
  const [scheduledAt, setScheduledAt] = useState("")
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const requestingAgent = agents.find((a) => a.id === approval.requestedByAgentId) ?? null
  const relatedTask = tasks.find((t) => t.id === approval.relatedTaskId) ?? null
  const isDecided = approval.state !== "pending"
  const isSocialPost = approval.type === "social_post"

  async function handleDelete() { setActionError(null); setActing("delete"); try { unwrap(await window.agentCompany.deleteApproval({ id: approval.id, companyId })); setConfirmDelete(false); await onDeleted() } catch (e) { setActionError(describeActionError(e)) } finally { setActing(null) } }

  async function handleDecision(state: "approved"|"rejected"|"revision_requested") {
    setActionError(null)
    setScheduleError(null)

    // Validate schedule if social_post and user picked "scheduled"
    if (isSocialPost && state === "approved" && scheduleMode === "scheduled") {
      if (!scheduledAt) {
        setScheduleError("Please select a date and time for scheduling.")
        return
      }
      const chosenTime = new Date(scheduledAt).getTime()
      if (chosenTime <= Date.now()) {
        setScheduleError("Scheduled time must be in the future.")
        return
      }
    }

    setActing(state)
    try {
      // For social_post approvals with a schedule, include the schedule info in the decision note
      let noteForDecision = decisionNote || undefined
      if (isSocialPost && state === "approved" && scheduleMode === "scheduled" && scheduledAt) {
        const scheduleInfo = `[scheduled:${new Date(scheduledAt).toISOString()}]`
        noteForDecision = noteForDecision ? `${noteForDecision} ${scheduleInfo}` : scheduleInfo
      }
      await onDecide(state, noteForDecision)
      if (state === "approved") addToast("Approval granted — agent is moving forward", "success")
      else if (state === "rejected") addToast("Approval rejected", "warn")
      else if (state === "revision_requested") addToast("Revision requested — agent will revise and resubmit", "warn")
    } catch (e) {
      setActionError(describeActionError(e))
    } finally {
      setActing(null)
    }
  }

  // Compute minimum datetime for schedule picker: now + 5 minutes
  const minDatetime = (() => {
    const d = new Date(Date.now() + 5 * 60 * 1000)
    // Format as YYYY-MM-DDTHH:mm for datetime-local input
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })()

  const socialPlatform = (() => {
    if (!isSocialPost || !approval.payloadJson) return "other"
    try { return (JSON.parse(approval.payloadJson) as { platform?: string }).platform ?? "other" } catch { return "other" }
  })()

  return (
    <div className="space-y-6">
      <ConfirmDialog open={confirmDelete} title={t("exec.deleteApproval")} message={t("exec.deleteApprovalConfirm")} errorMessage={actionError} onConfirm={() => void handleDelete()} onCancel={() => { setActionError(null); setConfirmDelete(false) }} />
      {actionError && !confirmDelete ? <InlineNotice message={actionError} /> : null}
      <div className="border-y border-[color:var(--line)] py-4 space-y-4">
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${getTypeBadgeClass(approval.type)}`}>{approval.type.replaceAll("_", " ")}</span>
          <StatusPill status={approval.state} />
        </div>
        <div className="text-[13px] font-medium text-[color:var(--text)]">{approval.payloadSummary}</div>
        {approval.impactSummary ? <div className="text-[13px] text-[color:var(--muted)]">{approval.impactSummary}</div> : null}
        <div className="grid gap-2 text-[13px] md:grid-cols-2">
          <div className="flex items-center gap-2 text-[color:var(--muted)]"><Robot size={14} />Requested by: <span className="font-medium text-[color:var(--text)]">{requestingAgent?.name ?? "Unknown"}</span>{requestingAgent?.role ? <span className="text-[10px] text-[color:var(--muted)]">({requestingAgent.role})</span> : null}</div>
          {relatedTask ? <div className="flex items-center gap-2 text-[color:var(--muted)]"><Briefcase size={14} />Task: <span className="font-medium text-[color:var(--text)]">{relatedTask.title}</span></div> : null}
          <div className="text-[color:var(--muted)]">Created: <span className="mono text-[color:var(--text)]">{formatTime(approval.createdAt)}</span></div>
          {approval.updatedAt !== approval.createdAt ? <div className="text-[color:var(--muted)]">Updated: <span className="mono text-[color:var(--text)]">{formatTime(approval.updatedAt)}</span></div> : null}
        </div>
        {approval.type === "hire_agent" ? (() => { const payload = parseApprovalPayloadJson(approval); const payloadAgentId = typeof payload?.agentId === "string" ? payload.agentId : null; const reqSnap = payload?.requestedConfigurationSnapshot && typeof payload.requestedConfigurationSnapshot === "object" && !Array.isArray(payload.requestedConfigurationSnapshot) ? payload.requestedConfigurationSnapshot as Record<string, unknown> : null; const proposedAgent = (approval.relatedAgentId ? (agents.find((a) => a.id === approval.relatedAgentId) ?? null) : null) ?? (payloadAgentId ? (agents.find((a) => a.id === payloadAgentId) ?? null) : null); const mgrId = proposedAgent?.reportsTo ?? (typeof reqSnap?.reportsTo === "string" ? reqSnap.reportsTo : null); const mgr = mgrId ? (agents.find((a) => a.id === mgrId) ?? null) : null; if (!proposedAgent && !reqSnap) return null; return (
          <div className="rounded-[8px] border border-[color:var(--accent)] border-opacity-30 bg-[color:var(--accent-soft)] px-4 py-3"><div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--accent)]">Proposed Hire</div><div className="grid gap-1.5 text-[12px]">
            <div><span className="text-[color:var(--muted)]">Name:</span> <span className="font-medium text-[color:var(--text)]">{proposedAgent?.name ?? approval.payloadSummary.replace(/^Hire\s+/i, "").split(/\s+as\s+/i)[0] ?? "Pending hire"}</span></div>
            <div><span className="text-[color:var(--muted)]">Role:</span> <span className="text-[color:var(--text)]">{proposedAgent?.role ?? (typeof reqSnap?.role === "string" ? reqSnap.role : "Unspecified")}</span></div>
            {(proposedAgent?.title || typeof reqSnap?.title === "string") ? <div><span className="text-[color:var(--muted)]">Title:</span> <span className="text-[color:var(--text)]">{proposedAgent?.title || reqSnap?.title as string}</span></div> : null}
            {(proposedAgent?.capabilities || typeof reqSnap?.capabilities === "string") ? <div><span className="text-[color:var(--muted)]">Capabilities:</span> <span className="text-[color:var(--text)]">{proposedAgent?.capabilities || reqSnap?.capabilities as string}</span></div> : null}
            <div><span className="text-[color:var(--muted)]">Connector:</span> <span className="mono text-[color:var(--text)]">{proposedAgent?.connectorId ?? (typeof reqSnap?.connectorId === "string" ? reqSnap.connectorId : "Unknown")}</span></div>
            <div><span className="text-[color:var(--muted)]">Budget:</span> <span className="mono text-[color:var(--text)]">{formatMoney(proposedAgent?.budgetMonthlyUsd ?? (typeof reqSnap?.budgetMonthlyUsd === "number" ? reqSnap.budgetMonthlyUsd : 0))}/mo</span></div>
            {mgr ? <div><span className="text-[color:var(--muted)]">Reports to:</span> <span className="text-[color:var(--text)]">{mgr.name}</span></div> : null}
          </div></div>) })() : null}
        {approval.type === "approve_ceo_strategy" ? <div className="rounded-[8px] border border-[color:var(--warn)] border-opacity-30 bg-[color:var(--warn-soft)] px-4 py-3"><div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--warn)]">Organization Strategy</div><div className="whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--text)]">{approval.payloadSummary}</div></div> : null}
        {approval.type === "deliverable_review" ? <DeliverableReviewPanel approval={approval} documents={documents} agents={agents} /> : null}
        {isSocialPost && approval.payloadJson ? (
          <SocialDraftPreview
            payloadJson={approval.payloadJson}
            platform={socialPlatform}
            isPending={approval.state === "pending"}
          />
        ) : null}
      </div>

      {/* Schedule picker for social_post approvals */}
      {isSocialPost && !isDecided ? (
        <div className="space-y-3">
          <div role="radiogroup" aria-label="Post timing" className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <span
                role="radio"
                aria-checked={scheduleMode === "immediate"}
                tabIndex={0}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${scheduleMode === "immediate" ? "border-[color:var(--accent)]" : "border-[color:var(--line)]"}`}
                onClick={() => { setScheduleMode("immediate"); setScheduleError(null) }}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { setScheduleMode("immediate"); setScheduleError(null) } }}
              >
                {scheduleMode === "immediate" ? <span className="h-2 w-2 rounded-full bg-[color:var(--accent)]" aria-hidden="true" /> : null}
              </span>
              <span className="text-[13px] font-medium text-[color:var(--text)]">Post immediately</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <span
                role="radio"
                aria-checked={scheduleMode === "scheduled"}
                tabIndex={0}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${scheduleMode === "scheduled" ? "border-[color:var(--accent)]" : "border-[color:var(--line)]"}`}
                onClick={() => setScheduleMode("scheduled")}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") setScheduleMode("scheduled") }}
              >
                {scheduleMode === "scheduled" ? <span className="h-2 w-2 rounded-full bg-[color:var(--accent)]" aria-hidden="true" /> : null}
              </span>
              <span className="text-[13px] font-medium text-[color:var(--text)]">Schedule for later</span>
            </label>
          </div>
          {scheduleMode === "scheduled" ? (
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-[color:var(--muted)]" />
              <input
                type="datetime-local"
                value={scheduledAt}
                min={minDatetime}
                onChange={(e) => { setScheduledAt(e.target.value); setScheduleError(null) }}
                className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-3.5 py-2.5 text-[13px] text-[color:var(--text)] focus:border-[color:var(--accent)] focus:outline-none"
              />
            </div>
          ) : null}
          {scheduleError ? <InlineNotice message={scheduleError} /> : null}
        </div>
      ) : null}

      {!isDecided ? <div><label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Decision note</label><TextArea value={decisionNote} onChange={setDecisionNote} placeholder="Add a note (optional)" rows={3} /></div> : null}
      <div className="flex flex-wrap gap-3">
        {!isDecided ? <>
          <ActionButton
            label={isSocialPost ? "Approve & Post" : t("exec.approve")}
            tone="accent"
            onClick={() => void handleDecision("approved")}
            icon={CheckCircle}
            loading={acting === "approved"}
          />
          <ActionButton label={t("exec.requestRevision")} onClick={() => void handleDecision("revision_requested")} icon={ClockCounterClockwise} loading={acting === "revision_requested"} />
          <ActionButton label={t("exec.reject")} tone="danger" onClick={() => void handleDecision("rejected")} icon={XCircle} loading={acting === "rejected"} />
        </> : null}
        {isDecided ? <ActionButton label="Delete" onClick={() => setConfirmDelete(true)} icon={Trash} tone="danger" loading={acting === "delete"} /> : null}
      </div>
      {approval.decisionNote ? <div className="border-t border-[color:var(--line)] pt-4 text-[13px] text-[color:var(--muted-strong)]">Last note: {approval.decisionNote}</div> : null}
    </div>
  )
}

function DeliverableReviewPanel({ approval, documents, agents }: { approval: ApprovalRecord; documents?: DocumentRecord[]; agents: AgentRecord[] }) {
  const payload = parseApprovalPayloadJson(approval)
  const docRefs = Array.isArray(payload?.documents) ? payload.documents as Array<{ id: string; type: string; title: string }> : []
  const docIds = Array.isArray(payload?.documentIds) ? payload.documentIds as string[] : docRefs.map((d) => d.id)
  const fullDocs = documents ? docIds.map((id) => documents.find((d) => d.id === id)).filter(Boolean) as DocumentRecord[] : []
  const [expandedDocId, setExpandedDocId] = useState<string | null>(fullDocs.length === 1 ? fullDocs[0]!.id : null)

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--accent)]">Deliverable Review</div>
      {fullDocs.length > 0 ? fullDocs.map((doc) => {
        const isExpanded = expandedDocId === doc.id
        const author = doc.authorAgentId ? agents.find((a) => a.id === doc.authorAgentId) : null
        return (
          <div key={doc.id} className="rounded-[8px] border border-[color:var(--line)] overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
              className="flex w-full cursor-pointer items-center gap-3 bg-[color:var(--panel-soft)] px-4 py-3 text-left transition hover:bg-[color:var(--panel)]"
            >
              <span className="shrink-0 rounded-full bg-[color:var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[color:var(--accent)]">{doc.type.replaceAll("_", " ")}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[color:var(--text)]">{doc.title}</span>
              {isExpanded ? <CaretUp size={14} className="shrink-0 text-[color:var(--muted)]" /> : <CaretDown size={14} className="shrink-0 text-[color:var(--muted)]" />}
            </button>
            {isExpanded ? (
              <div className="border-t border-[color:var(--line)] px-4 py-3">
                {author ? <div className="mb-2 text-[11px] text-[color:var(--muted)]">Author: <span className="font-medium text-[color:var(--text)]">{author.name}</span> ({author.role})</div> : null}
                <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--text)]">{doc.content || "No content."}</div>
              </div>
            ) : null}
          </div>
        )
      }) : docRefs.length > 0 ? docRefs.map((doc) => (
        <div key={doc.id} className="flex items-center gap-2 rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-[12px]">
          <span className="rounded-full bg-[color:var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[color:var(--accent)]">{doc.type.replaceAll("_", " ")}</span>
          <span className="font-medium text-[color:var(--text)]">{doc.title}</span>
        </div>
      )) : <div className="text-[12px] text-[color:var(--muted)]">{approval.payloadSummary}</div>}
      {approval.impactSummary ? <div className="text-[11px] text-[color:var(--muted)]">{approval.impactSummary}</div> : null}
    </div>
  )
}
