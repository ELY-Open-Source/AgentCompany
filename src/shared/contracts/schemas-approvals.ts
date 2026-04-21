import { z } from "zod";
import { optionalId } from "./helpers";

// Schema-typed attachment pointers. Agents used to jam everything into the
// free-form `payloadJson` string, which meant the board UI had to parse JSON
// blind and hope the keys matched. documentIds / workProductIds make the
// attachment contract schema-visible: validators see them, the HTTP route
// folds them back into payloadJson for persistence, and the inspector renders
// them deterministically in the "linked documents" panel on the first screen.
// payloadJson remains as the escape hatch for type-specific structured
// fields (social post drafts, hire proposals, etc.).
export const approvalInputSchema = z.object({
  companyId: z.string().uuid(),
  relatedTaskId: optionalId,
  requestedByAgentId: optionalId,
  relatedAgentId: optionalId,
  type: z.enum(["hire_agent", "approve_ceo_strategy", "dangerous_command", "secret_access", "budget_request", "promotion", "termination", "vendor_approval", "document_review", "production_deploy", "incident_escalation", "social_post", "deliverable_review", "budget_override", "plan_review", "scope_review", "draft_review", "strategy_review", "exception_review"]),
  payloadSummary: z.string().min(2).max(280),
  impactSummary: z.string().min(2).max(400),
  // payloadJson: type-specific structured fields only (social draft, hire
  // proposal, etc). DEPRECATED: embedding `documentIds` / `workProductIds` /
  // `documents[]` / `workProducts[]` here. Use the top-level schema fields
  // below — they are the canonical source of truth for attachment pointers.
  // Legacy embedded mirrors are still read for back-compat but new callers
  // must not write them.
  payloadJson: z.string().nullable().optional(),
  // CANONICAL attachment pointers. mergeApprovalAttachments folds these into
  // payloadJson at persist time so on-disk rows have a single readable shape,
  // but the schema top-level is the authoritative contract.
  documentIds: z.array(z.string().uuid()).optional(),
  workProductIds: z.array(z.string().uuid()).optional(),
});

/**
 * Merge canonical documentIds / workProductIds (schema top-level) into
 * payloadJson so downstream readers (ApprovalDocumentsPanel,
 * extractApprovalDocumentReferences) see a single source of truth.
 *
 * Throws if payloadJson is non-empty but not valid JSON-object: the previous
 * behavior stuffed the opaque string under `rawPayload` which hid producer
 * bugs (an agent passing a stringified-twice JSON, or a literal "undefined")
 * and silently broke attachment rendering. Let it crash at the boundary.
 */
export function mergeApprovalAttachments(
  payloadJson: string | null | undefined,
  documentIds: string[] | undefined,
  workProductIds: string[] | undefined,
): string | null {
  const hasDocs = Array.isArray(documentIds) && documentIds.length > 0;
  const hasProducts = Array.isArray(workProductIds) && workProductIds.length > 0;
  if (!hasDocs && !hasProducts) return payloadJson ?? null;

  let base: Record<string, unknown> = {};
  if (payloadJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadJson);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `mergeApprovalAttachments: payloadJson is not valid JSON (${detail}). ` +
          `payloadJson must be a JSON object or null; free-text payloads are not supported.`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `mergeApprovalAttachments: payloadJson must be a JSON object (got ${
          Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed
        }).`,
      );
    }
    base = parsed as Record<string, unknown>;
  }

  if (hasDocs) base.documentIds = documentIds;
  if (hasProducts) base.workProductIds = workProductIds;
  return JSON.stringify(base);
}

export const approvalDecisionSchema = z.object({
  companyId: z.string().uuid(),
  approvalId: z.string().uuid(),
  state: z.enum(["approved", "rejected", "revision_requested"]),
  decisionNote: z.string().max(400).default(""),
});
