import type { ConnectorId, TaskType } from "@shared/types";

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

const COMPAT_STRENGTH = "Claude Code CLI with third-party API provider (DeepSeek, OpenRouter, Ollama, etc.). Cost-effective for worker agents.";

export const CONNECTOR_STRENGTHS: Record<ConnectorId, string> = {
  claude_local:
    "Best for code generation, content writing, complex reasoning. Supports session resume, cost tracking.",
  claude_compatible: COMPAT_STRENGTH,
  claude_compat_2: COMPAT_STRENGTH,
  claude_compat_3: COMPAT_STRENGTH,
  claude_compat_4: COMPAT_STRENGTH,
  claude_compat_5: COMPAT_STRENGTH,
  claude_compat_6: COMPAT_STRENGTH,
  claude_compat_7: COMPAT_STRENGTH,
  claude_compat_8: COMPAT_STRENGTH,
  claude_compat_9: COMPAT_STRENGTH,
  claude_compat_10: COMPAT_STRENGTH,
  codex_local:
    "Optimized for code editing and generation. Supports session resume, structured output.",
  gemini_local:
    "Strong at research, analysis, and large-context tasks. Good for data processing.",
};

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
