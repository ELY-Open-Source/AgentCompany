/**
 * Document type categories shared between db, route handlers, and clients.
 *
 * IMPORTANT_DOC_TYPES are the document types that trigger deliverable-review
 * approvals (PRDs, specs, design docs, contracts, etc.). The ordering matters
 * for some lookup queries; keep this in sync with database/documents.ts.
 */
export const IMPORTANT_DOC_TYPES = [
  "prd",
  "technical_spec",
  "design_doc",
  "project_brief",
  "proposal",
  "budget_proposal",
  "architecture_decision",
  "contract",
  "sop",
] as const;

export type ImportantDocType = (typeof IMPORTANT_DOC_TYPES)[number];

export const IMPORTANT_DOC_TYPE_SET: ReadonlySet<string> = new Set(IMPORTANT_DOC_TYPES);
