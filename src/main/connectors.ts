import type { ServerAdapterModule } from "@agentcompany/adapter-utils";
import { agentConfigurationDoc as claudeDoc, models as claudeModels } from "@agentcompany/adapter-claude-local";
import { execute as claudeExecute, sessionCodec as claudeSessionCodec, testEnvironment as claudeTestEnvironment } from "@agentcompany/adapter-claude-local/server";
import {
  agentConfigurationDoc as codexDoc,
  DEFAULT_CODEX_LOCAL_MODEL,
  models as codexModels,
} from "@agentcompany/adapter-codex-local";
import { execute as codexExecute, sessionCodec as codexSessionCodec, testEnvironment as codexTestEnvironment } from "@agentcompany/adapter-codex-local/server";
import { agentConfigurationDoc as geminiDoc, DEFAULT_GEMINI_LOCAL_MODEL, models as geminiModels } from "@agentcompany/adapter-gemini-local";
import { execute as geminiExecute, sessionCodec as geminiSessionCodec, testEnvironment as geminiTestEnvironment } from "@agentcompany/adapter-gemini-local/server";
import type { CapabilityMatrix, ConnectorId, ConnectorRecord } from "@shared/types";

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

interface ConnectorDefinition {
  id: ConnectorId;
  label: string;
  description: string;
  defaultCommand: string;
  defaultModel: string | null;
  notes: string;
  capabilityMatrix: CapabilityMatrix;
  configurationDoc: string;
  module: ServerAdapterModule;
  listModels?: () => Promise<Array<{ id: string; label: string }>>;
}

