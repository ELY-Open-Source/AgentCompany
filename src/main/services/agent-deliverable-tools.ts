import { RISK_LEVEL } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { withSavepoint } from "../database/connection";
import { holdDeliverable, reviewsDeliverables, type HeldTarget } from "./held-deliverables";
import { ApprovalService } from "./approval-service";
import { writeDeliverable } from "./deliverable-writer";
import { DocumentService } from "./document-service";
import { recordWorkspaceFile } from "./files/file-object-store";
import { requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { JsonRecord } from "./provider-http";

const REVIEW_EXCERPT_CHARS = 4000;

export function writeDeliverableTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  if (!ctx.workspace) throw new Error("No workspace is bound to this task; cannot write deliverables.");
  const path = requireString(args.path, "path");
  const content = requireString(args.content, "content");
  if (reviewsDeliverables(deps.db, ctx.orgId)) {
    holdForReview(deps, ctx, { kind: "file", workspaceRoot: ctx.workspace.localPath, relativePath: path }, content, `Review deliverable: ${path}`);
    return `Deliverable ${path} (${content.length} chars) is held for board review in Approvals. It is not written until approved, so no one can use it yet.`;
  }
  const written = writeDeliverable({ workspaceRoot: ctx.workspace.localPath, relativePath: path, content });
  const fileId = recordWorkspaceFile(deps.db, {
    orgId: ctx.orgId,
    ownerType: "agent",
    ownerId: ctx.agent.id,
    workspaceRoot: ctx.workspace.localPath,
    relativePath: written,
  });
  return `Wrote deliverable ${written} (file_id=${fileId}, chars=${content.length}).`;
}

export function createDocumentTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const title = requireString(args.title, "title");
  const docType = requireString(args.doc_type, "doc_type");
  const content = requireString(args.content, "content");
  if (reviewsDeliverables(deps.db, ctx.orgId)) {
    holdForReview(deps, ctx, { kind: "document_create", title, docType }, content, `Review ${docType}: ${title}`);
    return `Document "${title}" (${docType}, ${content.length} chars) is held for board review in Approvals. It is not created until approved, so no one can use it yet.`;
  }
  const docId = new DocumentService(deps.db).create({
    orgId: ctx.orgId,
    title,
    docType,
    content,
    authorAgentId: ctx.agent.id,
    reviewerAgentId: null,
    projectId: ctx.taskProjectId,
    goalId: ctx.taskGoalId,
    taskId: ctx.taskId,
  });
  return `Created document "${title}" (doc_id=${docId}, type=${docType}, chars=${content.length}).`;
}

/** In AI Co-Founder mode the board reviews what the company produces before it exists; AI CEO mode ships without review. */
export function holdForReview(deps: AgentToolDeps, ctx: AgentToolContext, target: HeldTarget, content: string, title: string): void {
  const excerpt = content.length > REVIEW_EXCERPT_CHARS ? `${content.slice(0, REVIEW_EXCERPT_CHARS)}\n[... ${content.length - REVIEW_EXCERPT_CHARS} more chars]` : content;
  withSavepoint(deps.db, "hold_deliverable", () => {
    const heldId = createId("hld");
    const approvalId = new ApprovalService(deps.db).create(
      {
        orgId: ctx.orgId,
        kind: "deliverable_review",
        title,
        details: `Produced by an agent run (${content.length} chars). Approving writes it; declining discards it.\n\n${excerpt}`,
        risk: RISK_LEVEL.LOW,
        requestedByType: "agent",
        requestedById: ctx.agent.id,
      },
      { sourceEntityType: "held_deliverable", sourceEntityId: heldId },
    );
    holdDeliverable(deps.db, {
      id: heldId, approvalId, orgId: ctx.orgId, agentId: ctx.agent.id, taskId: ctx.taskId, goalId: ctx.taskGoalId, projectId: ctx.taskProjectId, target, content,
    });
  });
}
