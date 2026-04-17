import { useState } from "react"
import type { AgentRecord, ApprovalRecord, DocumentRecord, TaskRecord } from "@shared/types"
import { extractApprovalDocumentReferences } from "@shared/approval-documents"
import { useT } from "../../../i18n"
import { unwrap } from "../../../lib/desktop"
import { Card, ConfirmDialog, Eyebrow, InlineNotice } from "../../ui"
import { useAppStore } from "../../../state/store"
import { describeActionError } from "../execution-utils"
import { SocialDraftPreview } from "../SocialDraftPreview"
import { ApprovalSummary } from "./ApprovalSummary"
import { ProposedHireCard } from "./ProposedHireCard"
import { ApprovalDocumentsPanel } from "./ApprovalDocumentsPanel"
import { DeliverableReviewPanel } from "./DeliverableReviewPanel"
import { SchedulePicker, type ScheduleMode } from "./SchedulePicker"
import { DecisionForm, type ActingState, type DecisionState } from "./DecisionForm"
import { useSocialPlatform } from "./useApprovalPayload"

export function ApprovalInspector({
  approval,
  agents,
  tasks,
  documents,
  companyId,
  onDecide,
  onDeleted,
}: {
  approval: ApprovalRecord
  agents: AgentRecord[]
  tasks: TaskRecord[]
  documents?: DocumentRecord[]
  companyId: string
  onDecide: (state: DecisionState, note?: string) => Promise<void>
  onDeleted: () => Promise<void>
}) {
  const t = useT()
  const addToast = useAppStore((s) => s.addToast)
  const [decisionNote, setDecisionNote] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [acting, setActing] = useState<ActingState>(null)
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("immediate")
  const [scheduledAt, setScheduledAt] = useState("")
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  const requestingAgent = agents.find((a) => a.id === approval.requestedByAgentId) ?? null
  const relatedTask = tasks.find((task) => task.id === approval.relatedTaskId) ?? null
  const isDecided = approval.state !== "pending"
  const isSocialPost = approval.type === "social_post"
  const socialPlatform = useSocialPlatform(approval)
  const hasDocumentReferences = extractApprovalDocumentReferences(approval.payloadJson).length > 0

  async function handleDelete() {
    setActionError(null)
    setActing("delete")
    try {
      unwrap(await window.agentCompany.deleteApproval({ id: approval.id, companyId }))
      setConfirmDelete(false)
      await onDeleted()
    } catch (error) {
      setActionError(describeActionError(error))
    } finally {
      setActing(null)
    }
  }

  async function handleDecision(state: DecisionState) {
    setActionError(null)
    setScheduleError(null)

    if (isSocialPost && state === "approved" && scheduleMode === "scheduled") {
      if (!scheduledAt) {
        setScheduleError(t("approval.scheduleSelectTime"))
        return
      }
      const chosenTime = new Date(scheduledAt).getTime()
      if (chosenTime <= Date.now()) {
        setScheduleError(t("approval.scheduleFuture"))
        return
      }
    }

    setActing(state)
    try {
      let noteForDecision = decisionNote || undefined
      if (isSocialPost && state === "approved" && scheduleMode === "scheduled" && scheduledAt) {
        const scheduleInfo = `[scheduled:${new Date(scheduledAt).toISOString()}]`
        noteForDecision = noteForDecision ? `${noteForDecision} ${scheduleInfo}` : scheduleInfo
      }
      await onDecide(state, noteForDecision)
      if (state === "approved") addToast(t("approval.granted"), "success")
      else if (state === "rejected") addToast(t("approval.rejectedToast"), "warn")
      else if (state === "revision_requested") addToast(t("approval.revisionRequested"), "warn")
    } catch (error) {
      setActionError(describeActionError(error))
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={confirmDelete}
        title={t("exec.deleteApproval")}
        message={t("exec.deleteApprovalConfirm")}
        errorMessage={actionError}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setActionError(null)
          setConfirmDelete(false)
        }}
      />
      {actionError && !confirmDelete ? <InlineNotice message={actionError} /> : null}
      <div className="border-y border-border py-4 space-y-4">
        <ApprovalSummary approval={approval} requestingAgent={requestingAgent} relatedTask={relatedTask} />
        {approval.type === "hire_agent" ? <ProposedHireCard approval={approval} agents={agents} /> : null}
        {approval.type === "approve_ceo_strategy" ? (
          <Card
            padding="sm"
            className="border-[color:var(--destructive)] border-opacity-30 bg-warning-muted"
          >
            <Eyebrow tone="warning" className="mb-2">
              {t("approval.orgStrategy")}
            </Eyebrow>
            <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
              {approval.payloadSummary}
            </div>
          </Card>
        ) : null}
        <ApprovalDocumentsPanel approval={approval} documents={documents} companyId={companyId} />
        {approval.type === "deliverable_review" && !hasDocumentReferences ? (
          <DeliverableReviewPanel approval={approval} documents={documents} agents={agents} />
        ) : null}
        {isSocialPost && approval.payloadJson ? (
          <SocialDraftPreview
            payloadJson={approval.payloadJson}
            platform={socialPlatform}
            isPending={approval.state === "pending"}
          />
        ) : null}
      </div>

      {isSocialPost && !isDecided ? (
        <SchedulePicker
          mode={scheduleMode}
          scheduledAt={scheduledAt}
          error={scheduleError}
          onModeChange={setScheduleMode}
          onScheduledAtChange={setScheduledAt}
          onClearError={() => setScheduleError(null)}
        />
      ) : null}

      <DecisionForm
        isDecided={isDecided}
        isSocialPost={isSocialPost}
        decisionNote={decisionNote}
        acting={acting}
        onDecisionNoteChange={setDecisionNote}
        onDecide={(state) => void handleDecision(state)}
        onRequestDelete={() => setConfirmDelete(true)}
      />

      {approval.decisionNote ? (
        <div className="border-t border-border pt-4 text-[13px] text-muted-foreground">
          {t("approval.lastNote")} {approval.decisionNote}
        </div>
      ) : null}
    </div>
  )
}
