import { useEffect, useState } from "react";
import { Pencil, Trash } from "../../../ui/icons";
import { DEPARTMENT_OPTIONS } from "@shared/constants";
import type {
  AgentRecord,
  ConnectorRecord,
  DepartmentId,
  WorkspaceRecord,
} from "@shared/types";
import { unwrap } from "../../../../lib/desktop";
import { buildBudgetPolicyInput } from "../../../../lib/budget-policy-input";
import { useAppStore } from "../../../../state/store";
import { useT } from "../../../../i18n";
import { ActionButton, Input, Select, TextArea } from "../../../ui";
import { SkillAgentToggles } from "../../../skills/SkillAgentToggles";
import { ConfirmDelete, HeartbeatSection } from "../../helpers";
import type { AgentFormState } from "../useAgentForm";

interface EditFormBodyProps {
  agent: AgentRecord;
  companyId: string;
  agents: AgentRecord[];
  workspaces: WorkspaceRecord[];
  connectors: ConnectorRecord[];
  connectorOptions: Array<{ value: string; label: string }>;
  selectedConnectorIssue: string | null;
  persistedConnectorIssue: string | null;
  form: AgentFormState;
  onSaved: () => Promise<void>;
  onDeleted?: () => Promise<void>;
}

export function EditFormBody({
  agent,
  companyId,
  agents,
  workspaces,
  connectorOptions,
  selectedConnectorIssue,
  persistedConnectorIssue,
  form,
  onSaved,
  onDeleted,
}: EditFormBodyProps) {
  const t = useT();
  const {
    name,
    setName,
    role,
    setRole,
    title,
    setTitle,
    department,
    setDepartment,
    status,
    setStatus,
    connectorId,
    setConnectorId,
    model,
    setModel,
    availableModels,
    workspaceId,
    setWorkspaceId,
    budget,
    setBudget,
    capabilities,
    setCapabilities,
    reportsTo,
    setReportsTo,
    thinkingEffort,
    setThinkingEffort,
    existingMeta,
    supportsEffort,
    selectedDepartment,
    agentPolicy,
  } = form;

  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const pendingApproval = agent.status === "pending_approval";

  const skills = useAppStore((s) => s.skills);
  const setSkills = useAppStore((s) => s.setSkills);
  useEffect(() => {
    if (skills.length === 0 && companyId) {
      window.agentCompany.listSkills(companyId).then((result) => {
        if (result.ok) setSkills(result.data);
      });
    }
  }, [companyId, skills.length, setSkills]);

  const managerCandidates = agents.filter((a) => a.id !== agent.id);

  async function persistAgentDraft() {
    const meta = { ...existingMeta };
    if (thinkingEffort) meta.thinkingEffort = thinkingEffort;
    else delete meta.thinkingEffort;

    const budgetDollars = Number(budget || 0);
    unwrap(
      await window.agentCompany.saveAgent({
        id: agent.id,
        companyId,
        name: name.trim(),
        role: role.trim(),
        title: title.trim(),
        department: selectedDepartment,
        status,
        connectorId,
        workspaceId: workspaceId || null,
        reportsTo: reportsTo || null,
        model: model || null,
        metadataJson: JSON.stringify(meta),
        budgetMonthlyUsd: budgetDollars,
        capabilities: capabilities.trim(),
      }),
    );

    if (budgetDollars > 0 && agent.id) {
      const payload = buildBudgetPolicyInput({
        policyId: agentPolicy?.id ?? null,
        companyId,
        scopeType: "agent",
        scopeId: agent.id,
        amountDollars: String(budgetDollars),
        warnPercent: String(agentPolicy?.warnPercent ?? 80),
        hardStopEnabled: agentPolicy?.hardStopEnabled ?? true,
        notifyEnabled: agentPolicy?.notifyEnabled ?? true,
      });
      if (!payload) {
        throw new Error(t("agent.form.budgetPolicyInvalid"));
      }
      unwrap(await window.agentCompany.saveBudgetPolicy(payload));
    }
  }

  async function handleWakeNow() {
    setSaveError(null);
    try {
      await persistAgentDraft();
      unwrap(
        await window.agentCompany.triggerHeartbeat({
          agentId: agent.id,
          companyId,
          trigger: "manual",
        }),
      );
      await onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("agent.form.wakeFailed"));
    }
  }

  async function handleSave() {
    setSaveError(null);
    try {
      await persistAgentDraft();
      await onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("agent.form.saveFailed"));
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <Input
        label={t("agent.name")}
        value={name}
        onChange={setName}
        placeholder={t("agent.name")}
        readOnly={pendingApproval}
        disabled={pendingApproval}
      />
      <Input
        label={t("agent.role")}
        value={role}
        onChange={setRole}
        placeholder={t("agent.role")}
        readOnly={pendingApproval}
        disabled={pendingApproval}
      />
      <Input
        label={t("agent.title")}
        value={title}
        onChange={setTitle}
        placeholder={t("agent.title")}
        readOnly={pendingApproval}
        disabled={pendingApproval}
      />
      <Select
        label={t("comm.department")}
        value={department}
        onChange={(value) => setDepartment(value as DepartmentId | "")}
        disabled={pendingApproval}
        options={DEPARTMENT_OPTIONS.map((option) => ({
          value: option.value,
          label: option.value === "" ? t("comm.selectDepartment") : option.label,
        }))}
      />
      <Select
        label={t("agent.status")}
        value={status}
        onChange={(v) => setStatus(v as AgentRecord["status"])}
        disabled={pendingApproval}
        options={
          pendingApproval
            ? [{ value: "pending_approval", label: t("agent.pendingApproval") }]
            : [
                { value: "idle", label: t("agent.form.statusIdle") },
                { value: "active", label: t("agent.form.statusActive") },
                { value: "running", label: t("agent.form.statusRunning") },
                { value: "paused", label: t("agent.form.statusPaused") },
                { value: "error", label: t("agent.form.statusError") },
                { value: "terminated", label: t("agent.form.statusTerminated") },
              ]
        }
      />
      {pendingApproval ? (
        <p className="text-[12px] text-muted-foreground">{t("agent.pendingHireNote")}</p>
      ) : null}
      <Select
        label={t("agent.connector")}
        value={connectorId}
        onChange={(v) => setConnectorId(v as ConnectorRecord["id"])}
        disabled={pendingApproval}
        options={connectorOptions}
      />
      {selectedConnectorIssue ? (
        <p className="text-[12px] text-warning">{selectedConnectorIssue}</p>
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
            { value: "", label: t("agent.form.effortDefault") },
            { value: "low", label: t("agent.form.effortLow") },
            { value: "medium", label: t("agent.form.effortMedium") },
            { value: "high", label: t("agent.form.effortHigh") },
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
      <Input
        label={t("agent.budget")}
        value={budget}
        onChange={setBudget}
        placeholder={t("agent.form.budgetPlaceholder")}
        type="number"
        readOnly={pendingApproval}
        disabled={pendingApproval}
      />
      <TextArea
        label={t("agent.capabilities")}
        value={capabilities}
        onChange={setCapabilities}
        placeholder={t("agent.capabilities")}
        readOnly={pendingApproval}
        disabled={pendingApproval}
      />

      <HeartbeatSection
        agent={agent}
        companyId={companyId}
        pendingApproval={pendingApproval}
        persistedConnectorIssue={selectedConnectorIssue ?? persistedConnectorIssue}
        onSaved={onSaved}
        onWakeNow={() => void handleWakeNow()}
      />

      <div className="mt-6 border-t border-border pt-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-primary mb-3">
          {t("agent.skills")}
        </h3>
        <SkillAgentToggles
          mode="agent"
          companyId={companyId}
          agentId={agent.id}
          skills={skills}
        />
      </div>

      <div className="flex items-center gap-3">
        <ActionButton
          label={t("agent.saveChanges")}
          tone="accent"
          icon={Pencil}
          disabled={pendingApproval || !!selectedConnectorIssue}
          onClick={() => void handleSave()}
        />
        {confirmingDelete ? (
          <ConfirmDelete
            entityLabel={agent.name}
            onConfirm={() =>
              void (async () => {
                await window.agentCompany.deleteAgent({ id: agent.id, companyId });
                if (onDeleted) await onDeleted();
              })()
            }
            onCancel={() => setConfirmingDelete(false)}
          />
        ) : (
          <ActionButton
            label={t("agent.form.delete")}
            tone="danger"
            icon={Trash}
            disabled={pendingApproval}
            onClick={() => setConfirmingDelete(true)}
          />
        )}
      </div>
      {pendingApproval ? (
        <p className="text-[12px] text-muted-foreground">
          {t("agent.form.pendingReadOnly")}
        </p>
      ) : null}
      {saveError ? <p className="text-[12px] text-destructive">{saveError}</p> : null}
    </div>
  );
}
