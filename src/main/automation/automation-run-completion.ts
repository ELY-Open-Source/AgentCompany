import type { AppDatabase } from "../database";
import type { RunRecord, SectionId } from "@shared/types";
import type { NotificationOptions } from "../notification-service";
import type { AutomationEventContext, RunFinishedEvent } from "./types";
import { IMPORTANT_DOCUMENT_TYPES } from "./types";

function localizeNotification(locale: string | null | undefined, en: string, zh: string): string {
  return locale === "zh" ? zh : en;
}

export interface RunCompletionDeps {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  publishDomainChanged: () => void;
  notify: (options: NotificationOptions) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
}

export interface RunCompletionCallbacks {
  dispatchAutomation: (trigger: string, ctx: AutomationEventContext) => void;
  handleTaskStatusChange: (taskId: string, companyId: string, previousStatus: string, newStatus: string) => void;
}

// ─── Pure helpers exported for testing ─────────────────────────────────────

export type DeliverableTaskType = "code" | "research" | "content" | "management" | "general";

/** Returns true for task types that require a tangible artifact before auto-advancing. */
export function needsDeliverableCheck(taskType: DeliverableTaskType | string): boolean {
  return taskType === "research" || taskType === "content";
}

export interface DeliverableCheckInput {
  taskType: DeliverableTaskType | string;
  hasKnowledgeEntry: boolean;
  hasDocument: boolean;
  hasSubstantialComment: boolean;
}

/** Returns the next task status and comment after a successful run. */
export function determinePostRunStatus(input: DeliverableCheckInput): {
  nextStatus: "in_review" | "in_progress";
  comment: string;
} {
  if (!needsDeliverableCheck(input.taskType)) {
    return {
      nextStatus: "in_review",
      comment: "Run completed successfully. Awaiting review.",
    };
  }
  const delivered = input.hasKnowledgeEntry || input.hasDocument || input.hasSubstantialComment;
  if (delivered) {
    return {
      nextStatus: "in_review",
      comment: "Run completed with deliverable. Awaiting review.",
    };
  }
  return {
    nextStatus: "in_progress",
    comment: `${input.taskType} task run completed but no deliverable artifact was detected. Flagging for manager review.`,
  };
}

export interface BudgetThresholdInput {
  name: string;
  budgetMonthlyUsd: number;
  spentMonthlyUsd: number;
}

/**
 * Fires budget threshold notifications when utilization >= 80%.
 * The notify callback receives a NotificationOptions-style object so callers
 * can forward it directly to the notification service.
 */
export function checkBudgetThreshold(
  agent: BudgetThresholdInput,
  notify: (opts: { title: string; body: string; urgency: "critical" | "informational"; navigation: { section: SectionId }; batchKey?: string }) => void,
  localizeNotification: (en: string, zh: string) => string,
): void {
  if (agent.budgetMonthlyUsd <= 0) return;
  const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
  if (utilization < 0.8) return;

  const pct = Math.round(utilization * 100);
  notify({
    title: localizeNotification("Budget Warning", "预算警告"),
    body: localizeNotification(
      `${agent.name} has used ${pct}% of monthly budget`,
      `${agent.name} 已使用月度预算的 ${pct}%`,
    ),
    urgency: "informational",
    navigation: { section: "costs" },
    batchKey: "budget_alerts",
  });

  if (utilization >= 1.0) {
    notify({
      title: localizeNotification("Budget Exhausted", "预算耗尽"),
      body: localizeNotification(
        `${agent.name} has reached 100% of monthly budget and is paused`,
        `${agent.name} 已达到月度预算上限并已暂停`,
      ),
      urgency: "critical",
      navigation: { section: "costs" },
    });
  }
}

// ─── Internal DB-backed deliverable check ───────────────────────────────────

function checkRunProducedDeliverable(db: AppDatabase, runId: string, companyId: string, taskId: string): boolean {
  return db.runProducedDeliverable(runId, companyId, taskId);
}

