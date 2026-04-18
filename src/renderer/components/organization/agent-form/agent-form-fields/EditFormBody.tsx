import { useMemo, useState } from "react";
import type {
  AgentRecord,
  ConnectorRecord,
  WorkspaceRecord,
} from "@shared/types";
import { unwrap } from "../../../../lib/desktop";
import { buildBudgetPolicyInput } from "../../../../lib/budget-policy-input";
import { useT } from "../../../../i18n";
import { HeartbeatSection } from "../../helpers";
import type { AgentFormState } from "../useAgentForm";
import { IdentitySection } from "./edit-sections/IdentitySection";
import { RuntimeSection } from "./edit-sections/RuntimeSection";
import { ConstraintsSection } from "./edit-sections/ConstraintsSection";
import { EditActionBar } from "./edit-sections/EditActionBar";
import { SectionHeader } from "./edit-sections/SectionHeader";

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
  onCancel: () => void;
  onDeleted?: () => Promise<void>;
}

/**
 * Orchestrator for the agent Edit modal. Owns the save / wake / delete
 * side effects, the save-error latch, and the dirty-state derivation;
 * renders through five section components so each concern (identity,
 * runtime, constraints, behavior, skills) lives in a ≤200 LOC file.
 *
 * "Dirty" is computed from the form state vs. the persisted agent record
 * plus the persisted budget policy. We intentionally compare trimmed
 * strings and numeric budget so that whitespace-only edits do not falsely
 * enable Save. Root-agent guards against Delete / terminate live here
 * and are threaded into the relevant sections.
 */
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
  onCancel,
  onDeleted,
}: EditFormBodyProps) {
  const t = useT();
  const [saveError, setSaveError] = useState<string | null>(null);

  const pendingApproval = agent.status === "pending_approval";
  const isRootAgent = !agent.reportsTo;

  const isDirty = useMemo(() => {
    if (pendingApproval) return false;
    const persistedEffort =
      typeof form.existingMeta.thinkingEffort === "string"
        ? (form.existingMeta.thinkingEffort as string)
        : "";
    return (
      form.name.trim() !== agent.name ||
      form.role.trim() !== agent.role ||
      form.title.trim() !== (agent.title ?? "") ||
      (form.department || null) !== (agent.department ?? null) ||
      form.status !== agent.status ||
      form.connectorId !== agent.connectorId ||
      (form.model || null) !== (agent.model ?? null) ||
      (form.workspaceId || null) !== (agent.workspaceId ?? null) ||
      (form.reportsTo || null) !== (agent.reportsTo ?? null) ||
      Number(form.budget || 0) !== agent.budgetMonthlyUsd ||
      form.capabilities.trim() !== (agent.capabilities ?? "") ||
      form.thinkingEffort !== persistedEffort
    );
  }, [form, agent, pendingApproval]);

  async function persistAgentDraft() {
    const meta = { ...form.existingMeta };
    if (form.thinkingEffort) meta.thinkingEffort = form.thinkingEffort;
    else delete meta.thinkingEffort;

    const budgetDollars = Number(form.budget || 0);
    unwrap(
      await window.agentCompany.saveAgent({
        id: agent.id,
        companyId,
        name: form.name.trim(),
        role: form.role.trim(),
        title: form.title.trim(),
        department: form.selectedDepartment,
        status: form.status,
        connectorId: form.connectorId,
        workspaceId: form.workspaceId || null,
        reportsTo: form.reportsTo || null,
        model: form.model || null,
        metadataJson: JSON.stringify(meta),
        budgetMonthlyUsd: budgetDollars,
        capabilities: form.capabilities.trim(),
      }),
    );

    if (budgetDollars > 0 && agent.id) {
      const payload = buildBudgetPolicyInput({
        policyId: form.agentPolicy?.id ?? null,
        companyId,
        scopeType: "agent",
        scopeId: agent.id,
        amountDollars: String(budgetDollars),
        warnPercent: String(form.agentPolicy?.warnPercent ?? 80),
        hardStopEnabled: form.agentPolicy?.hardStopEnabled ?? true,
        notifyEnabled: form.agentPolicy?.notifyEnabled ?? true,
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

  async function handleDelete() {
    await window.agentCompany.deleteAgent({ id: agent.id, companyId });
    if (onDeleted) await onDeleted();
  }

  return (
    <div className="grid min-w-0 gap-6">
      <IdentitySection form={form} agent={agent} agents={agents} pendingApproval={pendingApproval} />
      <RuntimeSection
        form={form}
        agent={agent}
        workspaces={workspaces}
        connectorOptions={connectorOptions}
        selectedConnectorIssue={selectedConnectorIssue}
        pendingApproval={pendingApproval}
        isRootAgent={isRootAgent}
      />
      <ConstraintsSection form={form} agent={agent} pendingApproval={pendingApproval} />
      <SectionHeader title={t("agent.form.sectionBehavior")}>
        <HeartbeatSection
          agent={agent}
          companyId={companyId}
          pendingApproval={pendingApproval}
          persistedConnectorIssue={selectedConnectorIssue ?? persistedConnectorIssue}
          onSaved={onSaved}
          onWakeNow={() => void handleWakeNow()}
        />
      </SectionHeader>
      <EditActionBar
        agent={agent}
        pendingApproval={pendingApproval}
        isRootAgent={isRootAgent}
        isDirty={isDirty}
        selectedConnectorIssue={selectedConnectorIssue}
        saveError={saveError}
        onSave={handleSave}
        onCancel={onCancel}
        onDelete={handleDelete}
      />
    </div>
  );
}
