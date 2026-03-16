import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ChatCircle,
  EnvelopeSimple,
  At,
  Hash,
  UserCircle,
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
  Robot,
  Tray,
} from "@phosphor-icons/react"
import type {
  AgentMessageRecord,
  AgentRecord,
  DepartmentId,
  MessageChannel,
  MessagePriority,
} from "@shared/types"
import { ActionButton, Modal, Select, Input, TextArea } from "./ui"

/* ------------------------------------------------------------------ */
/*  Constants & Config                                                  */
/* ------------------------------------------------------------------ */

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

const departmentColors: Record<string, string> = {
  executive: "#8b5cf6",
  engineering: "#3b82f6",
  product: "#f59e0b",
  marketing: "#ec4899",
  sales: "#10b981",
  hr: "#6366f1",
  finance: "#14b8a6",
  legal: "#a78bfa",
  operations: "#f97316",
  customer_support: "#06b6d4",
  research: "#8b5cf6",
  design: "#f43f5e",
}

function getDepartmentColor(department: DepartmentId | null | undefined): string {
  if (!department) return "var(--muted)"
  return departmentColors[department] ?? "var(--muted)"
}

function getAgentInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.max(0, now - then)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatMessageTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()

  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()

  if (isYesterday) {
    return `Yesterday ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  }

  return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

/* ------------------------------------------------------------------ */
/*  Channel Derivation                                                  */
/* ------------------------------------------------------------------ */

interface ChannelDescriptor {
  key: string
  channel: MessageChannel
  label: string
  targetId: string | null
  /** Agent ID for DM channels */
  agentId: string | null
}

function deriveChannels(
  messages: AgentMessageRecord[],
  agents: AgentRecord[],
): ChannelDescriptor[] {
  const channelMap = new Map<string, ChannelDescriptor>()
  const agentMap = new Map(agents.map((a) => [a.id, a]))

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
        } else {
          const ids = [msg.fromAgentId, otherId].sort()
          key = `direct-${ids.join("-")}`
          const other = agentMap.get(otherId)
          label = other ? other.name : "Unknown Agent"
          agentId = otherId
        }
        break
      }
      case "department": {
        const dept = msg.channelTargetId ?? "general"
        key = `department-${dept}`
        label = `#${dept.replace("_", "-")}`
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
        label = `#project-${projId.slice(0, 8)}`
        break
      }
      case "incident": {
        const incId = msg.channelTargetId ?? "general"
        key = `incident-${incId}`
        label = `#incident-${incId.slice(0, 8)}`
        break
      }
    }

    if (!channelMap.has(key)) {
      channelMap.set(key, {
        key,
        channel: msg.channel,
        label,
        targetId: msg.channelTargetId,
        agentId,
      })
    }
  }

  // Ensure at least one company-wide channel exists
  if (!channelMap.has("company-all")) {
    channelMap.set("company-all", {
      key: "company-all",
      channel: "company",
      label: "#company-wide",
      targetId: null,
      agentId: null,
    })
  }

  const order: MessageChannel[] = ["company", "department", "project", "incident", "direct"]
  return Array.from(channelMap.values()).sort((a, b) => {
    const ai = order.indexOf(a.channel)
    const bi = order.indexOf(b.channel)
    if (ai !== bi) return ai - bi
    return a.label.localeCompare(b.label)
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
      if (!channel.agentId) return false
      const ids = [msg.fromAgentId, msg.toAgentId ?? ""].sort()
      return channel.key === `direct-${ids.join("-")}`
    }
    return false
  })
}

/* ------------------------------------------------------------------ */
/*  Agent Avatar                                                        */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Channel Sidebar Item                                                */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Message Bubble                                                      */
/* ------------------------------------------------------------------ */

