import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle,
  Heartbeat,
  Kanban,
  Lightning,
  Pencil,
  Robot,
  Target,
  Trash,
  XCircle,
} from "@phosphor-icons/react";
import type {
  AgentRecord,
  ConnectorRecord,
  GoalRecord,
  ProjectRecord,
  WorkspaceRecord,
} from "@shared/types";
import { getConnectorExecutionReadinessIssue, isConnectorExecutionReady } from "@shared/connector-policy";
import { formatMoney, formatTime, getAgentInitials } from "../lib/formatters";
import { unwrap } from "../lib/desktop";
import {
  ActionButton,
  EmptyState,
  Input,
  ListFrame,
  ListRow,
  Select,
  StatusPill,
  TextArea,
} from "./ui";
import { useT } from "../i18n";

function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const overBudget = spent > budget && budget > 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[color:var(--line)]">
        <div
          className={`h-full rounded-full transition-all ${overBudget ? "bg-[color:var(--danger)]" : "bg-[color:var(--success)]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[11px] ${overBudget ? "text-[color:var(--danger)]" : "text-[color:var(--muted)]"}`}>
        {formatMoney(spent)} / {formatMoney(budget)}
      </span>
    </div>
  );
}

function ConfirmDelete({
  entityLabel,
  onConfirm,
  onCancel,
}: {
  entityLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[8px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3">
      <span className="text-[13px] text-[color:var(--danger)]">Delete {entityLabel}?</span>
      <ActionButton label="Yes, delete" tone="danger" onClick={onConfirm} icon={Trash} />
      <ActionButton label="Cancel" onClick={onCancel} icon={XCircle} />
    </div>
  );
}

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
        placeholder="What this agent is expected to do and when it becomes relevant."
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
        // Only reset model when connector changes, not on initial load
        if (connectorId !== agent.connectorId) {
          setModel(result.data[0]?.id ?? "");
        }
      }
    })();
    if (connectorId !== "claude_local" && connectorId !== "codex_local") {
      setThinkingEffort("");
    }
  }, [connectorId, agent.connectorId]);

  // Exclude self from the "reports to" list to avoid cycles
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

      {/* Heartbeat / Continuous Execution */}
      <div className="rounded-lg border border-[color:var(--line)] p-3">
        <div className="mb-2 flex items-center gap-2">
          <Heartbeat size={16} className="text-[color:var(--accent)]" />
          <span className="text-[13px] font-semibold text-[color:var(--text)]">Continuous Execution</span>
        </div>
        <div className="mb-2 flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={agent.heartbeatEnabled}
              disabled={pendingApproval}
              onChange={(e) =>
                void (async () => {
                  await window.agentCompany.setHeartbeat({
                    agentId: agent.id,
                    companyId,
                    enabled: e.target.checked,
                    intervalSec: agent.heartbeatIntervalSec || 120,
                  });
                  await onSaved();
                })()
              }
              className="h-4 w-4 rounded border-[color:var(--line)] accent-[color:var(--accent)]"
            />
            <span className="text-[13px] text-[color:var(--text)]">Enable heartbeat</span>
          </label>
          {agent.heartbeatEnabled && (
            <span className="text-[11px] text-[color:var(--muted)]">
              Every {agent.heartbeatIntervalSec}s
              {agent.lastHeartbeatAt ? ` · Last: ${formatTime(agent.lastHeartbeatAt)}` : ""}
            </span>
          )}
        </div>
        {agent.heartbeatEnabled && (
          <Select
            label="Interval"
            value={String(agent.heartbeatIntervalSec)}
            onChange={(v) =>
              void (async () => {
                await window.agentCompany.setHeartbeat({
                  agentId: agent.id,
                  companyId,
                  enabled: true,
                  intervalSec: Number(v),
                });
                await onSaved();
              })()
            }
            disabled={pendingApproval}
            options={[
              { value: "30", label: "30 seconds" },
              { value: "60", label: "1 minute" },
              { value: "120", label: "2 minutes" },
              { value: "300", label: "5 minutes" },
              { value: "600", label: "10 minutes" },
              { value: "1800", label: "30 minutes" },
              { value: "3600", label: "1 hour" },
            ]}
          />
        )}
        <div className="mt-2">
          <ActionButton
            label="Wake now"
            tone="accent"
            icon={Lightning}
            disabled={pendingApproval || !!persistedConnectorIssue}
            onClick={() =>
              void (async () => {
                await window.agentCompany.triggerHeartbeat({
                  agentId: agent.id,
                  companyId,
                  trigger: "manual",
                });
                await onSaved();
              })()
            }
          />
          {persistedConnectorIssue ? (
            <p className="mt-2 text-[12px] text-[color:var(--warn)]">
              {persistedConnectorIssue} Save a ready connector before waking this agent again.
            </p>
          ) : null}
        </div>
      </div>

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

