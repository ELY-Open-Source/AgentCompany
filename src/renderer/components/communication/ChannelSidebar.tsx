import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { EnvelopeSimple, Hash, Buildings, Megaphone, Fire, MagnifyingGlass, Funnel } from "@phosphor-icons/react"
import type { AgentRecord, MessageChannel } from "@shared/types"
import { AgentAvatar } from "./MessageItem"
import type { ChannelDescriptor, TaskDiscussionDescriptor } from "./ChannelHeader"
import { useT } from "../../i18n"

const channelConfig: Record<MessageChannel, { label: string; icon: React.ElementType; color: string }> = {
  direct: { label: "Direct Messages", icon: EnvelopeSimple, color: "var(--primary)" },
  department: { label: "Department", icon: Buildings, color: "var(--muted-foreground)" },
  company: { label: "Company-wide", icon: Megaphone, color: "var(--primary)" },
  project: { label: "Project", icon: Hash, color: "var(--primary)" },
  incident: { label: "Incident", icon: Fire, color: "var(--destructive)" },
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
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${config.color}18` }}
        >
          <Icon size={14} weight={active ? "fill" : "regular"} style={{ color: config.color }} />
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
        <span
          className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-bold text-primary-foreground"
          style={{ backgroundColor: "var(--primary)" }}
        >
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
  onHideSidebar,
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
            <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
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
                  onClick={() => onSelectChannel(ch.key)}
                />
              )
            })}
          </div>
        ))}

        {taskDiscussionChannels.length > 0 ? (
          <div className="mb-3">
            <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t("comm.taskDiscussions")}
            </div>
            {taskDiscussionChannels.map((discussion) => (
              <button
                key={discussion.key}
                type="button"
                onClick={() => onSelectChannel(discussion.key)}
                className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition duration-150 ${
                  selectedChannelKey === discussion.key ? "bg-muted" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--primary)" }}>
                  <Hash size={14} weight={selectedChannelKey === discussion.key ? "fill" : "regular"} style={{ color: "var(--primary)" }} />
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
          <span>{totalChannels} channels</span>
          <span>{agents.length} agents</span>
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
            className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1"
            style={{ focusRingColor: "var(--primary)" } as React.CSSProperties}
          />
        </div>
        {scopeToggle}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
            expanded || filters.channelType !== "all" || filters.priority !== "all" || filters.unreadOnly
              ? "border-transparent text-primary-foreground"
              : "border-border text-muted-foreground hover:border-border"
          }`}
          style={
            expanded || filters.channelType !== "all" || filters.priority !== "all" || filters.unreadOnly
              ? { backgroundColor: "var(--primary)" }
              : undefined
          }
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
            <select
              value={filters.channelType}
              onChange={(e) => onChangeFilters({ ...filters, channelType: e.target.value as MessageChannel | "all" })}
              className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground"
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
              onChange={(e) => onChangeFilters({ ...filters, priority: e.target.value })}
              className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground"
            >
              <option value="all">{t("comm.allPriorities")}</option>
              <option value="urgent">{t("comm.urgent")}</option>
              <option value="normal">{t("comm.normal")}</option>
              <option value="low">{t("comm.low")}</option>
            </select>
            <button
              type="button"
              onClick={() => onChangeFilters({ ...filters, unreadOnly: !filters.unreadOnly })}
              className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
                filters.unreadOnly ? "text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
              style={filters.unreadOnly ? { backgroundColor: "var(--primary)" } : undefined}
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
