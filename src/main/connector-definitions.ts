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
import type { CapabilityMatrix, ConnectorId } from "@shared/types";

export interface ConnectorDefinition {
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

const claudeCompatModule: ServerAdapterModule = {
  type: "claude_local",
  execute: claudeExecute,
  testEnvironment: claudeTestEnvironment,
  sessionCodec: claudeSessionCodec,
  nativeContextManagement: false,
  models: claudeModels,
};

const claudeCompatCapabilities: CapabilityMatrix = {
  sessionResume: true,
  gracefulCancel: true,
  modelDiscovery: false,
  structuredTranscript: true,
  costAttribution: false,
};

const COMPAT_SLOT_IDS: ConnectorId[] = [
  "claude_compatible",
  "claude_compat_2",
  "claude_compat_3",
  "claude_compat_4",
  "claude_compat_5",
  "claude_compat_6",
  "claude_compat_7",
  "claude_compat_8",
  "claude_compat_9",
  "claude_compat_10",
];

const claudeCompatSlots: ConnectorDefinition[] = COMPAT_SLOT_IDS.map((id, i) => ({
  id,
  label: i === 0 ? "Claude Code Compatible API" : `Claude Code Compatible API (${i + 1})`,
  description: i === 0
    ? "Claude Code CLI connected to a third-party API provider (e.g. DeepSeek, OpenRouter, Ollama)."
    : `Claude Code CLI compatible API slot ${i + 1} for a third-party provider.`,
  defaultCommand: "claude",
  defaultModel: null,
  notes: "",
  capabilityMatrix: claudeCompatCapabilities,
  configurationDoc: claudeDoc,
  module: claudeCompatModule,
  listModels: async () => claudeModels,
}));

export const CONNECTORS: ConnectorDefinition[] = [
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
  ...claudeCompatSlots,
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
