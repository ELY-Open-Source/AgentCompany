/**
 * Unified document-creation lifecycle.
 *
 * Two invariants:
 *
 *   1. DB-writing hooks (thread events, checkpoint approval,
 *      deliverable-review approval) commit atomically with the
 *      document row. A failure in any of them rolls back the save so
 *      the operator never sees a live document with a missing thread
 *      or a skipped approval.
 *
 *   2. Cross-process side effects (automation dispatch, reviewer wake)
 *      are durable via the `document_lifecycle_events` ledger. Every
 *      hook attempt lands a row and the processor stamps its outcome;
 *      a crash between "document saved" and "reviewer woken" is
 *      observable as a `failed` ledger row instead of a silent gap.
 *
 * The HTTP API route and the desktop IPC handler both call
 * `createDocumentWithLifecycle`, so both surfaces end up in the same
 * state after a save — no more divergence between the two entry points.
 */

import log from "electron-log/main.js";
import { IMPORTANT_DOC_TYPE_SET } from "@shared/document-categories";
import type { AppDatabase } from "./database";
import type { ThreadIntegrationService } from "./thread-integration";
import type { createCheckpointEngine } from "./checkpoint-engine";

export type CheckpointEngineLike = Pick<
  ReturnType<typeof createCheckpointEngine>,
  "onDocumentDrafted"
>;

