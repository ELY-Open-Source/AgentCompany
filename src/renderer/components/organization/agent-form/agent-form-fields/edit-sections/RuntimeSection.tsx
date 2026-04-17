import type { AgentRecord, ConnectorRecord, WorkspaceRecord } from "@shared/types";
import { Select } from "../../../../ui";
import { useT } from "../../../../../i18n";
import type { AgentFormState } from "../../useAgentForm";
import { SectionHeader } from "./SectionHeader";

interface RuntimeSectionProps {
  form: AgentFormState;
  agent: AgentRecord;
  workspaces: WorkspaceRecord[];
  connectorOptions: Array<{ value: string; label: string }>;
  selectedConnectorIssue: string | null;
  pendingApproval: boolean;
  isRootAgent: boolean;
}

/**
 * How this agent runs: which connector, which model, thinking effort,
 * which workspace, and what the current runtime status is. Status +
 * connector + model cluster together because that is what the orchestrator
 * reads when dispatching a run.
 *
 * Thinking Effort is always shown (instead of disappearing when the model
 * does not support it) so users can see the option exists — it is
 * disabled with an inline note when the selected connector's provider
 * does not accept the hint.
 */
export function RuntimeSection({
  form,
  agent,
  workspaces,
  connectorOptions,
  selectedConnectorIssue,
  pendingApproval,
  isRootAgent,
}: RuntimeSectionProps) {
  const t = useT();

  return (
    <SectionHeader title={t("agent.form.sectionRuntime")}>
      <Select
        label={t("agent.status")}
        value={form.status}
        onChange={(v) => form.setStatus(v as AgentRecord["status"])}
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
                ...(isRootAgent
                  ? []
                  : [{ value: "terminated", label: t("agent.form.statusTerminated") }]),
              ]
        }
      />
      {pendingApproval ? (
        <p className="text-[12px] text-muted-foreground">{t("agent.pendingHireNote")}</p>
      ) : null}
      {isRootAgent && !pendingApproval ? (
        <p className="text-[12px] text-muted-foreground">{t("agent.form.rootTerminateBlocked")}</p>
      ) : null}
      <Select
        label={t("agent.connector")}
        value={form.connectorId}
        onChange={(v) => form.setConnectorId(v as ConnectorRecord["id"])}
        disabled={pendingApproval}
        options={connectorOptions}
      />
      {selectedConnectorIssue ? (
        <p className="text-[12px] text-warning">{selectedConnectorIssue}</p>
      ) : null}
      {form.availableModels.length > 0 ? (
        <Select
          label={t("agent.model")}
          value={form.model}
          onChange={form.setModel}
          disabled={pendingApproval}
          options={form.availableModels.map((m) => ({ value: m.id, label: m.label }))}
        />
      ) : null}
      <Select
        label={t("agent.thinkingEffort")}
        value={form.thinkingEffort}
        onChange={form.setThinkingEffort}
        disabled={pendingApproval || !form.supportsEffort}
        options={[
          { value: "", label: t("agent.form.effortDefault") },
          { value: "low", label: t("agent.form.effortLow") },
          { value: "medium", label: t("agent.form.effortMedium") },
          { value: "high", label: t("agent.form.effortHigh") },
        ]}
      />
      {!form.supportsEffort && !pendingApproval ? (
        <p className="text-[11px] text-muted-foreground">{t("agent.form.effortNotSupported")}</p>
      ) : null}
      <Select
        label={t("agent.workspace")}
        value={form.workspaceId}
        onChange={form.setWorkspaceId}
        disabled={pendingApproval}
        options={[
          { value: "", label: t("agent.noWorkspace") },
          ...workspaces.map((w) => ({ value: w.id, label: w.name })),
        ]}
      />
      <input type="hidden" data-agent-id={agent.id} />
    </SectionHeader>
  );
}
