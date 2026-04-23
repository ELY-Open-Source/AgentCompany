import type { AppDatabase } from "../database";
import type {
  AutomationAction,
  DesktopEvent,
  RunStatus,
} from "@shared/types";
import type { NotificationOptions } from "../notification-service";

/** Document types considered important enough to gate behind user review when reviewDeliverables is enabled. */
export const IMPORTANT_DOCUMENT_TYPES = new Set([
  "prd", "technical_spec", "design_doc", "project_brief", "proposal",
  "budget_proposal", "architecture_decision", "contract", "sop",
]);

export interface WorkflowStepState {
  id: string;
  name: string;
  action: AutomationAction;
  configJson: string;
  assigneeDepartment: string | null;
  assigneeAgentId: string | null;
  requiresApproval: boolean;
  timeoutSec: number;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

export interface AutomationEventContext {
  companyId: string;
  taskId?: string;
  agentId?: string;
  runId?: string;
  projectId?: string;
  department?: string;
  previousStatus?: string;
  newStatus?: string;
  costUsd?: number;
}

export interface AutomationDependencies {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  emitEvent: (event: DesktopEvent) => void;
  publishDomainChanged: () => void;
  notify: (options: NotificationOptions) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
  queueBrowserActionExecution: (actionId: string, companyId: string) => void;
  isQuitting: () => boolean;
}

export interface RunFinishedEvent {
  status: RunStatus;
  summary: string | null;
  errorMessage: string | null;
}
