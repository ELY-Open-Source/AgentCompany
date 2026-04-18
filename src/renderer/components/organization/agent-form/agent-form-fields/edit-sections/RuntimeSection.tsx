import type { AgentRecord, ConnectorRecord, WorkspaceRecord } from "@shared/types";
import { Select } from "../../../../ui";
import { useT } from "../../../../../i18n";
import type { AgentFormState } from "../../useAgentForm";

interface RuntimeSectionProps {
  form: AgentFormState;
  workspaces: WorkspaceRecord[];
  connectorOptions: Array<{ value: string; label: string }>;
  selectedConnectorIssue: string | null;
  pendingApproval: boolean;
  isRootAgent: boolean;
}

/**
 * How this agent runs: status + which connector/model/effort it uses +
 * which workspace. Status leads because it is the high-frequency control
 * (pause / resume / mark error); the connector/model cluster follows
 * because those change rarely. Thinking Effort stays always-visible
 * with a disabled state when the current connector's models don't
 * accept the hint — users can see the option exists.
 */
export function RuntimeSection({
  form,
  workspaces,
  connectorOptions,
  selectedConnectorIssue,
  pendingApproval,
  isRootAgent,
}: RuntimeSectionProps) {
  const t = useT();
  const showInlineEffortHint = !form.supportsEffort && !pendingApproval;

  return (
    <div className="grid gap-4">
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
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
        </div>
        {form.availableModels.length > 0 ? (
          <Select
            label={t("agent.model")}
            value={form.model}
            onChange={form.setModel}
            disabled={pendingApproval}
            options={form.availableModels.map((m) => ({ value: m.id, label: m.label }))}
          />
        ) : <div />}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
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
          {showInlineEffortHint ? (
            <p className="text-[11px] text-muted-foreground">{t("agent.form.effortNotSupported")}</p>
          ) : null}
        </div>
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
      </div>
    </div>
  );
}
