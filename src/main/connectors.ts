import type { ConnectorRecord } from "@shared/types";
import { CONNECTORS } from "./connector-definitions";
export type { ConnectorDefinition } from "./connector-definitions";

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

export function buildDefaultConnectorRows(existing: Array<Partial<ConnectorRecord>> = []): ConnectorRecord[] {
  const byId = new Map(existing.map((record) => [record.id, record]));
  return CONNECTORS.map((definition) => {
    const existingRecord = byId.get(definition.id);
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      status: existingRecord?.status ?? "not_installed",
      command: existingRecord?.command ?? definition.defaultCommand,
      version: existingRecord?.version ?? null,
      authState: existingRecord?.authState ?? "unknown",
      lastCheckedAt: existingRecord?.lastCheckedAt ?? null,
      lastError: existingRecord?.lastError ?? null,
      model: existingRecord?.model ?? definition.defaultModel,
      envBindingText: existingRecord?.envBindingText ?? "",
      notes: existingRecord?.notes ?? definition.notes,
      configurationDoc: definition.configurationDoc,
      capabilityMatrix: definition.capabilityMatrix,
    };
  });
}
