import { useRef, useEffect, useMemo } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChatCircle, Tray } from "@phosphor-icons/react"
import type { AgentMessageRecord, AgentRecord, CommentRecord, TaskRecord } from "@shared/types"
import { MessageBubble, TaskCommentBubble } from "./MessageItem"
import type { AnyChannel } from "./ChannelHeader"
import { useT } from "../../i18n"
import { useRovingTabIndex } from "../../lib/keyboard"

interface FilterState {
  search: string
  channelType: string
  priority: string
  unreadOnly: boolean
}

interface MessageListProps {
  activeChannel: AnyChannel | null
  filteredMessages: AgentMessageRecord[]
  taskDiscussionComments: CommentRecord[]
  activeTask: TaskRecord | null
  agentMap: Map<string, AgentRecord>
  filters: FilterState
  onReply: (message: AgentMessageRecord) => void
  messageCount: number
  selectedChannelKey: string | null
}

export function MessageList({
  activeChannel,
  filteredMessages,
  taskDiscussionComments,
  activeTask,
  agentMap,
  filters,
  onReply,
  messageCount,
  selectedChannelKey,
}: MessageListProps) {
  const t = useT()
  const parentRef = useRef<HTMLDivElement>(null)

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

  // Flatten for virtualization: each top-level message + its replies
  const flatItems = useMemo(() => {
    const items: Array<{ type: "message"; message: AgentMessageRecord; isThread: boolean; replyCount: number } | { type: "comment"; comment: CommentRecord }> = []

    if (activeChannel?.kind === "task") {
      for (const comment of taskDiscussionComments) {
        items.push({ type: "comment", comment })
      }
    } else {
      for (const msg of threadedMessages.topLevel) {
        const replies = threadedMessages.replyMap.get(msg.id) ?? []
        items.push({ type: "message", message: msg, isThread: false, replyCount: replies.length })
        for (const reply of replies) {
          items.push({ type: "message", message: reply, isThread: true, replyCount: 0 })
        }
      }
    }
    return items
  }, [activeChannel?.kind, taskDiscussionComments, threadedMessages])

  const { handleKeyDown, getTabIndex, focusedIndex } = useRovingTabIndex(flatItems.length)

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10,
  })

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (flatItems.length > 0) {
      virtualizer.scrollToIndex(flatItems.length - 1, { align: "end" })
    }
  }, [selectedChannelKey, messageCount, flatItems.length, virtualizer])

  if (!activeChannel) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <ChatCircle size={40} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">
          {t("comm.selectChannelView")}
        </div>
      </div>
    )
  }

  if (activeChannel.kind === "task" && taskDiscussionComments.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <Tray size={36} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">
          {t("comm.noDiscussionYet")}
        </div>
      </div>
    )
  }

  if (activeChannel.kind !== "task" && filteredMessages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <Tray size={36} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">
          {filters.search || filters.unreadOnly || filters.priority !== "all"
            ? t("comm.noMatchFilters")
            : t("comm.noMessagesChannel")}
        </div>
        {(filters.search || filters.unreadOnly || filters.priority !== "all") ? (
          <div className="mt-1 text-[13px] text-[color:var(--muted)]">{t("comm.adjustFilters")}</div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      role="listbox"
      aria-label="Messages"
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = flatItems[virtualRow.index]
          return (
            <div
              key={virtualRow.index}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              tabIndex={getTabIndex(virtualRow.index)}
              role="option"
              aria-selected={false}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className={`focus-ring outline-none ${virtualRow.index === focusedIndex ? "ring-1 ring-[color:var(--accent)] ring-inset" : ""}`}
            >
              {item.type === "comment" ? (
                <TaskCommentBubble
                  comment={item.comment}
                  agent={item.comment.authorAgentId ? (agentMap.get(item.comment.authorAgentId) ?? undefined) : undefined}
                />
              ) : (
                <MessageBubble
                  message={item.message}
                  agent={agentMap.get(item.message.fromAgentId)}
                  isThread={item.isThread}
                  replyCount={item.replyCount}
                  onReply={() => onReply(item.message)}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