export function GoalList({
  goals,
  agents,
  selectedGoalId,
  onSelect,
}: {
  goals: GoalRecord[];
  agents: AgentRecord[];
  selectedGoalId: string | null;
  onSelect: (goalId: string) => void;
}) {
  const t = useT();
  if (goals.length === 0) {
    return <EmptyState title={t("org.noGoalsYet")} />;
  }
  return (
    <ListFrame>
      {goals.map((goal) => {
        const isSelected = goal.id === selectedGoalId;
        const parentGoal = goal.parentId ? goals.find((g) => g.id === goal.parentId) : null;
        const ownerAgent = goal.ownerAgentId
          ? agents.find((a) => a.id === goal.ownerAgentId)
          : null;
        return (
          <ListRow
            key={goal.id}
            onClick={() => onSelect(goal.id)}
            className={`cursor-pointer transition-colors duration-100 ${isSelected ? "bg-[color:var(--accent-soft)]" : "hover:bg-[color:var(--panel-soft)]"}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isSelected && (
                  <CheckCircle size={16} weight="fill" className="text-[color:var(--accent)]" />
                )}
                <div className="text-[15px] text-[color:var(--text)]">{goal.title}</div>
              </div>
              <StatusPill status={goal.status} />
            </div>
            <div className="text-[13px] text-[color:var(--muted)]">{goal.description}</div>
            <div className="mt-1 flex gap-4 text-[12px] text-[color:var(--muted)]">
              {parentGoal && <span>Parent: {parentGoal.title}</span>}
              {ownerAgent && <span>Owner: {ownerAgent.name}</span>}
            </div>
          </ListRow>
        );
      })}
    </ListFrame>
  );
}

export function GoalCreator({
  companyId,
  agents,
  goals,
  onSaved,
}: {
  companyId: string;
  agents: AgentRecord[];
  goals: GoalRecord[];
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerAgentId, setOwnerAgentId] = useState(agents[0]?.id ?? "");
  const [parentId, setParentId] = useState("");
  return (
    <div className="grid gap-4">
      <Input label="Goal title" value={title} onChange={setTitle} placeholder="Goal title" />
      <TextArea
        label="Success criteria"
        value={description}
        onChange={setDescription}
        placeholder="What must become true for this goal to count as achieved?"
      />
      <Select
        label="Owner agent"
        value={ownerAgentId}
        onChange={setOwnerAgentId}
        options={[
          { value: "", label: "No owner" },
          ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
        ]}
      />
      <Select
        label="Parent goal"
        value={parentId}
        onChange={setParentId}
        options={[
          { value: "", label: "No parent goal" },
          ...goals.map((g) => ({ value: g.id, label: g.title })),
        ]}
      />
      <ActionButton
        label="Create goal"
        tone="accent"
        onClick={() =>
          void (async () => {
            try {
            await window.agentCompany.saveGoal({
              companyId,
              title,
              description,
              ownerAgentId: ownerAgentId || null,
              parentId: parentId || null,
              status: "active",
            });
            setTitle("");
            setDescription("");
            await onSaved();
            } catch (error) {
              void error;
            }
          })()
        }
        icon={Target}
      />
    </div>
  );
}

export function GoalEditor({
  goal,
  goals,
  agents,
  companyId,
  onSaved,
  onDeleted,
}: {
  goal: GoalRecord;
  goals: GoalRecord[];
  agents: AgentRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description);
  const [status, setStatus] = useState<GoalRecord["status"]>(goal.status);
  const [parentId, setParentId] = useState(goal.parentId ?? "");
  const [ownerAgentId, setOwnerAgentId] = useState(goal.ownerAgentId ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Exclude self from parent list
  const parentCandidates = goals.filter((g) => g.id !== goal.id);

  return (
    <div className="grid gap-4">
      <Input label="Goal title" value={title} onChange={setTitle} placeholder="Goal title" />
      <TextArea label="Description" value={description} onChange={setDescription} placeholder="Description" />
      <Select
        label="Status"
        value={status}
        onChange={(v) => setStatus(v as GoalRecord["status"])}
        options={[
          { value: "planned", label: "Planned" },
          { value: "active", label: "Active" },
          { value: "achieved", label: "Achieved" },
          { value: "cancelled", label: "Cancelled" },
        ]}
      />
      <Select
        label="Parent goal"
        value={parentId}
        onChange={setParentId}
        options={[
          { value: "", label: "No parent goal" },
          ...parentCandidates.map((g) => ({ value: g.id, label: g.title })),
        ]}
      />
      <Select
        label="Owner agent"
        value={ownerAgentId}
        onChange={setOwnerAgentId}
        options={[
          { value: "", label: "No owner" },
          ...agents.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <ActionButton
          label="Save changes"
          tone="accent"
          icon={Pencil}
          onClick={() =>
            void (async () => {
              try {
              await window.agentCompany.saveGoal({
                id: goal.id,
                companyId,
                title,
                description,
                status,
                parentId: parentId || null,
                ownerAgentId: ownerAgentId || null,
              });
              await onSaved();
              } catch (error) {
                void error;
              }
            })()
          }
        />
        {confirmingDelete ? (
          <ConfirmDelete
            entityLabel={goal.title}
            onConfirm={() =>
              void (async () => {
                await window.agentCompany.deleteGoal({ id: goal.id, companyId });
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
            onClick={() => setConfirmingDelete(true)}
          />
        )}
      </div>
    </div>
  );
}

export function ProjectList({
  projects,
  goals,
  agents,
  workspaces,
  selectedProjectId,
  onSelect,
}: {
  projects: ProjectRecord[];
  goals: GoalRecord[];
  agents: AgentRecord[];
  workspaces: WorkspaceRecord[];
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
}) {
  const t = useT();
  if (projects.length === 0) {
    return <EmptyState title={t("org.noProjectsYet")} />;
  }
  return (
    <ListFrame>
      {projects.map((project) => {
        const isSelected = project.id === selectedProjectId;
        const wsCount = workspaces.filter((w) => w.projectId === project.id).length;
        return (
          <ListRow
            key={project.id}
            onClick={() => onSelect(project.id)}
            className={`cursor-pointer transition-colors duration-100 ${isSelected ? "bg-[color:var(--accent-soft)]" : "hover:bg-[color:var(--panel-soft)]"}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isSelected && (
                  <CheckCircle size={16} weight="fill" className="text-[color:var(--accent)]" />
                )}
                <div className="text-[15px] text-[color:var(--text)]">{project.name}</div>
              </div>
              <StatusPill status={project.status} />
            </div>
            <div className="mb-2 text-[13px] text-[color:var(--muted)]">{project.description}</div>
            <div className="flex flex-wrap gap-4 text-[12px] text-[color:var(--muted)]">
              <span>
                Goal: {goals.find((g) => g.id === project.goalId)?.title ?? "None"}
              </span>
              <span>
                Lead: {agents.find((a) => a.id === project.leadAgentId)?.name ?? "Unassigned"}
              </span>
              {project.targetDate && <span>Target: {project.targetDate}</span>}
              {wsCount > 0 && (
                <span>
                  {wsCount} workspace{wsCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </ListRow>
        );
      })}
    </ListFrame>
  );
}

export function ProjectCreator({
  companyId,
  goals,
  agents,
  onSaved,
}: {
  companyId: string;
  goals: GoalRecord[];
  agents: AgentRecord[];
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goalId, setGoalId] = useState(goals[0]?.id ?? "");
  const [leadAgentId, setLeadAgentId] = useState(agents[0]?.id ?? "");
  const [targetDate, setTargetDate] = useState("");
  return (
    <div className="grid gap-4">
      <Input label="Project name" value={name} onChange={setName} placeholder="Project name" />
      <TextArea
        label="Description"
        value={description}
        onChange={setDescription}
        placeholder="What delivery lane does this project own?"
      />
      <Select
        label="Linked goal"
        value={goalId}
        onChange={setGoalId}
        options={[
          { value: "", label: "No linked goal" },
          ...goals.map((goal) => ({ value: goal.id, label: goal.title })),
        ]}
      />
      <Select
        label="Lead agent"
        value={leadAgentId}
        onChange={setLeadAgentId}
        options={[
          { value: "", label: "No lead" },
          ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
        ]}
      />
      <Input label="Target date" value={targetDate} onChange={setTargetDate} placeholder="YYYY-MM-DD" />
      <ActionButton
        label="Create project"
        tone="accent"
        onClick={() =>
          void (async () => {
            try {
            await window.agentCompany.saveProject({
              companyId,
              goalId: goalId || null,
              name,
              description,
              leadAgentId: leadAgentId || null,
              targetDate: targetDate || null,
              status: "planned",
            });
            setName("");
            setDescription("");
            setTargetDate("");
            await onSaved();
            } catch (error) {
              void error;
            }
          })()
        }
        icon={Kanban}
      />
    </div>
  );
}

export function ProjectEditor({
  project,
  goals,
  agents,
  companyId,
  onSaved,
  onDeleted,
}: {
  project: ProjectRecord;
  goals: GoalRecord[];
  agents: AgentRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState<ProjectRecord["status"]>(project.status);
  const [goalId, setGoalId] = useState(project.goalId ?? "");
  const [leadAgentId, setLeadAgentId] = useState(project.leadAgentId ?? "");
  const [targetDate, setTargetDate] = useState(project.targetDate ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="grid gap-4">
      <Input label="Project name" value={name} onChange={setName} placeholder="Project name" />
      <TextArea label="Description" value={description} onChange={setDescription} placeholder="Description" />
      <Select
        label="Status"
        value={status}
        onChange={(v) => setStatus(v as ProjectRecord["status"])}
        options={[
          { value: "backlog", label: "Backlog" },
          { value: "planned", label: "Planned" },
          { value: "in_progress", label: "In Progress" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
        ]}
      />
      <Select
        label="Linked goal"
        value={goalId}
        onChange={setGoalId}
        options={[
          { value: "", label: "No linked goal" },
          ...goals.map((g) => ({ value: g.id, label: g.title })),
        ]}
      />
      <Select
        label="Lead agent"
        value={leadAgentId}
        onChange={setLeadAgentId}
        options={[
          { value: "", label: "No lead" },
          ...agents.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
      <Input label="Target date" value={targetDate} onChange={setTargetDate} placeholder="YYYY-MM-DD" />

      <div className="flex items-center gap-3">
        <ActionButton
          label="Save changes"
          tone="accent"
          icon={Pencil}
          onClick={() =>
            void (async () => {
              try {
              await window.agentCompany.saveProject({
                id: project.id,
                companyId,
                name,
                description,
                status,
                goalId: goalId || null,
                leadAgentId: leadAgentId || null,
                targetDate: targetDate || null,
              });
              await onSaved();
              } catch (error) {
                void error;
              }
            })()
          }
        />
        {confirmingDelete ? (
          <ConfirmDelete
            entityLabel={project.name}
            onConfirm={() =>
              void (async () => {
                await window.agentCompany.deleteProject({ id: project.id, companyId });
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
            onClick={() => setConfirmingDelete(true)}
          />
        )}
      </div>
    </div>
  );
}

const CARD_W = 220;
const CARD_H = 110;
const GAP_X = 32;
const GAP_Y = 80;
const CHART_PADDING = 60;

interface OrgTreeNode {
  agent: AgentRecord;
  children: OrgTreeNode[];
}

interface LayoutNode {
  agent: AgentRecord;
  x: number;
  y: number;
  children: LayoutNode[];
}

function buildOrgTree(agents: AgentRecord[]): OrgTreeNode[] {
  const agentIds = new Set(agents.map((a) => a.id));
  const childrenMap = new Map<string, AgentRecord[]>();
  const roots: AgentRecord[] = [];
  for (const agent of agents) {
    if (!agent.reportsTo || !agentIds.has(agent.reportsTo)) {
      roots.push(agent);
    } else {
      const list = childrenMap.get(agent.reportsTo) ?? [];
      list.push(agent);
      childrenMap.set(agent.reportsTo, list);
    }
  }
  function toNode(agent: AgentRecord): OrgTreeNode {
    const kids = childrenMap.get(agent.id) ?? [];
    return { agent, children: kids.map(toNode) };
  }
  return roots.map(toNode);
}

function subtreeWidth(node: OrgTreeNode): number {
  if (node.children.length === 0) return CARD_W;
  const childrenW = node.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
  const gaps = (node.children.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

function layoutTree(node: OrgTreeNode, x: number, y: number): LayoutNode {
  const totalW = subtreeWidth(node);
  const layoutChildren: LayoutNode[] = [];
  if (node.children.length > 0) {
    const childrenW = node.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
    const gaps = (node.children.length - 1) * GAP_X;
    let cx = x + (totalW - childrenW - gaps) / 2;
    for (const child of node.children) {
      const cw = subtreeWidth(child);
      layoutChildren.push(layoutTree(child, cx, y + CARD_H + GAP_Y));
      cx += cw + GAP_X;
    }
  }
  return { agent: node.agent, x: x + (totalW - CARD_W) / 2, y, children: layoutChildren };
}

function layoutForest(roots: OrgTreeNode[]): LayoutNode[] {
  let x = CHART_PADDING;
  return roots.map((root) => {
    const w = subtreeWidth(root);
    const node = layoutTree(root, x, CHART_PADDING);
    x += w + GAP_X;
    return node;
  });
}

function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function walk(n: LayoutNode) { result.push(n); n.children.forEach(walk); }
  nodes.forEach(walk);
  return result;
}

function collectEdges(nodes: LayoutNode[]): Array<{ parent: LayoutNode; child: LayoutNode }> {
  const edges: Array<{ parent: LayoutNode; child: LayoutNode }> = [];
  function walk(n: LayoutNode) { for (const c of n.children) { edges.push({ parent: n, child: c }); walk(c); } }
  nodes.forEach(walk);
  return edges;
}

const statusDotColor: Record<string, string> = {
  running: "#22d3ee",
  active: "#4ade80",
  paused: "#facc15",
  idle: "#facc15",
  error: "#f87171",
  terminated: "#a3a3a3",
};

const adapterLabels: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  gemini_local: "Gemini",
  opencode_local: "OpenCode",
  kimi_local: "Kimi",
};

export function OrgChart({
  agents,
  onSelectAgent,
}: {
  agents: AgentRecord[];
  onSelectAgent?: (agentId: string) => void;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const orgTree = useMemo(() => buildOrgTree(agents), [agents]);
  const layout = useMemo(() => layoutForest(orgTree), [orgTree]);
  const allNodes = useMemo(() => flattenLayout(layout), [layout]);
  const edges = useMemo(() => collectEdges(layout), [layout]);
  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { width: 800, height: 600 };
    let maxX = 0, maxY = 0;
    for (const n of allNodes) { maxX = Math.max(maxX, n.x + CARD_W); maxY = Math.max(maxY, n.y + CARD_H); }
    return { width: maxX + CHART_PADDING, height: maxY + CHART_PADDING };
  }, [allNodes]);

  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current || allNodes.length === 0 || !containerRef.current) return;
    hasInitialized.current = true;
    const cW = containerRef.current.clientWidth;
    const cH = containerRef.current.clientHeight;
    const scaleX = (cW - 40) / bounds.width;
    const scaleY = (cH - 40) / bounds.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);
    const chartW = bounds.width * fitZoom;
    const chartH = bounds.height * fitZoom;
    setZoom(fitZoom);
    setPan({ x: (cW - chartW) / 2, y: (cH - chartH) / 2 });
  }, [allNodes, bounds]);

  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return;
    const cW = containerRef.current.clientWidth;
    const cH = containerRef.current.clientHeight;
    const scaleX = (cW - 40) / bounds.width;
    const scaleY = (cH - 40) / bounds.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);
    const chartW = bounds.width * fitZoom;
    const chartH = bounds.height * fitZoom;
    setZoom(fitZoom);
    setPan({ x: (cW - chartW) / 2, y: (cH - chartH) / 2 });
  }, [bounds]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-org-card]")) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: dragStart.current.panX + (e.clientX - dragStart.current.x), y: dragStart.current.panY + (e.clientY - dragStart.current.y) });
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(Math.max(zoom * factor, 0.2), 2);
    const scale = newZoom / zoom;
    setPan({ x: mouseX - scale * (mouseX - pan.x), y: mouseY - scale * (mouseY - pan.y) });
    setZoom(newZoom);
  }, [zoom, pan]);

  if (agents.length === 0) {
    return <EmptyState title={t("org.noAgentsToDisplay")} />;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-[480px] w-full overflow-hidden rounded-[10px] border border-[color:var(--line)] bg-[color:var(--bg)]"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Zoom controls */}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
        {[
          { label: "+", ariaLabel: "Zoom in", action: () => { const nz = Math.min(zoom * 1.2, 2); const c = containerRef.current; if (c) { const cx = c.clientWidth / 2; const cy = c.clientHeight / 2; const s = nz / zoom; setPan({ x: cx - s * (cx - pan.x), y: cy - s * (cy - pan.y) }); } setZoom(nz); } },
          { label: "\u2212", ariaLabel: "Zoom out", action: () => { const nz = Math.max(zoom * 0.8, 0.2); const c = containerRef.current; if (c) { const cx = c.clientWidth / 2; const cy = c.clientHeight / 2; const s = nz / zoom; setPan({ x: cx - s * (cx - pan.x), y: cy - s * (cy - pan.y) }); } setZoom(nz); } },
          { label: "Fit", ariaLabel: "Fit chart to screen", action: fitToScreen },
        ].map((btn) => (
          <button
            key={btn.ariaLabel}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel)] text-[12px] text-[color:var(--text)] transition hover:bg-[color:var(--panel-soft)]"
            onClick={btn.action}
            aria-label={btn.ariaLabel}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* SVG edges */}
      <svg className="pointer-events-none absolute inset-0" style={{ width: "100%", height: "100%" }}>
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {edges.map(({ parent, child }) => {
            const x1 = parent.x + CARD_W / 2;
            const y1 = parent.y + CARD_H;
            const x2 = child.x + CARD_W / 2;
            const y2 = child.y;
            const midY = (y1 + y2) / 2;
            const isChildRunning = child.agent.status === "running";
            return (
              <path
                key={`${parent.agent.id}-${child.agent.id}`}
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                stroke={isChildRunning ? "var(--success)" : "var(--line-strong)"}
                strokeWidth={isChildRunning ? 2 : 1.5}
                strokeDasharray={isChildRunning ? "6 3" : "none"}
                opacity={isChildRunning ? 0.8 : 0.5}
              />
            );
          })}
        </g>
      </svg>

      {/* Card layer */}
      <div
        className="absolute inset-0"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
      >
        {allNodes.map((node) => {
          const dotColor = statusDotColor[node.agent.status] ?? "#a3a3a3";
          const connectorLabel = adapterLabels[node.agent.connectorId] ?? node.agent.connectorId;
          const initials = getAgentInitials(node.agent.name);
          const isRunning = node.agent.status === "running";
          const isActive = node.agent.status === "active" || isRunning;
          const isError = node.agent.status === "error";
          const isPending = node.agent.status === "pending_approval";
          const isCEO = node.children.length > 0 && !node.agent.reportsTo;
          return (
            <div
              key={node.agent.id}
              data-org-card
              className={`absolute cursor-pointer select-none rounded-[10px] border bg-[color:var(--panel)] shadow-sm transition-all duration-200 hover:shadow-lg ${
                isRunning ? "border-[color:var(--success)] shadow-[0_0_12px_rgba(74,222,128,0.15)]" :
                isError ? "border-[color:var(--danger)] border-opacity-50" :
                isPending ? "border-[color:var(--warn)] border-dashed" :
                "border-[color:var(--line)] hover:border-[color:var(--line-strong)]"
              }`}
              style={{ left: node.x, top: node.y, width: CARD_W, minHeight: CARD_H }}
              onClick={() => onSelectAgent?.(node.agent.id)}
            >
              {/* Top accent bar for role hierarchy */}
              <div className={`h-[3px] rounded-t-[9px] ${
                isCEO ? "bg-[color:var(--accent)]" :
                node.children.length > 0 ? "bg-[color:var(--warn)]" :
                "bg-[color:var(--muted)] opacity-30"
              }`} />
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="relative shrink-0">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-bold ${
                    isActive ? "bg-[color:var(--success-soft)] text-[color:var(--success)]" :
                    isError ? "bg-[color:var(--danger-soft)] text-[color:var(--danger)]" :
                    "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)]"
                  }`}>
                    {initials}
                  </div>
                  {isRunning ? (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40" style={{ backgroundColor: dotColor }} />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-[color:var(--panel)]" style={{ backgroundColor: dotColor }} />
                    </span>
                  ) : (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[color:var(--panel)]"
                      style={{ backgroundColor: dotColor }}
                    />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="text-[13px] font-semibold leading-tight text-[color:var(--text)]">{node.agent.name}</span>
                  <span className="mt-0.5 text-[11px] leading-tight text-[color:var(--muted)]">
                    {node.agent.title || node.agent.role}
                  </span>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="rounded bg-[color:var(--panel-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
                      {connectorLabel}
                    </span>
                    {node.agent.heartbeatEnabled ? (
                      <Heartbeat size={10} className="text-[color:var(--success)]" />
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
