import type { AgentRecord, ConnectorRecord, WorkspaceRecord } from "@shared/types";
import { AgentForm } from "./agent-form";

export function AgentEditor({
  agent,
  connectors,
  workspaces,
  agents,
  companyId,
  onSaved,
  onCancel,
  onDeleted,
}: {
  agent: AgentRecord;
  connectors: ConnectorRecord[];
  workspaces: WorkspaceRecord[];
  agents: AgentRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  onDeleted: () => Promise<void>;
}) {
  return (
    <AgentForm
      mode="edit"
      companyId={companyId}
      connectors={connectors}
      workspaces={workspaces}
      agents={agents}
      agent={agent}
      onSaved={onSaved}
      onCancel={onCancel}
      onDeleted={onDeleted}
    />
  );
}