export interface DocumentLifecycleDeps {
  db: AppDatabase;
  threadIntegration: ThreadIntegrationService;
  checkpointEngine: CheckpointEngineLike;
  dispatchAutomation: (trigger: string, ctx: { companyId: string; [key: string]: unknown }) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
  publishDomainChanged: () => void;
  logger: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface DocumentLifecycleInput {
  id?: string | null;
  companyId: string;
  type: string;
  title: string;
  content: string;
  authorAgentId: string | null;
  reviewerAgentId: string | null;
  projectId: string | null;
  goalId: string | null;
  parentDocId: string | null;
  version: number;
  status: string;
  tagsJson: string;
  sourceRunId: string | null;
}

export interface DocumentLifecycleOutcome {
  id: string;
  isNew: boolean;
  taskId: string | null;
  deliverableReviewApprovalId: string | null;
}

export type SideEffectHook = "automation_dispatch" | "reviewer_wake";

interface PendingSideEffect {
  eventId: string;
  hook: SideEffectHook;
  run: () => void;
}

export function createDocumentWithLifecycle(
  deps: DocumentLifecycleDeps,
  input: DocumentLifecycleInput,
): DocumentLifecycleOutcome {
  const pendingSideEffects: PendingSideEffect[] = [];

  const outcome = deps.db.withTransaction(() => {
    const isNew = !input.id;
    const id = deps.db.saveDocument(input);
    const taskId = deriveTaskIdFromRun(deps.db, input.sourceRunId, input.companyId, deps.logger);

    let deliverableReviewApprovalId: string | null = null;
    if (isNew) {
      // DB-writing hooks run inside the transaction. Any throw rolls
      // back `saveDocument` along with the thread event / approvals.
      deps.threadIntegration.onDocumentCreated(
        input.companyId,
        input.authorAgentId,
        taskId,
        input.title,
      );
      deps.checkpointEngine.onDocumentDrafted(
        input.companyId,
        id,
        input.title,
        input.type,
        input.authorAgentId,
        taskId,
      );
      if (IMPORTANT_DOC_TYPE_SET.has(input.type)) {
        deliverableReviewApprovalId = maybeRaiseDeliverableReviewApproval(deps, input, id, taskId);
      }

      // Side effects (cross-process / advisory) land in the ledger so
      // a post-commit failure is observable instead of a silent gap.
      const automationEventId = deps.db.documentLifecycleEvents.enqueue({
        companyId: input.companyId,
        documentId: id,
        hookType: "automation_dispatch",
        payloadJson: JSON.stringify({
          trigger: "document_created",
          agentId: input.authorAgentId,
          projectId: input.projectId,
        }),
      });
      pendingSideEffects.push({
        eventId: automationEventId,
        hook: "automation_dispatch",
        run: () => deps.dispatchAutomation("document_created", {
          companyId: input.companyId,
          agentId: input.authorAgentId ?? undefined,
          projectId: input.projectId ?? undefined,
        }),
      });

      if (input.reviewerAgentId && input.reviewerAgentId !== input.authorAgentId) {
        const wakeEventId = deps.db.documentLifecycleEvents.enqueue({
          companyId: input.companyId,
          documentId: id,
          hookType: "reviewer_wake",
          payloadJson: JSON.stringify({ reviewerAgentId: input.reviewerAgentId }),
        });
        const reviewerAgentId = input.reviewerAgentId;
        const companyId = input.companyId;
        pendingSideEffects.push({
          eventId: wakeEventId,
          hook: "reviewer_wake",
          run: () => {
            deps.wakeAgentIfPossible(reviewerAgentId, companyId, "assignment");
          },
        });
      }
    }

    return { id, isNew, taskId, deliverableReviewApprovalId };
  });

  for (const pending of pendingSideEffects) {
    runSideEffect(deps, pending);
  }

  deps.publishDomainChanged();
  return outcome;
}

function runSideEffect(deps: DocumentLifecycleDeps, pending: PendingSideEffect): void {
  try {
    deps.db.documentLifecycleEvents.markRunning(pending.eventId);
  } catch (error) {
    deps.logger.warn(
      `[document-lifecycle] markRunning failed for ${pending.eventId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  try {
    pending.run();
    deps.db.documentLifecycleEvents.markSucceeded(pending.eventId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.error(
      `[document-lifecycle] hook ${pending.hook} failed for event ${pending.eventId}: ${message}`,
    );
    try {
      deps.db.documentLifecycleEvents.markFailed(pending.eventId, message);
    } catch (markError) {
      deps.logger.warn(
        `[document-lifecycle] markFailed failed for ${pending.eventId}: ${markError instanceof Error ? markError.message : String(markError)}`,
      );
    }
  }
}

function deriveTaskIdFromRun(
  db: AppDatabase,
  runId: string | null,
  companyId: string,
  logger: DocumentLifecycleDeps["logger"],
): string | null {
  if (!runId) return null;
  try {
    const run = db.getRun(runId);
    if (run.companyId !== companyId) return null;
    return run.taskId ?? null;
  } catch (error) {
    logger.warn(
      `[document-lifecycle] getRun(${runId}) failed while deriving taskId: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function maybeRaiseDeliverableReviewApproval(
  deps: DocumentLifecycleDeps,
  input: DocumentLifecycleInput,
  documentId: string,
  taskId: string | null,
): string | null {
  const companySettings = deps.db.getCompanyApprovalSettings(input.companyId);
  if (!companySettings?.reviewDeliverables) return null;
  if (deps.db.getCompanyExecutionMode(input.companyId) === "ai_cofounder") return null;
  if (deps.db.hasPendingDeliverableReviews(input.companyId)) return null;

  const approvalId = deps.db.requestApproval({
    companyId: input.companyId,
    relatedTaskId: taskId,
    requestedByAgentId: input.authorAgentId ?? "",
    type: "deliverable_review",
    payloadSummary: `Review deliverable: ${input.title}`.slice(0, 280),
    impactSummary: `New ${input.type.replaceAll("_", " ")} created. Awaiting your review before workflow continues.`.slice(0, 400),
    payloadJson: JSON.stringify({
      documentIds: [documentId],
      documents: [{ id: documentId, type: input.type, title: input.title }],
    }),
  });

  if (input.authorAgentId) {
    try {
      const agent = deps.db.getAgent(input.authorAgentId);
      if (agent.heartbeatEnabled) {
        deps.db.setHeartbeat(input.authorAgentId, false, agent.heartbeatIntervalSec || 120);
      }
    } catch (error) {
      deps.logger.warn(
        `[document-lifecycle] heartbeat pause failed for agent ${input.authorAgentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return approvalId;
}

export const defaultLogger: DocumentLifecycleDeps["logger"] = log;
