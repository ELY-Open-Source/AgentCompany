import { memo } from "react"
import { motion } from "framer-motion"
import {
  ChatCircle,
  At,
  Circle,
  WarningCircle,
  ArrowBendUpLeft,
  UserCircle,
} from "../ui/icons"
import type { AgentMessageRecord, AgentRecord, CommentRecord, DepartmentId } from "@shared/types"
import { getAgentInitials, formatMessageTime } from "../../lib/formatters"
import { safeJson } from "../../lib/safe-json"
import { DEPARTMENT_COLORS } from "@shared/constants"
import { useT, type TranslationFn } from "../../i18n"
import { MarkdownBody } from "../ui/MarkdownBody"

const HUMAN_SENDER_ID = "__board__";


function priorityConfig(t: TranslationFn): Record<string, { label: string; className: string }> {
  return {
    urgent: { label: t("msg.priority.urgent"), className: "bg-destructive-muted text-destructive" },
    normal: { label: t("msg.priority.normal"), className: "bg-muted text-muted-foreground" },
    low: { label: t("msg.priority.low"), className: "bg-muted text-muted-foreground" },
  }
}

function getDepartmentColor(department: DepartmentId | null | undefined): string {
  if (!department) return "var(--muted-foreground)"
  return DEPARTMENT_COLORS[department] ?? "var(--muted-foreground)"
}

export const AgentAvatar = memo(function AgentAvatar({
  agent,
  size = "md",
}: {
  agent: AgentRecord | undefined
  size?: "sm" | "md" | "lg"
}) {
  const sizeClass = size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-11 w-11 text-[14px]" : "h-9 w-9 text-[11px]"
  const color = agent ? getDepartmentColor(agent.department) : "var(--muted-foreground)"
  const initials = agent ? getAgentInitials(agent.name) : "?"

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${sizeClass}`}
      style={{ backgroundColor: `color-mix(in oklab, ${color}, transparent 91%)`, color }}
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
  const t = useT()
  const priorityMap = priorityConfig(t)
  const isUnread = !message.readAt
  const isHuman = message.fromAgentId === HUMAN_SENDER_ID
  const deptColor = agent ? getDepartmentColor(agent.department) : "var(--muted-foreground)"
  const senderColor = isHuman ? "var(--primary)" : deptColor
  const senderName = isHuman ? t("msg.you") : (agent?.name ?? t("msg.unknownAgent"))

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`group relative flex gap-3 rounded-lg px-4 py-3 transition ${
        isThread ? "ml-11" : ""
      } ${
        isUnread
          ? "bg-card"
          : "hover:bg-muted/40"
      }`}
    >
      {isHuman
        ? <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><UserCircle size={20} weight="fill" /></div>
        : <AgentAvatar agent={agent} />}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold" style={{ color: senderColor }}>
            {senderName}
          </span>
          {agent?.title ? (
            <span className="truncate text-[11px] text-muted-foreground">{agent.title}</span>
          ) : null}
          <span className="whitespace-nowrap shrink-0 text-[11px] text-muted-foreground">
            {formatMessageTime(message.createdAt)}
          </span>
          {message.priority !== "normal" ? (
            <span
              className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] ${priorityMap[message.priority]?.className ?? ""}`}
            >
              {message.priority === "urgent" ? <WarningCircle size={10} weight="fill" /> : null}
              {priorityMap[message.priority]?.label}
            </span>
          ) : null}
          {isUnread ? (
            <Circle size={8} weight="fill" className="shrink-0" style={{ color: "var(--primary)" }} aria-label={t("msg.unread")} />
          ) : null}
        </div>

        {message.subject ? (
          <div className="mt-0.5 break-words text-[13px] font-medium text-foreground">
            {message.subject}
          </div>
        ) : null}

        <div className="mt-1 break-words text-[13px] leading-relaxed text-muted-foreground">
          <MarkdownBody body={message.body} />
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
              style={{ color: "var(--primary)" }}
            >
              <ChatCircle size={12} />
              {replyCount} {t("msg.replies")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onReply}
            className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
          >
            <ArrowBendUpLeft size={10} />
            {t("msg.reply")}
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
  const deptColor = agent ? getDepartmentColor(agent.department) : "var(--muted-foreground)"

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="group relative flex gap-3 rounded-lg bg-card px-4 py-3"
    >
      <AgentAvatar agent={agent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold" style={{ color: isBoard ? "var(--primary)" : deptColor }}>
            {comment.authorName}
          </span>
          {agent?.title ? <span className="truncate text-[11px] text-muted-foreground">{agent.title}</span> : null}
          <span className="whitespace-nowrap shrink-0 text-[11px] text-muted-foreground">{formatMessageTime(comment.createdAt)}</span>
        </div>
        <div className="mt-1 break-words text-[13px] leading-relaxed text-muted-foreground">
          <MarkdownBody body={comment.body} />
        </div>
      </div>
    </motion.div>
  )
}

function AttachmentList({ json }: { json: string }) {
  const items = safeJson<Array<{ type: string; id: string; title: string }>>(json, [])
  if (!items.length) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={`${item.id}-${i}`}
          className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground"
        >
          <At size={10} className="text-muted-foreground" />
          {item.title || `${item.type}:${item.id.slice(0, 8)}`}
        </span>
      ))}
    </div>
  )
}
