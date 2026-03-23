import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import type { AgentMessageRecord, AgentRecord, CommentRecord, MessageChannel, ProjectRecord, TaskRecord } from "@shared/types"
import { useAppStore } from "../../state/store"
import { unwrap } from "../../lib/desktop"
import { useT } from "../../i18n"
import { ChannelSidebar, FilterBar, type FilterState } from "./ChannelSidebar"
import type { ChannelDescriptor, TaskDiscussionDescriptor, AnyChannel } from "./ChannelHeader"
import { ChannelHeader } from "./ChannelHeader"
import { MessageList } from "./MessageList"
import { MessageComposer, TaskDiscussionComposer, NoChannelComposer } from "./MessageComposer"
import { SearchResults } from "./SearchResults"
import { deriveChannels, deriveTaskDiscussionChannels, getChannelMessages } from "./channel-utils"


interface CommunicationHubProps {
  messages: AgentMessageRecord[]; comments: CommentRecord[]; tasks: TaskRecord[]; agents: AgentRecord[]
  projects?: ProjectRecord[]; companyId: string; selectedEntityId?: string | null
  onEntityConsumed?: () => void; onNavigateToTask: (taskId: string) => void; onRefresh: () => void
}

function SearchScopeToggle({ scope, onChangeScope }: { scope: "global" | "channel"; onChangeScope: (scope: "global" | "channel") => void }) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full bg-[color:var(--panel)] p-0.5"
      role="radiogroup"
      aria-label="Search scope"
    >
      <button
        type="button"
        role="radio"
        aria-checked={scope === "global"}
        onClick={() => onChangeScope("global")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChangeScope("global") } }}
        className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition-colors duration-150 ${
          scope === "global"
            ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
            : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)]"
        }`}
      >
        All Channels
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={scope === "channel"}
        onClick={() => onChangeScope("channel")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChangeScope("channel") } }}
        className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition-colors duration-150 ${
          scope === "channel"
            ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
            : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)]"
        }`}
      >
        This Channel
      </button>
    </div>
  )
}

