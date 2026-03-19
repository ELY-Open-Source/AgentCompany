import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ChatCircle,
  EnvelopeSimple,
  At,
  Hash,
  PaperPlaneTilt,
  MagnifyingGlass,
  Funnel,
  Circle,
  CheckCircle,
  WarningCircle,
  Megaphone,
  Buildings,
  Fire,
  ArrowBendUpLeft,
  Plus,
  X,
  CaretDown,
  Tray,
} from "@phosphor-icons/react"
import type {
  AgentMessageRecord,
  AgentRecord,
  CommentRecord,
  DepartmentId,
  MessageChannel,
  MessagePriority,
  ProjectRecord,
  TaskRecord,
} from "@shared/types"
import { getAgentInitials, formatMessageTime } from "../lib/formatters"
import { DEPARTMENT_COLORS } from "@shared/constants"
import { unwrap } from "../lib/desktop"
import { InlineNotice, Modal, Select, Input, TextArea } from "./ui"
import { useT } from "../i18n"

const TERRACOTTA = "#d97745"
const TERRACOTTA_SOFT = "#d9774518"

const channelConfig: Record<MessageChannel, { label: string; icon: React.ElementType; color: string }> = {
  direct: { label: "Direct Messages", icon: EnvelopeSimple, color: "var(--accent)" },
  department: { label: "Department", icon: Buildings, color: "#6366f1" },
  company: { label: "Company-wide", icon: Megaphone, color: TERRACOTTA },
  project: { label: "Project", icon: Hash, color: "#10b981" },
  incident: { label: "Incident", icon: Fire, color: "var(--danger)" },
}

const priorityConfig: Record<MessagePriority, { label: string; color: string; bg: string }> = {
  urgent: { label: "Urgent", color: "var(--danger)", bg: "var(--danger-soft)" },
  normal: { label: "Normal", color: "var(--muted-strong)", bg: "var(--panel-soft)" },
  low: { label: "Low", color: "var(--muted)", bg: "var(--panel-soft)" },
}

function getDepartmentColor(department: DepartmentId | null | undefined): string {
  if (!department) return "var(--muted)"
  return DEPARTMENT_COLORS[department] ?? "var(--muted)"
}

interface ChannelDescriptor {
  key: string
  kind: "message"
  channel: MessageChannel
  label: string
  targetId: string | null
  /** Agent ID for DM channels */
  agentId: string | null
  /** Participant IDs for DM channels */
  participantIds: string[]
}

interface TaskDiscussionDescriptor {
  key: string
  kind: "task"
  taskId: string
  label: string
}

function deriveChannels(
  messages: AgentMessageRecord[],
  agents: AgentRecord[],
  projects?: ProjectRecord[],
): ChannelDescriptor[] {
  const channelMap = new Map<string, ChannelDescriptor>()
  const agentMap = new Map(agents.map((a) => [a.id, a]))
  const projectMap = new Map((projects ?? []).map((project) => [project.id, project]))

  // Always create company-wide channel
  channelMap.set("company-all", {
    key: "company-all",
    kind: "message",
    channel: "company",
    label: "#company-wide",
    targetId: null,
    agentId: null,
    participantIds: [],
  })

  // Create permanent department channels for all departments that have agents
  const activeDepts = new Set<string>()
  for (const agent of agents) {
    if (agent.department && agent.status !== "terminated") {
      activeDepts.add(agent.department)
    }
  }
  for (const dept of activeDepts) {
    const key = `department-${dept}`
    const deptLabel = dept.replace(/_/g, "-")
    channelMap.set(key, {
        key,
        kind: "message",
        channel: "department",
      label: `#${deptLabel}`,
      targetId: dept,
      agentId: null,
      participantIds: [],
    })
  }

  // Add channels derived from existing messages (DMs, projects, incidents)
  for (const msg of messages) {
    let key: string
    let label: string
    let agentId: string | null = null

    switch (msg.channel) {
      case "direct": {
        const otherId = msg.toAgentId
        if (!otherId) {
          key = `direct-broadcast`
          label = "Broadcast DMs"
          agentId = null
        } else {
          const ids = [msg.fromAgentId, otherId].sort()
          key = `direct-${ids.join("-")}`
          const first = agentMap.get(ids[0] ?? "")
          const second = agentMap.get(ids[1] ?? "")
          label = `${first?.name ?? (ids[0] ? ids[0].slice(0, 8) : "Unknown")} ↔ ${second?.name ?? (ids[1] ? ids[1].slice(0, 8) : "Unknown")}`
          agentId = ids[1] ?? null
        }
        break
      }
      case "department": {
        const dept = msg.channelTargetId ?? "general"
        key = `department-${dept}`
        label = `#${dept.replace(/_/g, "-")}`
        break
      }
      case "company": {
        key = "company-all"
        label = "#company-wide"
        break
      }
      case "project": {
        const projId = msg.channelTargetId ?? "general"
        key = `project-${projId}`
        label = projectMap.get(projId)?.name ?? `#project-${projId.slice(0, 8)}`
        break
      }
      case "incident": {
        const incId = msg.channelTargetId ?? "room"
        key = `incident-${incId}`
        label = incId === "room" ? "#incident-room" : `#incident-${incId.slice(0, 8)}`
        break
      }
    }

    if (!channelMap.has(key)) {
      channelMap.set(key, {
        key,
        kind: "message",
        channel: msg.channel,
        label,
        targetId: msg.channelTargetId,
        agentId,
        participantIds: msg.channel === "direct" && msg.toAgentId
          ? [msg.fromAgentId, msg.toAgentId].sort()
          : [],
      })
    }
  }

  const order: MessageChannel[] = ["company", "department", "project", "incident", "direct"]
  return Array.from(channelMap.values()).sort((a, b) => {
    const ai = order.indexOf(a.channel)
    const bi = order.indexOf(b.channel)
    if (ai !== bi) return ai - bi
    return a.label.localeCompare(b.label)
  })
}

