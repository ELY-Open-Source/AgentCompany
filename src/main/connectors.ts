import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  ServerAdapterModule,
} from "@agentcompany/adapter-utils";
import { asNumber, asString, ensureAbsoluteDirectory, ensureCommandResolvable, ensurePathInEnv, runChildProcess } from "@agentcompany/adapter-utils/server-utils";
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
import { agentConfigurationDoc as opencodeDoc } from "@agentcompany/adapter-opencode-local";
import { execute as opencodeExecute, listOpenCodeModels, sessionCodec as opencodeSessionCodec, testEnvironment as opencodeTestEnvironment } from "@agentcompany/adapter-opencode-local/server";
import type { CapabilityMatrix, ConnectorId, ConnectorRecord } from "@shared/types";

function normalizeEnv(input: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

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

const kimiModule: ServerAdapterModule = {
  type: "kimi_local",
  async testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
    const command = asString(ctx.config.command, "kimi");
    const cwd = asString(ctx.config.cwd, process.cwd());
    const env = normalizeEnv(ensurePathInEnv({ ...(ctx.config.env as Record<string, string> ?? process.env) }));
    try {
      await ensureCommandResolvable(command, cwd, env);
      return {
        adapterType: "kimi_local",
        status: "warn",
        checks: [
          {
            code: "kimi_command_detected",
            level: "info",
            message: `Detected Kimi Code command "${command}".`,
          },
          {
            code: "kimi_runtime_generic_mode",
            level: "warn",
            message:
              "Kimi integration is running in generic CLI mode. Session resume, model discovery, and structured transcript are not guaranteed.",
          },
        ],
        testedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        adapterType: "kimi_local",
        status: "fail",
        checks: [
          {
            code: "kimi_command_missing",
            level: "error",
            message: error instanceof Error ? error.message : "Kimi command is not available.",
            hint: "Install Kimi Code and ensure the CLI is available on PATH.",
          },
        ],
        testedAt: new Date().toISOString(),
      };
    }
  },
  async execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const command = asString(ctx.config.command, "kimi");
    const cwd = asString(ctx.config.cwd, process.cwd());
    const model = asString(ctx.config.model, "kimi-for-coding");
    const timeoutSec = asNumber(ctx.config.timeoutSec, 0);
    const graceSec = asNumber(ctx.config.graceSec, 20);
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

    const prompt = typeof ctx.context.taskTitle === "string" && ctx.context.taskTitle.length > 0
      ? [
          ctx.context.taskTitle,
          typeof ctx.context.taskDescription === "string" && ctx.context.taskDescription.length > 0
            ? ctx.context.taskDescription
            : "",
        ].filter(Boolean).join("\n\n")
      : [
          `You are agent ${ctx.agent.name}.`,
          "Respond with a concise execution summary when complete.",
        ].join("\n\n");

    const env = normalizeEnv(ensurePathInEnv({ ...(ctx.config.env as Record<string, string> ?? process.env) }));
    await ensureCommandResolvable(command, cwd, env);
    const result = await runChildProcess(ctx.runId, command, [], {
      cwd,
      env,
      timeoutSec,
      graceSec,
      stdin: prompt,
      onLog: ctx.onLog,
    });

    const summary =
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-8)
        .join("\n") || null;

    return {
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      summary,
      model,
      billingType: "unknown",
    };
  },
};

const CONNECTORS: ConnectorDefinition[] = [
  {
    id: "codex_local",
    label: "Codex",
    description: "Local Codex CLI with session resume, structured event parsing, and model selection.",
    defaultCommand: "codex",
    defaultModel: DEFAULT_CODEX_LOCAL_MODEL,
    notes: "Best fit for high-context coding tasks and shell-heavy automation.",
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
    notes: "Useful for long-running coding sessions and agent-style loops.",
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
    notes: "Good for multi-provider local workflows when Google auth is already in place.",
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
      models: geminiModels,
    },
    listModels: async () => geminiModels,
  },
  {
    id: "opencode_local",
    label: "OpenCode",
    description: "Local OpenCode runtime with provider/model routing and session restore.",
    defaultCommand: "opencode",
    defaultModel: null,
    notes: "Best when model routing belongs to the runtime rather than the app.",
    capabilityMatrix: {
      sessionResume: true,
      gracefulCancel: true,
      modelDiscovery: true,
      structuredTranscript: true,
      costAttribution: false,
    },
    configurationDoc: opencodeDoc,
    module: {
      type: "opencode_local",
      execute: opencodeExecute,
      testEnvironment: opencodeTestEnvironment,
      sessionCodec: opencodeSessionCodec,
      models: [],
      listModels: listOpenCodeModels,
    },
    listModels: listOpenCodeModels,
  },
  {
    id: "kimi_local",
    label: "Kimi Code",
    description: "Official Kimi Code CLI surfaced through a generic execution contract with explicit capability downgrade.",
    defaultCommand: "kimi",
    defaultModel: "kimi-for-coding",
    notes: "MVP support is explicit generic mode until richer runtime contract evidence is implemented.",
    capabilityMatrix: {
      sessionResume: false,
      gracefulCancel: false,
      modelDiscovery: false,
      structuredTranscript: false,
      costAttribution: false,
    },
    configurationDoc: [
      "# kimi_local agent configuration",
      "",
      "Core fields:",
      "- command (string, optional): defaults to \"kimi\"",
      "- cwd (string, optional): working directory for the Kimi CLI process",
      "- model (string, optional): default kimi-for-coding",
      "- timeoutSec (number, optional)",
      "- graceSec (number, optional)",
      "",
      "Notes:",
      "- This connector currently runs Kimi in generic CLI mode.",
      "- Session resume, model discovery, structured transcript, and cost attribution are declared unsupported.",
      "- The UI must surface these limitations explicitly.",
    ].join("\n"),
    module: kimiModule,
    listModels: async () => [{ id: "kimi-for-coding", label: "kimi-for-coding" }],
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

export function buildDefaultConnectorRows(existing: Array<Partial<ConnectorRecord>> = []): ConnectorRecord[] {
  const byId = new Map(existing.map((record) => [record.id, record]));
  return CONNECTORS.map((definition) => {
    const existingRecord = byId.get(definition.id);
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      status: existingRecord?.status ?? "not_installed",
      command: definition.defaultCommand,
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
