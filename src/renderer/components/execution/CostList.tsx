import { useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { ProfileSnapshot } from "@shared/types"
import { useT } from "../../i18n"
import { formatMoney } from "../../lib/formatters"
import { useRovingTabIndex } from "../../lib/keyboard"
import { EmptyState, Select } from "../ui"

export function CostList({ costs, agents, runs }: { costs: ProfileSnapshot["costs"]; agents: ProfileSnapshot["agents"]; runs: ProfileSnapshot["runs"] }) {
  const t = useT()
  const [connectorFilter, setConnectorFilter] = useState("all")
  const parentRef = useRef<HTMLDivElement>(null)

  const connectorIds = useMemo(() => {
    const ids = new Set(costs.map((c) => c.connectorId))
    return Array.from(ids).sort()
  }, [costs])
  const filtered = useMemo(() => connectorFilter === "all" ? costs : costs.filter((c) => c.connectorId === connectorFilter), [costs, connectorFilter])
  const total = useMemo(() => filtered.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0), [filtered])

  // +1 for the total row at the bottom
  const { handleKeyDown, getTabIndex, focusedIndex } = useRovingTabIndex(filtered.length + 1)

  const virtualizer = useVirtualizer({
    count: filtered.length + 1, // +1 for total row
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  })

  if (costs.length === 0) return <EmptyState title={t("exec.noCostData")} detail={t("exec.noCostDataDetail")} />
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Select value={connectorFilter} onChange={setConnectorFilter} options={[{ value: "all", label: t("exec.allConnectors") }, ...connectorIds.map((id) => ({ value: id, label: id }))]} />
      </div>
      <div
        ref={parentRef}
        className="h-full max-h-[600px] overflow-auto border-y border-[color:var(--line)]"
        role="listbox"
        aria-label="Cost entries"
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
            const isTotal = virtualRow.index === filtered.length
            if (isTotal) {
              return (
                <div
                  key="__total__"
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
                  className={`focus-ring outline-none border-b border-[color:var(--line)] px-4 py-3 last:border-b-0 ${virtualRow.index === focusedIndex ? "ring-1 ring-[color:var(--accent)] ring-inset" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-[13px] font-semibold text-[color:var(--text)]">Total ({filtered.length} entries)</div>
                    <div className="mono tabular-nums text-[13px] font-bold tracking-[-0.02em] text-[color:var(--text)]">{formatMoney(total)}</div>
                  </div>
                </div>
              )
            }
            const entry = filtered[virtualRow.index]
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
                className={`focus-ring outline-none border-b border-[color:var(--line)] px-4 py-3 last:border-b-0 ${virtualRow.index === focusedIndex ? "ring-1 ring-[color:var(--accent)] ring-inset" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-[color:var(--text)]">{runs.find((run) => run.id === entry.runId)?.summary || "Run cost"}</div>
                    <div className="text-[11px] text-[color:var(--muted)]">{agents.find((a) => a.id === entry.agentId)?.name ?? "Unknown agent"} · {entry.connectorId}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="mono tabular-nums text-[13px] text-[color:var(--text)]">{formatMoney(entry.amountUsd)}</div>
                    {entry.unattributed ? <div className="text-[11px] text-[color:var(--warn)]">unattributed</div> : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
