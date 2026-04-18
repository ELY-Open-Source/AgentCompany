import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { EnvelopeSimple, Hash, Buildings, Megaphone, Fire, MagnifyingGlass, Funnel } from "../ui/icons"
import type { AgentRecord, MessageChannel } from "@shared/types"
import { AgentAvatar } from "./MessageItem"
import type { ChannelDescriptor, TaskDiscussionDescriptor } from "./ChannelHeader"
import { useT } from "../../i18n"
import { Eyebrow, Select } from "../ui"

type ChannelConfig = { labelKey: string; icon: React.ElementType }

const channelConfig: Record<MessageChannel, ChannelConfig> = {
  direct: { labelKey: "comm.channelLabel.direct", icon: EnvelopeSimple },
  department: { labelKey: "comm.channelLabel.department", icon: Buildings },
  company: { labelKey: "comm.channelLabel.company", icon: Megaphone },
  project: { labelKey: "comm.channelLabel.project", icon: Hash },
  incident: { labelKey: "comm.channelLabel.incident", icon: Fire },
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
  const agent = descriptor.agentId ? agents.find((a) => a.id === descriptor.agentId) : undefined

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition duration-150 ${
        active ? "bg-accent" : "hover:bg-muted/50"
      }`}
    >
      {descriptor.channel === "direct" && agent ? (
        <AgentAvatar agent={agent} size="sm" />
      ) : (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon size={14} weight={active ? "fill" : "regular"} className="text-muted-foreground" />
        </div>
      )}

      <span
        className={`min-w-0 flex-1 truncate text-[13px] ${
          active
            ? "font-semibold text-foreground"
            : unreadCount > 0
              ? "font-semibold text-foreground"
              : "font-medium text-muted-foreground"
        }`}
      >
        {descriptor.label}
      </span>

      {hasUrgent ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
      ) : unreadCount > 0 ? (
        <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </button>
  )
}

interface ChannelSidebarProps {
  channelGroups: Array<{ type: MessageChannel; label: string; items: ChannelDescriptor[] }>
  taskDiscussionChannels: TaskDiscussionDescriptor[]
  selectedChannelKey: string | null
  onSelectChannel: (key: string) => void
  unreadByChannel: Map<string, { unread: number; hasUrgent: boolean }>
  agents: AgentRecord[]
  totalChannels: number
  onHideSidebar: () => void
}

export function ChannelSidebar({
  channelGroups,
  taskDiscussionChannels,
  selectedChannelKey,
  onSelectChannel,
  unreadByChannel,
  agents,
  totalChannels,
  onHideSidebar: _onHideSidebar,
}: ChannelSidebarProps) {
  const t = useT()

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 260, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-card"
      style={{ width: 260 }}
    >
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {channelGroups.map((group) => (
          <div key={group.type} className="mb-3">
            <Eyebrow className="mb-1 px-2">{group.label}</Eyebrow>
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
                  onClick={() => onSelectChannel(ch.key)}
                />
              )
            })}
          </div>
        ))}

        {taskDiscussionChannels.length > 0 ? (
          <div className="mb-3">
            <Eyebrow className="mb-1 px-2">{t("comm.taskDiscussions")}</Eyebrow>
            {taskDiscussionChannels.map((discussion) => (
              <button
                key={discussion.key}
                type="button"
                onClick={() => onSelectChannel(discussion.key)}
                className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition duration-150 ${
                  selectedChannelKey === discussion.key ? "bg-accent" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Hash size={14} weight={selectedChannelKey === discussion.key ? "fill" : "regular"} className="text-muted-foreground" />
                </div>
                <span className={`min-w-0 flex-1 truncate text-[13px] ${selectedChannelKey === discussion.key ? "font-semibold text-foreground" : "font-medium text-muted-foreground"}`}>
                  {discussion.label}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {totalChannels === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            {t("comm.noActiveDepartments")}
          </div>
        ) : null}
      </div>

      <div className="border-t border-border px-4 py-2">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{t("comm.channelsTotal").replace("{count}", String(totalChannels))}</span>
          <span>{t("comm.agentsTotal").replace("{count}", String(agents.length))}</span>
        </div>
      </div>
    </motion.div>
  )
}

export interface FilterState {
  search: string
  channelType: MessageChannel | "all"
  priority: string
  unreadOnly: boolean
}

export function FilterBar({
  filters,
  onChangeFilters,
  scopeToggle,
  onSearchKeyDown,
}: {
  filters: FilterState
  onChangeFilters: (next: FilterState) => void
  scopeToggle?: React.ReactNode
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onChangeFilters({ ...filters, search: e.target.value })}
            onKeyDown={onSearchKeyDown}
            placeholder={t("comm.searchMessages")}
            className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-[color:var(--primary)] focus:outline-none focus:ring-1 focus:ring-[color:var(--primary)]"
          />
        </div>
        {scopeToggle}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
            expanded || filters.channelType !== "all" || filters.priority !== "all" || filters.unreadOnly
              ? "border-transparent bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:border-border"
          }`}
        >
          <Funnel size={12} />
          {t("comm.filters")}
        </button>
      </div>

      <AnimatePresence>
        {expanded ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap items-center gap-2 overflow-hidden"
          >
            <Select
              compact
              value={filters.channelType}
              onChange={(v) => onChangeFilters({ ...filters, channelType: v as MessageChannel | "all" })}
              options={[
                { value: "all", label: t("comm.allChannels") },
                { value: "direct", label: t("comm.direct") },
                { value: "department", label: t("comm.department") },
                { value: "company", label: t("comm.company") },
                { value: "project", label: t("nav.projects") },
                { value: "incident", label: t("comm.incident") },
              ]}
            />
            <Select
              compact
              value={filters.priority}
              onChange={(v) => onChangeFilters({ ...filters, priority: v })}
              options={[
                { value: "all", label: t("comm.allPriorities") },
                { value: "urgent", label: t("comm.urgent") },
                { value: "normal", label: t("comm.normal") },
                { value: "low", label: t("comm.low") },
              ]}
            />
            <button
              type="button"
              onClick={() => onChangeFilters({ ...filters, unreadOnly: !filters.unreadOnly })}
              className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
                filters.unreadOnly ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {t("comm.unreadOnly")}
            </button>
            {(filters.channelType !== "all" || filters.priority !== "all" || filters.unreadOnly) ? (
              <button
                type="button"
                onClick={() => onChangeFilters({ search: filters.search, channelType: "all", priority: "all", unreadOnly: false })}
                className="text-[11px] font-medium text-muted-foreground underline transition hover:text-foreground"
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
