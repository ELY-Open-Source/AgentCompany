import { useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { CheckCircle } from "@phosphor-icons/react"
import type { AgentRecord, ConnectorRecord, WorkspaceRecord } from "@shared/types"
import { EmptyState, StatusPill } from "../ui"
import { useT } from "../../i18n"
import { useRovingTabIndex } from "../../lib/keyboard"
import { BudgetBar } from "./helpers"

export function AgentRoster({
  agents,
  connectors,
  workspaces,
  selectedAgentId,
  onSelect,
}: {
  agents: AgentRecord[]
  connectors: ConnectorRecord[]
  workspaces: WorkspaceRecord[]
  selectedAgentId: string | null
  onSelect: (agentId: string) => void
}) {
  const t = useT()
  const parentRef = useRef<HTMLDivElement>(null)
  const { handleKeyDown, getTabIndex, focusedIndex } = useRovingTabIndex(agents.length)

  const virtualizer = useVirtualizer({
    count: agents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  })

  if (agents.length === 0) {
    return <EmptyState title={t("org.noAgentsYet")} detail={t("org.noAgentsDetail")} />
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto border-y border-[color:var(--line)]"
      role="listbox"
      aria-label="Agent roster"
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
          const agent = agents[virtualRow.index]
          const connector = connectors.find((c) => c.id === agent.connectorId)
          const workspace = agent.workspaceId
            ? workspaces.find((w) => w.id === agent.workspaceId)
            : null
          const isSelected = agent.id === selectedAgentId

          return (
            <div
              key={agent.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              tabIndex={getTabIndex(virtualRow.index)}
              role="option"
              aria-selected={isSelected}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className={`focus-ring outline-none ${virtualRow.index === focusedIndex ? "ring-1 ring-[color:var(--accent)] ring-inset" : ""}`}
            >
              <button
                type="button"
                onClick={() => onSelect(agent.id)}
                tabIndex={-1}
                className={`block w-full border-b border-[color:var(--line)] px-4 py-3 text-left last:border-b-0 cursor-pointer transition-colors duration-150 ${isSelected ? "bg-[color:var(--accent-soft)] border-l-[3px] border-l-[color:var(--accent)]" : "hover:bg-[color:var(--panel-soft)]"}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isSelected && (
                      <CheckCircle size={16} weight="fill" className="text-[color:var(--accent)]" />
                    )}
                    <div>
                      <div className={`truncate text-[14px] font-semibold text-[color:var(--text)]`}>{agent.name}</div>
                      <div className="truncate text-[11px] text-[color:var(--muted)]">
                        {agent.role} · {agent.title || "No title"}
                      </div>
                    </div>
                  </div>
                  <StatusPill status={agent.status} />
                </div>
                <div className="flex items-center justify-between text-[11px] text-[color:var(--muted)]">
                  <span>Connector: {connector?.label ?? agent.connectorId}</span>
                  {workspace && <span>Workspace: {workspace.name}</span>}
                </div>
                <div className="mt-1.5">
                  <BudgetBar spent={agent.spentMonthlyUsd} budget={agent.budgetMonthlyUsd} />
                </div>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
