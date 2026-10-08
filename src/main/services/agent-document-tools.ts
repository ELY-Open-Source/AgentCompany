import { optionalEnum, optionalLimit, optionalText, requireString } from "./agent-tool-args";
import { requestDeliverableReview } from "./agent-deliverable-tools";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import { DocumentService } from "./document-service";
import type { JsonRecord } from "./provider-http";
import type { ToolDefinition } from "./provider-tool-turn";
import { relevantItems } from "./relevance";
import { PAGE_TOOL_PROPERTIES, pageText, readPageArgs } from "./text-paging";

export const DOCUMENT_TYPES = ["prd", "spec", "memo", "report", "runbook", "proposal", "policy", "guide"] as const;

interface DocumentRow {
  id: string;
  title: string;
  doc_type: string;
  status: string;
  content: string;
  updated_at: string;
  task_id: string | null;
  task_title: string | null;
}

export const DOCUMENT_TOOLS: ToolDefinition[] = [
  {
    name: "list_documents",
    description: "Find company documents (PRDs, specs, reports, ...) by words in their title or body, or by type. Returns doc_ids for read_document.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Words to look for; omit to list the newest documents." },
        doc_type: { type: "string", enum: [...DOCUMENT_TYPES] },
        limit: { type: "number", description: "Most documents to return (default 10, max 30)." },
      },
      required: [],
    },
  },
  {
    name: "read_document",
    description: "Read a company document by doc_id — whole, a range of lines, or only the lines matching a search.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { doc_id: { type: "string" }, ...PAGE_TOOL_PROPERTIES },
      required: ["doc_id"],
    },
  },
  {
    name: "update_document",
    description: "Replace a company document's content (and optionally its title). Say why in reason.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        doc_id: { type: "string" },
        content: { type: "string", description: "The full new content in markdown." },
        title: { type: "string" },
        reason: { type: "string", description: "What changed and why." },
      },
      required: ["doc_id", "content", "reason"],
    },
  },
];

export function listDocumentsTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const query = optionalText(args.query, "query");
  const docType = args.doc_type === undefined ? null : optionalEnum(args.doc_type, "doc_type", DOCUMENT_TYPES, "");
  const limit = optionalLimit(args.limit, "limit", 10, 30);
  const rows = deps.db.prepare(`
    select d.id, d.title, d.doc_type, d.status, d.content, d.updated_at, d.task_id, t.title as task_title
    from documents d left join tasks t on t.id = d.task_id
    where d.org_id = ? and (? is null or d.doc_type = ?) order by d.updated_at desc
  `).all(ctx.orgId, docType, docType) as unknown as DocumentRow[];
  const found = query ? relevantItems(rows, (row) => `${row.title} ${row.content}`, query, limit) : rows.slice(0, limit);
  if (found.length === 0) return query ? `No documents match "${query}".` : "No documents yet.";
  return found.map((row) => `${row.title} (doc_id=${row.id}, ${row.doc_type}, ${row.status}, ${row.content.length} chars, updated ${row.updated_at}${producedBy(row)})`).join("\n");
}

export function readDocumentTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const id = requireString(args.doc_id, "doc_id");
  const doc = deps.db.prepare("select title, doc_type, status, content from documents where id = ? and org_id = ?")
    .get(id, ctx.orgId) as { title: string; doc_type: string; status: string; content: string } | undefined;
  if (!doc) throw new Error(`No document with doc_id "${id}".`);
  return `${doc.title} (${doc.doc_type}, ${doc.status})\n\n${pageText(doc.title, doc.content, readPageArgs(args))}`;
}

export function updateDocumentTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const id = requireString(args.doc_id, "doc_id");
  const doc = deps.db.prepare("select title, doc_type, status from documents where id = ? and org_id = ?")
    .get(id, ctx.orgId) as { title: string; doc_type: string; status: string } | undefined;
  if (!doc) throw new Error(`No document with doc_id "${id}".`);
  const content = requireString(args.content, "content");
  const title = optionalText(args.title, "title") ?? doc.title;
  const reason = requireString(args.reason, "reason");
  new DocumentService(deps.db).update({ orgId: ctx.orgId, documentId: id, title, content, status: doc.status });
  const review = requestDeliverableReview(deps, ctx, {
    title: `Review ${doc.doc_type} update: ${title}`,
    details: `Document "${title}" was updated by an agent run (${content.length} chars). Reason: ${reason}`,
    sourceEntityType: "document",
    sourceEntityId: id,
  });
  return `Updated document "${title}" (doc_id=${id}).${review ? " The update is queued for board review in Approvals." : ""}`;
}

function producedBy(row: DocumentRow): string {
  if (row.task_id === null || row.task_title === null) return "";
  return `, from task "${row.task_title}" task_id=${row.task_id}`;
}
