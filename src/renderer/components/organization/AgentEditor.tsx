import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash } from "@phosphor-icons/react";
import type { AgentRecord, ConnectorRecord, WorkspaceRecord } from "@shared/types";
import { getConnectorExecutionReadinessIssue, isConnectorExecutionReady } from "@shared/connector-policy";
import { unwrap } from "../../lib/desktop";
import { ActionButton, Input, Select, TextArea } from "../ui";
import { ConfirmDelete, HeartbeatSection } from "./helpers";

export function AgentEditor({
  agent,
  connectors,
  workspaces,
  agents,
  companyId,
  onSaved,
  onDeleted,
}: {
  agent: AgentRecord;
  connectors: ConnectorRecord[];
  workspaces: WorkspaceRecord[];
  agents: AgentRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [title, setTitle] = useState(agent.title);
  const [status, setStatus] = useState<AgentRecord["status"]>(agent.status);
  const [connectorId, setConnectorId] = useState<ConnectorRecord["id"]>(agent.connectorId);
  const [model, setModel] = useState(agent.model ?? "");
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; label: string }>>([]);
  const [workspaceId, setWorkspaceId] = useState(agent.workspaceId ?? "");
  const [budget, setBudget] = useState(String(agent.budgetMonthlyUsd));
  const [capabilities, setCapabilities] = useState(agent.capabilities);
  const [reportsTo, setReportsTo] = useState(agent.reportsTo ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const existingMeta = useMemo(() => { try { return JSON.parse(agent.metadataJson || "{}"); } catch { return {}; } }, [agent.metadataJson]);
  const [thinkingEffort, setThinkingEffort] = useState<string>(existingMeta.thinkingEffort ?? "");
  const supportsEffort = connectorId === "claude_local" || connectorId === "codex_local";
  const pendingApproval = agent.status === "pending_approval";
  const executionReadyConnectors = useMemo(
    () => connectors.filter((connector) => isConnectorExecutionReady(connector)),
    [connectors],
  );
  const selectedConnectorRecord = connectors.find((connector) => connector.id === connectorId) ?? null;
  const selectedConnectorIssue = selectedConnectorRecord ? getConnectorExecutionReadinessIssue(selectedConnectorRecord) : "Select a connector.";
  const persistedConnectorRecord = connectors.find((connector) => connector.id === agent.connectorId) ?? null;
  const persistedConnectorIssue = persistedConnectorRecord ? getConnectorExecutionReadinessIssue(persistedConnectorRecord) : "Current connector is unavailable.";
  const connectorOptions = useMemo(() => {
    const readyOptions = executionReadyConnectors.map((connector) => ({ value: connector.id, label: connector.label }));
    if (!selectedConnectorRecord || isConnectorExecutionReady(selectedConnectorRecord)) {
      return readyOptions;
    }
    return [
      { value: selectedConnectorRecord.id, label: `${selectedConnectorRecord.label} (current, blocked)` },
      ...readyOptions.filter((option) => option.value !== selectedConnectorRecord.id),
    ];
  }, [executionReadyConnectors, selectedConnectorRecord]);

  useEffect(() => {
    void (async () => {
      const result = await window.agentCompany.listConnectorModels(connectorId);
      if (result.ok) {
        setAvailableModels(result.data);
        if (connectorId !== agent.connectorId) {
          setModel(result.data[0]?.id ?? "");
        }
      }
    })();
    if (connectorId !== "claude_local" && connectorId !== "codex_local") {
      setThinkingEffort("");
    }
  }, [connectorId, agent.connectorId]);

  const managerCandidates = agents.filter((a) => a.id !== agent.id);

  return (
    <div className="grid gap-4">
      <Input label="Agent name" value={name} onChange={setName} placeholder="Agent name" readOnly={pendingApproval} disabled={pendingApproval} />
      <Input label="Role" value={role} onChange={setRole} placeholder="Role" readOnly={pendingApproval} disabled={pendingApproval} />
      <Input label="Title" value={title} onChange={setTitle} placeholder="Title" readOnly={pendingApproval} disabled={pendingApproval} />
      <Select
        label="Status"
        value={status}
        onChange={(v) => setStatus(v as AgentRecord["status"])}
        disabled={pendingApproval}
        options={pendingApproval
          ? [{ value: "pending_approval", label: "Pending Approval" }]
          : [
            { value: "idle", label: "Idle" },
            { value: "active", label: "Active" },
            { value: "running", label: "Running" },
            { value: "paused", label: "Paused" },
            { value: "error", label: "Error" },
            { value: "terminated", label: "Terminated" },
          ]}
      />
      {pendingApproval ? (
        <p className="text-[12px] text-[color:var(--muted)]">
          Pending hires must be approved or rejected from Hiring or Approvals. Status changes are intentionally locked here.
        </p>
      ) : null}
      <Select
        label="Connector"
        value={connectorId}
        onChange={(v) => setConnectorId(v as ConnectorRecord["id"])}
        disabled={pendingApproval}
        options={connectorOptions}
      />
      {selectedConnectorIssue ? (
        <p className="text-[12px] text-[color:var(--warn)]">
          {selectedConnectorIssue}
        </p>
      ) : null}
      {availableModels.length > 0 ? (
        <Select
          label="Model"
          value={model}
          onChange={setModel}
          disabled={pendingApproval}
          options={availableModels.map((m) => ({ value: m.id, label: m.label }))}
        />
      ) : null}
      {supportsEffort ? (
        <Select
          label="Thinking effort"
          value={thinkingEffort}
          onChange={setThinkingEffort}
          disabled={pendingApproval}
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
        disabled={pendingApproval}
        options={[
          { value: "", label: "No workspace" },
          ...workspaces.map((w) => ({ value: w.id, label: w.name })),
        ]}
      />
      <Select
        label="Reports to"
        value={reportsTo}
        onChange={setReportsTo}
        disabled={pendingApproval}
        options={[
          { value: "", label: "No manager" },
          ...managerCandidates.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
      <Input label="Monthly budget (USD)" value={budget} onChange={setBudget} placeholder="120" type="number" readOnly={pendingApproval} disabled={pendingApproval} />
      <TextArea label="Capabilities" value={capabilities} onChange={setCapabilities} placeholder="Capabilities" readOnly={pendingApproval} disabled={pendingApproval} />

      <HeartbeatSection agent={agent} companyId={companyId} pendingApproval={pendingApproval} persistedConnectorIssue={persistedConnectorIssue} onSaved={onSaved} />

      <div className="flex items-center gap-3">
        <ActionButton
          label="Save changes"
          tone="accent"
          icon={Pencil}
          disabled={pendingApproval || !!selectedConnectorIssue}
          onClick={() =>
            void (async () => {
              setSaveError(null);
              const meta = { ...existingMeta };
              if (thinkingEffort) meta.thinkingEffort = thinkingEffort;
              else delete meta.thinkingEffort;
              try {
                unwrap(await window.agentCompany.saveAgent({
                  id: agent.id,
                  companyId,
                  name,
                  role,
                  title,
                  status,
                  connectorId,
                  workspaceId: workspaceId || null,
                  reportsTo: reportsTo || null,
                  model: model || null,
                  metadataJson: JSON.stringify(meta),
                  budgetMonthlyUsd: Number(budget || 0),
                  capabilities,
                }));
                await onSaved();
              } catch (error) {
                setSaveError(error instanceof Error ? error.message : "Failed to save agent.");
              }
            })()
          }
        />
        {confirmingDelete ? (
          <ConfirmDelete
            entityLabel={agent.name}
            onConfirm={() =>
              void (async () => {
                await window.agentCompany.deleteAgent({ id: agent.id, companyId });
                await onDeleted();
              })()
            }
            onCancel={() => setConfirmingDelete(false)}
          />
        ) : (
          <ActionButton
            label="Delete"
            tone="danger"
            icon={Trash}
            disabled={pendingApproval}
            onClick={() => setConfirmingDelete(true)}
          />
        )}
      </div>
      {pendingApproval ? (
        <p className="text-[12px] text-[color:var(--muted)]">
          Pending hires are read-only here. Use Hiring or Approvals to approve or reject the request before editing the agent profile.
        </p>
      ) : null}
      {saveError ? <p className="text-[12px] text-[color:var(--danger)]">{saveError}</p> : null}
    </div>
  );
}
