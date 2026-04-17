import type { AgentRecord, ConnectorRecord, WorkspaceRecord } from "@shared/types";
import { AgentForm } from "./agent-form";

export function AgentCreator({
  companyId,
  connectors,
  workspaces,
  agents,
  onSaved,
}: {
  companyId: string;
  connectors: ConnectorRecord[];
  workspaces: WorkspaceRecord[];
  agents: AgentRecord[];
  onSaved: () => Promise<void>;
}) {
  return (
    <AgentForm
      mode="create"
      companyId={companyId}
      connectors={connectors}
      workspaces={workspaces}
      agents={agents}
      onSaved={onSaved}
    />
  );
}