export function CommunicationHub({ messages, comments, tasks, agents, projects, companyId, selectedEntityId, onEntityConsumed, onNavigateToTask, onRefresh }: CommunicationHubProps) {
  const t = useT()
  const [selectedChannelKey, setSelectedChannelKey] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [replyTo, setReplyTo] = useState<AgentMessageRecord | null>(null)
  const [optimisticReadIds, setOptimisticReadIds] = useState<Set<string>>(new Set())
  const pendingReadIdsRef = useRef<Set<string>>(new Set())
  const [filters, setFilters] = useState<FilterState>({ search: "", channelType: "all", priority: "all", unreadOnly: false })

  // Search state from Zustand store
  const searchQuery = useAppStore((s) => s.searchQuery)
  const searchScope = useAppStore((s) => s.searchScope)
  const searchResults = useAppStore((s) => s.searchResults)
  const searchLoading = useAppStore((s) => s.searchLoading)
  const searchRequestId = useAppStore((s) => s.searchRequestId)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const setSearchScope = useAppStore((s) => s.setSearchScope)
  const setSearchResults = useAppStore((s) => s.setSearchResults)
  const setSearchLoading = useAppStore((s) => s.setSearchLoading)
  const clearSearch = useAppStore((s) => s.clearSearch)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (filters.search && !searchQuery) { const q = filters.search.toLowerCase(); r = r.filter((m) => m.subject.toLowerCase().includes(q) || m.body.toLowerCase().includes(q) || (agentMap.get(m.fromAgentId)?.name ?? "").toLowerCase().includes(q)) }
    if (filters.priority !== "all") r = r.filter((m) => m.priority === filters.priority)
    if (filters.unreadOnly) r = r.filter((m) => !m.readAt)
    return r
  }, [channelMessages, filters, agentMap, searchQuery])

  // Debounced search via IPC
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const query = filters.search
    if (!query || query.length < 1) {
      if (searchQuery) clearSearch()
      return
    }

    setSearchQuery(query)
    setSearchLoading(true)

    const currentRequestId = searchRequestId + 1
    debounceRef.current = setTimeout(async () => {
      try {
        const channelParam = searchScope === "channel" && activeChannel?.kind === "message"
          ? (activeChannel as ChannelDescriptor).channel
          : undefined
        const channelTargetParam = searchScope === "channel" && activeChannel?.kind === "message"
          ? (activeChannel as ChannelDescriptor).targetId
          : undefined

        const result = await window.agentCompany.searchMessages({
          companyId,
          query,
          channel: channelParam,
          channelTargetId: channelTargetParam,
          limit: 50,
        })

        if (result.ok) {
          setSearchResults(result.data, currentRequestId)
        } else {
          setSearchResults([], currentRequestId)
        }
      } catch {
        setSearchResults([], currentRequestId)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, searchScope, activeChannel, companyId])

  // Navigate to the channel containing a search result
  const handleNavigateToResult = useCallback((message: AgentMessageRecord) => {
    // Find which channel this message belongs to
    const matchingChannel = messageChannels.find((ch) => {
      const channelMsgs = getChannelMessages(effectiveMessages, ch)
      return channelMsgs.some((m) => m.id === message.id)
    })

    if (matchingChannel) {
      setSelectedChannelKey(matchingChannel.key)
    }

    // Clear search to return to normal view
    setFilters((prev) => ({ ...prev, search: "" }))
    clearSearch()
  }, [messageChannels, effectiveMessages, clearSearch])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault()
      setFilters((prev) => ({ ...prev, search: "" }))
      clearSearch()
    }
  }, [clearSearch])

  const isSearchActive = filters.search.length >= 1

  useEffect(() => {
    if (!activeChannel || activeChannel.kind !== "message") return
    if (isSearchActive) return // Don't mark as read during search
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
  }, [activeChannel, companyId, filteredMessages, isSearchActive])

  const unreadByChannel = useMemo(() => {
    const counts = new Map<string, { unread: number; hasUrgent: boolean }>()
    for (const ch of channels) { if (ch.kind !== "message") { counts.set(ch.key, { unread: 0, hasUrgent: false }); continue }; const msgs = getChannelMessages(effectiveMessages, ch); counts.set(ch.key, { unread: msgs.filter((m) => !m.readAt).length, hasUrgent: msgs.some((m) => !m.readAt && m.priority === "urgent") }) }
    return counts
  }, [channels, effectiveMessages])


  const channelGroups = useMemo(() => {
    const groups: Array<{ type: MessageChannel; label: string; items: ChannelDescriptor[] }> = []
    const cfgs: Record<MessageChannel, string> = { company: "Company-wide", department: "Department", project: "Project", incident: "Incident", direct: "Direct Messages" }
    for (const type of (["company", "department", "project", "incident", "direct"] as MessageChannel[])) {
      const items = channels.filter((c): c is ChannelDescriptor => c.kind === "message" && c.channel === type)
      if (items.length > 0) groups.push({ type, label: cfgs[type], items })
    }
    return groups
  }, [channels])

  const scopeToggleElement = isSearchActive ? (
    <SearchScopeToggle scope={searchScope} onChangeScope={setSearchScope} />
  ) : null

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <AnimatePresence initial={false}>
        {showSidebar ? <ChannelSidebar channelGroups={channelGroups} taskDiscussionChannels={taskDiscussionChannels} selectedChannelKey={selectedChannelKey} onSelectChannel={setSelectedChannelKey} unreadByChannel={unreadByChannel} agents={agents} totalChannels={channels.length} onHideSidebar={() => setShowSidebar(false)} /> : null}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col">
        <ChannelHeader activeChannel={activeChannel} showSidebar={showSidebar} onShowSidebar={() => setShowSidebar(true)} channelMessages={channelMessages} taskDiscussionComments={taskComments} activeTask={activeTask} unreadByChannel={unreadByChannel} onNavigateToTask={onNavigateToTask} filterBar={<FilterBar filters={filters} onChangeFilters={setFilters} scopeToggle={scopeToggleElement} onSearchKeyDown={handleSearchKeyDown} />} />
        <div className="flex-1 overflow-y-auto px-2 py-3">
          <AnimatePresence mode="wait">
            {isSearchActive ? (
              <motion.div
                key="search-results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeInOut" }}
                className="h-full"
              >
                <SearchResults
                  results={searchResults}
                  query={searchQuery}
                  loading={searchLoading}
                  agents={agents}
                  onNavigateToResult={handleNavigateToResult}
                />
              </motion.div>
            ) : (
              <motion.div
                key="message-list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeInOut" }}
                className="h-full"
              >
                <MessageList activeChannel={activeChannel} filteredMessages={filteredMessages} taskDiscussionComments={taskComments} activeTask={activeTask} agentMap={agentMap} filters={filters} onReply={setReplyTo} messageCount={effectiveMessages.length} selectedChannelKey={selectedChannelKey} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {activeChannel ? (activeChannel.kind === "message" ? <MessageComposer agents={agents} companyId={companyId} channel={activeChannel.channel} channelTargetId={activeChannel.channel === "direct" ? null : activeChannel.targetId} directParticipantIds={activeChannel.channel === "direct" ? activeChannel.participantIds : []} replyTo={replyTo} onSent={() => { setReplyTo(null); onRefresh() }} onCancelReply={() => setReplyTo(null)} /> : <TaskDiscussionComposer companyId={companyId} taskId={activeChannel.taskId} onSent={onRefresh} />) : <NoChannelComposer />}
      </div>
    </div>
  )
}
