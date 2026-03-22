import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence } from "framer-motion"
import { ChatCircle, Plus } from "@phosphor-icons/react"
import type { AgentMessageRecord, AgentRecord, CommentRecord, MessageChannel, ProjectRecord, TaskRecord } from "@shared/types"
import { useAppStore } from "../../state/store"
import { unwrap } from "../../lib/desktop"
import { useT } from "../../i18n"
import { ChannelSidebar, FilterBar, type FilterState } from "./ChannelSidebar"
import type { ChannelDescriptor, TaskDiscussionDescriptor, AnyChannel } from "./ChannelHeader"
import { ChannelHeader } from "./ChannelHeader"
import { MessageList } from "./MessageList"
import { MessageComposer, TaskDiscussionComposer, NoChannelComposer, ComposeModal } from "./MessageComposer"
import { deriveChannels, deriveTaskDiscussionChannels, getChannelMessages } from "./channel-utils"

const TERRACOTTA = "#d97745"
const TERRACOTTA_SOFT = "#d9774518"

interface CommunicationHubProps {
  messages: AgentMessageRecord[]; comments: CommentRecord[]; tasks: TaskRecord[]; agents: AgentRecord[]
  projects?: ProjectRecord[]; companyId: string; selectedEntityId?: string | null
  onEntityConsumed?: () => void; onNavigateToTask: (taskId: string) => void; onRefresh: () => void
}

