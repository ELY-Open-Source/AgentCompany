/** Thread Integration — wires thread runtime into orchestration callbacks. */

import type { ExecutionMode } from "@shared/types";
import {
  type ThreadIntegrationDeps,
  findTaskThread,
  ensureTaskThread,
  ensureApprovalThread,
  announceApprovalToBoard,
  notifyThreadSubscribers,
} from "./thread-helpers";

export type { ThreadIntegrationDeps } from "./thread-helpers";

export function createThreadIntegration({ db, logger, emitEvent, publishDomainChanged, notify }: ThreadIntegrationDeps) {
  return {
    /**
     * Called when a new task is created.
     * Creates a thread for the task and records the creation event.
     */
    onTaskCreated(taskId: string, companyId: string): void {
      try {
        const task = db.core.entity.getTask(taskId);
        if (task.companyId !== companyId) return;

        const thread = ensureTaskThread(db, taskId, companyId, task.title);

        db.core.threads.addThreadEvent({
          threadId: thread.id,
          actorId: task.assigneeAgentId ?? "system",
          actorType: task.assigneeAgentId ? "agent" : "system",
          eventType: "system_note",
          body: `Task created: "${task.title}"`,
          metadataJson: JSON.stringify({ taskId, status: task.status, priority: task.priority }),
        });

        // Auto-enroll assignee and human as participants
        if (task.assigneeAgentId) {
          db.core.threads.addParticipant({ threadId: thread.id, participantId: task.assigneeAgentId, participantType: "agent", role: "owner" });
          db.core.threads.subscribe({ threadId: thread.id, subscriberId: task.assigneeAgentId, subscriberType: "agent" });
        }
        db.core.threads.addParticipant({ threadId: thread.id, participantId: "user", participantType: "user", role: "observer" });
        db.core.threads.subscribe({ threadId: thread.id, subscriberId: "user", subscriberType: "user" });
      } catch (err) {
        logger.error(`[thread-integration] onTaskCreated failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    /**
     * Called when a task's status changes.
     * Records the transition as a thread event.
     * In ai_cofounder mode, creates a wait state when task enters review.
     */
    onTaskStatusChanged(taskId: string, companyId: string, previousStatus: string, newStatus: string): void {
      try {
        const task = db.core.entity.getTask(taskId);
        if (task.companyId !== companyId) return;

        const thread = ensureTaskThread(db, taskId, companyId, task.title);

        db.core.threads.addThreadEvent({
          threadId: thread.id,
          actorId: task.assigneeAgentId ?? "system",
          actorType: task.assigneeAgentId ? "agent" : "system",
          eventType: "status_change",
          body: `${previousStatus} → ${newStatus}`,
          metadataJson: JSON.stringify({ taskId, previousStatus, newStatus }),
        });

        // In co-founder mode, set wait state when task enters review
        if (newStatus === "in_review") {
          const mode = db.core.company.getCompanyExecutionMode(companyId) as ExecutionMode;
          if (mode === "ai_cofounder") {
            const reason = `@Board review needed: Task "${task.title}" is ready for your review.`;
            db.core.threads.setThreadWaitState({
              threadId: thread.id,
              companyId,
              waitingFor: "user_review",
              relatedApprovalId: null,
              reason,
            });
            notifyThreadSubscribers(db, thread.id, task.title, reason, notify);
          }
        }

        // Resolve wait states when task moves past review
        if (previousStatus === "in_review" && (newStatus === "done" || newStatus === "in_progress")) {
          const waitStates = db.core.threads.listThreadWaitStates(companyId);
          for (const ws of waitStates) {
            if (ws.threadId === thread.id && ws.waitingFor === "user_review") {
              db.core.threads.resolveThreadWaitState(ws.id, companyId);
            }
          }
        }
      } catch (err) {
        logger.error(`[thread-integration] onTaskStatusChanged failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    /**
     * Called when an approval is created (by API server or automation).
     * Records the approval request in the task's thread and sets a wait state
     * in ai_cofounder mode.
     */
    onApprovalCreated(approvalId: string, companyId: string, taskId: string | null, approvalType: string, summary: string): void {
      try {
        const approval = db.core.approvals.getApprovalRecord(approvalId);
        const task = taskId ? db.core.entity.getTask(taskId) : null;
        const thread = task
          ? ensureTaskThread(db, task.id, companyId, task.title)
          : ensureApprovalThread(db, approvalId, companyId, summary || approval.payloadSummary);

        db.core.threads.addThreadEvent({
          threadId: thread.id,
          actorId: "system",
          actorType: "system",
          eventType: "approval_request",
          body: summary ? `@Board ${summary}` : `@Board approval required: ${approvalType}`,
          metadataJson: JSON.stringify({ approvalId, approvalType }),
        });

        if (approval.requestedByAgentId) {
          db.core.threads.addParticipant({ threadId: thread.id, participantId: approval.requestedByAgentId, participantType: "agent", role: "owner" });
          db.core.threads.subscribe({ threadId: thread.id, subscriberId: approval.requestedByAgentId, subscriberType: "agent" });
        }
        db.core.threads.addParticipant({ threadId: thread.id, participantId: "user", participantType: "user", role: "observer" });
        db.core.threads.subscribe({ threadId: thread.id, subscriberId: "user", subscriberType: "user" });

        // In co-founder mode, set wait state for user approval
        const mode = db.core.company.getCompanyExecutionMode(companyId) as ExecutionMode;
        if (mode === "ai_cofounder") {
          const approvalReason = `@Board approval needed: ${approvalType}`;
          db.core.threads.setThreadWaitState({
            threadId: thread.id,
            companyId,
            waitingFor: "user_approval",
            relatedApprovalId: approvalId,
            reason: approvalReason,
          });
          notifyThreadSubscribers(db, thread.id, thread.title, approvalReason, notify);
        }
        announceApprovalToBoard(db, approval, { emitEvent, publishDomainChanged, logger });
      } catch (err) {
        logger.error(`[thread-integration] onApprovalCreated failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    /**
     * Called when an approval is resolved (approved/rejected).
     * Records the decision in the relevant thread and resolves wait states.
     */
    onApprovalResolved(approvalId: string, companyId: string, decision: string): void {
      try {
        // Resolve any wait states linked to this approval
        const waitStates = db.core.threads.listThreadWaitStates(companyId);
        for (const ws of waitStates) {
          if (ws.relatedApprovalId === approvalId) {
            db.core.threads.resolveThreadWaitState(ws.id, companyId);

            // Add decision event to the thread
            db.core.threads.addThreadEvent({
              threadId: ws.threadId,
              actorId: "user",
              actorType: "user",
              eventType: "approval_decision",
              body: `Approval ${decision}`,
              metadataJson: JSON.stringify({ approvalId, decision }),
            });
          }
        }
      } catch (err) {
        logger.error(`[thread-integration] onApprovalResolved failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    /**
     * Called when a document is created or updated.
     * Records in the task thread if linked to a task.
     */
    onDocumentCreated(companyId: string, authorAgentId: string | null, taskId: string | null, documentTitle: string): void {
      try {
        if (!taskId) return;

        db.core.entity.getTask(taskId); // validates task exists and belongs to company
        const thread = findTaskThread(db, taskId, companyId);
        if (!thread) return;

        db.core.threads.addThreadEvent({
          threadId: thread.id,
          actorId: authorAgentId ?? "system",
          actorType: authorAgentId ? "agent" : "system",
          eventType: "file_attachment",
          body: `Document created: "${documentTitle}"`,
          metadataJson: JSON.stringify({ taskId, authorAgentId }),
        });
      } catch (err) {
        logger.error(`[thread-integration] onDocumentCreated failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    /**
     * Called when a run starts for a task.
     * Records the run start in the task thread.
     */
    onRunStarted(runId: string, taskId: string | null, agentId: string, companyId: string): void {
      if (!taskId) return;
      try {
        const thread = findTaskThread(db, taskId, companyId);
        if (!thread) return;

        db.core.threads.addThreadEvent({
          threadId: thread.id,
          actorId: agentId,
          actorType: "agent",
          eventType: "system_note",
          body: "Execution started",
          metadataJson: JSON.stringify({ runId, agentId }),
        });
      } catch (err) {
        logger.error(`[thread-integration] onRunStarted failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    /**
     * Called when a run finishes (success or failure).
     * Records in the task thread. In ai_cofounder mode, creates a
     * wait state for user review on successful completion.
     */
    onRunFinished(runId: string, taskId: string, agentId: string, companyId: string, status: string, errorMessage: string | null): void {
      try {
        const thread = findTaskThread(db, taskId, companyId);
        if (!thread) return;

        const body = status === "succeeded"
          ? "Execution completed successfully"
          : `Execution ${status}${errorMessage ? `: ${errorMessage}` : ""}`;

        db.core.threads.addThreadEvent({
          threadId: thread.id,
          actorId: agentId,
          actorType: "agent",
          eventType: "system_note",
          body,
          metadataJson: JSON.stringify({ runId, status, errorMessage }),
        });

        // In co-founder mode, successful runs create a user_reply wait state
        // so the heartbeat pauses until the human reviews the output
        if (status === "succeeded") {
          const mode = db.core.company.getCompanyExecutionMode(companyId) as ExecutionMode;
          if (mode === "ai_cofounder") {
            const task = db.core.entity.getTask(taskId);
            const completionReason = `@Board review needed: Agent completed work on "${task.title}" — awaiting your review.`;
            db.core.threads.setThreadWaitState({
              threadId: thread.id,
              companyId,
              waitingFor: "user_reply",
              relatedApprovalId: null,
              reason: completionReason,
            });
            notifyThreadSubscribers(db, thread.id, task.title, completionReason, notify);
          }
        }
      } catch (err) {
        logger.error(`[thread-integration] onRunFinished failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    /**
     * Called when a human user sends a message.
     * Resolves thread wait states using a precision hierarchy:
     * 1. If waitStateId is provided, resolves only that exact wait state (checkpoint-precise).
     * 2. Else if threadId is provided, resolves all user_* wait states for that thread.
     * 3. Else if toAgentId is provided (direct message), resolves wait states for threads
     *    assigned to that agent.
     * 4. Otherwise (company-wide broadcast), only resolves user_reply wait states.
     *    user_review and user_approval require scoped resolution via thread or approval UI.
     */
    onHumanMessage(companyId: string, toAgentId?: string | null, threadId?: string | null, waitStateId?: string | null): void {
      try {
        // Most precise: resolve a single identified wait state
        if (waitStateId) {
          db.core.threads.resolveThreadWaitState(waitStateId, companyId);
          return;
        }

        // Scoped resolution: threadId or toAgentId resolve all user_* types
        const SCOPED_WAIT_TYPES = new Set(["user_reply", "user_review"]);
        const isScoped = Boolean(threadId || toAgentId);

        const waitStates = db.core.threads.listThreadWaitStates(companyId);
        for (const ws of waitStates) {
          if (isScoped) {
            if (!SCOPED_WAIT_TYPES.has(ws.waitingFor)) continue;
          } else {
            // Company-wide fallback: only resolve user_reply to prevent
            // accidental resolution of reviews/approvals from casual messages
            if (ws.waitingFor !== "user_reply") continue;
          }

          if (threadId) {
            if (ws.threadId !== threadId) continue;
          } else if (toAgentId) {
            const thread = db.core.threads.getThread(ws.threadId, companyId);
            if (!thread || thread.relatedEntityType !== "task" || !thread.relatedEntityId) continue;
            try {
              const task = db.core.entity.getTask(thread.relatedEntityId);
              if (task.assigneeAgentId !== toAgentId) continue;
            } catch (err) {
              logger.warn(`[thread-integration] getTask failed for thread ${ws.threadId}:`, err instanceof Error ? err.message : String(err));
              continue;
            }
          }

          db.core.threads.resolveThreadWaitState(ws.id, companyId);
        }
      } catch (err) {
        logger.error(`[thread-integration] onHumanMessage failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    hasUnresolvedWaitStates(companyId: string): boolean {
      try {
        const waitStates = db.core.threads.listThreadWaitStates(companyId);
        return waitStates.length > 0;
      } catch (err) {
        logger.warn(`[thread-integration] hasUnresolvedWaitStates query failed for company ${companyId}; treating as blocked:`, err instanceof Error ? err.message : String(err));
        return true;
      }
    },

    /**
     * Checks whether a specific agent has unresolved thread wait states
     * across task, approval, and freeform threads. The query lives on
     * `db.hasUnresolvedWaitStateForAgent` so the heartbeat scheduler and
     * the pi `beforeToolCall` hook share one source of truth.
     */
    hasUnresolvedWaitStatesForAgent(companyId: string, agentId: string): boolean {
      try {
        return db.core.threads.hasUnresolvedWaitStateForAgent(companyId, agentId);
      } catch (err) {
        logger.warn(`[thread-integration] hasUnresolvedWaitStatesForAgent query failed (company=${companyId} agent=${agentId}); treating as blocked:`, err instanceof Error ? err.message : String(err));
        return true;
      }
    },

    /**
     * Returns the count of unresolved wait states for a company.
     * Used by the inbox to show "waiting on you" badge count.
     */
    countUnresolvedWaitStates(companyId: string): number {
      try {
        return db.core.threads.listThreadWaitStates(companyId).length;
      } catch (err) {
        logger.warn(`[thread-integration] countUnresolvedWaitStates failed for company ${companyId}:`, err instanceof Error ? err.message : String(err));
        return 0;
      }
    },
  };
}

export type ThreadIntegrationService = ReturnType<typeof createThreadIntegration>;
