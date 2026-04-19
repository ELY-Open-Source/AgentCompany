import type { AppDatabase } from "../database";
import type { DesktopEvent } from "@shared/types";
import type { NotificationOptions } from "../notification-service";
import type { createBudgetEnforcementService } from "../budget-enforcement-service";
import type { ProjectedSkill } from "../skill-types";

export type WorkspaceLockMode = "exclusive" | "shared" | "none";

export interface WorkspaceResolution {
  workspace: ReturnType<AppDatabase["getWorkspace"]>;
  lockMode: WorkspaceLockMode;
  source: "task" | "agent" | "project" | "company_fallback" | "none";
}

export interface AutomationDispatch {
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

export interface EnqueueRunPayload {
  runId: string;
  companyId: string;
  /** Null for heartbeat runs (agent wake-ups with no assigned task). */
  taskId: string | null;
  taskTitle: string;
  taskDescription: string;
  agentId: string;
  agentName: string;
  connectorId: string;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceMode: WorkspaceLockMode;
  command: string;
  model: string | null;
  thinkingEffort: string | null;
  env: Record<string, string>;
  sessionParams: Record<string, unknown> | null;
  systemPrompt: string | null;
  trigger: string | null;
  /** Task session id used by SqliteSessionStore to load/append messages. */
  taskSessionId: string;
  /** Execution mode from the owning company. */
  executionMode: "ai_ceo" | "ai_cofounder";
}

export interface OrchestrationDependencies {
  db: AppDatabase;
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  publishDomainChanged: () => void;
  emitEvent: (event: DesktopEvent) => void;
  notify: (options: NotificationOptions) => void;
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  getApiPort: () => number;
  dispatchAutomation: (trigger: string, ctx: AutomationDispatch) => void;
  hasWorkerReady: () => boolean;
  enqueueWorkerRun: (payload: EnqueueRunPayload) => void;
  isQuitting: () => boolean;
  listRuntimeSkillEntries: (companyId: string, agentId: string, connectorId: string) => ProjectedSkill[];
  budgetService: ReturnType<typeof createBudgetEnforcementService>;
  /** Checkpoint engine for unified co-founder mode pause decisions. */
  checkpointEngine?: { shouldPauseHeartbeat: (companyId: string, agentId: string) => boolean };
  getSessionHandoff?: (agentId: string) => string | null;
  evaluatePreRunSessionRotation?: (agentId: string, connectorId: string) => {
    rotated: boolean;
    handoff: string | null;
    /**
     * The session id the next run should use. Equals the freshly-minted
     * session id after a rotation, or the unchanged agent session id when
     * no rotation fired. Null if the agent has no session yet (first run).
     */
    sessionId: string | null;
  };
}
