import { useEffect, useState } from "react"
import { Robot, ArrowRight } from "@phosphor-icons/react"
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
        <Robot size={16} className="text-[color:var(--muted)]" />
        <span className="text-[13px] font-semibold text-[color:var(--text)]">{t("exec.communication")}</span>
        <span className="text-[11px] text-[color:var(--muted)]">({comments.length})</span>
      </div>
      {comments.length === 0 ? (
        <div className="text-[12px] text-[color:var(--muted)]">{t("exec.noMessagesYet")}</div>
      ) : (
        <div className="max-h-[240px] space-y-2 overflow-y-auto rounded-lg border border-[color:var(--line)] p-3">
          {comments.map((comment) => {
            const isAgent = Boolean(comment.authorAgentId)
            const agent = isAgent ? agents.find((a) => a.id === comment.authorAgentId) : null
            return (
              <div key={comment.id} className="rounded-md bg-[color:var(--panel-soft)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[12px] font-semibold ${isAgent ? "text-[color:var(--accent)]" : "text-[color:var(--text)]"}`}>{comment.authorName}</span>
                  {agent && <span className="text-[10px] text-[color:var(--muted)]">{agent.role}</span>}
                  <span className="text-[10px] text-[color:var(--muted)]">{formatTime(comment.createdAt)}</span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] text-[color:var(--text)]">{comment.body}</div>
              </div>
            )
          })}
        </div>
      )}
      {submitError ? <InlineNotice message={submitError} /> : null}
      <div className="flex gap-2">
        <input className="flex-1 rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:outline-none" placeholder={t("exec.sendMessage")} value={newComment} onChange={(e) => setNewComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSubmit() } }} />
        <ActionButton label={t("exec.send")} tone="accent" onClick={() => void handleSubmit()} icon={ArrowRight} loading={submitting} />
      </div>
    </div>
  )
}
