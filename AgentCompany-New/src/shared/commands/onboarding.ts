import type { SearchEntityType } from "../domain";

export interface BootstrapOnboardingInput {
  companyName: string;
  companyDescription: string;
  employeeName: string;
  workspacePath: string;
  executionMode: "ai_ceo" | "ai_cofounder";
  autoApproveHires: boolean;
  reviewDeliverables: boolean;
  goalTitle: string;
  goalDescription: string;
  providerKey: string;
  providerSecret: string;
  providerModel: string;
}

export interface BootstrapOnboardingSummary {
  orgId: string;
  employeeId: string;
  ceoAgentId: string;
  workspaceId: string | null;
  goalId: string;
  projectId: string;
  taskId: string;
  runId: string;
  providerId: string;
}

export interface SearchInput {
  orgId: string;
  employeeId: string;
  query: string;
  entityTypes?: SearchEntityType[];
  limit?: number;
}
