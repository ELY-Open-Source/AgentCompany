import type { AppDatabase } from "../database";
import type { DesktopEvent } from "@shared/types";
import type { NotificationOptions } from "../notification-service";
import type { createBudgetEnforcementService } from "../budget-enforcement-service";
import type { ProjectedSkill } from "../skill-types";

export type WorkspaceLockMode = "exclusive" | "shared" | "none";

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
  agentId: string;
  agentName: string;
  connectorId: string;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceMode: WorkspaceLockMode;
  model: string | null;
  thinkingEffort: string | null;
  env: Record<string, string>;
  systemPrompt: string | null;
  trigger: string | null;
  /** Task session id used by SqliteSessionStore to load/append messages. */
  taskSessionId: string;
  /** Execution mode from the owning company. */
  executionMode: "ai_ceo" | "ai_cofounder";
  /**
   * The literal user-role turn the worker seeds onto the pi Agent to
   * kick off the loop. Resolved at dispatch time — for task runs this is
   * the task title/description; for communication wakes it binds to the
   * actual inbox rows (message_id, sender, subject) so the agent lands
   * on a concrete action cue instead of a context-free `Continue.`.
   */
  initialUserTurn: string;
  /**
   * Internal tools main decides to inject for this specific run (C4).
   * Currently only CEOs with hire authority receive `hire_agent` and
   * `file_approval`; any other agent's `internalTools` is empty. The
   * decision is made at dispatch time from the resolved CEO mode so the
   * worker never re-derives it.
   */
  internalTools: ReadonlyArray<"hire_agent" | "file_approval">;
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
