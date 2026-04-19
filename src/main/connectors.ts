import type { CapabilityMatrix, ConnectorRecord } from "@shared/types";
import { CONNECTORS, type ConnectorDefinition } from "./connector-definitions";
import { buildApiKeyDoc, buildCloudDoc, buildOAuthDoc } from "./connector-definitions-docs";
export { CONNECTORS } from "./connector-definitions";
export type { ConnectorDefinition } from "./connector-definitions";
export { findConnectorDefinition, listFeaturedOnboardingConnectors } from "./connector-definitions-lookup";

const RESERVED_ENV_BINDING_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "NODE_OPTIONS",
  "ELECTRON_RUN_AS_NODE",
  "DYLD_INSERT_LIBRARIES",
  "LD_PRELOAD",
  "PWD",
]);

/**
 * Pi-mono drives all provider dispatch through pi-ai, so the adapter-era
 * capability matrix now collapses to a uniform baseline. These values are
 * still written into the `connectors` table for legacy UI surfaces that read
 * them, but the worker and resolver no longer branch on them.
 */
const PI_MONO_CAPABILITIES: CapabilityMatrix = {
  sessionResume: true,
  gracefulCancel: true,
  modelDiscovery: true,
  structuredTranscript: true,
  costAttribution: true,
};

export function getConnectorDefinition(id: string) {
  const definition = CONNECTORS.find((entry) => entry.id === id);
  if (!definition) {
    throw new Error(`Unknown connector: ${id}`);
  }
  return definition;
}

export function parseEnvBindingText(text: string): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [envKey, ...rest] = line.split("=");
    const key = envKey?.trim();
    const value = rest.join("=").trim();
    if (!key || !value) continue;
    bindings[key] = value;
  }
  return bindings;
}

export function listInvalidEnvBindingKeys(text: string): string[] {
  return Object.keys(parseEnvBindingText(text)).filter((key) => {
    return RESERVED_ENV_BINDING_KEYS.has(key) || key.startsWith("AGENT_COMPANY_");
  });
}

export { PI_MONO_CAPABILITIES };

export function renderConnectorConfigurationDoc(definition: ConnectorDefinition): string {
  return renderConfigurationDoc(definition);
}

function renderConfigurationDoc(definition: ConnectorDefinition): string {
  switch (definition.auth.type) {
    case "oauth":
      return buildOAuthDoc(definition.label, definition.auth.oauthId);
    case "api_key":
      return buildApiKeyDoc(definition.label, definition.auth.envKey);
    case "aws":
      return buildCloudDoc(
        definition.label,
        "Credentials are discovered via the standard AWS chain (profile, IAM keys, Bedrock bearer token, ECS roles, or IRSA).",
      );
    case "azure":
      return buildCloudDoc(
        definition.label,
        "Provide AZURE_OPENAI_API_KEY plus AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME.",
      );
    case "gcp_adc":
      return buildCloudDoc(
        definition.label,
        "Uses Google Cloud Application Default Credentials. Run `gcloud auth application-default login` or set GOOGLE_APPLICATION_CREDENTIALS.",
      );
  }
}

export function buildDefaultConnectorRows(existing: Array<Partial<ConnectorRecord>> = []): ConnectorRecord[] {
  const byId = new Map(existing.map((record) => [record.id, record]));
  return CONNECTORS.map((definition) => {
    const existingRecord = byId.get(definition.id);
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      status: existingRecord?.status ?? "not_installed",
      version: existingRecord?.version ?? null,
      authState: existingRecord?.authState ?? "unknown",
      lastCheckedAt: existingRecord?.lastCheckedAt ?? null,
      lastError: existingRecord?.lastError ?? null,
      model: existingRecord?.model ?? definition.defaultModel,
      envBindingText: existingRecord?.envBindingText ?? "",
      notes: existingRecord?.notes ?? definition.notes ?? "",
      configurationDoc: renderConfigurationDoc(definition),
      capabilityMatrix: PI_MONO_CAPABILITIES,
    };
  });
}
