import { z } from "zod";
import { optionalId } from "./helpers";

export const approvalInputSchema = z.object({
  companyId: z.string().uuid(),
  relatedTaskId: optionalId,
  requestedByAgentId: optionalId,
  relatedAgentId: optionalId,
  type: z.enum(["hire_agent", "approve_ceo_strategy", "dangerous_command", "secret_access", "budget_request", "promotion", "termination", "vendor_approval", "document_review", "production_deploy", "incident_escalation", "social_post", "deliverable_review", "budget_override", "plan_review", "scope_review", "draft_review", "strategy_review", "exception_review"]),
  payloadSummary: z.string().min(2).max(280),
  impactSummary: z.string().min(2).max(400),
  payloadJson: z.string().nullable().optional(),
});

export const approvalDecisionSchema = z.object({
  companyId: z.string().uuid(),
  approvalId: z.string().uuid(),
  state: z.enum(["approved", "rejected", "revision_requested"]),
  decisionNote: z.string().max(400).default(""),
});
