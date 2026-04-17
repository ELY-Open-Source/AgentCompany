import type { ConnectorId, TaskType } from "@shared/types";
import { CONNECTORS } from "./connectors";

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
 * Preferred provider ordering per task type. Resolved against `CONNECTORS` at
 * module load so `TASK_TYPE_PREFERENCE` stays in sync with the pi-mono catalog
 * without hard-coded id lists.
 */
const PROVIDER_PREFERENCE: Record<TaskType, string[]> = {
  code: ["anthropic", "openai", "xai", "groq", "google", "openrouter", "mistral", "cerebras"],
  research: ["google", "anthropic", "openai", "openrouter", "xai", "mistral", "groq"],
  content: ["anthropic", "openai", "google", "mistral", "openrouter", "groq", "xai"],
  management: ["anthropic", "openai", "google", "mistral", "openrouter", "groq", "xai"],
  general: ["anthropic", "openai", "google", "openrouter", "mistral", "xai", "groq"],
};

function connectorsByProvider(provider: string): ConnectorId[] {
  return CONNECTORS.filter((c) => c.provider === provider).map((c) => c.id);
}

function buildPreference(taskType: TaskType): ConnectorId[] {
  const preferred: ConnectorId[] = [];
  const seen = new Set<ConnectorId>();
  for (const provider of PROVIDER_PREFERENCE[taskType]) {
    for (const id of connectorsByProvider(provider)) {
      if (!seen.has(id)) {
        preferred.push(id);
        seen.add(id);
      }
    }
  }
  // Ensure every catalog entry appears in the preference list so callers can
  // always resolve to *some* connector even when the provider is not ranked.
  for (const connector of CONNECTORS) {
    if (!seen.has(connector.id)) {
      preferred.push(connector.id);
      seen.add(connector.id);
    }
  }
  return preferred;
}

export const TASK_TYPE_PREFERENCE: Record<TaskType, ConnectorId[]> = {
  code: buildPreference("code"),
  research: buildPreference("research"),
  content: buildPreference("content"),
  management: buildPreference("management"),
  general: buildPreference("general"),
};

export function inferTaskType(department: string | null | undefined): TaskType {
  if (!department) return "general";
  const lower = department.toLowerCase();
  return ROLE_DEPARTMENT_HINTS[lower] ?? "general";
}

export function getConnectorStrengths(connectorId: ConnectorId): string {
  const definition = CONNECTORS.find((c) => c.id === connectorId);
  if (!definition) return "General-purpose AI connector.";
  return definition.description;
}
