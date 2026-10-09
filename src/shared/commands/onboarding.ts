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

/** The unfinished wizard as saved between launches; it has no key field, so a key is never stored before launch. */
export interface OnboardingDraft {
  step: "welcome" | "provider" | "company" | "mode" | "mission";
  companyName: string;
  companyDescription: string;
  employeeName: string;
  workspacePath: string;
  executionMode: "ai_ceo" | "ai_cofounder";
  providerKey: string;
  providerBaseUrl: string;
  providerModel: string;
  goalTitle: string;
  goalDescription: string;
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
  /** Hits to skip, for the next page. */
  offset?: number;
}
