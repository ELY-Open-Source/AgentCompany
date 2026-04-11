import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Robot } from "@phosphor-icons/react";
import { DEPARTMENT_OPTIONS } from "@shared/constants";
import type { AgentRecord, ConnectorRecord, DepartmentId, WorkspaceRecord } from "@shared/types";
import { isConnectorExecutionReady } from "@shared/connector-policy";
import { unwrap } from "../../lib/desktop";
import { ActionButton, Input, Select, TextArea } from "../ui";
import { useT } from "../../i18n";

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
  const [department, setDepartment] = useState<DepartmentId | "">("");
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

  const t = useT();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const selectedDepartment: DepartmentId | null = department === "" ? null : department;

  return (
    <div className="grid min-w-0 gap-4">
      <Input label={t("org.agentName")} value={name} onChange={setName} placeholder={t("org.agentName")} hint="Display name shown in org chart and messages" />
      <Input label={t("agent.role")} value={role} onChange={setRole} placeholder="e.g. Engineer, PM, CEO" hint="Determines which tasks the agent can handle" />
      <Input label={t("agent.title")} value={title} onChange={setTitle} placeholder={t("agent.title")} hint="Job title shown under the name" />
      <Select
        label={t("org.connector")}
        value={connectorId}
        onChange={(value) => setConnectorId(value as ConnectorRecord["id"])}
        options={executionReadyConnectors.map((connector) => ({ value: connector.id, label: connector.id.startsWith("claude_compat") && connector.notes ? connector.notes : connector.label }))}
      />
      {executionReadyConnectors.length === 0 ? (
        <p className="text-[12px] text-warning">
          {t("org.noConnectorAvailable")}
        </p>
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
      <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground">
        <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}><path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
        {t("org.advancedSettings")}
      </button>
      <AnimatePresence>
      {showAdvanced ? (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }} className="grid gap-4 overflow-hidden">
          <Select
            label={t("comm.department")}
            value={department}
            onChange={(value) => setDepartment(value as DepartmentId | "")}
            options={DEPARTMENT_OPTIONS.map((option) => ({
              value: option.value,
              label: option.value === "" ? t("comm.selectDepartment") : option.label,
            }))}
          />
          <Select
            label={t("agent.workspace")}
            value={workspaceId}
            onChange={setWorkspaceId}
            options={[
              { value: "", label: t("agent.noWorkspace") },
              ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
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
          <Input label={t("org.monthlyBudget")} value={budget} onChange={setBudget} placeholder="120" type="number" hint="Spending cap per month; agent pauses when exceeded" />
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
      <p className="text-[12px] text-muted-foreground">
        {t("org.hireRequestNote")}
      </p>
      <ActionButton
        label={t("org.submitHireRequest")}
        tone="accent"
        onClick={() =>
          void (async () => {
            try {
              setRequestError(null);
              if (!selectedConnector) {
                setRequestError(t("org.selectConnectorFirst"));
                return;
              }
              const meta: Record<string, string> = {};
              if (thinkingEffort) meta.thinkingEffort = thinkingEffort;
              unwrap(await window.agentCompany.requestHire({
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
              }));
              setName("");
              setRole("");
              setTitle("");
              setDepartment("");
              setCapabilities("");
              setReportsTo("");
              setRequestError(null);
              await onSaved();
            } catch (error) {
              setRequestError(error instanceof Error ? error.message : t("org.hireRequestFailed"));
            }
          })()
        }
        icon={Robot}
        disabled={!selectedConnector}
      />
      {requestError ? <p className="text-[12px] text-destructive">{requestError}</p> : null}
    </div>
  );
}
