import type { ConnectorId, ConnectorStatus, TaskType } from "@shared/types";

interface ConnectorMatchInput {
  taskType: TaskType;
  availableConnectors: Array<{
    id: ConnectorId;
    status: ConnectorStatus;
    label: string;
  }>;
}

interface ConnectorMatchResult {
  recommendedConnectorId: ConnectorId;
  fallbackConnectorId: ConnectorId | null;
  reason: string;
}

export const TASK_TYPE_PREFERENCE: Record<TaskType, ConnectorId[]> = {
  code: ["claude_local", "codex_local", "claude_compatible", "claude_compat_2", "claude_compat_3", "claude_compat_4", "claude_compat_5", "claude_compat_6", "claude_compat_7", "claude_compat_8", "claude_compat_9", "claude_compat_10", "gemini_local"],
  research: ["gemini_local", "claude_local", "claude_compatible", "claude_compat_2", "claude_compat_3", "claude_compat_4", "claude_compat_5", "claude_compat_6", "claude_compat_7", "claude_compat_8", "claude_compat_9", "claude_compat_10", "codex_local"],
  content: ["claude_local", "claude_compatible", "claude_compat_2", "claude_compat_3", "claude_compat_4", "claude_compat_5", "claude_compat_6", "claude_compat_7", "claude_compat_8", "claude_compat_9", "claude_compat_10", "gemini_local", "codex_local"],
  management: ["claude_local", "claude_compatible", "claude_compat_2", "claude_compat_3", "claude_compat_4", "claude_compat_5", "claude_compat_6", "claude_compat_7", "claude_compat_8", "claude_compat_9", "claude_compat_10", "gemini_local", "codex_local"],
  general: ["claude_local", "codex_local", "claude_compatible", "claude_compat_2", "claude_compat_3", "claude_compat_4", "claude_compat_5", "claude_compat_6", "claude_compat_7", "claude_compat_8", "claude_compat_9", "claude_compat_10", "gemini_local"],
};

export const ROLE_DEPARTMENT_HINTS: Record<string, TaskType> = {
  engineering: "code",
  research: "research",
  marketing: "content",
  product: "content",
  hr: "management",
  finance: "management",
  executive: "management",
  design: "content",
  customer_support: "content",
  operations: "management",
  sales: "content",
  legal: "management",
};

export const CONNECTOR_STRENGTHS: Record<ConnectorId, string> = {
  claude_local:
    "Best for code generation, content writing, complex reasoning. Supports session resume, cost tracking.",
  claude_compatible:
    "Claude Code CLI with third-party API provider (DeepSeek, OpenRouter, Ollama, etc.). Cost-effective for worker agents.",
  claude_compat_2:
    "Claude Code CLI with third-party API provider (DeepSeek, OpenRouter, Ollama, etc.). Cost-effective for worker agents.",
  claude_compat_3:
    "Claude Code CLI with third-party API provider (DeepSeek, OpenRouter, Ollama, etc.). Cost-effective for worker agents.",
  claude_compat_4:
    "Claude Code CLI with third-party API provider (DeepSeek, OpenRouter, Ollama, etc.). Cost-effective for worker agents.",
  claude_compat_5:
    "Claude Code CLI with third-party API provider (DeepSeek, OpenRouter, Ollama, etc.). Cost-effective for worker agents.",
  claude_compat_6:
    "Claude Code CLI with third-party API provider (DeepSeek, OpenRouter, Ollama, etc.). Cost-effective for worker agents.",
  claude_compat_7:
    "Claude Code CLI with third-party API provider (DeepSeek, OpenRouter, Ollama, etc.). Cost-effective for worker agents.",
  claude_compat_8:
    "Claude Code CLI with third-party API provider (DeepSeek, OpenRouter, Ollama, etc.). Cost-effective for worker agents.",
  claude_compat_9:
    "Claude Code CLI with third-party API provider (DeepSeek, OpenRouter, Ollama, etc.). Cost-effective for worker agents.",
  claude_compat_10:
    "Claude Code CLI with third-party API provider (DeepSeek, OpenRouter, Ollama, etc.). Cost-effective for worker agents.",
  codex_local:
    "Optimized for code editing and generation. Supports session resume, structured output.",
  gemini_local:
    "Strong at research, analysis, and large-context tasks. Good for data processing.",
};

const READY_STATUSES: Set<ConnectorStatus> = new Set(["ready"]);

export function inferTaskType(
  department: string | null | undefined,
): TaskType {
  if (!department) return "general";
  const lower = department.toLowerCase();
  return ROLE_DEPARTMENT_HINTS[lower] ?? "general";
}

export function getConnectorStrengths(connectorId: ConnectorId): string {
  return CONNECTOR_STRENGTHS[connectorId] ?? "General-purpose AI connector.";
}

export function matchConnector(input: ConnectorMatchInput): ConnectorMatchResult {
  const { taskType, availableConnectors } = input;
  const prefList = TASK_TYPE_PREFERENCE[taskType] ?? TASK_TYPE_PREFERENCE.general;

  // Partition into ready vs all
  const readySet = new Set<ConnectorId>();
  for (const c of availableConnectors) {
    if (READY_STATUSES.has(c.status)) {
      readySet.add(c.id);
    }
  }

  // If we have ready connectors, walk the preference list
  if (readySet.size > 0) {
    let recommended: ConnectorId | null = null;
    let fallback: ConnectorId | null = null;

    for (const connId of prefList) {
      if (readySet.has(connId)) {
        if (recommended === null) {
          recommended = connId;
        } else if (fallback === null && connId !== recommended) {
          fallback = connId;
          break; // We have both recommended and fallback
        }
      }
    }

    // recommended should always be set if readySet.size > 0, but guard
    if (recommended) {
      return {
        recommendedConnectorId: recommended,
        fallbackConnectorId: fallback,
        reason: `Selected ${recommended} for ${taskType} tasks.`,
      };
    }
  }

  // No ready connectors -- fall back to first available connector
  if (availableConnectors.length > 0) {
    const first = availableConnectors[0];
    return {
      recommendedConnectorId: first.id,
      fallbackConnectorId: null,
      reason: `No ready connectors available. Using ${first.label} as fallback (status: ${first.status}).`,
    };
  }

  // Ultimate fallback -- no connectors at all
  return {
    recommendedConnectorId: "claude_local",
    fallbackConnectorId: null,
    reason: "No connectors available. Defaulting to claude_local.",
  };
}
