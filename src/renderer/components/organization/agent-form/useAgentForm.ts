import { useEffect, useMemo, useState } from "react";
import type {
  AgentRecord,
  BudgetPolicyRecord,
  ConnectorRecord,
  DepartmentId,
} from "@shared/types";
import { isConnectorExecutionReady } from "@shared/connector-policy";
import { findConnectorCatalogEntry } from "@shared/connector-catalog";
import { safeJson } from "../../../lib/safe-json";
import { getBudgetPolicyAmountDollars } from "../../../lib/budget-policy-input";

/**
 * Connectors whose models accept a thinking-effort hint. Derived from the
 * pi-mono catalog provider id so renderer stays in sync with Agent A's data
 * without hard-coding hyphen-vs-underscore id literals.
 */
function connectorSupportsThinkingEffort(connectorId: string): boolean {
  const entry = findConnectorCatalogEntry(connectorId);
  if (!entry) return false;
  return (
    entry.provider === "anthropic" ||
    entry.provider === "openai" ||
    entry.provider === "openai-codex"
  );
}

export type AgentFormMode = "create" | "edit";

export interface UseAgentFormArgs {
  mode: AgentFormMode;
  agent: AgentRecord | null;
  connectors: ConnectorRecord[];
  workspaces: { id: string; name: string }[];
  companyId: string;
}

export interface AgentFormState {
  name: string;
  setName: (value: string) => void;
  role: string;
  setRole: (value: string) => void;
  title: string;
  setTitle: (value: string) => void;
  department: DepartmentId | "";
  setDepartment: (value: DepartmentId | "") => void;
  status: AgentRecord["status"];
  setStatus: (value: AgentRecord["status"]) => void;
  connectorId: ConnectorRecord["id"];
  setConnectorId: (value: ConnectorRecord["id"]) => void;
  model: string;
  setModel: (value: string) => void;
  availableModels: Array<{ id: string; label: string }>;
  workspaceId: string;
  setWorkspaceId: (value: string) => void;
  budget: string;
  setBudget: (value: string) => void;
  capabilities: string;
  setCapabilities: (value: string) => void;
  reportsTo: string;
  setReportsTo: (value: string) => void;
  thinkingEffort: string;
  setThinkingEffort: (value: string) => void;
  existingMeta: Record<string, unknown>;
  supportsEffort: boolean;
  executionReadyConnectors: ConnectorRecord[];
  selectedConnectorRecord: ConnectorRecord | null;
  selectedDepartment: DepartmentId | null;
  agentPolicy: BudgetPolicyRecord | null;
}

export function useAgentForm({
  mode,
  agent,
  connectors,
  workspaces,
  companyId,
}: UseAgentFormArgs): AgentFormState {
  const executionReadyConnectors = useMemo(
    () => connectors.filter((connector) => isConnectorExecutionReady(connector)),
    [connectors],
  );

  const initialConnectorId: ConnectorRecord["id"] =
    agent?.connectorId ?? executionReadyConnectors[0]?.id ?? ("" as ConnectorRecord["id"]);
  const existingMeta = useMemo(
    () => safeJson<Record<string, unknown>>(agent?.metadataJson ?? null, {}),
    [agent?.metadataJson],
  );

  const [name, setName] = useState(agent?.name ?? "");
  const [role, setRole] = useState(agent?.role ?? "");
  const [title, setTitle] = useState(agent?.title ?? "");
  const [department, setDepartment] = useState<DepartmentId | "">(agent?.department ?? "");
  const [status, setStatus] = useState<AgentRecord["status"]>(agent?.status ?? "idle");
  const [connectorId, setConnectorId] = useState<ConnectorRecord["id"]>(initialConnectorId);
  const [model, setModel] = useState(agent?.model ?? "");
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; label: string }>>([]);
  const [workspaceId, setWorkspaceId] = useState(
    agent ? agent.workspaceId ?? "" : workspaces[0]?.id ?? "",
  );
  const [budget, setBudget] = useState(agent ? String(agent.budgetMonthlyUsd) : "120");
  const [capabilities, setCapabilities] = useState(agent?.capabilities ?? "");
  const [reportsTo, setReportsTo] = useState(agent?.reportsTo ?? "");
  const [thinkingEffort, setThinkingEffort] = useState<string>(
    typeof existingMeta.thinkingEffort === "string" ? existingMeta.thinkingEffort : "",
  );

  const supportsEffort = connectorSupportsThinkingEffort(connectorId);

  const selectedConnectorRecord =
    (mode === "edit" ? connectors : executionReadyConnectors).find(
      (connector) => connector.id === connectorId,
    ) ?? null;

  const persistedConnectorId = agent?.connectorId ?? null;
  useEffect(() => {
    if (mode === "create") {
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
      if (!connectorSupportsThinkingEffort(connectorId)) {
        setThinkingEffort("");
      }
      return;
    }

    void (async () => {
      const result = await window.agentCompany.listConnectorModels(connectorId);
      if (result.ok) {
        setAvailableModels(result.data);
        if (persistedConnectorId && connectorId !== persistedConnectorId) {
          setModel(result.data[0]?.id ?? "");
        }
      }
    })();
    if (!connectorSupportsThinkingEffort(connectorId)) {
      setThinkingEffort("");
    }
  }, [connectorId, mode, persistedConnectorId, connectors]);

  useEffect(() => {
    if (mode !== "create") return;
    if (!connectorId && executionReadyConnectors[0]) {
      setConnectorId(executionReadyConnectors[0].id);
      return;
    }
    if (
      connectorId &&
      !executionReadyConnectors.some((connector) => connector.id === connectorId)
    ) {
      setConnectorId(executionReadyConnectors[0]?.id ?? ("" as ConnectorRecord["id"]));
    }
  }, [executionReadyConnectors, connectorId, mode]);

  const [agentPolicy, setAgentPolicy] = useState<BudgetPolicyRecord | null>(null);
  const agentIdForPolicy = agent?.id ?? null;
  useEffect(() => {
    if (mode !== "edit" || !agentIdForPolicy) return;
    void (async () => {
      const result = await window.agentCompany.listBudgetPolicies(companyId);
      if (result.ok) {
        const policy = result.data
          .filter((p) => p.scopeType === "agent" && p.scopeId === agentIdForPolicy)
          .sort((left, right) => {
            if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
            return right.updatedAt.localeCompare(left.updatedAt);
          })[0];
        if (policy) {
          setAgentPolicy(policy);
          setBudget(getBudgetPolicyAmountDollars(policy));
        }
      }
    })();
  }, [companyId, agentIdForPolicy, mode]);

  const selectedDepartment: DepartmentId | null = department === "" ? null : department;

  return {
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
    executionReadyConnectors,
    selectedConnectorRecord,
    selectedDepartment,
    agentPolicy,
  };
}
