/**
 * Checkpoint Engine
 *
 * Creates approval checkpoints based on company executionMode.
 * In ai_cofounder mode, key orchestration junctures pause for user confirmation.
 * In ai_ceo mode, only high-risk actions require approval.
 *
 * Policy decisions (which types require review, which can be auto-approved)
 * are centralized in execution-policy.ts — the single source of truth.
 */

import type { AppDatabase } from "./database";
import type { ApprovalType, ExecutionMode, SectionId } from "@shared/types";
import type { ThreadIntegrationService } from "./thread-integration";
import {
  CHECKPOINT_TASK_TYPES,
  STRATEGY_DOCUMENT_TYPES,
} from "./execution-policy";

interface CheckpointDeps {
  db: AppDatabase;
  logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  threadIntegration: ThreadIntegrationService;
  publishDomainChanged: () => void;
  notify: (options: { title: string; body: string; urgency: "critical" | "informational"; navigation?: { section: SectionId; entityId?: string } }) => void;
}

export function getCompanyExecutionMode(db: AppDatabase, companyId: string): ExecutionMode {
  return db.getCompanyExecutionMode(companyId) as ExecutionMode;
}

export function createCheckpointEngine(deps: CheckpointDeps) {
  const { db, logger, threadIntegration, publishDomainChanged, notify } = deps;

  return {
    /**
     * Called when a task transitions to in_progress for the first time.
     * In co-founder mode, creates a plan_review checkpoint for top-level
     * non-code tasks so the user can review the plan before execution
     * begins. Subtasks inherit their parent's review — creating a
     * checkpoint for every subtask made the whole team stall on a
     * waterfall of approvals that the operator had no chance to process
     * in real time.
     */
    onTaskStarted(taskId: string, companyId: string, agentId: string | null): string | null {
      try {
        const mode = getCompanyExecutionMode(db, companyId);
        if (mode !== "ai_cofounder") return null;

        const task = db.getTask(taskId);
        const taskType = db.getTaskType(taskId);

        // Only create plan checkpoints for non-code task types
        if (!taskType || !CHECKPOINT_TASK_TYPES.has(taskType)) return null;

        // Subtasks inherit the parent's plan review; creating a fresh
        // checkpoint per subtask produces an unbounded approval fan-out
        // that blocks the assignee's heartbeat (shouldPauseHeartbeat)
        // the moment delegation starts.
        if (task.parentId) return null;

        const approvalId = db.requestApproval({
          companyId,
          relatedTaskId: taskId,
          requestedByAgentId: agentId,
          type: "plan_review",
          payloadSummary: `Review plan for: ${task.title}`.slice(0, 280),
          impactSummary: `Task "${task.title}" is starting. Review the scope and approach before execution proceeds.`.slice(0, 400),
          payloadJson: JSON.stringify({ taskId, taskTitle: task.title, taskType }),
        });

        threadIntegration.onApprovalCreated(approvalId, companyId, taskId, "plan_review", `Plan review: ${task.title}`);

        notify({
          title: "Plan Review Needed",
          body: `"${task.title}" needs your review before work begins`,
          urgency: "informational",
          navigation: { section: "approvals", entityId: approvalId },
        });

        publishDomainChanged();
        return approvalId;
      } catch (err) {
        logger.error(`[checkpoint] onTaskStarted failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },

    /**
     * Called when a document is created in co-founder mode.
     * Creates a draft_review checkpoint so the user can review before
     * the document is considered final.
     */
    onDocumentDrafted(companyId: string, documentId: string, documentTitle: string, documentType: string, authorAgentId: string | null, taskId: string | null): string | null {
      try {
        const mode = getCompanyExecutionMode(db, companyId);
        if (mode !== "ai_cofounder") return null;

        // Strategy-related document types get strategy_review instead
        const approvalType: ApprovalType = STRATEGY_DOCUMENT_TYPES.has(documentType)
          ? "strategy_review"
          : "draft_review";

        const approvalId = db.requestApproval({
          companyId,
          relatedTaskId: taskId,
          requestedByAgentId: authorAgentId,
          type: approvalType,
          payloadSummary: `Review ${documentType.replaceAll("_", " ")}: ${documentTitle}`.slice(0, 280),
          impactSummary: `New ${documentType.replaceAll("_", " ")} drafted. Please review before it becomes final.`.slice(0, 400),
          payloadJson: JSON.stringify({ documentId, documentTitle, documentType }),
        });

        threadIntegration.onApprovalCreated(approvalId, companyId, taskId, approvalType, `${approvalType}: ${documentTitle}`);

        notify({
          title: "Draft Review Needed",
          body: `"${documentTitle}" needs your review`,
          urgency: "informational",
          navigation: { section: "approvals", entityId: approvalId },
        });

        publishDomainChanged();
        return approvalId;
      } catch (err) {
        logger.error(`[checkpoint] onDocumentDrafted failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },

    /**
     * Checks if a company in ai_cofounder mode has unresolved checkpoints
     * that should pause heartbeat for an agent.
     */
    shouldPauseHeartbeat(companyId: string, agentId: string): boolean {
      try {
        const mode = getCompanyExecutionMode(db, companyId);
        if (mode !== "ai_cofounder") return false;

        // Check for unresolved wait states for THIS agent's threads (not company-wide)
        if (threadIntegration.hasUnresolvedWaitStatesForAgent(companyId, agentId)) {
          return true;
        }

        // Check for pending approvals related to this agent's tasks
        return db.hasPendingReviewApprovalForAgent(companyId, agentId);
      } catch (err) {
        logger.error(`[checkpoint] shouldPauseHeartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },

    /**
     * Returns execution mode for a company. Convenience accessor.
     */
    getExecutionMode(companyId: string): ExecutionMode {
      return getCompanyExecutionMode(db, companyId);
    },
  };
}