function MessageBubble({
  message,
  agent,
  isThread,
  replyCount,
  onReply,
  onMarkRead,
}: {
  message: AgentMessageRecord
  agent: AgentRecord | undefined
  isThread: boolean
  replyCount: number
  onReply: () => void
  onMarkRead: () => void
}) {
  const isUnread = !message.readAt
  const isUrgent = message.priority === "urgent"
  const deptColor = agent ? getDepartmentColor(agent.department) : "var(--muted)"

  useEffect(() => {
    if (isUnread) {
      const timer = setTimeout(onMarkRead, 1500)
      return () => clearTimeout(timer)
    }
  }, [isUnread, onMarkRead])

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`group relative flex gap-3 rounded-[10px] px-4 py-3 transition ${
        isThread ? "ml-11" : ""
      } ${
        isUnread
          ? "border-l-[3px] bg-[color:var(--panel)]"
          : "border-l-[3px] border-l-transparent hover:bg-[color:var(--panel-soft)]/40"
      } ${
        isUrgent
          ? "border-l-[color:var(--danger)]"
          : isUnread
            ? `border-l-[${TERRACOTTA}]`
            : ""
      }`}
      style={
        isUnread && !isUrgent
          ? { borderLeftColor: TERRACOTTA }
          : isUrgent
            ? { borderLeftColor: "var(--danger)" }
            : undefined
      }
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

        {/* Subject */}
        {message.subject ? (
          <div className="mt-0.5 text-[13px] font-medium text-[color:var(--text)]">
            {message.subject}
          </div>
        ) : null}

        {/* Body */}
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

/* ------------------------------------------------------------------ */
/*  Attachment List                                                     */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Message Composer                                                    */
/* ------------------------------------------------------------------ */

interface MessageComposerProps {
  agents: AgentRecord[]
  companyId: string
  /** Pre-fill channel context */
  channel: MessageChannel
  channelTargetId: string | null
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
  replyTo,
  onSent,
  onCancelReply,
}: MessageComposerProps) {
  const [fromAgentId, setFromAgentId] = useState(agents[0]?.id ?? "")
  const [body, setBody] = useState("")
  const [subject, setSubject] = useState("")
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (replyTo) {
      textareaRef.current?.focus()
    }
  }, [replyTo])

  const handleSend = useCallback(async () => {
    if (!body.trim() || !fromAgentId) return
    setSending(true)
    try {
      await window.agentCompany.sendAgentMessage({
        companyId,
        fromAgentId,
        toAgentId: replyTo ? replyTo.fromAgentId : null,
        channel,
        channelTargetId,
        subject: subject.trim() || (replyTo ? `Re: ${replyTo.subject}` : ""),
        body: body.trim(),
        priority: "normal",
        parentMessageId: replyTo?.id ?? null,
        attachmentsJson: "[]",
      })
      setBody("")
      setSubject("")
      onSent()
    } catch (err) {
      console.error("[MessageComposer] send failed:", err)
    } finally {
      setSending(false)
    }
  }, [body, fromAgentId, companyId, channel, channelTargetId, replyTo, subject, onSent])

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
      {/* Reply indicator */}
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

      {/* Sender selector row */}
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

      {/* Body input */}
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
          disabled={!body.trim() || !fromAgentId || sending}
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

/* ------------------------------------------------------------------ */
/*  Compose New Message Modal                                           */
/* ------------------------------------------------------------------ */

interface ComposeModalProps {
  open: boolean
  onClose: () => void
  agents: AgentRecord[]
  companyId: string
  onSent: () => void
}