/** Returns important documents created during this run (matching IMPORTANT_DOCUMENT_TYPES). */
function findImportantDocsForRun(db: AppDatabase, runId: string, companyId: string): Array<{ id: string; type: string; title: string }> {
  const placeholders = [...IMPORTANT_DOCUMENT_TYPES].map(() => "?").join(", ");
  // Prefer causal binding, fall back to time-window for legacy data
  const causal = db.queryAll<{ id: string; type: string; title: string }>(
    `select id, type, title from documents where company_id = ? and type in (${placeholders}) and source_run_id = ?`,
    companyId, ...IMPORTANT_DOCUMENT_TYPES, runId,
  );
  if (causal.length > 0) return causal;
  return db.queryAll<{ id: string; type: string; title: string }>(
    `select id, type, title from documents where company_id = ? and type in (${placeholders}) and source_run_id is null and created_at >= (select started_at from runs where id = ?)`,
    companyId, ...IMPORTANT_DOCUMENT_TYPES, runId,
  );
}

/** Creates a deliverable_review approval and fires OS notification. */
function createDeliverableReviewApproval(
  deps: RunCompletionDeps,
  companyId: string,
  taskId: string,
  agentId: string,
  docs: Array<{ id: string; type: string; title: string }>,
  reviewerNote?: string,
): string {
  const { db, logger, publishDomainChanged, notify } = deps;
  const docTitles = docs.map((d) => d.title).join(", ");
  const approvalId = db.requestApproval({
    companyId,
    relatedTaskId: taskId,
    requestedByAgentId: agentId,
    type: "deliverable_review",
    payloadSummary: `Review deliverable: ${docTitles}`.slice(0, 280),
    impactSummary: reviewerNote ?? "Agent completed work with important deliverables. Awaiting your final review.",
    payloadJson: JSON.stringify({ documentIds: docs.map((d) => d.id), documents: docs }),
  });
  db.setTaskRequiresUserReview(taskId, false);
  const agent = db.getAgent(agentId);
  if (agent.heartbeatEnabled) {
    db.setHeartbeat(agentId, false, agent.heartbeatIntervalSec || 120);
    logger.info(`[deliverable-review] Paused heartbeat for ${agent.name} — awaiting user review.`);
  }
  notify({
    title: "Deliverable Ready for Review",
    body: `${docTitles}`.slice(0, 200),
    urgency: "informational",
    navigation: { section: "approvals", entityId: approvalId },
    batchKey: "deliverable_review",
  });
  publishDomainChanged();
  return approvalId;
}

/** Advances a task to in_review and optionally flags deliverables for user review. */
function advanceToInReview(
  deps: RunCompletionDeps,
  callbacks: RunCompletionCallbacks,
  run: RunRecord,
  taskId: string,
  statusMessage: string,
): void {
  const { db, logger, publishDomainChanged } = deps;
  db.advanceTaskStatus(taskId, "in_review", statusMessage);
  callbacks.handleTaskStatusChange(taskId, run.companyId, "in_progress", "in_review");
  const company = db.listSnapshot().companies.find((c) => c.id === run.companyId);
  if (company?.reviewDeliverables) {
    const importantDocs = findImportantDocsForRun(db, run.id, run.companyId);
    if (importantDocs.length > 0) {
      db.setTaskRequiresUserReview(taskId, true);
      const agent = db.getAgent(run.agentId);
      if (agent.heartbeatEnabled) {
        db.setHeartbeat(agent.id, false, agent.heartbeatIntervalSec || 120);
        logger.info(`[deliverable-review] Paused heartbeat for ${agent.name} — deliverable flagged for review.`);
      }
      const chain = db.getChainOfCommand(agent.id);
      if (chain.length === 0) {
        createDeliverableReviewApproval(deps, run.companyId, taskId, run.agentId, importantDocs);
      }
    }
  }
  publishDomainChanged();
}

