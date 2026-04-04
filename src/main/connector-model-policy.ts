import type { ConnectorId } from "@shared/types";
import { getConnectorDefinition } from "./connectors";

interface ConnectorModelPolicyDeps {
  getConnector: (id: ConnectorId) => { id: ConnectorId; label?: string | null; model: string | null };
  getDisabledModels: (connectorId: string) => Array<{ id: string; label: string }>;
}

export interface ConnectorModelPolicyResult {
  connectorId: ConnectorId;
  connectorLabel: string;
  enabledModels: Array<{ id: string; label: string }>;
  defaultModel: string | null;
}

export function parseCompatConnectorModelCatalog(model: string | null | undefined): string[] {
  return uniqueModels(
    (model ?? "")
      .split(",")
      .map((entry) => ({ id: entry.trim(), label: entry.trim(), enabled: true }))
      .filter((entry) => entry.id.length > 0),
  ).map((entry) => entry.id);
}

function uniqueModels(models: Array<{ id: string; label: string }>) {
  const byId = new Map<string, { id: string; label: string }>();
  for (const model of models) {
    const id = model.id.trim();
    if (!id) continue;
    if (!byId.has(id)) {
      byId.set(id, { id, label: model.label || id });
    }
  }
  return Array.from(byId.values());
}

export function getConnectorModelPolicy(
  deps: ConnectorModelPolicyDeps,
  connectorId: ConnectorId,
): ConnectorModelPolicyResult {
  const connector = deps.getConnector(connectorId);
  const definition = getConnectorDefinition(connectorId);
  const disabledModels = new Set(deps.getDisabledModels(connectorId).map((model) => model.id));

  const catalog = connectorId.startsWith("claude_compat")
    ? parseCompatConnectorModelCatalog(connector.model).map((model) => ({ id: model, label: model }))
    : (definition.module.models ?? []).map((model) => ({ id: model.id, label: model.label }));

  const enabledModels = uniqueModels(catalog).filter((model) => !disabledModels.has(model.id));

  return {
    connectorId,
    connectorLabel: connector.label?.trim() || definition.label,
    enabledModels,
    defaultModel: connectorId.startsWith("claude_compat")
      ? null
      : (connector.model?.trim() || definition.defaultModel),
  };
}

export function validateConnectorModelSelection(
  deps: ConnectorModelPolicyDeps,
  connectorId: ConnectorId,
  model: string | null | undefined,
): { ok: true; effectiveModel: string | null } | { ok: false; error: string } {
  const policy = getConnectorModelPolicy(deps, connectorId);
  const selectedModel = model?.trim() || null;

  if (policy.enabledModels.length === 0) {
    return {
      ok: false,
      error: `${policy.connectorLabel} has no enabled models available.`,
    };
  }

  if (selectedModel) {
    if (!policy.enabledModels.some((entry) => entry.id === selectedModel)) {
      return {
        ok: false,
        error: `${policy.connectorLabel} does not allow model "${selectedModel}".`,
      };
    }
    return { ok: true, effectiveModel: selectedModel };
  }

  if (policy.defaultModel && policy.enabledModels.some((entry) => entry.id === policy.defaultModel)) {
    return { ok: true, effectiveModel: policy.defaultModel };
  }

  return { ok: true, effectiveModel: policy.enabledModels[0]?.id ?? null };
}

export function validateConnectorConfigurationModel(
  connectorId: ConnectorId,
  model: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!connectorId.startsWith("claude_compat")) {
    return { ok: true };
  }

  if (model == null) {
    return { ok: true };
  }

  const catalog = parseCompatConnectorModelCatalog(model);
  if (catalog.length === 0) {
    return { ok: false, error: "Compatible connectors require at least one model in the configured model catalog." };
  }

  return { ok: true };
}
