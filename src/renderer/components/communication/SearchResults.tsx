import { useRef, useCallback } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { motion } from "framer-motion"
import { EnvelopeSimple, Buildings, Megaphone, Hash, Fire } from "@phosphor-icons/react"
import type { AgentMessageRecord, AgentRecord, MessageChannel } from "@shared/types"
import { AgentAvatar } from "./MessageItem"
import { formatMessageTime } from "../../lib/formatters"
import { EmptyState, useReducedMotion } from "../ui"
import { useRovingTabIndex } from "../../lib/keyboard"

const channelConfig: Record<MessageChannel, { label: string; icon: React.ElementType; color: string }> = {
  direct: { label: "Direct", icon: EnvelopeSimple, color: "var(--accent)" },
  department: { label: "Department", icon: Buildings, color: "var(--muted-strong)" },
  company: { label: "Company", icon: Megaphone, color: "var(--accent)" },
  project: { label: "Project", icon: Hash, color: "var(--success)" },
  incident: { label: "Incident", icon: Fire, color: "var(--danger)" },
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`(${escaped})`, "gi")
  const parts = text.split(regex)
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="rounded-[2px] bg-[color:var(--warn-soft)] px-0.5 text-[color:var(--text)]">{part}</mark>
      : part
  )
}

function SkeletonRow() {
  return (
    <div className="flex gap-3 px-3 py-3" style={{ height: 72 }}>
      <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-[color:var(--panel-soft)]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="h-3 w-32 animate-pulse rounded bg-[color:var(--panel-soft)]" />
        <div className="h-3 w-48 animate-pulse rounded bg-[color:var(--panel-soft)]" />
        <div className="h-3 w-64 animate-pulse rounded bg-[color:var(--panel-soft)]" />
      </div>
    </div>
  )
}

interface SearchResultsProps {
  results: AgentMessageRecord[]
  query: string
  loading: boolean
  agents: AgentRecord[]
  onNavigateToResult: (message: AgentMessageRecord) => void
}

export function SearchResults({ results, query, loading, agents, onNavigateToResult }: SearchResultsProps) {
  const reducedMotion = useReducedMotion()
  const parentRef = useRef<HTMLDivElement>(null)
  const agentMap = new Map(agents.map((a) => [a.id, a]))

  const { handleKeyDown, getTabIndex, focusedIndex } = useRovingTabIndex(results.length)

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 8,
  })

  const handleResultClick = useCallback((message: AgentMessageRecord) => {
    onNavigateToResult(message)
  }, [onNavigateToResult])

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    )
  }

  if (results.length === 0 && query.length > 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="No messages matched your search"
          detail="Try different keywords or search across all channels."
        />
      </div>
    )
  }

  if (results.length === 0) return null

  const animationProps = reducedMotion
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2, ease: "easeOut" as const } }

  return (
    <motion.div className="flex h-full flex-col" {...animationProps}>
      <div className="shrink-0 px-3 py-2">
        <span className="text-[11px] font-semibold text-[color:var(--muted)]">
          {results.length} result{results.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
        role="listbox"
        aria-label="Search results"
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
            const message = results[virtualRow.index]
            const agent = agentMap.get(message.fromAgentId)
            const config = channelConfig[message.channel]
            const ChannelIcon = config.icon

            return (
              <div
                key={virtualRow.index}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                tabIndex={getTabIndex(virtualRow.index)}
                role="option"
                aria-selected={false}
                onClick={() => handleResultClick(message)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    handleResultClick(message)
                  }
                }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={`cursor-pointer px-3 py-2 transition-colors duration-100 hover:bg-[color:var(--panel-soft)] focus:outline-none ${virtualRow.index === focusedIndex ? "ring-1 ring-inset ring-[color:var(--accent)]" : ""}`}
              >
                <div className="flex items-start gap-2.5">
                  <AgentAvatar agent={agent} size="sm" />

                  <div className="min-w-0 flex-1">
                    {/* Row 1: Agent name, channel badge, timestamp */}
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[11px] font-semibold text-[color:var(--text)]">
                        {agent?.name ?? "Unknown Agent"}
                      </span>
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium"
                        style={{ backgroundColor: `${config.color}18`, color: config.color }}
                      >
                        <ChannelIcon size={10} weight="bold" />
                        {config.label}
                      </span>
                      <span className="ml-auto whitespace-nowrap shrink-0 font-mono text-[11px] text-[color:var(--muted)]">
                        {formatMessageTime(message.createdAt)}
                      </span>
                    </div>

                    {/* Row 2: Subject */}
                    <div className="mt-0.5 truncate text-[13px] font-semibold text-[color:var(--text)]">
                      {highlightMatch(message.subject, query)}
                    </div>

                    {/* Row 3: Body snippet */}
                    <div className="mt-0.5 line-clamp-2 break-words text-[13px] leading-relaxed text-[color:var(--muted)]">
                      {highlightMatch(message.body, query)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
