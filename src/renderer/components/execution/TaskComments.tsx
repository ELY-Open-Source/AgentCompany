import { useEffect, useState } from "react"
import { Robot, ArrowRight } from "../ui/icons"
import type { CommentRecord, ProfileSnapshot } from "@shared/types"
import { useT } from "../../i18n"
import { formatTime } from "../../lib/formatters"
import { unwrap } from "../../lib/desktop"
import { ActionButton, InlineNotice } from "../ui"
import { describeActionError } from "./execution-utils"

export function TaskComments({ taskId, companyId, agents, comments, onRefresh }: {
  taskId: string; companyId: string; agents: ProfileSnapshot["agents"]; comments: CommentRecord[]; onRefresh: () => Promise<void>
}) {
  const t = useT()
  const [newComment, setNewComment] = useState(""); const [submitting, setSubmitting] = useState(false); const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = window.agentCompany.subscribe((event) => { if (event.type === "agent-message" && event.taskId === taskId) void onRefresh() })
    return unsubscribe
  }, [onRefresh, taskId])

  const handleSubmit = async () => {
    if (!newComment.trim()) return; setSubmitError(null); setSubmitting(true)
    try { unwrap(await window.agentCompany.addComment({ companyId, taskId, authorName: "Board", body: newComment.trim() })); setNewComment(""); await onRefresh() } catch (e) { setSubmitError(describeActionError(e)) } finally { setSubmitting(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Robot size={16} className="text-muted-foreground" />
        <span className="text-[13px] font-semibold text-foreground">{t("exec.communication")}</span>
        <span className="text-[11px] text-muted-foreground">({comments.length})</span>
      </div>
      {comments.length === 0 ? (
        <div className="text-[12px] text-muted-foreground">{t("exec.noMessagesYet")}</div>
      ) : (
        <div className="max-h-[240px] space-y-2 overflow-y-auto rounded-lg border border-border p-3">
          {comments.map((comment) => {
            const isAgent = Boolean(comment.authorAgentId)
            const agent = isAgent ? agents.find((a) => a.id === comment.authorAgentId) : null
            return (
              <div key={comment.id} className="rounded-md bg-muted px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[12px] font-semibold ${isAgent ? "text-primary" : "text-foreground"}`}>{comment.authorName}</span>
                  {agent && <span className="text-[10px] text-muted-foreground">{agent.role}</span>}
                  <span className="text-[10px] text-muted-foreground">{formatTime(comment.createdAt)}</span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] text-foreground">{comment.body}</div>
              </div>
            )
          })}
        </div>
      )}
      {submitError ? <InlineNotice message={submitError} /> : null}
      <div className="flex gap-2">
        <input aria-label={t("exec.sendMessage")} className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-[color:var(--primary)] focus:outline-none" placeholder={t("exec.sendMessage")} value={newComment} onChange={(e) => setNewComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSubmit() } }} />
        <ActionButton label={t("exec.send")} tone="accent" onClick={() => void handleSubmit()} icon={ArrowRight} loading={submitting} />
      </div>
    </div>
  )
}
