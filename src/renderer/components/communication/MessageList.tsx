import { useRef, useEffect, useMemo } from "react"
import { ChatCircle, Tray } from "@phosphor-icons/react"
import type { AgentMessageRecord, AgentRecord, CommentRecord, TaskRecord } from "@shared/types"
import { MessageBubble, TaskCommentBubble } from "./MessageItem"
import type { AnyChannel } from "./ChannelHeader"
import { useT } from "../../i18n"

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
  const messageEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "auto" })
  }, [selectedChannelKey, messageCount])

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

  if (!activeChannel) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <ChatCircle size={40} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">
          {t("comm.selectChannelView")}
        </div>
        <div className="mt-1 text-[12px] text-[color:var(--muted)]">
          {t("comm.monitorComms")}
        </div>
      </div>
    )
  }

  if (activeChannel.kind === "task") {
    if (taskDiscussionComments.length === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <Tray size={36} className="mb-3 text-[color:var(--muted)]" />
          <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">
            {t("comm.noDiscussionYet")}
          </div>
          <div className="mt-1 text-[12px] text-[color:var(--muted)]">
            {t("comm.commentsAppearHere")}
          </div>
        </div>
      )
    }
    return (
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
  }

  if (filteredMessages.length === 0) {
    return (
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
    )
  }

  return (
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
              onReply={() => onReply(msg)}
            />
            {replies.length > 0 ? (
              <div className="space-y-0.5">
                {replies.map((reply) => (
                  <MessageBubble
                    key={reply.id}
                    message={reply}
                    agent={agentMap.get(reply.fromAgentId)}
                    isThread={true}
                    replyCount={0}
                    onReply={() => onReply(reply)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
      <div ref={messageEndRef} />
    </div>
  )
}
