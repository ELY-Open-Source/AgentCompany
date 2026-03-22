import { CheckCircle } from "@phosphor-icons/react";
import type { AgentRecord, ConnectorRecord, WorkspaceRecord } from "@shared/types";
import { EmptyState, ListFrame, ListRow, StatusPill } from "../ui";
import { useT } from "../../i18n";
import { BudgetBar } from "./helpers";

export function AgentRoster({
  agents,
  connectors,
  workspaces,
  selectedAgentId,
  onSelect,
}: {
  agents: AgentRecord[];
  connectors: ConnectorRecord[];
  workspaces: WorkspaceRecord[];
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
}) {
  const t = useT();
  if (agents.length === 0) {
    return <EmptyState title={t("org.noAgentsYet")} />;
  }
  return (
    <ListFrame>
      {agents.map((agent) => {
        const connector = connectors.find((c) => c.id === agent.connectorId);
        const workspace = agent.workspaceId
          ? workspaces.find((w) => w.id === agent.workspaceId)
          : null;
        const isSelected = agent.id === selectedAgentId;
        return (
          <ListRow
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className={`cursor-pointer transition-colors duration-100 ${isSelected ? "bg-[color:var(--accent-soft)]" : "hover:bg-[color:var(--panel-soft)]"}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isSelected && (
                  <CheckCircle size={16} weight="fill" className="text-[color:var(--accent)]" />
                )}
                <div>
                  <div className="text-[15px] text-[color:var(--text)]">{agent.name}</div>
                  <div className="text-[12px] text-[color:var(--muted)]">
                    {agent.role} · {agent.title || "No title"}
                  </div>
                </div>
              </div>
              <StatusPill status={agent.status} />
            </div>
            <div className="flex items-center justify-between text-[12px] text-[color:var(--muted)]">
              <span>Connector: {connector?.label ?? agent.connectorId}</span>
              {workspace && <span>Workspace: {workspace.name}</span>}
            </div>
            <div className="mt-1.5">
              <BudgetBar spent={agent.spentMonthlyUsd} budget={agent.budgetMonthlyUsd} />
            </div>
          </ListRow>
        );
      })}
    </ListFrame>
  );
}