export function CommunicationHub({ messages, comments, tasks, agents, projects, companyId, selectedEntityId, onEntityConsumed, onNavigateToTask, onRefresh }: CommunicationHubProps) {
  const t = useT()
  const [selectedChannelKey, setSelectedChannelKey] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showCompose, setShowCompose] = useState(false)
  const [replyTo, setReplyTo] = useState<AgentMessageRecord | null>(null)
  const [optimisticReadIds, setOptimisticReadIds] = useState<Set<string>>(new Set())
  const pendingReadIdsRef = useRef<Set<string>>(new Set())
  const [filters, setFilters] = useState<FilterState>({ search: "", channelType: "all", priority: "all", unreadOnly: false })

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const effectiveMessages = useMemo(() => messages.map((m) => optimisticReadIds.has(m.id) ? { ...m, readAt: m.readAt ?? new Date().toISOString() } : m), [messages, optimisticReadIds])

  useEffect(() => { setOptimisticReadIds((cur) => { if (cur.size === 0) return cur; const next = new Set(Array.from(cur).filter((id) => effectiveMessages.some((m) => m.id === id))); return next.size === cur.size ? cur : next }) }, [effectiveMessages])

  const messageChannels = useMemo(() => deriveChannels(effectiveMessages, agents, projects), [effectiveMessages, agents, projects])
  const forcedTaskId = useMemo(() => (selectedEntityId && tasks.some((t) => t.id === selectedEntityId) ? selectedEntityId : null), [selectedEntityId, tasks])
  const taskDiscussionChannels = useMemo(() => deriveTaskDiscussionChannels(comments, tasks, forcedTaskId), [comments, forcedTaskId, tasks])
  const channels: AnyChannel[] = useMemo(() => [...messageChannels, ...taskDiscussionChannels], [messageChannels, taskDiscussionChannels])

  useEffect(() => { if (channels.length === 0) { if (selectedChannelKey) setSelectedChannelKey(null); return }; if (!selectedChannelKey || !channels.some((c) => c.key === selectedChannelKey)) setSelectedChannelKey(channels[0].key) }, [channels, selectedChannelKey])

  useEffect(() => {
    if (!selectedEntityId) return
    const matchMsg = effectiveMessages.find((m) => m.id === selectedEntityId)
    if (matchMsg) { const ch = messageChannels.find((ch) => getChannelMessages(effectiveMessages, ch).some((m) => m.id === selectedEntityId)); if (ch) { setSelectedChannelKey(ch.key); onEntityConsumed?.() }; return }
    const matchCom = comments.find((c) => c.id === selectedEntityId)
    if (matchCom) { setSelectedChannelKey(`task-${matchCom.taskId}`); onEntityConsumed?.(); return }
    const matchTask = taskDiscussionChannels.find((d) => d.taskId === selectedEntityId)
    if (matchTask) { setSelectedChannelKey(matchTask.key); onEntityConsumed?.() }
  }, [selectedEntityId, effectiveMessages, comments, messageChannels, onEntityConsumed, taskDiscussionChannels])

  const activeChannel = useMemo(() => channels.find((c) => c.key === selectedChannelKey) ?? null, [channels, selectedChannelKey])
  const channelMessages = useMemo(() => { if (!activeChannel || activeChannel.kind !== "message") return []; return getChannelMessages(effectiveMessages, activeChannel).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) }, [effectiveMessages, activeChannel])
  const taskComments = useMemo(() => { if (!activeChannel || activeChannel.kind !== "task") return []; return comments.filter((c) => c.taskId === activeChannel.taskId).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) }, [comments, activeChannel])
  const activeTask = useMemo(() => { if (!activeChannel || activeChannel.kind !== "task") return null; return tasks.find((t) => t.id === activeChannel.taskId) ?? null }, [tasks, activeChannel])

  const filteredMessages = useMemo(() => {
    let r = channelMessages
    if (filters.channelType !== "all") r = r.filter((m) => m.channel === filters.channelType)
    if (filters.search) { const q = filters.search.toLowerCase(); r = r.filter((m) => m.subject.toLowerCase().includes(q) || m.body.toLowerCase().includes(q) || (agentMap.get(m.fromAgentId)?.name ?? "").toLowerCase().includes(q)) }
    if (filters.priority !== "all") r = r.filter((m) => m.priority === filters.priority)
    if (filters.unreadOnly) r = r.filter((m) => !m.readAt)
    return r
  }, [channelMessages, filters, agentMap])

  useEffect(() => {
    if (!activeChannel || activeChannel.kind !== "message") return
    const ids = filteredMessages.filter((m) => !m.readAt && !pendingReadIdsRef.current.has(m.id)).map((m) => m.id)
    if (ids.length === 0) return
    let cancelled = false
    void (async () => {
      for (const id of ids) pendingReadIdsRef.current.add(id)
      setOptimisticReadIds((c) => { const n = new Set(c); for (const id of ids) n.add(id); return n })
      const results = await Promise.all(ids.map(async (id) => { try { unwrap(await window.agentCompany.markMessageRead({ messageId: id, companyId })); return { id, ok: true as const } } catch { return { id, ok: false as const } } }))
      const failed = results.filter((r) => !r.ok).map((r) => r.id)
      for (const id of ids) pendingReadIdsRef.current.delete(id)
      if (!cancelled && failed.length > 0) setOptimisticReadIds((c) => { const n = new Set(c); for (const id of failed) n.delete(id); return n })
    })()
    return () => { cancelled = true }
  }, [activeChannel, companyId, filteredMessages])

  const unreadByChannel = useMemo(() => {
    const counts = new Map<string, { unread: number; hasUrgent: boolean }>()
    for (const ch of channels) { if (ch.kind !== "message") { counts.set(ch.key, { unread: 0, hasUrgent: false }); continue }; const msgs = getChannelMessages(effectiveMessages, ch); counts.set(ch.key, { unread: msgs.filter((m) => !m.readAt).length, hasUrgent: msgs.some((m) => !m.readAt && m.priority === "urgent") }) }
    return counts
  }, [channels, effectiveMessages])

  const totalUnread = useMemo(() => effectiveMessages.filter((m) => !m.readAt).length, [effectiveMessages])

  const channelGroups = useMemo(() => {
    const groups: Array<{ type: MessageChannel; label: string; items: ChannelDescriptor[] }> = []
    const cfgs: Record<MessageChannel, string> = { company: "Company-wide", department: "Department", project: "Project", incident: "Incident", direct: "Direct Messages" }
    for (const type of (["company", "department", "project", "incident", "direct"] as MessageChannel[])) {
      const items = channels.filter((c): c is ChannelDescriptor => c.kind === "message" && c.channel === type)
      if (items.length > 0) groups.push({ type, label: cfgs[type], items })
    }
    return groups
  }, [channels])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px]" style={{ backgroundColor: TERRACOTTA_SOFT }}>
            <ChatCircle size={20} weight="fill" style={{ color: TERRACOTTA }} />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[color:var(--text)]">{t("comm.communicationHub")}</h2>
            <p className="text-[12px] text-[color:var(--muted)]">{messages.length} message{messages.length !== 1 ? "s" : ""}{totalUnread > 0 ? <span style={{ color: TERRACOTTA }}> ({totalUnread} unread)</span> : null}</p>
          </div>
        </div>
        <button type="button" onClick={() => setShowCompose(true)} className="inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-[11px] font-semibold text-white transition hover:brightness-90" style={{ backgroundColor: TERRACOTTA }}>
          <Plus size={13} weight="bold" />{t("comm.newMessage")}
        </button>
      </div>
      <div className="flex overflow-hidden rounded-[12px] border border-[color:var(--line)]" style={{ height: "calc(100vh - 220px)", minHeight: "480px" }}>
        <AnimatePresence initial={false}>
          {showSidebar ? <ChannelSidebar channelGroups={channelGroups} taskDiscussionChannels={taskDiscussionChannels} selectedChannelKey={selectedChannelKey} onSelectChannel={setSelectedChannelKey} unreadByChannel={unreadByChannel} agents={agents} totalChannels={channels.length} onHideSidebar={() => setShowSidebar(false)} /> : null}
        </AnimatePresence>
        <div className="flex min-w-0 flex-1 flex-col bg-[color:var(--bg)]">
          <ChannelHeader activeChannel={activeChannel} showSidebar={showSidebar} onShowSidebar={() => setShowSidebar(true)} channelMessages={channelMessages} taskDiscussionComments={taskComments} activeTask={activeTask} unreadByChannel={unreadByChannel} onNavigateToTask={onNavigateToTask} filterBar={<FilterBar filters={filters} onChangeFilters={setFilters} />} />
          <div className="flex-1 overflow-y-auto px-2 py-3">
            <MessageList activeChannel={activeChannel} filteredMessages={filteredMessages} taskDiscussionComments={taskComments} activeTask={activeTask} agentMap={agentMap} filters={filters} onReply={setReplyTo} messageCount={effectiveMessages.length} selectedChannelKey={selectedChannelKey} />
          </div>
          {activeChannel ? (activeChannel.kind === "message" ? <MessageComposer agents={agents} companyId={companyId} channel={activeChannel.channel} channelTargetId={activeChannel.channel === "direct" ? null : activeChannel.targetId} directParticipantIds={activeChannel.channel === "direct" ? activeChannel.participantIds : []} replyTo={replyTo} onSent={() => { setReplyTo(null); onRefresh() }} onCancelReply={() => setReplyTo(null)} /> : <TaskDiscussionComposer companyId={companyId} taskId={activeChannel.taskId} onSent={onRefresh} />) : <NoChannelComposer />}
        </div>
      </div>
      <ComposeModal open={showCompose} onClose={() => setShowCompose(false)} agents={agents} projects={projects} companyId={companyId} onSent={onRefresh} />
    </div>
  )
}
