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

type EditTab = "identity" | "runtime" | "constraints" | "behavior";

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
 * Agent Edit modal body. Tabs replace the previous single-scroll stack
 * so a 12-field edit surface no longer forces the modal to grow tall
 * and scroll internally. Same IA pattern as the Settings page.
 *
 * Tab state is local — the modal is transient. Default is "identity"
 * because that is where users land for name/role/department edits,
 * which are the most common touches after the runtime cluster.
 *
 * Dirty-state and save/wake/delete handlers stay in this orchestrator;
 * each tab renders a pure-body section component that receives form
 * state + computed flags via props.
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
  const [activeTab, setActiveTab] = useState<EditTab>("identity");

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

  const tabs: Array<{ id: EditTab; label: string }> = [
    { id: "identity", label: t("agent.form.sectionIdentity") },
    { id: "runtime", label: t("agent.form.sectionRuntime") },
    { id: "constraints", label: t("agent.form.sectionConstraints") },
    { id: "behavior", label: t("agent.form.sectionBehavior") },
  ];

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
    <div className="grid min-w-0 gap-5">
      <nav
        role="tablist"
        aria-label={t("agent.form.tabsAria")}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-4 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {active ? (
                <span aria-hidden="true" className="absolute inset-x-2 bottom-[-1px] h-[2px] bg-primary" />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div>
        {activeTab === "identity" ? (
          <IdentitySection form={form} agent={agent} agents={agents} pendingApproval={pendingApproval} />
        ) : null}
        {activeTab === "runtime" ? (
          <RuntimeSection
            form={form}
            workspaces={workspaces}
            connectorOptions={connectorOptions}
            selectedConnectorIssue={selectedConnectorIssue}
            pendingApproval={pendingApproval}
            isRootAgent={isRootAgent}
          />
        ) : null}
        {activeTab === "constraints" ? (
          <ConstraintsSection form={form} agent={agent} pendingApproval={pendingApproval} />
        ) : null}
        {activeTab === "behavior" ? (
          <HeartbeatSection
            agent={agent}
            companyId={companyId}
            pendingApproval={pendingApproval}
            persistedConnectorIssue={selectedConnectorIssue ?? persistedConnectorIssue}
            onSaved={onSaved}
            onWakeNow={() => void handleWakeNow()}
          />
        ) : null}
      </div>

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
