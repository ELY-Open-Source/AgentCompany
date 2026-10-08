import { RISK_LEVEL } from "../../shared/domain";
import { ApprovalService } from "./approval-service";
import { writeDeliverable } from "./deliverable-writer";
import { DocumentService } from "./document-service";
import { recordWorkspaceFile } from "./files/file-object-store";
import { requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { JsonRecord } from "./provider-http";

export function writeDeliverableTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  if (!ctx.workspace) throw new Error("No workspace is bound to this task; cannot write deliverables.");
  const path = requireString(args.path, "path");
  const content = requireString(args.content, "content");
  const written = writeDeliverable({ workspaceRoot: ctx.workspace.localPath, relativePath: path, content });
  const fileId = recordWorkspaceFile(deps.db, {
    orgId: ctx.orgId,
    ownerType: "agent",
    ownerId: ctx.agent.id,
    workspaceRoot: ctx.workspace.localPath,
    relativePath: written,
  });
  const review = requestDeliverableReview(deps, ctx, {
    title: `Review deliverable: ${written}`,
    details: `Deliverable ${written} (${content.length} chars) produced by an agent run.`,
    sourceEntityType: "file",
    sourceEntityId: fileId,
  });
  return `Wrote deliverable ${written} (file_id=${fileId}, chars=${content.length}).${review ? " It is queued for board review in Approvals." : ""}`;
}

export function createDocumentTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const title = requireString(args.title, "title");
  const docType = requireString(args.doc_type, "doc_type");
  const content = requireString(args.content, "content");
  const documentService = new DocumentService(deps.db);
  const docId = documentService.create({
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
  const review = requestDeliverableReview(deps, ctx, {
    title: `Review ${docType}: ${title}`,
    details: `Document "${title}" (${docType}, ${content.length} chars) authored by an agent run.`,
    sourceEntityType: "document",
    sourceEntityId: docId,
  });
  return `Created document "${title}" (doc_id=${docId}, type=${docType}, chars=${content.length}).${review ? " It is queued for board review in Approvals." : ""}`;
}

/**
 * In AI Co-Founder mode the operator reviews what the company produces, so
 * every deliverable and document lands in the Approvals queue. AI CEO mode
 * ships without review — that autonomy is the mode's contract.
 */
export function requestDeliverableReview(
  deps: AgentToolDeps,
  ctx: AgentToolContext,
  input: { title: string; details: string; sourceEntityType: "file" | "document"; sourceEntityId: string },
): boolean {
  const org = deps.db.prepare("select review_deliverables from organizations where id = ?")
    .get(ctx.orgId) as { review_deliverables: number } | undefined;
  if (!org) throw new Error("Organization was not found.");
  if (org.review_deliverables !== 1) return false;
  new ApprovalService(deps.db).create(
    {
      orgId: ctx.orgId,
      kind: "deliverable_review",
      title: input.title,
      details: input.details,
      risk: RISK_LEVEL.LOW,
      requestedByType: "agent",
      requestedById: ctx.agent.id,
    },
    { sourceEntityType: input.sourceEntityType, sourceEntityId: input.sourceEntityId },
  );
  return true;
}