function ComposeModal({ open, onClose, agents, companyId, onSent }: ComposeModalProps) {
  const [fromAgentId, setFromAgentId] = useState(agents[0]?.id ?? "")
  const [toAgentId, setToAgentId] = useState("")
  const [channel, setChannel] = useState<MessageChannel>("company")
  const [channelTargetId, setChannelTargetId] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [priority, setPriority] = useState<MessagePriority>("normal")
  const [sending, setSending] = useState(false)

  const departmentOptions = useMemo(() => {
    const depts = new Set<string>()
    for (const a of agents) {
      if (a.department) depts.add(a.department)
    }
    return Array.from(depts).sort()
  }, [agents])

  const handleSend = useCallback(async () => {
    if (!body.trim() || !fromAgentId || !subject.trim()) return
    setSending(true)
    try {
      await window.agentCompany.sendAgentMessage({
        companyId,
        fromAgentId,
        toAgentId: channel === "direct" && toAgentId ? toAgentId : null,
        channel,
        channelTargetId: channelTargetId || null,
        subject: subject.trim(),
        body: body.trim(),
        priority,
        parentMessageId: null,
        attachmentsJson: "[]",
      })
      // Reset form
      setSubject("")
      setBody("")
      setPriority("normal")
      onSent()
      onClose()
    } catch (err) {
      console.error("[ComposeModal] send failed:", err)
    } finally {
      setSending(false)
    }
  }, [body, fromAgentId, toAgentId, channel, channelTargetId, subject, priority, companyId, onSent, onClose])

  return (
    <Modal open={open} title="Compose Message" onClose={onClose} width="560px">
      <div className="space-y-4">
        {/* From */}
        <Select
          label="From Agent"
          value={fromAgentId}
          onChange={setFromAgentId}
          options={agents.map((a) => ({
            value: a.id,
            label: `${a.name} (${a.role})`,
          }))}
        />

        {/* Channel type */}
        <Select
          label="Channel"
          value={channel}
          onChange={(v) => setChannel(v as MessageChannel)}
          options={[
            { value: "company", label: "Company-wide broadcast" },
            { value: "department", label: "Department channel" },
            { value: "project", label: "Project channel" },
            { value: "incident", label: "Incident channel" },
            { value: "direct", label: "Direct message" },
          ]}
        />

        {/* Channel target */}
        {channel === "direct" ? (
          <Select
            label="To Agent"
            value={toAgentId}
            onChange={setToAgentId}
            options={[
              { value: "", label: "Broadcast to all" },
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
        ) : channel === "project" || channel === "incident" ? (
          <Input
            label={channel === "project" ? "Project ID" : "Incident ID"}
            value={channelTargetId}
            onChange={setChannelTargetId}
            placeholder={`Enter ${channel} identifier`}
          />
        ) : null}

        {/* Subject */}
        <Input
          label="Subject"
          value={subject}
          onChange={setSubject}
          placeholder="Message subject"
        />

        {/* Body */}
        <TextArea
          label="Message"
          value={body}
          onChange={setBody}
          placeholder="Write your message..."
          rows={5}
        />

        {/* Priority */}
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

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-4 py-2 text-[12px] font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!body.trim() || !subject.trim() || !fromAgentId || sending}
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
            Send Message
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/*  Search & Filter Bar                                                 */
/* ------------------------------------------------------------------ */

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
            placeholder="Search messages..."
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
          Filters
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
              <option value="all">All channels</option>
              <option value="direct">Direct</option>
              <option value="department">Department</option>
              <option value="company">Company</option>
              <option value="project">Project</option>
              <option value="incident">Incident</option>
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
              <option value="all">All priorities</option>
              <option value="urgent">Urgent</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
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
              Unread only
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
                Clear filters
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main: CommunicationHub                                              */
/* ------------------------------------------------------------------ */

interface CommunicationHubProps {
  messages: AgentMessageRecord[]
  agents: AgentRecord[]
  companyId: string
  onRefresh: () => void
}

export function CommunicationHub({
  messages,
  agents,
  companyId,
  onRefresh,
}: CommunicationHubProps) {
  const [selectedChannelKey, setSelectedChannelKey] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<AgentMessageRecord | null>(null)
  const [showCompose, setShowCompose] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    channelType: "all",
    priority: "all",
    unreadOnly: false,
  })

  const messageEndRef = useRef<HTMLDivElement>(null)
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  // Derive channels from messages
  const channels = useMemo(() => deriveChannels(messages, agents), [messages, agents])

  // Auto-select first channel
  useEffect(() => {
    if (!selectedChannelKey && channels.length > 0) {
      setSelectedChannelKey(channels[0].key)
    }
  }, [channels, selectedChannelKey])

  const activeChannel = useMemo(
    () => channels.find((c) => c.key === selectedChannelKey) ?? null,
    [channels, selectedChannelKey],
  )

  // Messages for the selected channel
  const channelMessages = useMemo(() => {
    if (!activeChannel) return []
    return getChannelMessages(messages, activeChannel).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
  }, [messages, activeChannel])

  // Apply filters to visible messages
  const filteredMessages = useMemo(() => {
    let result = channelMessages

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
      const msgs = getChannelMessages(messages, ch)
      const unread = msgs.filter((m) => !m.readAt).length
      const hasUrgent = msgs.some((m) => !m.readAt && m.priority === "urgent")
      counts.set(ch.key, { unread, hasUrgent })
    }
    return counts
  }, [channels, messages])

  const totalUnread = useMemo(() => {
    return messages.filter((m) => !m.readAt).length
  }, [messages])

  // Mark message read
  const handleMarkRead = useCallback(
    (messageId: string) => {
      void window.agentCompany.markMessageRead({ messageId, companyId })
    },
    [companyId],
  )

  // After sending, refresh and scroll
  const handleSent = useCallback(() => {
    onRefresh()
    setTimeout(() => {
      messageEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, 200)
  }, [onRefresh])

  // Scroll to bottom when channel changes
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "auto" })
  }, [selectedChannelKey])

  // Group channels by type for sidebar sections
  const channelGroups = useMemo(() => {
    const groups: Array<{ type: MessageChannel; label: string; items: ChannelDescriptor[] }> = []
    const typeOrder: MessageChannel[] = ["company", "department", "project", "incident", "direct"]
    for (const type of typeOrder) {
      const items = channels.filter((c) => c.channel === type)
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
              Communication Hub
            </h2>
            <p className="text-[12px] text-[color:var(--muted)]">
              {messages.length} message{messages.length !== 1 ? "s" : ""}
              {totalUnread > 0 ? (
                <span style={{ color: TERRACOTTA }}> ({totalUnread} unread)</span>
              ) : null}
            </p>
          </div>
        </div>
        <ActionButton
          label="Compose"
          onClick={() => setShowCompose(true)}
          icon={Plus}
          tone="accent"
        />
      </div>

      {/* Main layout: sidebar + messages */}
      <div
        className="flex overflow-hidden rounded-[12px] border border-[color:var(--line)]"
        style={{ height: "calc(100vh - 220px)", minHeight: "480px" }}
      >
        {/* ── Sidebar ────────────────────────────────────────── */}
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
                  Channels
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
                            setReplyTo(null)
                          }}
                        />
                      )
                    })}
                  </div>
                ))}

                {channels.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[11px] text-[color:var(--muted)]">
                    No channels yet. Send a message to create one.
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

        {/* ── Main content ─────────────────────────────────── */}
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
                {(() => {
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
                })()}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-[color:var(--text)]">
                    {activeChannel.label}
                  </div>
                  <div className="text-[10px] text-[color:var(--muted)]">
                    {channelMessages.length} message{channelMessages.length !== 1 ? "s" : ""}
                    {(() => {
                      const stats = unreadByChannel.get(activeChannel.key)
                      return stats?.unread
                        ? ` (${stats.unread} unread)`
                        : ""
                    })()}
                  </div>
                </div>
              </>
            ) : (
              <span className="text-[13px] text-[color:var(--muted)]">
                Select a channel
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
                  Select a channel to view messages
                </div>
                <div className="mt-1 text-[12px] text-[color:var(--muted)]">
                  Or compose a new message to get started
                </div>
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Tray size={36} className="mb-3 text-[color:var(--muted)]" />
                <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">
                  {filters.search || filters.unreadOnly || filters.priority !== "all"
                    ? "No messages match your filters"
                    : "No messages in this channel yet"}
                </div>
                <div className="mt-1 text-[12px] text-[color:var(--muted)]">
                  {filters.search || filters.unreadOnly || filters.priority !== "all"
                    ? "Try adjusting your search or filters"
                    : "Be the first to send a message"}
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
                        onMarkRead={() => handleMarkRead(msg.id)}
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
                              onMarkRead={() => handleMarkRead(reply.id)}
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

          {/* Composer */}
          {activeChannel ? (
            <MessageComposer
              agents={agents}
              companyId={companyId}
              channel={activeChannel.channel}
              channelTargetId={activeChannel.targetId}
              replyTo={replyTo}
              onSent={handleSent}
              onCancelReply={() => setReplyTo(null)}
            />
          ) : null}
        </div>
      </div>

      {/* Compose modal */}
      <ComposeModal
        open={showCompose}
        onClose={() => setShowCompose(false)}
        agents={agents}
        companyId={companyId}
        onSent={() => {
          onRefresh()
          setShowCompose(false)
        }}
      />
    </div>
  )
}
