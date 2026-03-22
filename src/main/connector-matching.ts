/**
 * Deterministic connector-matching heuristic.
 *
 * Maps task types to the best available connector based on a static
 * preference table. Provides fallback logic when preferred connectors
 * are offline or unavailable.
 */
import type { ConnectorId, ConnectorStatus, TaskType } from "@shared/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectorMatchInput {
  taskType: TaskType;
  agentRole: string;
  agentDepartment: string | null;
  availableConnectors: Array<{
    id: ConnectorId;
    status: ConnectorStatus;
    label: string;
  }>;
}

export interface ConnectorMatchResult {
  recommendedConnectorId: ConnectorId;
  fallbackConnectorId: ConnectorId | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// Static preference tables
// ---------------------------------------------------------------------------

/**
 * For each task type, connectors ordered from most preferred to least.
 */
export const TASK_TYPE_PREFERENCE: Record<TaskType, ConnectorId[]> = {
  code: ["claude_local", "codex_local", "gemini_local"],
  research: ["gemini_local", "claude_local", "codex_local"],
  content: ["claude_local", "gemini_local", "codex_local"],
  management: ["claude_local", "gemini_local", "codex_local"],
  general: ["claude_local", "codex_local", "gemini_local"],
};

/**
 * Maps department strings to the most likely task type for that department.
 */
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

/**
 * Human-readable capability descriptions per connector.
 */
export const CONNECTOR_STRENGTHS: Record<ConnectorId, string> = {
  claude_local:
    "Best for code generation, content writing, complex reasoning. Supports session resume, cost tracking.",
  codex_local:
    "Optimized for code editing and generation. Supports session resume, structured output.",
  gemini_local:
    "Strong at research, analysis, and large-context tasks. Good for data processing.",
};

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

const READY_STATUSES: Set<ConnectorStatus> = new Set(["ready"]);

/**
 * Infer the most likely task type from a department name.
 * Returns 'general' for null, undefined, or unrecognised departments.
 */
export function inferTaskType(
  department: string | null | undefined,
): TaskType {
  if (!department) return "general";
  const lower = department.toLowerCase();
  return ROLE_DEPARTMENT_HINTS[lower] ?? "general";
}

/**
 * Get a human-readable description of a connector's strengths.
 */
export function getConnectorStrengths(connectorId: ConnectorId): string {
  return CONNECTOR_STRENGTHS[connectorId] ?? "General-purpose AI connector.";
}

/**
 * Select the best connector for a given task type and set of available
 * connectors. Falls back gracefully when preferred connectors are offline.
 *
 * Algorithm:
 * 1. Filter connectors to those with "ready" status.
 * 2. Walk the preference list for the given task type.
 * 3. Return the first ready match as recommended.
 * 4. Set fallback to the next *different* ready connector in the list.
 * 5. If no connectors are ready, use the first available connector.
 * 6. If no connectors at all, default to 'claude_local'.
 */
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