function deriveTaskDiscussionChannels(
  comments: CommentRecord[],
  tasks: TaskRecord[],
  forcedTaskId?: string | null,
): TaskDiscussionDescriptor[] {
  const taskMap = new Map(tasks.map((task) => [task.id, task]))
  const activeTaskIds = tasks
    .filter((task) => ["todo", "in_progress", "in_review", "blocked"].includes(task.status))
    .map((task) => task.id)
  const discussionTaskIds = new Set([
    ...comments.map((comment) => comment.taskId),
    ...activeTaskIds,
    ...(forcedTaskId ? [forcedTaskId] : []),
  ])

  return Array.from(discussionTaskIds)
    .map((taskId) => {
      const task = taskMap.get(taskId)
      return {
        key: `task-${taskId}`,
        kind: "task" as const,
        taskId,
        label: task
          ? `${task.title}${task.status === "blocked" ? " · blocked" : task.status === "in_review" ? " · review" : ""}`
          : `Task ${taskId.slice(0, 8)}`,
      }
    })
    .sort((left, right) => {
      const leftTask = taskMap.get(left.taskId)
      const rightTask = taskMap.get(right.taskId)
      const priorityWeight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
      const leftWeight = leftTask ? priorityWeight[leftTask.priority] ?? 0 : 0
      const rightWeight = rightTask ? priorityWeight[rightTask.priority] ?? 0 : 0
      if (leftWeight !== rightWeight) return rightWeight - leftWeight
      return left.label.localeCompare(right.label)
    })
}

function getChannelMessages(
  messages: AgentMessageRecord[],
  channel: ChannelDescriptor,
): AgentMessageRecord[] {
  return messages.filter((msg) => {
    if (channel.channel === "company" && msg.channel === "company") return true
    if (channel.channel === "department" && msg.channel === "department") {
      return msg.channelTargetId === channel.targetId
    }
    if (channel.channel === "project" && msg.channel === "project") {
      return msg.channelTargetId === channel.targetId
    }
    if (channel.channel === "incident" && msg.channel === "incident") {
      return msg.channelTargetId === channel.targetId
    }
    if (channel.channel === "direct" && msg.channel === "direct") {
      if (channel.key === "direct-broadcast") return !msg.toAgentId
      if (!msg.toAgentId || channel.participantIds.length < 2) return false
      const ids = [msg.fromAgentId, msg.toAgentId].sort()
      return ids[0] === channel.participantIds[0] && ids[1] === channel.participantIds[1]
    }
    return false
  })
}

