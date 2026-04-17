import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Robot } from "../../../ui/icons";
import { DEPARTMENT_OPTIONS } from "@shared/constants";
import type {
  AgentRecord,
  ConnectorRecord,
  DepartmentId,
  WorkspaceRecord,
} from "@shared/types";
import { unwrap } from "../../../../lib/desktop";
import { useT } from "../../../../i18n";
import { ActionButton, Input, Select, TextArea } from "../../../ui";
import type { AgentFormState } from "../useAgentForm";

interface CreateFormBodyProps {
  companyId: string;
  agents: AgentRecord[];
  workspaces: WorkspaceRecord[];
  connectorOptions: Array<{ value: string; label: string }>;
  form: AgentFormState;
  onSaved: () => Promise<void>;
}

export function CreateFormBody({
  companyId,
  agents,
  workspaces,
  connectorOptions,
  form,
  onSaved,
}: CreateFormBodyProps) {
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
    supportsEffort,
    executionReadyConnectors,
    selectedConnectorRecord,
    selectedDepartment,
  } = form;

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function handleCreate() {
    try {
      setRequestError(null);
      if (!selectedConnectorRecord) {
        setRequestError(t("org.selectConnectorFirst"));
        return;
      }
      const meta: Record<string, string> = {};
      if (thinkingEffort) meta.thinkingEffort = thinkingEffort;
      unwrap(
        await window.agentCompany.requestHire({
          companyId,
          requestedByAgentId: null,
          name: name.trim(),
          role: role.trim(),
          title: title.trim(),
          department: selectedDepartment,
          connectorId: connectorId as ConnectorRecord["id"],
          workspaceId: workspaceId || null,
          reportsTo: reportsTo || null,
          model: model || null,
          metadataJson: JSON.stringify(meta),
          capabilities: capabilities.trim(),
          budgetMonthlyUsd: Number(budget || 0),
        }),
      );
      setName("");
      setRole("");
      setTitle("");
      setDepartment("");
      setCapabilities("");
      setReportsTo("");
      setRequestError(null);
      await onSaved();
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : t("org.hireRequestFailed"),
      );
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <Input
        label={t("org.agentName")}
        value={name}
        onChange={setName}
        placeholder={t("org.agentName")}
        hint="Display name shown in org chart and messages"
      />
      <Input
        label={t("agent.role")}
        value={role}
        onChange={setRole}
        placeholder="e.g. Engineer, PM, CEO"
        hint="Determines which tasks the agent can handle"
      />
      <Input
        label={t("agent.title")}
        value={title}
        onChange={setTitle}
        placeholder={t("agent.title")}
        hint="Job title shown under the name"
      />
      <Select
        label={t("org.connector")}
        value={connectorId}
        onChange={(value) => setConnectorId(value as ConnectorRecord["id"])}
        options={connectorOptions}
      />
      {executionReadyConnectors.length === 0 ? (
        <p className="text-[12px] text-warning">{t("org.noConnectorAvailable")}</p>
      ) : null}
      {availableModels.length > 0 ? (
        <Select
          label={t("org.model")}
          value={model}
          onChange={setModel}
          options={availableModels.map((m) => ({ value: m.id, label: m.label }))}
        />
      ) : null}
      {supportsEffort ? (
        <Select
          label={t("org.thinkingEffort")}
          value={thinkingEffort}
          onChange={setThinkingEffort}
          options={[
            { value: "", label: t("org.default") },
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]}
        />
      ) : null}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}
        >
          <path
            d="M3 1l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        {t("org.advancedSettings")}
      </button>
      <AnimatePresence>
        {showAdvanced ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="grid gap-4 overflow-hidden"
          >
            <Select
              label={t("comm.department")}
              value={department}
              onChange={(value) => setDepartment(value as DepartmentId | "")}
              options={DEPARTMENT_OPTIONS.map((option) => ({
                value: option.value,
                label:
                  option.value === "" ? t("comm.selectDepartment") : option.label,
              }))}
            />
            <Select
              label={t("agent.workspace")}
              value={workspaceId}
              onChange={setWorkspaceId}
              options={[
                { value: "", label: t("agent.noWorkspace") },
                ...workspaces.map((workspace) => ({
                  value: workspace.id,
                  label: workspace.name,
                })),
              ]}
            />
            <Select
              label={t("agent.reportsTo")}
              value={reportsTo}
              onChange={setReportsTo}
              options={[
                { value: "", label: t("agent.noManager") },
                ...agents.map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
            <Input
              label={t("org.monthlyBudget")}
              value={budget}
              onChange={setBudget}
              placeholder="120"
              type="number"
              hint="Spending cap per month; agent pauses when exceeded"
            />
            <TextArea
              label={t("agent.capabilities")}
              value={capabilities}
              onChange={setCapabilities}
              placeholder="What this agent does"
              hint="Skills and domain knowledge injected into the agent's system prompt"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <p className="text-[12px] text-muted-foreground">{t("org.hireRequestNote")}</p>
      <ActionButton
        label={t("org.submitHireRequest")}
        tone="accent"
        onClick={() => void handleCreate()}
        icon={Robot}
        disabled={!selectedConnectorRecord}
      />
      {requestError ? (
        <p className="text-[12px] text-destructive">{requestError}</p>
      ) : null}
    </div>
  );
}
