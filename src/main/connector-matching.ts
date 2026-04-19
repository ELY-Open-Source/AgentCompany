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