function AgentAvatar({
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
}

function ChannelItem({
  descriptor,
  active,
  unreadCount,
  hasUrgent,
  agents,
  onClick,
}: {
  descriptor: ChannelDescriptor
  active: boolean
  unreadCount: number
  hasUrgent: boolean
  agents: AgentRecord[]
  onClick: () => void
}) {
  const config = channelConfig[descriptor.channel]
  const Icon = config.icon
  const agent = descriptor.agentId
    ? agents.find((a) => a.id === descriptor.agentId)
    : undefined

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left transition duration-150 ${
        active
          ? "bg-[color:var(--panel-soft)]"
          : "hover:bg-[color:var(--panel-soft)]/50"
      }`}
    >
      {descriptor.channel === "direct" && agent ? (
        <AgentAvatar agent={agent} size="sm" />
      ) : (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]"
          style={{ backgroundColor: `${config.color}18` }}
        >
          <Icon
            size={14}
            weight={active ? "fill" : "regular"}
            style={{ color: config.color }}
          />
        </div>
      )}

      <span
        className={`min-w-0 flex-1 truncate text-[12px] ${
          active
            ? "font-semibold text-[color:var(--text)]"
            : unreadCount > 0
              ? "font-semibold text-[color:var(--text)]"
              : "font-medium text-[color:var(--muted-strong)]"
        }`}
      >
        {descriptor.label}
      </span>

      {hasUrgent ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-[color:var(--danger)]" />
      ) : unreadCount > 0 ? (
        <span
          className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
          style={{ backgroundColor: TERRACOTTA }}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </button>
  )
}

function MessageBubble({
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
      className={`group relative flex gap-3 rounded-[10px] px-4 py-3 transition ${
        isThread ? "ml-11" : ""
      } ${
        isUnread
          ? "bg-[color:var(--panel)]"
          : "hover:bg-[color:var(--panel-soft)]/40"
      } ${
        isUrgent ? "border-l-[3px]" : ""
      }`}
      style={isUrgent ? { borderLeftColor: "var(--danger)" } : undefined}
    >
      <AgentAvatar agent={agent} />

      <div className="min-w-0 flex-1">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <span
            className="text-[13px] font-semibold"
            style={{ color: deptColor }}
          >
            {agent?.name ?? "Unknown Agent"}
          </span>
          {agent?.title ? (
            <span className="text-[10px] text-[color:var(--muted)]">
              {agent.title}
            </span>
          ) : null}
          {agent?.department ? (
            <span
              className="rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em]"
              style={{
                backgroundColor: `${deptColor}15`,
                color: deptColor,
              }}
            >
              {agent.department.replace("_", " ")}
            </span>
          ) : null}
          <span className="text-[10px] text-[color:var(--muted)]">
            {formatMessageTime(message.createdAt)}
          </span>

          {/* Priority badge */}
          {message.priority !== "normal" ? (
            <span
              className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em]"
              style={{
                backgroundColor: priorityConfig[message.priority].bg,
                color: priorityConfig[message.priority].color,
              }}
            >
              {message.priority === "urgent" ? (
                <WarningCircle size={10} weight="fill" />
              ) : null}
              {priorityConfig[message.priority].label}
            </span>
          ) : null}

          {/* Read indicator */}
          {isUnread ? (
            <Circle
              size={8}
              weight="fill"
              className="shrink-0"
              style={{ color: TERRACOTTA }}
            />
          ) : (
            <CheckCircle
              size={10}
              weight="fill"
              className="shrink-0 text-[color:var(--muted)] opacity-0 group-hover:opacity-60"
            />
          )}
        </div>

        {message.subject ? (
          <div className="mt-0.5 text-[13px] font-medium text-[color:var(--text)]">
            {message.subject}
          </div>
        ) : null}

        <div className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--muted-strong)]">
          {message.body}
        </div>

        {/* Attachments */}
        {message.attachmentsJson && message.attachmentsJson !== "[]" ? (
          <AttachmentList json={message.attachmentsJson} />
        ) : null}

        {/* Thread / Reply */}
        <div className="mt-2 flex items-center gap-3">
          {replyCount > 0 && !isThread ? (
            <button
              type="button"
              onClick={onReply}
              className="flex items-center gap-1.5 text-[11px] font-medium transition hover:opacity-80"
              style={{ color: TERRACOTTA }}
            >
              <ChatCircle size={12} />
              {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onReply}
            className="flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[10px] font-medium text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)] group-hover:opacity-100"
          >
            <ArrowBendUpLeft size={10} />
            Reply
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function TaskCommentBubble({
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
      className="group relative flex gap-3 rounded-[10px] border-l-[3px] bg-[color:var(--panel)] px-4 py-3"
      style={{ borderLeftColor: isBoard ? TERRACOTTA : deptColor }}
    >
      <AgentAvatar agent={agent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold" style={{ color: isBoard ? TERRACOTTA : deptColor }}>
            {comment.authorName}
          </span>
          {agent?.title ? <span className="text-[10px] text-[color:var(--muted)]">{agent.title}</span> : null}
          <span className="text-[10px] text-[color:var(--muted)]">{formatMessageTime(comment.createdAt)}</span>
        </div>
        <div className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--muted-strong)]">
          {comment.body}
        </div>
      </div>
    </motion.div>
  )
}

function TaskDiscussionComposer({
  companyId,
  taskId,
  onSent,
}: {
  companyId: string
  taskId: string
  onSent: () => void
}) {
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const handleSend = useCallback(async () => {
    if (!body.trim()) return
    setSending(true)
    setSendError(null)
    try {
      unwrap(await window.agentCompany.addComment({
        companyId,
        taskId,
        authorName: "Board",
        body: body.trim(),
      }))
      setBody("")
      onSent()
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to send task discussion reply.")
    } finally {
      setSending(false)
    }
  }, [body, companyId, taskId, onSent])

  return (
    <div className="border-t border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
      {sendError ? <div className="mb-3"><InlineNotice message={sendError} /></div> : null}
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Reply in task discussion..."
          rows={2}
          className="min-h-[40px] min-w-0 flex-1 resize-none rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-3 py-2 text-[12px] text-[color:var(--text)] placeholder:text-[color:var(--muted)] focus:border-transparent focus:outline-none focus:ring-2"
          style={{ focusRingColor: TERRACOTTA } as React.CSSProperties}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!body.trim() || sending}
          className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[8px] text-white transition hover:brightness-90 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none"
          style={{ backgroundColor: TERRACOTTA }}
          aria-label="Send task comment"
        >
          {sending ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
              <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <PaperPlaneTilt size={18} weight="fill" />
          )}
        </button>
      </div>
    </div>
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
          className="inline-flex items-center gap-1 rounded-[5px] bg-[color:var(--panel-soft)] px-2 py-1 text-[10px] font-medium text-[color:var(--muted-strong)]"
        >
          <At size={10} className="text-[color:var(--muted)]" />
          {item.title || `${item.type}:${item.id.slice(0, 8)}`}
        </span>
      ))}
    </div>
  )
}

interface MessageComposerProps {
  agents: AgentRecord[]
  companyId: string
  /** Pre-fill channel context */
  channel: MessageChannel
  channelTargetId: string | null
  /** Participant IDs for a direct channel */
  directParticipantIds?: string[]
  /** Pre-fill as a reply to a message */
  replyTo: AgentMessageRecord | null
  onSent: () => void
  onCancelReply: () => void
}

function MessageComposer({
  agents,
  companyId,
  channel,
  channelTargetId,
  directParticipantIds = [],
  replyTo,
  onSent,
  onCancelReply,
}: MessageComposerProps) {
  const [fromAgentId, setFromAgentId] = useState(agents[0]?.id ?? "")
  const [body, setBody] = useState("")
  const [subject, setSubject] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (replyTo) {
      textareaRef.current?.focus()
    }
  }, [replyTo])

  useEffect(() => {
    if (agents.length === 0) {
      if (fromAgentId) setFromAgentId("")
      return
    }
    if (!agents.some((agent) => agent.id === fromAgentId)) {
      setFromAgentId(agents[0]?.id ?? "")
    }
  }, [agents, fromAgentId])

  const directRecipientId = useMemo(() => {
    if (channel !== "direct") return null
    if (replyTo?.fromAgentId) return replyTo.fromAgentId
    if (directParticipantIds.length === 0) return null
    if (directParticipantIds.length === 1) return directParticipantIds[0] ?? null
    if (fromAgentId && directParticipantIds.includes(fromAgentId)) {
      return directParticipantIds.find((agentId) => agentId !== fromAgentId) ?? null
    }
    return directParticipantIds[0] ?? null
  }, [channel, replyTo, directParticipantIds, fromAgentId])

  const handleSend = useCallback(async () => {
    if (!body.trim() || !fromAgentId) return
    if (channel === "direct" && !directRecipientId) return
    if (!agents.some((agent) => agent.id === fromAgentId)) {
      setSendError("Select a valid sender from the current company before sending.")
      return
    }
    setSending(true)
    setSendError(null)
    try {
      unwrap(await window.agentCompany.sendAgentMessage({
        companyId,
        fromAgentId,
        toAgentId: channel === "direct" ? directRecipientId : null,
        channel,
        channelTargetId,
        subject: subject.trim() || (replyTo ? `Re: ${replyTo.subject}` : ""),
        body: body.trim(),
        priority: "normal",
        parentMessageId: replyTo?.id ?? null,
        attachmentsJson: "[]",
      }))
      setBody("")
      setSubject("")
      onSent()
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to send message.")
    } finally {
      setSending(false)
    }
  }, [agents, body, channel, channelTargetId, companyId, directRecipientId, fromAgentId, onSent, replyTo, subject])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend],
  )

  const fromAgent = agents.find((a) => a.id === fromAgentId)

  return (
    <div className="border-t border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
      {sendError ? <div className="mb-3"><InlineNotice message={sendError} /></div> : null}
      {channel === "direct" && !directRecipientId ? (
        <div className="mb-2">
          <InlineNotice message="Select a direct conversation partner before sending a DM." />
        </div>
      ) : null}
      <AnimatePresence>
        {replyTo ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 flex items-center gap-2 overflow-hidden rounded-[6px] bg-[color:var(--panel-soft)] px-3 py-2"
          >
            <ArrowBendUpLeft size={12} style={{ color: TERRACOTTA }} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[color:var(--muted-strong)]">
              Replying to <span className="font-semibold">{agents.find((a) => a.id === replyTo.fromAgentId)?.name ?? "agent"}</span>
              {replyTo.subject ? `: ${replyTo.subject}` : ""}
            </span>
            <button
              type="button"
              onClick={onCancelReply}
              className="shrink-0 rounded-[4px] p-0.5 text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
            >
              <X size={12} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="mb-2 flex items-center gap-2">
        <AgentAvatar agent={fromAgent} size="sm" />
        <select
          value={fromAgentId}
          onChange={(e) => setFromAgentId(e.target.value)}
          className="min-w-0 rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel)] px-2 py-1 text-[11px] font-medium text-[color:var(--text)]"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.role})
            </option>
          ))}
        </select>
        {!replyTo ? (
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (optional)"
            className="min-w-0 flex-1 rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel)] px-2.5 py-1 text-[11px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
          />
        ) : null}
      </div>

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={2}
          className="min-h-[40px] min-w-0 flex-1 resize-none rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-3 py-2 text-[12px] text-[color:var(--text)] placeholder:text-[color:var(--muted)] focus:border-transparent focus:outline-none focus:ring-2"
          style={{ focusRingColor: TERRACOTTA } as React.CSSProperties}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!body.trim() || !fromAgentId || sending || (channel === "direct" && !directRecipientId)}
          className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[8px] text-white transition hover:brightness-90 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none"
          style={{ backgroundColor: TERRACOTTA }}
          aria-label="Send message"
        >
          {sending ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
              <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <PaperPlaneTilt size={18} weight="fill" />
          )}
        </button>
      </div>
      <div className="mt-1 text-[9px] text-[color:var(--muted)]">
        Press {navigator.platform.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to send
      </div>
    </div>
  )
}

interface ComposeModalProps {
  open: boolean
  onClose: () => void
  agents: AgentRecord[]
  projects?: ProjectRecord[]
  companyId: string
  onSent: () => void
}

function ComposeModal({ open, onClose, agents, projects, companyId, onSent }: ComposeModalProps) {
  const t = useT()
  const [fromAgentId, setFromAgentId] = useState(agents[0]?.id ?? "")
  const [toAgentId, setToAgentId] = useState("")
  const [channel, setChannel] = useState<MessageChannel>("company")
  const [channelTargetId, setChannelTargetId] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [priority, setPriority] = useState<MessagePriority>("normal")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const departmentOptions = useMemo(() => {
    const depts = new Set<string>()
    for (const a of agents) {
      if (a.department) depts.add(a.department)
    }
    return Array.from(depts).sort()
  }, [agents])

  useEffect(() => {
    if (channel !== "direct") {
      setToAgentId("")
    }
    if (channel !== "department" && channel !== "project") {
      setChannelTargetId("")
    }
  }, [channel])

  useEffect(() => {
    if (agents.length === 0) {
      if (fromAgentId) setFromAgentId("")
      return
    }
    if (!agents.some((agent) => agent.id === fromAgentId)) {
      setFromAgentId(agents[0]?.id ?? "")
    }
  }, [agents, fromAgentId])

  const handleSend = useCallback(async () => {
    const requiresTarget = channel === "department" || channel === "project"
    if (
      !body.trim()
      || !fromAgentId
      || !subject.trim()
      || (channel === "direct" && !toAgentId)
      || (requiresTarget && !channelTargetId)
    ) return
    if (!agents.some((agent) => agent.id === fromAgentId)) {
      setSendError("Select a valid sender from the current company before sending.")
      return
    }
    setSending(true)
    setSendError(null)
    try {
      unwrap(await window.agentCompany.sendAgentMessage({
        companyId,
        fromAgentId,
        toAgentId: channel === "direct" && toAgentId ? toAgentId : null,
        channel,
        channelTargetId: channel === "department" || channel === "project" ? channelTargetId || null : null,
        subject: subject.trim(),
        body: body.trim(),
        priority,
        parentMessageId: null,
        attachmentsJson: "[]",
      }))
      setSubject("")
      setBody("")
      setPriority("normal")
      onSent()
      onClose()
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to send message.")
    } finally {
      setSending(false)
    }
  }, [agents, body, channel, channelTargetId, companyId, fromAgentId, onClose, onSent, priority, subject, toAgentId])

  return (
    <Modal open={open} title={t("comm.composeMessage")} onClose={onClose} width="560px">
      <div className="space-y-4">
        {sendError ? <InlineNotice message={sendError} /> : null}
        <Select
          label={t("comm.fromAgent")}
          value={fromAgentId}
          onChange={setFromAgentId}
          options={agents.map((a) => ({
            value: a.id,
            label: `${a.name} (${a.role})`,
          }))}
        />

        <Select
          label={t("comm.channel")}
          value={channel}
          onChange={(v) => setChannel(v as MessageChannel)}
          options={[
            { value: "company", label: t("comm.companyBroadcast") },
            { value: "department", label: t("comm.departmentChannel") },
            { value: "project", label: t("comm.projectChannel") },
            { value: "incident", label: t("comm.incidentChannel") },
            { value: "direct", label: t("comm.directMessage") },
          ]}
        />

        {channel === "direct" ? (
          <Select
            label="To Agent"
            value={toAgentId}
            onChange={setToAgentId}
            options={[
              { value: "", label: "Select a recipient..." },
              ...agents
                .filter((a) => a.id !== fromAgentId)
                .map((a) => ({
                  value: a.id,
                  label: `${a.name} (${a.role})`,
                })),
            ]}
          />
        ) : channel === "department" ? (
          <Select
            label="Department"
            value={channelTargetId}
            onChange={setChannelTargetId}
            options={[
              { value: "", label: "Select department..." },
              ...departmentOptions.map((d) => ({
                value: d,
                label: d.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              })),
            ]}
          />
        ) : channel === "project" ? (
          <Select
            label="Project"
            value={channelTargetId}
            onChange={setChannelTargetId}
            options={[
              { value: "", label: "Select project..." },
              ...(projects ?? []).map((p) => ({
                value: p.id,
                label: p.name,
              })),
            ]}
          />
        ) : null}

        <Input
          label={t("comm.subject")}
          value={subject}
          onChange={setSubject}
          placeholder={t("comm.messageSubject")}
        />

        <TextArea
          label={t("comm.message")}
          value={body}
          onChange={setBody}
          placeholder={t("comm.writeMessage")}
          rows={5}
        />

        <Select
          label="Priority"
          value={priority}
          onChange={(v) => setPriority(v as MessagePriority)}
          options={[
            { value: "low", label: "Low" },
            { value: "normal", label: "Normal" },
            { value: "urgent", label: "Urgent" },
          ]}
        />

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-4 py-2 text-[12px] font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={
              !body.trim()
              || !subject.trim()
              || !fromAgentId
              || (channel === "direct" && !toAgentId)
              || ((channel === "department" || channel === "project") && !channelTargetId)
              || sending
            }
            className="inline-flex items-center gap-2 rounded-[8px] px-4 py-2 text-[12px] font-semibold text-white transition hover:brightness-90 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none"
            style={{ backgroundColor: TERRACOTTA }}
          >
            {sending ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <PaperPlaneTilt size={14} weight="fill" />
            )}
            {t("comm.sendMessage")}
          </button>
        </div>
      </div>
    </Modal>
  )
}

interface FilterState {
  search: string
  channelType: MessageChannel | "all"
  priority: MessagePriority | "all"
  unreadOnly: boolean
}

function FilterBar({
  filters,
  onChangeFilters,
}: {
  filters: FilterState
  onChangeFilters: (next: FilterState) => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlass
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--muted)]"
          />
          <input
            type="text"
            value={filters.search}
            onChange={(e) =>
              onChangeFilters({ ...filters, search: e.target.value })
            }
            placeholder={t("comm.searchMessages")}
            className="w-full rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel)] py-1.5 pl-8 pr-3 text-[11px] text-[color:var(--text)] placeholder:text-[color:var(--muted)] focus:outline-none focus:ring-1"
            style={{ focusRingColor: TERRACOTTA } as React.CSSProperties}
          />
        </div>

        {/* Filter toggle */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1.5 text-[10px] font-medium transition ${
            expanded || filters.channelType !== "all" || filters.priority !== "all" || filters.unreadOnly
              ? "border-transparent text-white"
              : "border-[color:var(--line)] text-[color:var(--muted-strong)] hover:border-[color:var(--line-strong)]"
          }`}
          style={
            expanded || filters.channelType !== "all" || filters.priority !== "all" || filters.unreadOnly
              ? { backgroundColor: TERRACOTTA }
              : undefined
          }
        >
          <Funnel size={12} />
          {t("comm.filters")}
        </button>
      </div>

      {/* Expanded filter bar */}
      <AnimatePresence>
        {expanded ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap items-center gap-2 overflow-hidden"
          >
            <select
              value={filters.channelType}
              onChange={(e) =>
                onChangeFilters({
                  ...filters,
                  channelType: e.target.value as MessageChannel | "all",
                })
              }
              className="rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel)] px-2 py-1 text-[10px] font-medium text-[color:var(--text)]"
            >
              <option value="all">{t("comm.allChannels")}</option>
              <option value="direct">{t("comm.direct")}</option>
              <option value="department">{t("comm.department")}</option>
              <option value="company">{t("comm.company")}</option>
              <option value="project">{t("nav.projects")}</option>
              <option value="incident">{t("comm.incident")}</option>
            </select>

            <select
              value={filters.priority}
              onChange={(e) =>
                onChangeFilters({
                  ...filters,
                  priority: e.target.value as MessagePriority | "all",
                })
              }
              className="rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel)] px-2 py-1 text-[10px] font-medium text-[color:var(--text)]"
            >
              <option value="all">{t("comm.allPriorities")}</option>
              <option value="urgent">{t("comm.urgent")}</option>
              <option value="normal">{t("comm.normal")}</option>
              <option value="low">{t("comm.low")}</option>
            </select>

            <button
              type="button"
              onClick={() =>
                onChangeFilters({ ...filters, unreadOnly: !filters.unreadOnly })
              }
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
                filters.unreadOnly
                  ? "text-white"
                  : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)]"
              }`}
              style={filters.unreadOnly ? { backgroundColor: TERRACOTTA } : undefined}
            >
              {t("comm.unreadOnly")}
            </button>

            {(filters.channelType !== "all" || filters.priority !== "all" || filters.unreadOnly) ? (
              <button
                type="button"
                onClick={() =>
                  onChangeFilters({
                    search: filters.search,
                    channelType: "all",
                    priority: "all",
                    unreadOnly: false,
                  })
                }
                className="text-[10px] font-medium text-[color:var(--muted)] underline transition hover:text-[color:var(--text)]"
              >
                {t("comm.clearFilters")}
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

interface CommunicationHubProps {
  messages: AgentMessageRecord[]
  comments: CommentRecord[]
  tasks: TaskRecord[]
  agents: AgentRecord[]
  projects?: ProjectRecord[]
  companyId: string
  selectedEntityId?: string | null
  onEntityConsumed?: () => void
  onNavigateToTask: (taskId: string) => void
  onRefresh: () => void
}

export function CommunicationHub({
  messages,
  comments,
  tasks,
  agents,
  projects,
  companyId,
  selectedEntityId,
  onEntityConsumed,
  onNavigateToTask,
  onRefresh,
}: CommunicationHubProps) {
  const t = useT()
  const [selectedChannelKey, setSelectedChannelKey] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showCompose, setShowCompose] = useState(false)
  const [replyTo, setReplyTo] = useState<AgentMessageRecord | null>(null)
  const [optimisticReadIds, setOptimisticReadIds] = useState<Set<string>>(new Set())
  const pendingReadIdsRef = useRef<Set<string>>(new Set())
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    channelType: "all",
    priority: "all",
    unreadOnly: false,
  })

  const messageEndRef = useRef<HTMLDivElement>(null)
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const effectiveMessages = useMemo(
    () =>
      messages.map((message) =>
        optimisticReadIds.has(message.id)
          ? { ...message, readAt: message.readAt ?? new Date().toISOString() }
          : message,
      ),
    [messages, optimisticReadIds],
  )

  useEffect(() => {
    setOptimisticReadIds((current) => {
      if (current.size === 0) return current
      const next = new Set(Array.from(current).filter((messageId) => effectiveMessages.some((message) => message.id === messageId)))
      return next.size === current.size ? current : next
    })
  }, [effectiveMessages])

  // Derive channels from messages
  const messageChannels = useMemo(() => deriveChannels(effectiveMessages, agents, projects), [effectiveMessages, agents, projects])
  const forcedTaskDiscussionId = useMemo(
    () => (selectedEntityId && tasks.some((task) => task.id === selectedEntityId) ? selectedEntityId : null),
    [selectedEntityId, tasks],
  )
  const taskDiscussionChannels = useMemo(
    () => deriveTaskDiscussionChannels(comments, tasks, forcedTaskDiscussionId),
    [comments, forcedTaskDiscussionId, tasks],
  )
  const channels = useMemo(() => [...messageChannels, ...taskDiscussionChannels], [messageChannels, taskDiscussionChannels])

  // Auto-select first valid channel
  useEffect(() => {
    if (channels.length === 0) {
      if (selectedChannelKey) {
        setSelectedChannelKey(null)
      }
      return
    }
    if (!selectedChannelKey || !channels.some((channel) => channel.key === selectedChannelKey)) {
      setSelectedChannelKey(channels[0].key)
    }
  }, [channels, selectedChannelKey])

  useEffect(() => {
    if (!selectedEntityId) return
    const matchingMessage = effectiveMessages.find((message) => message.id === selectedEntityId)
    if (matchingMessage) {
      const matchingChannel = messageChannels.find((channel) => getChannelMessages(effectiveMessages, channel).some((message) => message.id === selectedEntityId))
      if (matchingChannel) {
        setSelectedChannelKey(matchingChannel.key)
        onEntityConsumed?.()
      }
      return
    }
    const matchingComment = comments.find((comment) => comment.id === selectedEntityId)
    if (matchingComment) {
      setSelectedChannelKey(`task-${matchingComment.taskId}`)
      onEntityConsumed?.()
      return
    }
    const matchingTaskDiscussion = taskDiscussionChannels.find((discussion) => discussion.taskId === selectedEntityId)
    if (matchingTaskDiscussion) {
      setSelectedChannelKey(matchingTaskDiscussion.key)
      onEntityConsumed?.()
    }
  }, [selectedEntityId, effectiveMessages, comments, messageChannels, onEntityConsumed, taskDiscussionChannels])

  const activeChannel = useMemo(
    () => channels.find((c) => c.key === selectedChannelKey) ?? null,
    [channels, selectedChannelKey],
  )

  // Messages for the selected channel
  const channelMessages = useMemo(() => {
    if (!activeChannel || activeChannel.kind !== "message") return []
    return getChannelMessages(effectiveMessages, activeChannel).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
  }, [effectiveMessages, activeChannel])

  const taskDiscussionComments = useMemo(() => {
    if (!activeChannel || activeChannel.kind !== "task") return []
    return comments
      .filter((comment) => comment.taskId === activeChannel.taskId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [comments, activeChannel])

  const activeTask = useMemo(() => {
    if (!activeChannel || activeChannel.kind !== "task") return null
    return tasks.find((task) => task.id === activeChannel.taskId) ?? null
  }, [tasks, activeChannel])

  // Apply filters to visible messages
  const filteredMessages = useMemo(() => {
    let result = channelMessages

    if (filters.channelType !== "all") {
      result = result.filter((m) => m.channel === filters.channelType)
    }

    if (filters.search) {
      const q = filters.search.toLowerCase()
      result = result.filter(
        (m) =>
          m.subject.toLowerCase().includes(q) ||
          m.body.toLowerCase().includes(q) ||
          (agentMap.get(m.fromAgentId)?.name ?? "").toLowerCase().includes(q),
      )
    }

    if (filters.priority !== "all") {
      result = result.filter((m) => m.priority === filters.priority)
    }

    if (filters.unreadOnly) {
      result = result.filter((m) => !m.readAt)
    }

    return result
  }, [channelMessages, filters, agentMap])

  useEffect(() => {
    if (!activeChannel || activeChannel.kind !== "message") return
    const unreadMessageIds = filteredMessages
      .filter((message) => !message.readAt && !pendingReadIdsRef.current.has(message.id))
      .map((message) => message.id)
    if (unreadMessageIds.length === 0) return

    let cancelled = false
    void (async () => {
      for (const messageId of unreadMessageIds) {
        pendingReadIdsRef.current.add(messageId)
      }
      setOptimisticReadIds((current) => {
        const next = new Set(current)
        for (const messageId of unreadMessageIds) {
          next.add(messageId)
        }
        return next
      })

      const results = await Promise.all(
        unreadMessageIds.map(async (messageId) => {
          try {
            unwrap(await window.agentCompany.markMessageRead({ messageId, companyId }))
            return { messageId, ok: true as const }
          } catch {
            return { messageId, ok: false as const }
          }
        }),
      )

      const failedIds = results.filter((result) => !result.ok).map((result) => result.messageId)
      for (const messageId of unreadMessageIds) {
        pendingReadIdsRef.current.delete(messageId)
      }

      if (!cancelled && failedIds.length > 0) {
        setOptimisticReadIds((current) => {
          const next = new Set(current)
          for (const messageId of failedIds) {
            next.delete(messageId)
          }
          return next
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeChannel, companyId, filteredMessages])

  // Build thread structure: top-level messages + their replies
  const threadedMessages = useMemo(() => {
    const topLevel = filteredMessages.filter((m) => !m.parentMessageId)
    const replyMap = new Map<string, AgentMessageRecord[]>()
    for (const m of filteredMessages) {
      if (m.parentMessageId) {
        const existing = replyMap.get(m.parentMessageId) ?? []
        existing.push(m)
        replyMap.set(m.parentMessageId, existing)
      }
    }
    return { topLevel, replyMap }
  }, [filteredMessages])

  // Unread counts per channel
  const unreadByChannel = useMemo(() => {
    const counts = new Map<string, { unread: number; hasUrgent: boolean }>()
    for (const ch of channels) {
      if (ch.kind !== "message") {
        counts.set(ch.key, { unread: 0, hasUrgent: false })
        continue
      }
      const visibleMessages = getChannelMessages(effectiveMessages, ch)
      const unread = visibleMessages.filter((m) => !m.readAt).length
      const hasUrgent = visibleMessages.some((m) => !m.readAt && m.priority === "urgent")
      counts.set(ch.key, { unread, hasUrgent })
    }
    return counts
  }, [channels, effectiveMessages])

  const totalUnread = useMemo(() => {
    return effectiveMessages.filter((m) => !m.readAt).length
  }, [effectiveMessages])

  // Scroll to bottom when channel changes or new messages arrive
  const messageCount = useMemo(() => effectiveMessages.length, [effectiveMessages])
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "auto" })
  }, [selectedChannelKey, messageCount])

  // Group channels by type for sidebar sections
  const channelGroups = useMemo(() => {
    const groups: Array<{ type: MessageChannel; label: string; items: ChannelDescriptor[] }> = []
    const typeOrder: MessageChannel[] = ["company", "department", "project", "incident", "direct"]
    for (const type of typeOrder) {
      const items = channels.filter((c): c is ChannelDescriptor => c.kind === "message" && c.channel === type)
      if (items.length > 0) {
        groups.push({
          type,
          label: channelConfig[type].label,
          items,
        })
      }
    }
    return groups
  }, [channels])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: TERRACOTTA_SOFT }}
          >
            <ChatCircle size={20} weight="fill" style={{ color: TERRACOTTA }} />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[color:var(--text)]">
              {t("comm.communicationHub")}
            </h2>
            <p className="text-[12px] text-[color:var(--muted)]">
              {messages.length} message{messages.length !== 1 ? "s" : ""}
              {totalUnread > 0 ? (
                <span style={{ color: TERRACOTTA }}> ({totalUnread} unread)</span>
              ) : null}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCompose(true)}
          className="inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-[11px] font-semibold text-white transition hover:brightness-90"
          style={{ backgroundColor: TERRACOTTA }}
        >
          <Plus size={13} weight="bold" />
          {t("comm.newMessage")}
        </button>
      </div>

      {/* Main layout: sidebar + messages */}
      <div
        className="flex overflow-hidden rounded-[12px] border border-[color:var(--line)]"
        style={{ height: "calc(100vh - 220px)", minHeight: "480px" }}
      >
        <AnimatePresence initial={false}>
          {showSidebar ? (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex h-full shrink-0 flex-col overflow-hidden border-r border-[color:var(--line)] bg-[color:var(--panel)]"
              style={{ width: 260 }}
            >
              {/* Sidebar header */}
              <div className="flex items-center justify-between border-b border-[color:var(--line)] px-4 py-3">
                <span className="text-[13px] font-semibold text-[color:var(--text)]">
                  {t("comm.channels")}
                </span>
                <button
                  type="button"
                  onClick={() => setShowSidebar(false)}
                  className="rounded-[4px] p-1 text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                  aria-label="Hide sidebar"
                >
                  <CaretDown size={12} className="-rotate-90" />
                </button>
              </div>

              {/* Channel list */}
              <div className="flex-1 overflow-y-auto px-2 py-2">
                {channelGroups.map((group) => (
                  <div key={group.type} className="mb-3">
                    <div className="mb-1 px-2 text-[9px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted)]">
                      {group.label}
                    </div>
                    {group.items.map((ch) => {
                      const stats = unreadByChannel.get(ch.key)
                      return (
                        <ChannelItem
                          key={ch.key}
                          descriptor={ch}
                          active={selectedChannelKey === ch.key}
                          unreadCount={stats?.unread ?? 0}
                          hasUrgent={stats?.hasUrgent ?? false}
                          agents={agents}
                          onClick={() => {
                            setSelectedChannelKey(ch.key)
                          }}
                        />
                      )
                    })}
                  </div>
                ))}

                {taskDiscussionChannels.length > 0 ? (
                  <div className="mb-3">
                    <div className="mb-1 px-2 text-[9px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted)]">
                      {t("comm.taskDiscussions")}
                    </div>
                    {taskDiscussionChannels.map((discussion) => (
                      <button
                        key={discussion.key}
                        type="button"
                        onClick={() => setSelectedChannelKey(discussion.key)}
                        className={`group flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left transition duration-150 ${
                          selectedChannelKey === discussion.key ? "bg-[color:var(--panel-soft)]" : "hover:bg-[color:var(--panel-soft)]/50"
                        }`}
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]" style={{ backgroundColor: `${TERRACOTTA}18` }}>
                          <Hash size={14} weight={selectedChannelKey === discussion.key ? "fill" : "regular"} style={{ color: TERRACOTTA }} />
                        </div>
                        <span className={`min-w-0 flex-1 truncate text-[12px] ${selectedChannelKey === discussion.key ? "font-semibold text-[color:var(--text)]" : "font-medium text-[color:var(--muted-strong)]"}`}>
                          {discussion.label}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {channels.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[11px] text-[color:var(--muted)]">
                    {t("comm.noActiveDepartments")}
                  </div>
                ) : null}
              </div>

              {/* Sidebar stats */}
              <div className="border-t border-[color:var(--line)] px-4 py-2">
                <div className="flex items-center justify-between text-[10px] text-[color:var(--muted)]">
                  <span>{channels.length} channels</span>
                  <span>{agents.length} agents</span>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col bg-[color:var(--bg)]">
          {/* Channel header */}
          <div className="flex items-center gap-3 border-b border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-2.5">
            {!showSidebar ? (
              <button
                type="button"
                onClick={() => setShowSidebar(true)}
                className="rounded-[4px] p-1 text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                aria-label="Show sidebar"
              >
                <CaretDown size={12} className="rotate-90" />
              </button>
            ) : null}

            {activeChannel ? (
              <>
                {activeChannel.kind === "message" ? (() => {
                  const Icon = channelConfig[activeChannel.channel].icon
                  return (
                    <Icon
                      size={16}
                      weight="fill"
                      style={{
                        color: channelConfig[activeChannel.channel].color,
                      }}
                    />
                  )
                })() : (
                  <Hash size={16} weight="fill" style={{ color: TERRACOTTA }} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-[color:var(--text)]">
                    {activeChannel.label}
                  </div>
                  <div className="text-[10px] text-[color:var(--muted)]">
                    {activeChannel.kind === "message"
                      ? `${channelMessages.length} message${channelMessages.length !== 1 ? "s" : ""}${(() => {
                        const stats = unreadByChannel.get(activeChannel.key)
                        return stats?.unread ? ` (${stats.unread} unread)` : ""
                      })()}`
                      : `${taskDiscussionComments.length} comment${taskDiscussionComments.length !== 1 ? "s" : ""}${activeTask ? ` · ${activeTask.status.replaceAll("_", " ")}` : ""}`}
                  </div>
                </div>
                {activeChannel.kind === "task" && activeTask ? (
                  <button
                    type="button"
                    onClick={() => onNavigateToTask(activeTask.id)}
                    className="rounded-[6px] border border-[color:var(--line)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--muted-strong)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
                  >
                    Open task
                  </button>
                ) : null}
              </>
            ) : (
              <span className="text-[13px] text-[color:var(--muted)]">
                {t("comm.selectChannel")}
              </span>
            )}

            {/* Filter bar inline */}
            <div className="ml-auto w-[320px]">
              <FilterBar filters={filters} onChangeFilters={setFilters} />
            </div>
          </div>

          {/* Message thread area */}
          <div className="flex-1 overflow-y-auto px-2 py-3">
            {!activeChannel ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <ChatCircle
                  size={40}
                  className="mb-3 text-[color:var(--muted)]"
                />
                <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">
                  {t("comm.selectChannelView")}
                </div>
                <div className="mt-1 text-[12px] text-[color:var(--muted)]">
                  {t("comm.monitorComms")}
                </div>
              </div>
            ) : activeChannel.kind === "task" ? (
              taskDiscussionComments.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <Tray size={36} className="mb-3 text-[color:var(--muted)]" />
                  <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">
                    {t("comm.noDiscussionYet")}
                  </div>
                  <div className="mt-1 text-[12px] text-[color:var(--muted)]">
                    {t("comm.commentsAppearHere")}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {taskDiscussionComments.map((comment) => (
                    <TaskCommentBubble
                      key={comment.id}
                      comment={comment}
                      agent={comment.authorAgentId ? (agentMap.get(comment.authorAgentId) ?? undefined) : undefined}
                    />
                  ))}
                  <div ref={messageEndRef} />
                </div>
              )
            ) : filteredMessages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Tray size={36} className="mb-3 text-[color:var(--muted)]" />
                <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">
                  {filters.search || filters.unreadOnly || filters.priority !== "all"
                    ? t("comm.noMatchFilters")
                    : t("comm.noMessagesChannel")}
                </div>
                <div className="mt-1 text-[12px] text-[color:var(--muted)]">
                  {filters.search || filters.unreadOnly || filters.priority !== "all"
                    ? t("comm.adjustFilters")
                    : t("comm.messagesAppear")}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {threadedMessages.topLevel.map((msg) => {
                  const replies = threadedMessages.replyMap.get(msg.id) ?? []
                  return (
                    <div key={msg.id}>
                      <MessageBubble
                        message={msg}
                        agent={agentMap.get(msg.fromAgentId)}
                        isThread={false}
                        replyCount={replies.length}
                        onReply={() => setReplyTo(msg)}
                      />
                      {/* Thread replies */}
                      {replies.length > 0 ? (
                        <div className="space-y-0.5">
                          {replies.map((reply) => (
                            <MessageBubble
                              key={reply.id}
                              message={reply}
                              agent={agentMap.get(reply.fromAgentId)}
                              isThread={true}
                              replyCount={0}
                              onReply={() => setReplyTo(reply)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                <div ref={messageEndRef} />
              </div>
            )}
          </div>

          {activeChannel ? (
            activeChannel.kind === "message" ? (
              <MessageComposer
                agents={agents}
                companyId={companyId}
                channel={activeChannel.channel}
                channelTargetId={activeChannel.channel === "direct" ? null : activeChannel.targetId}
                directParticipantIds={activeChannel.channel === "direct" ? activeChannel.participantIds : []}
                replyTo={replyTo}
                onSent={() => {
                  setReplyTo(null)
                  onRefresh()
                }}
                onCancelReply={() => setReplyTo(null)}
              />
            ) : (
              <TaskDiscussionComposer
                companyId={companyId}
                taskId={activeChannel.taskId}
                onSent={onRefresh}
              />
            )
          ) : (
            <div className="border-t border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-2.5">
              <div className="flex items-center gap-2 text-[11px] text-[color:var(--muted)]">
                <ChatCircle size={14} />
                <span>{t("comm.selectChannelSend")}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <ComposeModal
        open={showCompose}
        onClose={() => setShowCompose(false)}
        agents={agents}
        projects={projects}
        companyId={companyId}
        onSent={onRefresh}
      />
    </div>
  )
}
