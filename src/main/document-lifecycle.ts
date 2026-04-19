/**
 * Unified document-creation lifecycle.
 *
 * Previous layout had two divergent entry points: the HTTP API
 * (`routes-files.ts`) fired thread, checkpoint, automation, reviewer-wake,
 * and deliverable-review side effects, while the desktop IPC save path
 * (`ipc-content-operations-handlers.ts`) only fired automation and the
 * reviewer wake. A document created from the API and one created from the
 * desktop reviewer ended up in inconsistent thread-event and checkpoint
 * states, so the UI showed different lifecycle progress depending on
 * which surface produced the row.
 *
 * This module is the single owner of "what happens when a new document
 * lands in the DB". Both entry points call `createDocumentWithLifecycle`
 * and rely on its deterministic fan-out. Update-only edits (when `id` is
 * present) skip the creation-time side effects but still publish the
 * domain-change event via `publishDomainChanged`.
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
  /** Run that produced the save call, or null for operator-authored saves. */
  sourceRunId: string | null;
}

export interface DocumentLifecycleOutcome {
  id: string;
  isNew: boolean;
  /** Task derived from the originating run, if any — used for thread/approval binding. */
  taskId: string | null;
  /** Approval raised by the deliverable-review gate, when applicable. */
  deliverableReviewApprovalId: string | null;
}

/**
 * Save a document and dispatch every downstream side effect associated
 * with its creation. Side effects are fired inside individual `try`s
 * because this is the authoritative fanout — an early throw should not
 * prevent later hooks from running (e.g. an automation failure must not
 * suppress the thread event).
 */
export function createDocumentWithLifecycle(
  deps: DocumentLifecycleDeps,
  input: DocumentLifecycleInput,
): DocumentLifecycleOutcome {
  const isNew = !input.id;
  const id = deps.db.saveDocument(input);
  const taskId = deriveTaskIdFromRun(deps.db, input.sourceRunId, input.companyId, deps.logger);

  if (isNew) {
    fireCreationHooks(deps, input, id, taskId);
  }

  let deliverableReviewApprovalId: string | null = null;
  if (isNew && IMPORTANT_DOC_TYPE_SET.has(input.type)) {
    deliverableReviewApprovalId = maybeRaiseDeliverableReviewApproval(deps, input, id, taskId);
  }

  deps.publishDomainChanged();
  return { id, isNew, taskId, deliverableReviewApprovalId };
}

function fireCreationHooks(
  deps: DocumentLifecycleDeps,
  input: DocumentLifecycleInput,
  documentId: string,
  taskId: string | null,
): void {
  try {
    deps.dispatchAutomation("document_created", {
      companyId: input.companyId,
      agentId: input.authorAgentId ?? undefined,
      projectId: input.projectId ?? undefined,
    });
  } catch (error) {
    deps.logger.warn(
      `[document-lifecycle] dispatchAutomation failed for document ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    deps.threadIntegration.onDocumentCreated(
      input.companyId,
      input.authorAgentId,
      taskId,
      input.title,
    );
  } catch (error) {
    deps.logger.warn(
      `[document-lifecycle] threadIntegration.onDocumentCreated failed for ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    deps.checkpointEngine.onDocumentDrafted(
      input.companyId,
      documentId,
      input.title,
      input.type,
      input.authorAgentId,
      taskId,
    );
  } catch (error) {
    deps.logger.warn(
      `[document-lifecycle] checkpointEngine.onDocumentDrafted failed for ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (input.reviewerAgentId && input.reviewerAgentId !== input.authorAgentId) {
    try {
      deps.wakeAgentIfPossible(input.reviewerAgentId, input.companyId, "assignment");
    } catch (error) {
      deps.logger.warn(
        `[document-lifecycle] reviewer wake failed for ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
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

/**
 * Raises a `deliverable_review` approval when the company has opted in,
 * the document type is important, execution mode is `ai_ceo` (cofounder
 * mode handles reviews via the checkpoint engine), and no pending
 * deliverable review already exists. Mirrors the gate that used to live
 * inline in `routes-files.ts`; consolidating it here ensures operator-
 * created documents get the same reviewer treatment.
 */
function maybeRaiseDeliverableReviewApproval(
  deps: DocumentLifecycleDeps,
  input: DocumentLifecycleInput,
  documentId: string,
  taskId: string | null,
): string | null {
  try {
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
  } catch (error) {
    deps.logger.warn(
      `[document-lifecycle] deliverable-review gate failed for document ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** Re-export for backwards-compatible logging in callers that do not have electron-log wired. */
export const defaultLogger: DocumentLifecycleDeps["logger"] = log;
