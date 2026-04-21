import { useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { CheckCircle } from "../ui/icons"
import type { AgentRecord, ConnectorRecord, WorkspaceRecord } from "@shared/types"
import { EmptyState, StatusPill } from "../ui"
import { useT } from "../../i18n"
import { useRovingTabIndex } from "../../lib/keyboard"
import { formatConnectorLabel } from "../../lib/formatters"
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
    return <EmptyState title={t("org.noAgentsYet")} />
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto border-y border-border"
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
              className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none ${virtualRow.index === focusedIndex ? "ring-1 ring-[color:var(--primary)] ring-inset" : ""}`}
            >
              <button
                type="button"
                onClick={() => onSelect(agent.id)}
                tabIndex={-1}
                className={`block w-full border-b border-border px-4 py-3 text-left last:border-b-0 cursor-pointer transition-colors duration-150 ${isSelected ? "bg-accent border-l-[3px] border-l-[color:var(--primary)]" : "hover:bg-muted"}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isSelected && (
                      <CheckCircle size={16} weight="fill" className="text-primary" />
                    )}
                    <div>
                      <div className={`truncate text-[14px] font-semibold text-foreground`}>{agent.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {agent.role} · {agent.title || t("org.noTitle")}
                      </div>
                    </div>
                  </div>
                  <StatusPill status={agent.status} />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{t("org.connectorLabel")} {formatConnectorLabel(connector, agent.connectorId)}</span>
                  {workspace && <span>{t("org.workspaceLabel")} {workspace.name}</span>}
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
