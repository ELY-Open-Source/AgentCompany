/**
 * Wait State Indicator
 *
 * Renders an inline banner within a thread or channel when an agent
 * is waiting for human input (reply, review, or approval).
 * Provides a primary action button to reply or navigate to the approval.
 */

import { Hourglass, ChatCircle, CheckCircle } from "../ui/icons"
import type { AgentRecord } from "@shared/types"
import { useT } from "../../i18n"
import { timeAgo } from "../../lib/formatters"

export interface WaitStateInfo {
  id: string
  threadId: string
  companyId: string
  waitingFor: "user_reply" | "user_review" | "user_approval"
  reason: string
  createdAt: string
  relatedApprovalId: string | null
}

interface WaitStateIndicatorProps {
  waitState: WaitStateInfo
  agents: AgentRecord[]
  onReply: (waitStateId: string, threadId: string) => void
  onNavigateApproval?: (approvalId: string) => void
}

export default function WaitStateIndicator({ waitState, onReply, onNavigateApproval }: WaitStateIndicatorProps) {
  const t = useT()
  const isApproval = waitState.waitingFor === "user_approval" && waitState.relatedApprovalId
  const isReview = waitState.waitingFor === "user_review"
  const duration = timeAgo(waitState.createdAt)

  return (
    <div className="flex items-center gap-3 rounded-md border-l-2 border-primary bg-accent px-3 py-2">
      <Hourglass size={18} weight="fill" className="shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{waitState.reason}</p>
        <p className="text-xs text-muted-foreground">{t("wait.waitingSince")} {duration}</p>
      </div>
      {isApproval && onNavigateApproval ? (
        <button
          onClick={() => { const id = waitState.relatedApprovalId; if (id) onNavigateApproval(id); }}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:brightness-95"
        >
          <CheckCircle size={14} />
          {t("wait.review")}
        </button>
      ) : (
        <button
          onClick={() => onReply(waitState.id, waitState.threadId)}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:brightness-95"
        >
          <ChatCircle size={14} />
          {isReview ? t("wait.review") : t("wait.reply")}
        </button>
      )}
    </div>
  )
}
