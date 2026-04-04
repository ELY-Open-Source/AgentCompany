import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash } from "@phosphor-icons/react";
import type { AgentRecord, BudgetPolicyRecord, ConnectorRecord, WorkspaceRecord } from "@shared/types";
import { getConnectorExecutionReadinessIssue, isConnectorExecutionReady } from "@shared/connector-policy";
import { unwrap } from "../../lib/desktop";
import { useAppStore } from "../../state/store";
import { useT } from "../../i18n";
import { ActionButton, Input, Select, TextArea } from "../ui";
import { SkillAgentToggles } from "../skills/SkillAgentToggles";
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
  const t = useT();
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
    const getDisplayLabel = (c: typeof connectors[number]) =>
      c.id.startsWith("claude_compat") && c.notes ? c.notes : c.label;
    const readyOptions = executionReadyConnectors.map((connector) => ({ value: connector.id, label: getDisplayLabel(connector) }));
    if (!selectedConnectorRecord || isConnectorExecutionReady(selectedConnectorRecord)) {
      return readyOptions;
    }
    return [
      { value: selectedConnectorRecord.id, label: `${getDisplayLabel(selectedConnectorRecord)} (current, blocked)` },
      ...readyOptions.filter((option) => option.value !== selectedConnectorRecord.id),
    ];
  }, [executionReadyConnectors, selectedConnectorRecord]);

  useEffect(() => {
    if (connectorId.startsWith("claude_compat")) {
      // Parse comma-separated user-configured models
      const compat = connectors.find((c) => c.id === connectorId);
      const raw = compat?.model ?? "";
      const models = raw.split(",").map((m) => m.trim()).filter(Boolean).map((m) => ({ id: m, label: m }));
      setAvailableModels(models);
      if (connectorId !== agent.connectorId && models.length > 0) {
        setModel(models[0].id);
      }
    } else {
      void (async () => {
        const result = await window.agentCompany.listConnectorModels(connectorId);
        if (result.ok) {
          setAvailableModels(result.data);
          if (connectorId !== agent.connectorId) {
            setModel(result.data[0]?.id ?? "");
          }
        }
      })();
    }
    if (connectorId !== "claude_local" && !connectorId.startsWith("claude_compat") && connectorId !== "codex_local") {
      setThinkingEffort("");
    }
  }, [connectorId, agent.connectorId, connectors]);

  const skills = useAppStore((s) => s.skills);
  const setSkills = useAppStore((s) => s.setSkills);

  useEffect(() => {
    if (skills.length === 0 && companyId) {
      window.agentCompany.listSkills(companyId).then((result) => {
        if (result.ok) setSkills(result.data);
      });
    }
  }, [companyId, skills.length, setSkills]);

  // Load agent's budget policy (D-11: read from budget_policies)
  const [agentPolicy, setAgentPolicy] = useState<BudgetPolicyRecord | null>(null);
  useEffect(() => {
    void (async () => {
      const result = await window.agentCompany.listBudgetPolicies(companyId);
      if (result.ok) {
        const policy = result.data.find(
          (p) => p.scopeType === "agent" && p.scopeId === agent.id
        );
        if (policy) {
          setAgentPolicy(policy);
          setBudget(String((policy.amount / 100).toFixed(2)));
        }
      }
    })();
  }, [companyId, agent.id]);

  const managerCandidates = agents.filter((a) => a.id !== agent.id);

  async function persistAgentDraft() {
    const meta = { ...existingMeta };
    if (thinkingEffort) meta.thinkingEffort = thinkingEffort;
    else delete meta.thinkingEffort;

    const budgetDollars = Number(budget || 0);
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
      budgetMonthlyUsd: budgetDollars,
      capabilities,
    }));

    if (budgetDollars > 0 && agent.id) {
      await window.agentCompany.saveBudgetPolicy({
        companyId,
        scopeType: "agent",
        scopeId: agent.id,
        metric: "billed_cents",
        windowKind: "calendar_month_utc",
        amount: Math.round(budgetDollars * 100),
        warnPercent: agentPolicy?.warnPercent ?? 80,
        hardStopEnabled: agentPolicy?.hardStopEnabled ?? true,
        notifyEnabled: agentPolicy?.notifyEnabled ?? true,
        isActive: true,
      });
    }
  }

  async function handleWakeNow() {
    setSaveError(null);
    try {
      await persistAgentDraft();
      unwrap(await window.agentCompany.triggerHeartbeat({ agentId: agent.id, companyId, trigger: "manual" }));
      await onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to wake agent.");
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <Input label={t("agent.name")} value={name} onChange={setName} placeholder={t("agent.name")} readOnly={pendingApproval} disabled={pendingApproval} />
      <Input label={t("agent.role")} value={role} onChange={setRole} placeholder={t("agent.role")} readOnly={pendingApproval} disabled={pendingApproval} />
      <Input label={t("agent.title")} value={title} onChange={setTitle} placeholder={t("agent.title")} readOnly={pendingApproval} disabled={pendingApproval} />
      <Select
        label={t("agent.status")}
        value={status}
        onChange={(v) => setStatus(v as AgentRecord["status"])}
        disabled={pendingApproval}
        options={pendingApproval
          ? [{ value: "pending_approval", label: t("agent.pendingApproval") }]
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
        <p className="text-[12px] text-muted-foreground">
          {t("agent.pendingHireNote")}
        </p>
      ) : null}
      <Select
        label={t("agent.connector")}
        value={connectorId}
        onChange={(v) => setConnectorId(v as ConnectorRecord["id"])}
        disabled={pendingApproval}
        options={connectorOptions}
      />
      {selectedConnectorIssue ? (
        <p className="text-[12px] text-warning">
          {selectedConnectorIssue}
        </p>
      ) : null}
      {availableModels.length > 0 ? (
        <Select
          label={t("agent.model")}
          value={model}
          onChange={setModel}
          disabled={pendingApproval}
          options={availableModels.map((m) => ({ value: m.id, label: m.label }))}
        />
      ) : null}
      {supportsEffort ? (
        <Select
          label={t("agent.thinkingEffort")}
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
        label={t("agent.workspace")}
        value={workspaceId}
        onChange={setWorkspaceId}
        disabled={pendingApproval}
        options={[
          { value: "", label: t("agent.noWorkspace") },
          ...workspaces.map((w) => ({ value: w.id, label: w.name })),
        ]}
      />
      <Select
        label={t("agent.reportsTo")}
        value={reportsTo}
        onChange={setReportsTo}
        disabled={pendingApproval}
        options={[
          { value: "", label: t("agent.noManager") },
          ...managerCandidates.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
      <Input label={t("agent.budget")} value={budget} onChange={setBudget} placeholder="120" type="number" readOnly={pendingApproval} disabled={pendingApproval} />
      <TextArea label={t("agent.capabilities")} value={capabilities} onChange={setCapabilities} placeholder={t("agent.capabilities")} readOnly={pendingApproval} disabled={pendingApproval} />

      <HeartbeatSection
        agent={agent}
        companyId={companyId}
        pendingApproval={pendingApproval}
        persistedConnectorIssue={selectedConnectorIssue ?? persistedConnectorIssue}
        onSaved={onSaved}
        onWakeNow={() => void handleWakeNow()}
      />

      {/* Skills section (D-04 dual access) */}
      <div className="mt-6 border-t border-border pt-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-primary mb-3">{t("agent.skills")}</h3>
        <SkillAgentToggles mode="agent" companyId={companyId} agentId={agent.id} skills={skills} />
      </div>

      <div className="flex items-center gap-3">
        <ActionButton
          label={t("agent.saveChanges")}
          tone="accent"
          icon={Pencil}
          disabled={pendingApproval || !!selectedConnectorIssue}
          onClick={() =>
            void (async () => {
              setSaveError(null);
              try {
                await persistAgentDraft();
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
        <p className="text-[12px] text-muted-foreground">
          Pending hires are read-only here. Use Hiring or Approvals to approve or reject the request before editing the agent profile.
        </p>
      ) : null}
      {saveError ? <p className="text-[12px] text-destructive">{saveError}</p> : null}
    </div>
  );
}