const CONNECTORS: ConnectorDefinition[] = [
  {
    id: "codex_local",
    label: "Codex",
    description: "Local Codex CLI with session resume, structured event parsing, and model selection.",
    defaultCommand: "codex",
    defaultModel: DEFAULT_CODEX_LOCAL_MODEL,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: codexDoc,
    module: {
      type: "codex_local",
      execute: codexExecute,
      testEnvironment: codexTestEnvironment,
      sessionCodec: codexSessionCodec,
      nativeContextManagement: true,
      models: codexModels,
    },
    listModels: async () => codexModels,
  },
  {
    id: "claude_local",
    label: "Claude Code",
    description: "Local Claude Code CLI with session persistence and structured result parsing.",
    defaultCommand: "claude",
    defaultModel: claudeModels[0]?.id ?? null,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: true,
    },
    configurationDoc: claudeDoc,
    module: {
      type: "claude_local",
      execute: claudeExecute,
      testEnvironment: claudeTestEnvironment,
      sessionCodec: claudeSessionCodec,
      nativeContextManagement: true,
      models: claudeModels,
    },
    listModels: async () => claudeModels,
  },
  {
    id: "claude_compatible",
    label: "Claude Code Compatible API",
    description: "Claude Code CLI connected to a third-party API provider (e.g. DeepSeek, OpenRouter, Ollama).",
    defaultCommand: "claude",
    defaultModel: null,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: claudeDoc,
    module: {
      type: "claude_local",
      execute: claudeExecute,
      testEnvironment: claudeTestEnvironment,
      sessionCodec: claudeSessionCodec,
      nativeContextManagement: true,
      models: claudeModels,
    },
    listModels: async () => claudeModels,
  },
  {
    id: "claude_compat_2",
    label: "Claude Code Compatible API (2)",
    description: "Second Claude Code CLI compatible API slot for a third-party provider.",
    defaultCommand: "claude",
    defaultModel: null,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: claudeDoc,
    module: {
      type: "claude_local",
      execute: claudeExecute,
      testEnvironment: claudeTestEnvironment,
      sessionCodec: claudeSessionCodec,
      nativeContextManagement: true,
      models: claudeModels,
    },
    listModels: async () => claudeModels,
  },
  {
    id: "claude_compat_3",
    label: "Claude Code Compatible API (3)",
    description: "Third Claude Code CLI compatible API slot for a third-party provider.",
    defaultCommand: "claude",
    defaultModel: null,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: claudeDoc,
    module: {
      type: "claude_local",
      execute: claudeExecute,
      testEnvironment: claudeTestEnvironment,
      sessionCodec: claudeSessionCodec,
      nativeContextManagement: true,
      models: claudeModels,
    },
    listModels: async () => claudeModels,
  },
  {
    id: "claude_compat_4",
    label: "Claude Code Compatible API (4)",
    description: "Claude Code CLI compatible API slot 4 for a third-party provider.",
    defaultCommand: "claude",
    defaultModel: null,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: claudeDoc,
    module: {
      type: "claude_local",
      execute: claudeExecute,
      testEnvironment: claudeTestEnvironment,
      sessionCodec: claudeSessionCodec,
      nativeContextManagement: true,
      models: claudeModels,
    },
    listModels: async () => claudeModels,
  },
  {
    id: "claude_compat_5",
    label: "Claude Code Compatible API (5)",
    description: "Claude Code CLI compatible API slot 5 for a third-party provider.",
    defaultCommand: "claude",
    defaultModel: null,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: claudeDoc,
    module: {
      type: "claude_local",
      execute: claudeExecute,
      testEnvironment: claudeTestEnvironment,
      sessionCodec: claudeSessionCodec,
      nativeContextManagement: true,
      models: claudeModels,
    },
    listModels: async () => claudeModels,
  },
  {
    id: "claude_compat_6",
    label: "Claude Code Compatible API (6)",
    description: "Claude Code CLI compatible API slot 6 for a third-party provider.",
    defaultCommand: "claude",
    defaultModel: null,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: claudeDoc,
    module: {
      type: "claude_local",
      execute: claudeExecute,
      testEnvironment: claudeTestEnvironment,
      sessionCodec: claudeSessionCodec,
      nativeContextManagement: true,
      models: claudeModels,
    },
    listModels: async () => claudeModels,
  },
  {
    id: "claude_compat_7",
    label: "Claude Code Compatible API (7)",
    description: "Claude Code CLI compatible API slot 7 for a third-party provider.",
    defaultCommand: "claude",
    defaultModel: null,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: claudeDoc,
    module: {
      type: "claude_local",
      execute: claudeExecute,
      testEnvironment: claudeTestEnvironment,
      sessionCodec: claudeSessionCodec,
      nativeContextManagement: true,
      models: claudeModels,
    },
    listModels: async () => claudeModels,
  },
  {
    id: "claude_compat_8",
    label: "Claude Code Compatible API (8)",
    description: "Claude Code CLI compatible API slot 8 for a third-party provider.",
    defaultCommand: "claude",
    defaultModel: null,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: claudeDoc,
    module: {
      type: "claude_local",
      execute: claudeExecute,
      testEnvironment: claudeTestEnvironment,
      sessionCodec: claudeSessionCodec,
      nativeContextManagement: true,
      models: claudeModels,
    },
    listModels: async () => claudeModels,
  },
  {
    id: "claude_compat_9",
    label: "Claude Code Compatible API (9)",
    description: "Claude Code CLI compatible API slot 9 for a third-party provider.",
    defaultCommand: "claude",
    defaultModel: null,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: claudeDoc,
    module: {
      type: "claude_local",
      execute: claudeExecute,
      testEnvironment: claudeTestEnvironment,
      sessionCodec: claudeSessionCodec,
      nativeContextManagement: true,
      models: claudeModels,
    },
    listModels: async () => claudeModels,
  },
  {
    id: "claude_compat_10",
    label: "Claude Code Compatible API (10)",
    description: "Claude Code CLI compatible API slot 10 for a third-party provider.",
    defaultCommand: "claude",
    defaultModel: null,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: claudeDoc,
    module: {
      type: "claude_local",
      execute: claudeExecute,
      testEnvironment: claudeTestEnvironment,
      sessionCodec: claudeSessionCodec,
      nativeContextManagement: true,
      models: claudeModels,
    },
    listModels: async () => claudeModels,
  },
  {
    id: "gemini_local",
    label: "Gemini CLI",
    description: "Local Gemini CLI with resume support and JSON event parsing.",
    defaultCommand: "gemini",
    defaultModel: DEFAULT_GEMINI_LOCAL_MODEL,
    notes: "",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: false,
      structuredTranscript: true,
      costAttribution: true,
    },
    configurationDoc: geminiDoc,
    module: {
      type: "gemini_local",
      execute: geminiExecute,
      testEnvironment: geminiTestEnvironment,
      sessionCodec: geminiSessionCodec,
      nativeContextManagement: false,
      models: geminiModels,
    },
    listModels: async () => geminiModels,
  },
];

export function getConnectorDefinition(id: ConnectorId): ConnectorDefinition {
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
