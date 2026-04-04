/**
 * Wait State Indicator
 *
 * Renders an inline banner within a thread or channel when an agent
 * is waiting for human input (reply, review, or approval).
 * Provides a primary action button to reply or navigate to the approval.
 */

import { Hourglass, ChatCircle, CheckCircle } from "@phosphor-icons/react"
import type { AgentRecord } from "@shared/types"

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

function formatWaitDuration(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function WaitStateIndicator({ waitState, onReply, onNavigateApproval }: WaitStateIndicatorProps) {
  const isApproval = waitState.waitingFor === "user_approval" && waitState.relatedApprovalId
  const isReview = waitState.waitingFor === "user_review"
  const duration = formatWaitDuration(waitState.createdAt)

  return (
    <div className="flex items-center gap-3 rounded-md border-l-2 border-amber-500 bg-amber-50 px-3 py-2 dark:border-amber-400 dark:bg-amber-950/30">
      <Hourglass size={18} weight="fill" className="shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{waitState.reason}</p>
        <p className="text-xs text-muted-foreground">Waiting since {duration}</p>
      </div>
      {isApproval && onNavigateApproval ? (
        <button
          onClick={() => onNavigateApproval(waitState.relatedApprovalId!)}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
        >
          <CheckCircle size={14} />
          Review
        </button>
      ) : (
        <button
          onClick={() => onReply(waitState.id, waitState.threadId)}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
        >
          <ChatCircle size={14} />
          {isReview ? "Review" : "Reply"}
        </button>
      )}
    </div>
  )
}
