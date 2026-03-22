import type { AgentMessageRecord, CommentRecord, TaskRecord, MessageChannel } from "@shared/types"
import { ChatCircle, Hash, CaretDown } from "@phosphor-icons/react"
import { useT } from "../../i18n"

const channelConfig: Record<MessageChannel, { label: string; icon: React.ElementType; color: string }> = {
  direct: { label: "Direct Messages", icon: ChatCircle, color: "var(--accent)" },
  department: { label: "Department", icon: ChatCircle, color: "#6366f1" },
  company: { label: "Company-wide", icon: ChatCircle, color: "#d97745" },
  project: { label: "Project", icon: Hash, color: "#10b981" },
  incident: { label: "Incident", icon: ChatCircle, color: "var(--danger)" },
}

const TERRACOTTA = "#d97745"

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
    <div className="flex items-center gap-3 border-b border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-2.5">
      {!showSidebar ? (
        <button
          type="button"
          onClick={onShowSidebar}
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

      <div className="ml-auto w-[320px]">
        {filterBar}
      </div>
    </div>
  )
}
