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
import type { DocumentLifecycleProcessor } from "./document-lifecycle-processor";

export type CheckpointEngineLike = Pick<
  ReturnType<typeof createCheckpointEngine>,
  "onDocumentDrafted"
>;

export interface DocumentLifecycleDeps {
  db: AppDatabase;
  threadIntegration: ThreadIntegrationService;
  checkpointEngine: CheckpointEngineLike;
  /**
   * Drains the ledger rows this save enqueued. The processor reads from
   * `document_lifecycle_events` (not from an in-memory closure) so a
   * crash between commit and dispatch is self-healing — the next sweep
   * picks up anything left as `pending`. Callers still see the immediate
   * happy-path outcome because `drainForDocument` is synchronous.
   */
  lifecycleProcessor: Pick<DocumentLifecycleProcessor, "drainForDocument">;
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

export function createDocumentWithLifecycle(
  deps: DocumentLifecycleDeps,
  input: DocumentLifecycleInput,
): DocumentLifecycleOutcome {
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

      // Side effects (cross-process / advisory) land in the ledger as
      // `pending` rows. The processor drains them post-commit — not a
      // memoised closure — so a crash between this commit and the first
      // handler attempt is self-healing: the periodic sweeper picks the
      // row up on its next tick.
      deps.db.documentLifecycleEvents.enqueue({
        companyId: input.companyId,
        documentId: id,
        hookType: "automation_dispatch",
        payloadJson: JSON.stringify({
          trigger: "document_created",
          agentId: input.authorAgentId,
          projectId: input.projectId,
        }),
      });

      if (input.reviewerAgentId && input.reviewerAgentId !== input.authorAgentId) {
        deps.db.documentLifecycleEvents.enqueue({
          companyId: input.companyId,
          documentId: id,
          hookType: "reviewer_wake",
          payloadJson: JSON.stringify({ reviewerAgentId: input.reviewerAgentId }),
        });
      }
    }

    return { id, isNew, taskId, deliverableReviewApprovalId };
  });

  if (outcome.isNew) {
    // Immediate synchronous drain so the happy path behaves identically
    // to the pre-processor layout. A failure inside the processor is
    // recorded on the ledger row — the ledger, not an in-memory list,
    // is what the periodic sweeper retries against.
    try {
      deps.lifecycleProcessor.drainForDocument(outcome.id);
    } catch (error) {
      deps.logger.warn(
        `[document-lifecycle] drainForDocument(${outcome.id}) threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  deps.publishDomainChanged();
  return outcome;
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
