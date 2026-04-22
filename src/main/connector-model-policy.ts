import type { ConnectorId } from "@shared/types";
import { getConnectorDefinition } from "./connectors";
import { resolveModels } from "./model-resolver";

interface ConnectorModelPolicyDeps {
  getConnector: (id: ConnectorId) => { id: ConnectorId; label?: string | null; model: string | null };
  getDisabledModels: (companyId: string, connectorId: string) => Array<{ id: string; label: string }>;
}

/**
 * Adapter over AppDatabase that returns the structural shape consumed by
 * `getConnectorModelPolicy` / `validateConnectorModelSelection`. Callers
 * pass an `AppDatabase`-ish object; the helper unwraps the two typed
 * domain modules so we do not repeat the closure literal at every site.
 */
export function connectorPolicyDepsFromDb(db: {
  core: {
    connectors: { getConnector: (id: ConnectorId) => { id: ConnectorId; label?: string | null; model: string | null } };
    settings: { getDisabledModels: (companyId: string, connectorId: string) => Array<{ id: string; label: string }> };
  };
}): ConnectorModelPolicyDeps {
  return {
    getConnector: (id) => db.core.connectors.getConnector(id),
    getDisabledModels: (cid, connId) => db.core.settings.getDisabledModels(cid, connId),
  };
}

export interface ConnectorModelPolicyResult {
  connectorId: ConnectorId;
  connectorLabel: string;
  enabledModels: Array<{ id: string; label: string }>;
  defaultModel: string | null;
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

/**
 * Returns the models available for a given pi-ai provider id, going through
 * `resolveModels` so that providers not in pi-ai's built-in catalog (currently
 * the two Fireworks connectors, which serve `accounts/fireworks/routers/...`
 * and curated `accounts/fireworks/models/...` ids) are represented in the UI
 * model picker instead of collapsing to an empty list.
 */
function listProviderModels(provider: string): Array<{ id: string; label: string }> {
  return resolveModels(provider).map((model) => ({ id: model.id, label: model.name }));
}

export function getConnectorModelPolicy(
  deps: ConnectorModelPolicyDeps,
  companyId: string,
  connectorId: ConnectorId,
): ConnectorModelPolicyResult {
  const connector = deps.getConnector(connectorId);
  const definition = getConnectorDefinition(connectorId);
  const disabledModels = new Set(deps.getDisabledModels(companyId, connectorId).map((model) => model.id));

  const catalog = listProviderModels(definition.provider);
  const enabledModels = uniqueModels(catalog).filter((model) => !disabledModels.has(model.id));

  return {
    connectorId,
    connectorLabel: connector.label?.trim() || definition.label,
    enabledModels,
    defaultModel: connector.model?.trim() || definition.defaultModel,
  };
}

export function validateConnectorModelSelection(
  deps: ConnectorModelPolicyDeps,
  companyId: string,
  connectorId: ConnectorId,
  model: string | null | undefined,
): { ok: true; effectiveModel: string | null } | { ok: false; error: string } {
  const policy = getConnectorModelPolicy(deps, companyId, connectorId);
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

/**
 * Pi-mono catalog does not have free-form compat connectors; every connector
 * has a fixed pi-ai provider. The configuration-level model validator is a
 * no-op retained for IPC contract compatibility.
 */
export function validateConnectorConfigurationModel(
  _connectorId: ConnectorId,
  _model: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  return { ok: true };
}
