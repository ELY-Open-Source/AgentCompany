/**
 * Thread Panel
 *
 * Renders a thread event timeline with wait-state indicators and a
 * message composer for scoped replies. Designed to slide in as a
 * right-side panel alongside the main message area.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { X, ChatCircleDots, ArrowBendUpLeft } from "@phosphor-icons/react"
import { motion } from "framer-motion"
import type { AgentRecord, ConversationEventRecord, ThreadWaitStateRecord, ConversationThreadRecord, DocumentRecord } from "@shared/types"
import WaitStateIndicator, { type WaitStateInfo } from "./WaitStateIndicator"
import { MessageComposer } from "./MessageComposer"

interface ThreadPanelProps {
  threadId: string
  companyId: string
  agents: AgentRecord[]
  documents: DocumentRecord[]
  onClose: () => void
  onNavigateApproval?: (approvalId: string) => void
}

function EventItem({ event, agents }: { event: ConversationEventRecord; agents: AgentRecord[] }) {
  const actorName = event.actorType === "user"
    ? "You"
    : agents.find((a) => a.id === event.actorId)?.name ?? event.actorId

  const time = new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  const iconClass = event.eventType === "status_change"
    ? "text-blue-500"
    : event.eventType === "approval_request"
      ? "text-amber-500"
      : event.eventType === "approval_decision"
        ? "text-emerald-500"
        : "text-muted-foreground"

  return (
    <div className="flex gap-2 px-3 py-2">
      <div className={`mt-0.5 shrink-0 ${iconClass}`}>
        {event.actorType === "user"
          ? <ArrowBendUpLeft size={14} />
          : <ChatCircleDots size={14} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-foreground">{actorName}</span>
          <span className="text-xs text-muted-foreground">{time}</span>
        </div>
        <p className="text-sm text-foreground/80">{event.body}</p>
      </div>
    </div>
  )
}

export default function ThreadPanel({ threadId, companyId, agents, documents, onClose, onNavigateApproval }: ThreadPanelProps) {
  const [thread, setThread] = useState<ConversationThreadRecord | null>(null)
  const [events, setEvents] = useState<ConversationEventRecord[]>([])
  const [waitStates, setWaitStates] = useState<ThreadWaitStateRecord[]>([])
  const [replyWaitStateId, setReplyWaitStateId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadThread = useCallback(async () => {
    const threadResult = await window.agentCompany.getThread({ threadId, companyId })
    if (threadResult.ok) setThread(threadResult.data)

    const eventsResult = await window.agentCompany.listThreadEvents({ threadId, companyId, limit: 100, offset: 0 })
    if (eventsResult.ok) setEvents(eventsResult.data)

    const wsResult = await window.agentCompany.listThreadWaitStates({ companyId, resolvedOnly: false })
    if (wsResult.ok) {
      setWaitStates(wsResult.data.filter((ws) => ws.threadId === threadId && !ws.resolvedAt))
    }
  }, [threadId, companyId])

  useEffect(() => { void loadThread() }, [loadThread])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events])

  const handleReply = useCallback((waitStateId: string, _threadId: string) => {
    setReplyWaitStateId(waitStateId)
  }, [])

  const handleSent = useCallback(() => {
    setReplyWaitStateId(null)
    void loadThread()
  }, [loadThread])

  const activeReplyWaitState = waitStates.find((waitState) => waitState.waitingFor !== "user_approval") ?? null

  return (
    <motion.div
      initial={{ x: 380, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 380, opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-background"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ChatCircleDots size={18} className="text-muted-foreground" />
        <h3 className="flex-1 truncate text-sm font-medium text-foreground">
          {thread?.title ?? "Thread"}
        </h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close thread"
        >
          <X size={16} />
        </button>
      </div>

      {/* Wait State Indicators */}
      {waitStates.length > 0 && (
        <div className="space-y-1 border-b border-border p-2">
          {waitStates.map((ws) => (
            <WaitStateIndicator
              key={ws.id}
              waitState={ws as WaitStateInfo}
              agents={agents}
              onReply={handleReply}
              onNavigateApproval={onNavigateApproval}
            />
          ))}
        </div>
      )}

      {/* Event Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No events yet
          </div>
        ) : (
          <div className="divide-y divide-border/50 py-1">
            {events.map((event) => (
              <EventItem key={event.id} event={event} agents={agents} />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border">
        <MessageComposer
          agents={agents}
          companyId={companyId}
          channel="direct"
          channelTargetId={null}
          replyTo={null}
          onSent={handleSent}
          onCancelReply={() => setReplyWaitStateId(null)}
          documents={documents}
          threadId={threadId}
          waitStateId={replyWaitStateId ?? activeReplyWaitState?.id ?? null}
        />
      </div>
    </motion.div>
  )
}
