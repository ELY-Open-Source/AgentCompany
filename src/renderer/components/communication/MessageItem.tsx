import { memo } from "react"
import { motion } from "framer-motion"
import {
  ChatCircle,
  At,
  Circle,
  CheckCircle,
  WarningCircle,
  ArrowBendUpLeft,
} from "@phosphor-icons/react"
import type { AgentMessageRecord, AgentRecord, CommentRecord, DepartmentId } from "@shared/types"
import { getAgentInitials, formatMessageTime } from "../../lib/formatters"
import { DEPARTMENT_COLORS } from "@shared/constants"


const priorityConfig: Record<string, { label: string; color: string; bg: string }> = {
  urgent: { label: "Urgent", color: "var(--danger)", bg: "var(--danger-soft)" },
  normal: { label: "Normal", color: "var(--muted-strong)", bg: "var(--panel-soft)" },
  low: { label: "Low", color: "var(--muted)", bg: "var(--panel-soft)" },
}

function getDepartmentColor(department: DepartmentId | null | undefined): string {
  if (!department) return "var(--muted)"
  return DEPARTMENT_COLORS[department] ?? "var(--muted)"
}

export const AgentAvatar = memo(function AgentAvatar({
  agent,
  size = "md",
}: {
  agent: AgentRecord | undefined
  size?: "sm" | "md" | "lg"
}) {
  const sizeClass = size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-11 w-11 text-[14px]" : "h-9 w-9 text-[11px]"
  const color = agent ? getDepartmentColor(agent.department) : "var(--muted)"
  const initials = agent ? getAgentInitials(agent.name) : "?"

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${sizeClass}`}
      style={{ backgroundColor: `${color}18`, color }}
    >
      {initials}
    </div>
  )
})

export const MessageBubble = memo(function MessageBubble({
  message,
  agent,
  isThread,
  replyCount,
  onReply,
}: {
  message: AgentMessageRecord
  agent: AgentRecord | undefined
  isThread: boolean
  replyCount: number
  onReply: () => void
}) {
  const isUnread = !message.readAt
  const isUrgent = message.priority === "urgent"
  const deptColor = agent ? getDepartmentColor(agent.department) : "var(--muted)"

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`group relative flex gap-3 rounded-[8px] px-4 py-3 transition ${
        isThread ? "ml-11" : ""
      } ${
        isUnread
          ? "bg-[color:var(--panel)]"
          : "hover:bg-[color:var(--panel-soft)]/40"
      }`}
    >
      <AgentAvatar agent={agent} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold" style={{ color: deptColor }}>
            {agent?.name ?? "Unknown Agent"}
          </span>
          {agent?.title ? (
            <span className="truncate text-[11px] text-[color:var(--muted)]">{agent.title}</span>
          ) : null}
          {agent?.department ? (
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]"
              style={{ backgroundColor: `${deptColor}15`, color: deptColor }}
            >
              {agent.department.replace("_", " ")}
            </span>
          ) : null}
          <span className="whitespace-nowrap shrink-0 text-[11px] text-[color:var(--muted)]">
            {formatMessageTime(message.createdAt)}
          </span>
          {message.priority !== "normal" ? (
            <span
              className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em]"
              style={{
                backgroundColor: priorityConfig[message.priority].bg,
                color: priorityConfig[message.priority].color,
              }}
            >
              {message.priority === "urgent" ? <WarningCircle size={10} weight="fill" /> : null}
              {priorityConfig[message.priority].label}
            </span>
          ) : null}
          {isUnread ? (
            <Circle size={8} weight="fill" className="shrink-0" style={{ color: "var(--accent)" }} aria-label="Unread" />
          ) : (
            <CheckCircle
              size={10}
              weight="fill"
              className="shrink-0 text-[color:var(--muted)] opacity-0 group-hover:opacity-60 group-focus-within:opacity-60"
            />
          )}
        </div>

        {message.subject ? (
          <div className="mt-0.5 break-words text-[13px] font-medium text-[color:var(--text)]">
            {message.subject}
          </div>
        ) : null}

        <div className="mt-1 break-words whitespace-pre-wrap text-[13px] leading-relaxed text-[color:var(--muted-strong)]">
          {message.body}
        </div>

        {message.attachmentsJson && message.attachmentsJson !== "[]" ? (
          <AttachmentList json={message.attachmentsJson} />
        ) : null}

        <div className="mt-2 flex items-center gap-3">
          {replyCount > 0 && !isThread ? (
            <button
              type="button"
              onClick={onReply}
              className="flex items-center gap-1.5 text-[11px] font-medium transition hover:opacity-80"
              style={{ color: "var(--accent)" }}
            >
              <ChatCircle size={12} />
              {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onReply}
            className="flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[11px] font-medium text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)] group-hover:opacity-100"
          >
            <ArrowBendUpLeft size={10} />
            Reply
          </button>
        </div>
      </div>
    </motion.div>
  )
})

export function TaskCommentBubble({
  comment,
  agent,
}: {
  comment: CommentRecord
  agent: AgentRecord | undefined
}) {
  const isBoard = !comment.authorAgentId
  const deptColor = agent ? getDepartmentColor(agent.department) : "var(--muted)"

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="group relative flex gap-3 rounded-[8px] bg-[color:var(--panel)] px-4 py-3"
    >
      <AgentAvatar agent={agent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold" style={{ color: isBoard ? "var(--accent)" : deptColor }}>
            {comment.authorName}
          </span>
          {agent?.title ? <span className="truncate text-[11px] text-[color:var(--muted)]">{agent.title}</span> : null}
          <span className="whitespace-nowrap shrink-0 text-[11px] text-[color:var(--muted)]">{formatMessageTime(comment.createdAt)}</span>
        </div>
        <div className="mt-1 break-words whitespace-pre-wrap text-[13px] leading-relaxed text-[color:var(--muted-strong)]">
          {comment.body}
        </div>
      </div>
    </motion.div>
  )
}

function AttachmentList({ json }: { json: string }) {
  let items: Array<{ type: string; id: string; title: string }> = []
  try {
    items = JSON.parse(json)
  } catch {
    return null
  }
  if (!items.length) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={`${item.id}-${i}`}
          className="inline-flex items-center gap-1 rounded-[6px] bg-[color:var(--panel-soft)] px-2 py-1 text-[11px] font-medium text-[color:var(--muted-strong)]"
        >
          <At size={10} className="text-[color:var(--muted)]" />
          {item.title || `${item.type}:${item.id.slice(0, 8)}`}
        </span>
      ))}
    </div>
  )
}
