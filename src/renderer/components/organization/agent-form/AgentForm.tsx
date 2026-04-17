import { useMemo } from "react";
import type {
  AgentRecord,
  ConnectorRecord,
  WorkspaceRecord,
} from "@shared/types";
import {
  getConnectorExecutionReadinessIssue,
  isConnectorExecutionReady,
} from "@shared/connector-policy";
import { useAgentForm, type AgentFormMode } from "./useAgentForm";
import { CreateFormBody } from "./agent-form-fields/CreateFormBody";
import { EditFormBody } from "./agent-form-fields/EditFormBody";

interface AgentFormProps {
  mode: AgentFormMode;
  companyId: string;
  connectors: ConnectorRecord[];
  workspaces: WorkspaceRecord[];
  agents: AgentRecord[];
  agent?: AgentRecord;
  onSaved: () => Promise<void>;
  onDeleted?: () => Promise<void>;
}

export function AgentForm({
  mode,
  companyId,
  connectors,
  workspaces,
  agents,
  agent,
  onSaved,
  onDeleted,
}: AgentFormProps) {
  const form = useAgentForm({
    mode,
    agent: agent ?? null,
    connectors,
    workspaces,
    companyId,
  });
  const { executionReadyConnectors, selectedConnectorRecord } = form;

  const selectedConnectorIssue =
    mode === "edit"
      ? selectedConnectorRecord
        ? getConnectorExecutionReadinessIssue(selectedConnectorRecord)
        : "Select a connector."
      : null;
  const persistedConnectorRecord =
    mode === "edit" && agent
      ? connectors.find((connector) => connector.id === agent.connectorId) ?? null
      : null;
  const persistedConnectorIssue =
    mode === "edit"
      ? persistedConnectorRecord
        ? getConnectorExecutionReadinessIssue(persistedConnectorRecord)
        : "Current connector is unavailable."
      : null;

  const connectorOptions = useMemo(() => {
    const getDisplayLabel = (c: ConnectorRecord) =>
      c.id.startsWith("claude_compat") && c.notes ? c.notes : c.label;
    const readyOptions = executionReadyConnectors.map((connector) => ({
      value: connector.id,
      label: getDisplayLabel(connector),
    }));
    if (mode !== "edit") return readyOptions;
    if (!selectedConnectorRecord || isConnectorExecutionReady(selectedConnectorRecord)) {
      return readyOptions;
    }
    return [
      {
        value: selectedConnectorRecord.id,
        label: `${getDisplayLabel(selectedConnectorRecord)} (current, blocked)`,
      },
      ...readyOptions.filter((option) => option.value !== selectedConnectorRecord.id),
    ];
  }, [executionReadyConnectors, selectedConnectorRecord, mode]);

  if (mode === "create") {
    return (
      <CreateFormBody
        companyId={companyId}
        agents={agents}
        workspaces={workspaces}
        connectorOptions={connectorOptions}
        form={form}
        onSaved={onSaved}
      />
    );
  }

  if (!agent) return null;
  return (
    <EditFormBody
      agent={agent}
      companyId={companyId}
      agents={agents}
      workspaces={workspaces}
      connectors={connectors}
      connectorOptions={connectorOptions}
      selectedConnectorIssue={selectedConnectorIssue}
      persistedConnectorIssue={persistedConnectorIssue}
      form={form}
      onSaved={onSaved}
      onDeleted={onDeleted}
    />
  );
}
