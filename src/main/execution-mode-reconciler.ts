import log from "electron-log/main.js";
import { resolveApprovalDecision } from "./approval-policy";
import type { AppDatabase } from "./database";

type ReconcileExecutionModeChangeInput = {
  db: AppDatabase;
  companyId: string;
  previousExecutionMode: string;
  nextExecutionMode: string;
  previousReviewDeliverables: boolean;
  nextReviewDeliverables: boolean;
  handleApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
};

const COFOUNDER_TRANSITION_APPROVAL_TYPES = [
  "deliverable_review",
  "document_review",
  "plan_review",
  "scope_review",
  "draft_review",
  "strategy_review",
  "exception_review",
  "approve_ceo_strategy",
] as const;

const REVIEW_WAIT_STATE_TYPES = new Set(["user_reply", "user_review", "user_approval"]);

function collectImpactedAgentIdsFromWaitStates(db: AppDatabase, companyId: string): Set<string> {
  const agentIds = new Set<string>();
  const waitStates = db.core.threads.listThreadWaitStates(companyId);
  for (const waitState of waitStates) {
    const thread = db.core.threads.getThread(waitState.threadId, companyId);
    if (!thread || thread.relatedEntityType !== "task" || !thread.relatedEntityId) continue;
    try {
      const task = db.core.entity.getTask(thread.relatedEntityId);
      if (task.assigneeAgentId) {
        agentIds.add(task.assigneeAgentId);
      }
    } catch (err) {
      log.warn(`[execution-mode-reconciler] getTask failed for ${thread.relatedEntityId}:`, err instanceof Error ? err.message : String(err));
      continue;
    }
  }
  return agentIds;
}

function collectImpactedAgentIdsFromReviewState(db: AppDatabase, companyId: string): Set<string> {
  const agentIds = new Set<string>();
  const flaggedTasks = db.queryAll<{ assigneeAgentId: string | null }>(
    "select assignee_agent_id as assigneeAgentId from tasks where company_id = ? and requires_user_review = 1",
    companyId,
  );
  for (const task of flaggedTasks) {
    if (task.assigneeAgentId) {
      agentIds.add(task.assigneeAgentId);
    }
  }
  const pendingApprovals = db.queryAll<{ requestedByAgentId: string | null; relatedTaskId: string | null }>(
    `select requested_by_agent_id as requestedByAgentId, related_task_id as relatedTaskId
       from approvals
      where company_id = ?
        and state = 'pending'
        and type = 'deliverable_review'`,
    companyId,
  );
  for (const approval of pendingApprovals) {
    if (approval.requestedByAgentId) {
      agentIds.add(approval.requestedByAgentId);
    }
    if (!approval.relatedTaskId) continue;
    try {
      const task = db.core.entity.getTask(approval.relatedTaskId);
      if (task.assigneeAgentId) {
        agentIds.add(task.assigneeAgentId);
      }
    } catch (err) {
      log.warn(`[execution-mode-reconciler] getTask failed for approval ${approval.relatedTaskId}:`, err instanceof Error ? err.message : String(err));
      continue;
    }
  }
  return agentIds;
}

function resumeAgents(db: AppDatabase, companyId: string, agentIds: Iterable<string>): void {
  for (const agentId of agentIds) {
    try {
      const agent = db.core.entity.getAgent(agentId);
      if (agent.companyId !== companyId) continue;
      if (["terminated", "pending_approval"].includes(agent.status)) continue;
      if (!agent.heartbeatEnabled) {
        db.core.agents.setHeartbeat(agent.id, true, agent.heartbeatIntervalSec || 120);
      }
    } catch (err) {
      log.warn(`[execution-mode-reconciler] resumeAgents failed for ${agentId}:`, err instanceof Error ? err.message : String(err));
      continue;
    }
  }
}

export function reconcileExecutionModeChange({
  db,
  companyId,
  previousExecutionMode,
  nextExecutionMode,
  previousReviewDeliverables,
  nextReviewDeliverables,
  handleApprovalResolved,
}: ReconcileExecutionModeChangeInput): void {
  const leavingCofounderMode =
    previousExecutionMode === "ai_cofounder" && nextExecutionMode === "ai_ceo";
  const disablingDeliverableReviews =
    previousReviewDeliverables && !nextReviewDeliverables;

  if (!leavingCofounderMode && !disablingDeliverableReviews) {
    return;
  }

  const impactedAgents = new Set<string>([
    ...collectImpactedAgentIdsFromWaitStates(db, companyId),
    ...collectImpactedAgentIdsFromReviewState(db, companyId),
  ]);

  if (leavingCofounderMode) {
    const pendingApprovals = db.queryAll<{ id: string; type: string }>(
      `select id, type
         from approvals
        where company_id = ?
          and state = 'pending'
          and type in (${COFOUNDER_TRANSITION_APPROVAL_TYPES.map(() => "?").join(", ")})`,
      companyId,
      ...COFOUNDER_TRANSITION_APPROVAL_TYPES,
    );
    for (const approval of pendingApprovals) {
      resolveApprovalDecision({
        db,
        handleApprovalResolved,
        companyId,
        approvalId: approval.id,
        state: "approved",
        decisionNote: "Auto-approved because the company switched to AI CEO mode.",
        detail: `Mode transition auto-approved ${approval.type}.`,
        actor: "system",
      });
    }

    const waitStates = db.core.threads.listThreadWaitStates(companyId);
    for (const waitState of waitStates) {
      if (!REVIEW_WAIT_STATE_TYPES.has(waitState.waitingFor)) continue;
      db.core.threads.resolveThreadWaitState(waitState.id, companyId);
    }
  }

  if (disablingDeliverableReviews || leavingCofounderMode) {
    const tasks = db.queryAll<{ id: string }>(
      "select id from tasks where company_id = ? and requires_user_review = 1",
      companyId,
    );
    for (const task of tasks) {
      db.core.tasks.setTaskRequiresUserReview(task.id, false);
    }
  }

  resumeAgents(db, companyId, impactedAgents);
}
