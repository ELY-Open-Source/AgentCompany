import type { AgentMessageRecord, CommentRecord, TaskRecord, MessageChannel } from "@shared/types"
import { CaretDown } from "@phosphor-icons/react"
import { useT } from "../../i18n"

export interface ChannelDescriptor {
  key: string
  kind: "message"
  channel: MessageChannel
  label: string
  targetId: string | null
  agentId: string | null
  participantIds: string[]
}

export interface TaskDiscussionDescriptor {
  key: string
  kind: "task"
  taskId: string
  label: string
}

export type AnyChannel = ChannelDescriptor | TaskDiscussionDescriptor

interface ChannelHeaderProps {
  activeChannel: AnyChannel | null
  showSidebar: boolean
  onShowSidebar: () => void
  channelMessages: AgentMessageRecord[]
  taskDiscussionComments: CommentRecord[]
  activeTask: TaskRecord | null
  unreadByChannel: Map<string, { unread: number; hasUrgent: boolean }>
  onNavigateToTask: (taskId: string) => void
  filterBar: React.ReactNode
}

export function ChannelHeader({
  activeChannel,
  showSidebar,
  onShowSidebar,
  channelMessages,
  taskDiscussionComments,
  activeTask,
  unreadByChannel,
  onNavigateToTask,
  filterBar,
}: ChannelHeaderProps) {
  const t = useT()

  return (
    <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
      {!showSidebar ? (
        <button
          type="button"
          onClick={onShowSidebar}
          className="rounded-[4px] p-1 text-muted-foreground transition hover:text-foreground"
          aria-label="Show sidebar"
        >
          <CaretDown size={12} className="rotate-90" />
        </button>
      ) : null}

      {activeChannel ? (
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground">{activeChannel.label}</div>
          {activeChannel.kind === "task" && activeTask ? (
            <button type="button" onClick={() => onNavigateToTask(activeTask.id)} className="mt-0.5 text-[11px] font-medium text-primary transition hover:underline">
              Open task
            </button>
          ) : null}
        </div>
      ) : (
        <span className="text-[13px] text-muted-foreground">{t("comm.selectChannel")}</span>
      )}

      <div className="ml-auto w-full max-w-[320px]">
        {filterBar}
      </div>
    </div>
  )
}