export function processRunCompletion(
  deps: RunCompletionDeps,
  callbacks: RunCompletionCallbacks,
  run: RunRecord,
  event: RunFinishedEvent,
  isQuitting: () => boolean,
): void {
  if (isQuitting()) return;
  const { db, logger: _logger, publishDomainChanged, notify, wakeAgentIfPossible } = deps;
  const { dispatchAutomation, handleTaskStatusChange } = callbacks;

  let task: ReturnType<typeof db.getTask> | null = null;
  try {
    task = db.getTask(run.taskId);
  } catch (error) {
    deps.logger.warn(`[automation] processRunCompletion: task ${run.taskId} not found for run ${run.id}:`, error);
    return;
  }
  if (!task) return;

  const isSuccess = event.status === "succeeded";
  const isFailed = event.status === "failed" || event.status === "timed_out";

  let effectiveStatus = task.status;

  if (isSuccess && effectiveStatus === "in_progress") {
    // Delegate the task-type → deliverable-required decision to the pure
    // helper so production and tests share a single source of truth.
    const taskType = task.taskType ?? "general";

    if (needsDeliverableCheck(taskType)) {
      const hasDeliverable = checkRunProducedDeliverable(db, run.id, run.companyId, task.id);
      if (!hasDeliverable) {
        // Don't auto-advance -- flag for manager review
        db.advanceTaskStatus(task.id, "in_progress",
          `${taskType} task run completed but no deliverable artifact was detected. Flagging for manager review.`);
        handleTaskStatusChange(task.id, run.companyId, "in_progress", "in_progress");
        // Wake manager for review
        try {
          const agent = db.getAgent(run.agentId);
          const chain = db.getChainOfCommand(agent.id);
          if (chain.length > 0) {
            wakeAgentIfPossible(chain[0].id, run.companyId, "review_needed");
          }
        } catch (error) {
          deps.logger.warn(
            `[automation] deliverable-review manager wake failed for agent ${run.agentId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        publishDomainChanged();
        // Skip the normal in_review advance
      } else {
        advanceToInReview(deps, callbacks, run, task.id, "Run completed with deliverable. Awaiting review.");
        effectiveStatus = "in_review";
      }
    } else {
      // Code/management/general tasks advance normally
      advanceToInReview(deps, callbacks, run, task.id, "Run completed successfully. Awaiting review.");
      effectiveStatus = "in_review";
    }
  }

  if (isSuccess && task.isHeartbeat && effectiveStatus !== "done") {
    db.advanceTaskStatus(task.id, "done", "Heartbeat check completed.");
    handleTaskStatusChange(task.id, run.companyId, effectiveStatus, "done");
  }

  const automationContext: AutomationEventContext = {
    companyId: run.companyId,
    taskId: run.taskId,
    agentId: run.agentId,
    runId: run.id,
  };
  try {
    const agent = db.getAgent(run.agentId);
    automationContext.department = agent.department ?? undefined;
  } catch (err) {
    deps.logger.warn(`[automation] getAgent failed for ${run.agentId} during run completion; dropping department from context:`, err instanceof Error ? err.message : String(err));
  }

  if (isSuccess) {
    dispatchAutomation("run_completed", automationContext);
    if (task.parentId) {
      try {
        const siblings = db.listChildTasks(task.parentId, run.companyId);
        const allSiblingsDoneOrReview = siblings.every((entry) => entry.status === "done" || entry.status === "in_review");
        if (allSiblingsDoneOrReview) {
          const parent = db.getTask(task.parentId);
          if (parent.assigneeAgentId) {
            wakeAgentIfPossible(parent.assigneeAgentId, run.companyId, "subtask_completed");
          } else {
            const assignedId = db.autoAssignTask(parent.id, run.companyId);
            if (assignedId) {
              wakeAgentIfPossible(assignedId, run.companyId, "subtask_completed");
            }
          }
        }
      } catch (err) {
        deps.logger.warn(`[automation] Parent task ${task.parentId} cascade failed during run completion:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  if (isFailed) {
    dispatchAutomation("run_failed", automationContext);
  }

  // Budget threshold check runs after every succeeded run; finishRun
  // has already summed cost_entries and updated spentMonthlyUsd, so we
  // just read the post-run spend and fire if it crosses 80%.
  if (isSuccess) {
    try {
      const agent = db.getAgent(run.agentId);
      if (agent.budgetMonthlyUsd > 0) {
        const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
        if (utilization >= 0.8) {
          dispatchAutomation("budget_threshold", {
            ...automationContext,
            agentId: agent.id,
          });
        }
      }
      const budgetLocale = db.listSnapshot().locale;
      checkBudgetThreshold(
        agent,
        notify,
        (en, zh) => localizeNotification(budgetLocale, en, zh),
      );
    } catch (err) {
      deps.logger.warn(`[automation] Budget follow-up failed for agent ${run.agentId}:`, err instanceof Error ? err.message : String(err));
    }
  }
}
