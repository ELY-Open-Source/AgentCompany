import { useEffect, useMemo, useState } from "react";
import { Robot } from "@phosphor-icons/react";
import type { AgentRecord, ConnectorRecord, WorkspaceRecord } from "@shared/types";
import { isConnectorExecutionReady } from "@shared/connector-policy";
import { unwrap } from "../../lib/desktop";
import { ActionButton, Input, Select, TextArea } from "../ui";

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
  const executionReadyConnectors = useMemo(
    () => connectors.filter((connector) => isConnectorExecutionReady(connector)),
    [connectors],
  );
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [title, setTitle] = useState("");
  const [connectorId, setConnectorId] = useState(executionReadyConnectors[0]?.id ?? "");
  const [model, setModel] = useState("");
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; label: string }>>([]);
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [budget, setBudget] = useState("120");
  const [capabilities, setCapabilities] = useState("");
  const [reportsTo, setReportsTo] = useState("");
  const [thinkingEffort, setThinkingEffort] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const supportsEffort = connectorId === "claude_local" || connectorId === "codex_local";
  const selectedConnector = executionReadyConnectors.find((connector) => connector.id === connectorId) ?? null;

  useEffect(() => {
    if (!connectorId) {
      setAvailableModels([]);
      setModel("");
      return;
    }
    void (async () => {
      const result = await window.agentCompany.listConnectorModels(connectorId);
      if (result.ok) {
        setAvailableModels(result.data);
        setModel(result.data[0]?.id ?? "");
      }
    })();
    if (connectorId !== "claude_local" && connectorId !== "codex_local") {
      setThinkingEffort("");
    }
  }, [connectorId]);

  useEffect(() => {
    if (!connectorId && executionReadyConnectors[0]) {
      setConnectorId(executionReadyConnectors[0].id);
      return;
    }
    if (connectorId && !executionReadyConnectors.some((connector) => connector.id === connectorId)) {
      setConnectorId(executionReadyConnectors[0]?.id ?? "");
    }
  }, [executionReadyConnectors, connectorId]);

  return (
    <div className="grid gap-4">
      <Input label="Agent name" value={name} onChange={setName} placeholder="Agent name" />
      <Input label="Role" value={role} onChange={setRole} placeholder="e.g. Engineer, PM, CEO" />
      <Input label="Title" value={title} onChange={setTitle} placeholder="Title" />
      <Select
        label="Connector"
        value={connectorId}
        onChange={(value) => setConnectorId(value as ConnectorRecord["id"])}
        options={executionReadyConnectors.map((connector) => ({ value: connector.id, label: connector.label }))}
      />
      {executionReadyConnectors.length === 0 ? (
        <p className="text-[12px] text-[color:var(--warn)]">
          No execution-ready connector is available. Fix connector health before requesting hires.
        </p>
      ) : null}
      {availableModels.length > 0 ? (
        <Select
          label="Model"
          value={model}
          onChange={setModel}
          options={availableModels.map((m) => ({ value: m.id, label: m.label }))}
        />
      ) : null}
      {supportsEffort ? (
        <Select
          label="Thinking effort"
          value={thinkingEffort}
          onChange={setThinkingEffort}
          options={[
            { value: "", label: "Default" },
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]}
        />
      ) : null}
      <Select
        label="Workspace"
        value={workspaceId}
        onChange={setWorkspaceId}
        options={[
          { value: "", label: "No workspace" },
          ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
        ]}
      />
      <Select
        label="Reports to"
        value={reportsTo}
        onChange={setReportsTo}
        options={[
          { value: "", label: "No manager" },
          ...agents.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
      <Input label="Monthly budget (USD)" value={budget} onChange={setBudget} placeholder="120" type="number" />
      <TextArea
        label="Capabilities"
        value={capabilities}
        onChange={setCapabilities}
        placeholder="What this agent does"
      />
      <p className="text-[12px] text-[color:var(--muted)]">
        New agents enter the hiring pipeline first. Approval activates the agent and keeps onboarding, budgets, and org history linked to the same record.
      </p>
      <ActionButton
        label="Submit hire request"
        tone="accent"
        onClick={() =>
          void (async () => {
            try {
              setRequestError(null);
              if (!selectedConnector) {
                setRequestError("Select an execution-ready connector before requesting a hire.");
                return;
              }
              const meta: Record<string, string> = {};
              if (thinkingEffort) meta.thinkingEffort = thinkingEffort;
              unwrap(await window.agentCompany.requestHire({
                companyId,
                requestedByAgentId: null,
                name,
                role,
                title,
                department: null,
                connectorId: connectorId as ConnectorRecord["id"],
                workspaceId: workspaceId || null,
                reportsTo: reportsTo || null,
                model: model || null,
                metadataJson: JSON.stringify(meta),
                capabilities,
                budgetMonthlyUsd: Number(budget || 0),
              }));
              setName("");
              setRole("");
              setTitle("");
              setCapabilities("");
              setReportsTo("");
              setRequestError(null);
              await onSaved();
            } catch (error) {
              setRequestError(error instanceof Error ? error.message : "Hire request failed.");
            }
          })()
        }
        icon={Robot}
        disabled={!selectedConnector}
      />
      {requestError ? <p className="text-[12px] text-[color:var(--danger)]">{requestError}</p> : null}
    </div>
  );
}
