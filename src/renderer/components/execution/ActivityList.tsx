import { useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Lightning, MagnifyingGlass } from "@phosphor-icons/react"
import type { ActivityRecord } from "@shared/types"
import { useT } from "../../i18n"
import { formatTime } from "../../lib/formatters"
import { useRovingTabIndex } from "../../lib/keyboard"
import { EmptyState, Select } from "../ui"
import { ENTITY_ICONS, ENTITY_TYPE_OPTIONS } from "./execution-utils"

export function ActivityList({ activity }: { activity: ActivityRecord[] }) {
  const t = useT()
  const [search, setSearch] = useState("")
  const [entityFilter, setEntityFilter] = useState<string>("all")
  const parentRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    let result = activity
    if (entityFilter !== "all") result = result.filter((e) => e.entityType === entityFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((e) =>
        e.action.toLowerCase().includes(q) ||
        e.actor.toLowerCase().includes(q) ||
        e.detail.toLowerCase().includes(q) ||
        e.entityType.toLowerCase().includes(q),
      )
    }
    return result
  }, [activity, entityFilter, search])

  const { handleKeyDown, getTabIndex, focusedIndex } = useRovingTabIndex(filtered.length)

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 15,
  })

  if (activity.length === 0) return <EmptyState title={t("exec.noActivityYet")} detail={t("exec.noActivityDetail")} />
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" aria-label={t("exec.searchActivity")} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card py-2.5 pl-8 pr-3.5 text-[13px] text-foreground placeholder:text-muted-foreground" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("exec.searchActivity")} />
        </div>
        <Select value={entityFilter} onChange={setEntityFilter} options={ENTITY_TYPE_OPTIONS.map((v) => ({ value: v, label: v === "all" ? t("exec.allTypes") : v }))} />
      </div>
      {filtered.length === 0 ? <EmptyState title={t("exec.noMatchingActivity")} /> : (
        <div
          ref={parentRef}
          className="h-full max-h-[600px] overflow-auto border-y border-border"
          role="listbox"
          aria-label="Activity log"
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
              const entry = filtered[virtualRow.index]
              const EntityIcon = ENTITY_ICONS[entry.entityType] ?? Lightning
              return (
                <div
                  key={entry.id}
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
                  className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none border-b border-border px-4 py-3 last:border-b-0 ${virtualRow.index === focusedIndex ? "ring-1 ring-[color:var(--primary)] ring-inset" : ""}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <EntityIcon size={14} weight="duotone" className="shrink-0 text-muted-foreground" />
                      <div className="truncate text-[13px] text-foreground">{entry.action}</div>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">{formatTime(entry.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <span className="font-medium text-muted-foreground">{entry.actor}</span>
                    <span>·</span>
                    <span className="truncate">{entry.detail || `${entry.entityType}:${entry.entityId}`}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
